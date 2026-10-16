"""Migrations, the read-only reference database and the reference-based demo seed."""

import functools
import sqlite3
from datetime import datetime, timezone

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app import main, reference
from app.engine import decide
from app.home import HomeInput, home_summary
from app.migrate import run_migrations
from app.models import BaselineSchedule, SoilProfile, Zone
from app.seed import DEMO_ZONES, seed_demo
from test_api import client, as_role  # noqa: F401

def needs_reference(test):
    """Fail loudly (never skip) when the tracked reference database is missing."""

    @functools.wraps(test)
    def wrapper(*args, **kwargs):
        if not reference.available():
            pytest.fail(
                f"Reference database missing: {reference.REFERENCE_PATH}. "
                "It is tracked in git as data/reference/ANBIT_reference_app.db; restore it "
                "(git checkout -- data/reference) or point ANBIT_REFERENCE_DB at a copy.",
                pytrace=False,
            )
        return test(*args, **kwargs)

    return wrapper


def memory_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


def columns(engine, table):
    with engine.begin() as conn:
        return {row[1] for row in conn.exec_driver_sql(f'PRAGMA table_info("{table}")')}


def test_migration_on_empty_database_is_idempotent():
    engine = memory_engine()
    SQLModel.metadata.create_all(engine)
    assert run_migrations(engine) == ["0001_zone_irrigation_settings", "0002_sensors_and_baselines", "0003_time_indexes", "0004_zone_wetted_fraction"]
    assert run_migrations(engine) == []
    assert {"soil_class", "reference_plant_id", "irrigation_method", "flow_rate_lph", "allowed_start_hour", "allowed_end_hour", "wetted_fraction"} <= columns(engine, "zone")
    assert {"id", "zone_id", "point_id", "kind", "depth_m", "installed_at", "calibrated_at", "notes"} == columns(engine, "sensors")
    with engine.begin() as conn:
        indexes = {row[0] for row in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type = 'index'")}
    assert {"ix_soilmeasurement_zone_measured", "ix_recommendation_zone_created", "ix_irrigationevent_zone_executed"} <= indexes


def test_migration_on_existing_database_keeps_rows():
    engine = memory_engine()
    # A database from before migration 0001: the old zone columns and existing rows.
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE zone (id TEXT PRIMARY KEY, name TEXT)")
        conn.exec_driver_sql("CREATE TABLE measurementpoint (id TEXT PRIMARY KEY, zone_id TEXT)")
        conn.exec_driver_sql("CREATE TABLE soilmeasurement (id TEXT PRIMARY KEY, zone_id TEXT, measured_at TEXT)")
        conn.exec_driver_sql("CREATE TABLE recommendation (id TEXT PRIMARY KEY, zone_id TEXT, created_at TEXT)")
        conn.exec_driver_sql("CREATE TABLE irrigationevent (id TEXT PRIMARY KEY, zone_id TEXT, executed_at TEXT)")
        conn.exec_driver_sql("INSERT INTO zone VALUES ('old', 'منطقة قائمة')")
        conn.exec_driver_sql("INSERT INTO soilmeasurement VALUES ('r1', 'old', '2026-10-01T00:00:00+00:00')")
    assert len(run_migrations(engine)) == 4
    assert run_migrations(engine) == []
    with engine.begin() as conn:
        assert conn.exec_driver_sql("SELECT id, name, soil_class FROM zone").fetchall() == [("old", "منطقة قائمة", None)]
        assert conn.exec_driver_sql("SELECT COUNT(*) FROM soilmeasurement").scalar() == 1
        assert [r[0] for r in conn.exec_driver_sql("SELECT version FROM schema_version ORDER BY version")] == [1, 2, 3, 4]


@needs_reference
def test_reference_database_is_read_only():
    with reference.connect() as con:
        with pytest.raises(sqlite3.OperationalError):
            con.execute("INSERT INTO sources (key, citation) VALUES ('x', 'y')")


@needs_reference
def test_water_need_is_et0_times_kc_minus_effective_rain():
    with reference.connect() as con:
        for plant_id, month in [(21, 7), (41, 1), (33, 4)]:
            et0, rain, days = con.execute(
                "SELECT et0_mm_day, precip_mm, days FROM city_climate_monthly JOIN cities USING (city_id) WHERE name_en = 'Riyadh' AND year = 2025 AND month = ?",
                (month,),
            ).fetchone()
            kc = con.execute("SELECT kc FROM kc_monthly WHERE plant_id = ? AND month = ?", (plant_id, month)).fetchone()[0]
            need = reference.monthly_need(plant_id, month)
            assert need["et0_mm_day"] == et0 and need["kc"] == kc
            assert need["etc_mm_day"] == pytest.approx(et0 * kc, abs=1e-3)
            assert need["net_mm_day"] == pytest.approx(max(et0 * kc - rain * 0.8 / days, 0), abs=1e-3)
            view = con.execute(
                "SELECT net_need_mm_day FROM v_monthly_water_need JOIN cities USING (city_id) WHERE name_en = 'Riyadh' AND year = 2025 AND month = ? AND plant_id = ?",
                (month, plant_id),
            ).fetchone()[0]
            assert need["net_mm_day"] == pytest.approx(view, abs=0.01)


@needs_reference
def test_seed_thresholds_equal_plant_soil_targets():
    engine = memory_engine()
    SQLModel.metadata.create_all(engine)
    run_migrations(engine)
    with Session(engine) as session:
        seed_demo(session)
        zones = session.exec(select(Zone).order_by(Zone.id)).all()
        assert len(zones) == 5
        for zone, spec in zip(zones, DEMO_ZONES):
            target = reference.plant_soil_target(zone.reference_plant_id, zone.soil_class)
            soil = session.get(SoilProfile, zone.soil_id)
            assert (soil.lower_vwc, soil.target_vwc, soil.upper_vwc) == (target["vwc_min"], target["vwc_target"], target["vwc_max"])
            assert zone.root_depth_m == target["root_zone_m"]
            # The embedded fallback is the same data as the reference database.
            assert spec["fallback"] == {k: target[k] for k in ("root_zone_m", "vwc_min", "vwc_target", "vwc_max", "taw_mm", "raw_mm")}
            rate = 15 if zone.irrigation_method == "spray" else 5
            assert zone.flow_rate_lph == rate * zone.irrigated_area_m2
            assert zone.efficiency == (0.7 if zone.irrigation_method == "spray" else 0.9)
            assert (zone.allowed_start_hour, zone.allowed_end_hour) == (18, 8)
        schedules = session.exec(select(BaselineSchedule)).all()
        assert len(schedules) == 15 and all(s.label == "افتراض" for s in schedules)
        summer = {s.zone_id: s.litres_per_m2_per_day for s in schedules if s.id.endswith("summer")}
        assert summer == {"z1": 8, "z2": 4, "z3": 4, "z4": 8, "z5": 4}


@needs_reference
def test_home_uses_reference_et_for_linked_zones(client):  # noqa: F811
    with Session(main.engine) as session:
        zone = session.get(Zone, "z3")
        points, readings, soil = main.zone_data(session, zone)
        result = home_summary(zone, soil, readings, decide(zone, soil, points, readings), HomeInput(), datetime.now(timezone.utc))
    ref = result["et_reference"]
    assert ref and ref["source"] == "ET0 شهري 2025 — Open-Meteo"
    assert result["weather"]["et_mm_day"] == ref["net_mm_day"]
    assert result["default_weather"] is False and result["default_flow"] is False
    assert result["flow_l_h"] == zone.flow_rate_lph


@needs_reference
def test_reference_routes(client):  # noqa: F811
    as_role(client, "user")
    plants = client.get("/api/reference/landscape-plants").json()
    assert plants["available"] and len(plants["plants"]) == 24
    assert all(p["use_case"] in ("landscape", "both") for p in plants["plants"])
    rows = client.get("/api/baseline-schedules").json()
    assert len(rows) == 15 and all(isinstance(r["months"], list) for r in rows)


def test_main_entrance_water_need_total_and_per_m2():
    """المدخل الرئيسي: paspalum on sand, 600 m², 6% now, target 9.4%, roots 0.25 m, efficiency 0.7."""
    from app.planning import PlantSoilProfile, volume_to_target

    profile = PlantSoilProfile(
        plant="ref-22",
        soil="sand",
        evidence="Main entrance demo zone",
        field_capacity=0.10,
        wilting_point=0.04,
        threshold=0.07,
        target=0.094,
        root_depth_m=0.25,
        area_m2=600,
        efficiency=0.7,
    )
    litres = volume_to_target(profile, 0.06)["gross_l"]
    assert litres == pytest.approx(7286, abs=1)
    assert round(litres / 600, 1) == 12.1
