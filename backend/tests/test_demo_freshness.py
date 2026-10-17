"""Demo readings keep their seeded age, so Home shows the same values on any day."""

from datetime import datetime, timedelta, timezone

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app import database, main
from app.engine import decide
from app.home import HomeInput, home_summary
from app.migrate import run_migrations
from app.models import SoilMeasurement, Zone
from app.seed import demo_reading_age_hours, refresh_demo_readings, seed_demo


def demo_session(monkeypatch):
    monkeypatch.delenv("ANBIT_SEED_SCENARIO", raising=False)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    run_migrations(engine)
    session = Session(engine)
    seed_demo(session)
    return session


def home_values(session, now):
    out = {}
    for zone in session.exec(select(Zone).order_by(Zone.id)).all():
        points, readings, soil = main.zone_data(session, zone)
        r = home_summary(zone, soil, readings, decide(zone, soil, points, readings), HomeInput(), now)
        out[zone.id] = (round(r["current_vwc"], 6), r["source"], r["dose"]["litres"], r["dose"]["litres_per_m2"])
    return out


def age_everything(session, hours):
    for r in session.exec(select(SoilMeasurement)).all():
        r.measured_at = (datetime.fromisoformat(r.measured_at) - timedelta(hours=hours)).isoformat()
        session.add(r)
    session.commit()


def test_three_days_later_a_restart_shows_day_zero_values(monkeypatch):
    session = demo_session(monkeypatch)
    now = datetime.now(timezone.utc)
    day0 = home_values(session, now)
    # The dose report values (Riyadh, October 2025 ET0).
    assert {z: v[2] for z, v in day0.items()} == {"z1": 852.4, "z2": 275.7, "z3": 52.6, "z4": 1109.6, "z5": day0["z5"][2]}
    assert day0["z5"][1] == "estimated" and 180 <= day0["z5"][2] <= 186
    assert all(v[3] <= 10 for v in day0.values())
    # Three days pass without a restart: the demo drifts (stale, larger doses).
    age_everything(session, 72)
    later = home_values(session, now)
    assert later != day0
    assert later["z1"][2] > day0["z1"][2]
    # Restart: the readings move forward and Home is back to day zero.
    moved = refresh_demo_readings(session, now)
    assert set(moved) == {"z1", "z2", "z3", "z4", "z5"} and all(abs(h - 72) < 0.1 for h in moved.values())
    assert home_values(session, now) == day0
    for zone in session.exec(select(Zone)).all():
        latest = max(datetime.fromisoformat(r.measured_at) for r in session.exec(select(SoilMeasurement).where(SoilMeasurement.zone_id == zone.id)).all())
        assert abs((now - latest).total_seconds() / 3600 - demo_reading_age_hours(zone.id)) < 1e-6
    # A second restart moves nothing.
    assert all(h == 0 for h in refresh_demo_readings(session, now).values())
    session.close()


def test_spacing_values_and_other_origins_are_kept(monkeypatch):
    session = demo_session(monkeypatch)
    now = datetime.now(timezone.utc)
    field = SoilMeasurement(id="field-1", zone_id="z1", point_id="z1-p1", value=9.0, unit="vwc_percent", measured_at=(now - timedelta(days=5)).isoformat(), source="field", operator="x", quality="verified", origin="field")
    session.add(field)
    session.commit()
    age_everything(session, 50)
    before = {r.id: (r.measured_at, r.value) for r in session.exec(select(SoilMeasurement)).all()}
    refresh_demo_readings(session, now)
    after = {r.id: (r.measured_at, r.value) for r in session.exec(select(SoilMeasurement)).all()}
    assert after["field-1"] == before["field-1"]
    sim = [k for k in before if k != "field-1"]
    for k in sim:
        assert after[k][1] == before[k][1]
        moved = datetime.fromisoformat(after[k][0]) - datetime.fromisoformat(before[k][0])
        assert abs(moved.total_seconds() / 3600 - 50) < 0.1, k
    session.close()


def test_zone_irrigated_after_its_readings_is_left_alone(monkeypatch):
    session = demo_session(monkeypatch)
    now = datetime.now(timezone.utc)
    age_everything(session, 24)
    zone = session.get(Zone, "z2")
    zone.last_irrigated_at = (now - timedelta(hours=2)).isoformat()
    session.add(zone)
    session.commit()
    moved = refresh_demo_readings(session, now)
    assert "z2" not in moved and "z1" in moved
    session.close()


def test_only_the_demo_database_is_refreshed(tmp_path):
    demo = create_engine(f"sqlite:///{database.DEMO_DB_PATH}")
    assert database.is_demo_database(demo)
    assert not database.is_demo_database(create_engine(f"sqlite:///{database.BACKEND / 'anbit.db'}"))
    assert not database.is_demo_database(create_engine(f"sqlite:///{tmp_path / 'demo.db'}"))
    assert not database.is_demo_database(create_engine("sqlite://"))
    # The API tests' in-memory engine is never treated as the demo file.
    source = (database.BACKEND / "app" / "main.py").read_text(encoding="utf-8")
    assert "if is_demo_database(engine):\n            refresh_demo_readings(session)" in source
