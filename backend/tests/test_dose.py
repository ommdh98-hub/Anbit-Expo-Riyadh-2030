"""Today's dose (FAO-56 high-frequency irrigation) and the demo valve sectors."""

import json
from pathlib import Path

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app import reference
from app.dose import WETTED_FRACTION, daily_dose
from app.migrate import run_migrations
from app.models import SoilMeasurement, SoilProfile, Zone
from app.seed import seed_demo

FIXTURE = Path(__file__).resolve().parents[2] / "frontend/tests/fixtures/daily-dose.json"


def demo_session(monkeypatch):
    monkeypatch.delenv("ANBIT_SEED_SCENARIO", raising=False)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    run_migrations(engine)
    session = Session(engine)
    seed_demo(session)
    return session


def test_backend_matches_the_shared_case_table():
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    assert len(cases) == 5
    for case in cases:
        assert daily_dose(**case["inputs"]) == case["expected"], case["zone"]


def test_acceptance_october_riyadh_every_zone_within_limits():
    for case in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]:
        dose = daily_dose(**case["inputs"])
        assert dose["litres"] <= 1500, case["zone"]
        assert dose["litres"] / dose["effective_area_m2"] <= 10, case["zone"]
        assert dose["net_mm"] <= case["inputs"]["raw_mm"] + 1e-9
        assert dose["net_mm"] <= dose["deficit_mm"] + 1e-9


def test_backend_matches_the_stressed_cases():
    stressed = json.loads(FIXTURE.read_text(encoding="utf-8"))["stressed_cases"]
    assert len(stressed) == 5
    for case in stressed:
        assert daily_dose(**case["inputs"]) == case["expected"], case["zone"]


def test_stressed_zone_gets_the_recovery_dose():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in data["stressed_cases"]:
        i, dose = case["inputs"], daily_dose(**case["inputs"])
        root_mm = i["root_depth_m"] * 1000
        assert i["current_vwc"] < i["vwc_min"] and dose["recovery"] is True
        expected = min((i["vwc_min"] - i["current_vwc"]) * root_mm + i["et0_mm_day"] * i["kc"], i["raw_mm"])
        assert dose["net_mm"] == pytest.approx(expected, abs=1e-3), case["zone"]
        assert dose["net_mm"] <= i["raw_mm"] + 1e-9
        # Back at or above the minimum after one event (before the day's use).
        assert i["current_vwc"] + dose["net_mm"] / root_mm >= i["vwc_min"] - 1e-9, case["zone"]
        assert dose["recovery_events"] == 1
    # الممر الأخضر as on Home (12.9% vs 13.8%) stays within the acceptance limits.
    z5 = next(c for c in data["stressed_cases"] if c["zone"] == "z5")
    dose = daily_dose(**z5["inputs"])
    assert dose["litres"] <= 1500 and dose["litres"] / dose["effective_area_m2"] <= 10


def test_zones_within_range_keep_their_dose():
    for case in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]:
        i = case["inputs"]
        assert i["current_vwc"] >= i["vwc_min"]
        with_min, without_min = daily_dose(**i), daily_dose(**{k: v for k, v in i.items() if k != "vwc_min"})
        assert with_min == without_min and with_min["recovery"] is False and with_min["recovery_events"] is None


def test_raw_cap_spreads_the_recovery_over_n_events():
    # 5 points below the minimum on 0.5 m roots: 25 mm + 3 mm daily need, RAW 10 mm.
    dose = daily_dose(current_vwc=0.10, target_vwc=0.20, root_depth_m=0.5, efficiency=0.9, area_m2=10, wetted_fraction=1, et0_mm_day=6, kc=0.5, raw_mm=10, vwc_min=0.15)
    assert dose["recovery"] is True and dose["net_mm"] == 10 and dose["recovery_events"] == 3


def test_raw_cap_and_wetted_area():
    capped = daily_dose(current_vwc=0.05, target_vwc=0.3, root_depth_m=1, efficiency=0.9, area_m2=100, wetted_fraction=1, et0_mm_day=20, kc=1, raw_mm=12, days_to_window=3)
    assert capped["net_mm"] == 12 and capped["refill_days"] == 21
    drip = daily_dose(current_vwc=0.15, target_vwc=0.2, root_depth_m=0.3, efficiency=0.9, area_m2=120, wetted_fraction=0.4, et0_mm_day=5, kc=0.5, raw_mm=20)
    assert drip["effective_area_m2"] == 48 and drip["litres"] == pytest.approx(2.5 / 0.9 * 48, abs=0.1)
    assert daily_dose(current_vwc=None, target_vwc=0.2, root_depth_m=0.3, efficiency=0.9, area_m2=10, wetted_fraction=1, et0_mm_day=5, kc=0.5, raw_mm=10) is None


def test_demo_zones_are_valve_sectors_starting_near_their_trigger(monkeypatch):
    if not reference.available():
        pytest.fail(f"Reference database missing: {reference.REFERENCE_PATH}", pytrace=False)
    session = demo_session(monkeypatch)
    zones = session.exec(select(Zone).order_by(Zone.id)).all()
    assert [(z.name, z.irrigated_area_m2) for z in zones] == [
        ("المدخل الرئيسي", 150),
        ("ممر النخيل", 120),
        ("أحواض الشجيرات", 80),
        ("المسطح الأوسط", 200),
        ("الممر الأخضر", 100),
    ]
    for zone in zones:
        assert zone.area_m2 == zone.irrigated_area_m2
        assert zone.wetted_fraction == WETTED_FRACTION[zone.irrigation_method]
        assert zone.flow_rate_lph == (15 if zone.irrigation_method == "spray" else 5) * zone.irrigated_area_m2
        soil = session.get(SoilProfile, zone.soil_id)
        band = soil.target_vwc - soil.lower_vwc
        for reading in session.exec(select(SoilMeasurement).where(SoilMeasurement.zone_id == zone.id)).all():
            vwc = reading.value / 100
            assert soil.lower_vwc - 1e-9 <= vwc <= soil.lower_vwc + 0.2 * band + 1e-9, (zone.id, vwc)
            assert reading.origin == "simulation"
    session.close()
