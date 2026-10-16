from datetime import datetime, timedelta, timezone
from copy import deepcopy
from types import SimpleNamespace
import pytest
from pydantic import ValidationError
from sqlmodel import Session, select
from app import main
from app.home import HomeInput, home_summary
from app.models import SoilMeasurement
from test_api import client, as_role
from test_planning import profile
from test_simulation import snapshot

NOW = datetime(2026, 10, 15, 12, tzinfo=timezone(timedelta(hours=3)))


def data(age=1, value=12, **overrides):
    zone = SimpleNamespace(
        id="home-test",
        revision=1,
        plant_id="test-plant",
        origin="field",
        area_m2=300,
        irrigated_area_m2=300,
        root_depth_m=0.2,
        efficiency=0.8,
        freshness_hours=24,
        conflict_vwc=0.12,
        last_irrigated_at=None,
    )
    soil = SimpleNamespace(name="demo soil", lower_vwc=0.105, target_vwc=0.14)
    reading = SimpleNamespace(
        id="home-reading",
        point_id="point",
        value=value,
        unit="vwc_percent",
        quality="verified",
        origin="field",
        measured_at=(NOW - timedelta(hours=age)).isoformat(),
    )
    for k, v in overrides.items():
        setattr(reading, k, v)
    decision = dict(
        code="review",
        soil_condition="رطوبة أقل من الحد المحدد",
        estimate={"gross_l": 1500},
    )
    return zone, soil, [reading], decision


def calculate(age=1, value=12, settings=None, **overrides):
    z, soil, readings, d = data(age, value, **overrides)
    return home_summary(
        z, soil, readings, d, HomeInput(**(settings or {"profile": profile()})), NOW
    )


def test_fresh_source_authoritative_liters_and_default_flow():
    r = calculate()
    assert r["source"] == "measured" and r["current_vwc"] == 0.12
    assert r["target_vwc"] == 0.14 and r["gross_l"] == 1500
    assert r["duration_hours"] == 3.75 and r["flow_l_h"] == 400
    assert r["default_flow"] and r["default_weather"]
    assert r["can_review"] and not r["needs_reading"]
    assert (
        not r["operational_eligible"]
        and not r["persisted"]
        and not r["hardware_triggered"]
    )
    assert not r["ml_used"]


def test_stale_is_elapsed_balance_not_a_measured_or_ml_value():
    r = calculate(age=48)
    assert r["current_vwc"] == pytest.approx(0.07)
    assert r["source"] == "estimated" and r["stale"] and r["age_hours"] == 48
    assert r["needs_reading"] and not r["can_review"]
    assert calculate(age=240)["current_vwc"] == 0.06


@pytest.mark.parametrize(
    "changes",
    [
        {"quality": "unverified"},
        {"unit": "raw"},
        {"origin": "simulation"},
        {"measured_at": (NOW + timedelta(hours=1)).isoformat()},
        {"value": 101},
        {"value": float("nan")},
    ],
)
def test_bad_start_never_generates_a_value(changes):
    r = calculate(age=48, **changes)
    assert r["current_vwc"] is None and r["gross_l"] is None and r["next_at"] is None


def test_no_reading_and_post_irrigation_are_not_extrapolated():
    z, s, readings, d = data(age=48)
    z.last_irrigated_at = (NOW - timedelta(hours=2)).isoformat()
    for rows in [readings, []]:
        r = home_summary(z, s, rows, d, HomeInput(profile=profile()), NOW)
        assert r["current_vwc"] is None and r["gross_l"] is None


def test_latest_bad_reading_cannot_fall_back_to_older_good():
    z, s, readings, d = data(age=48)
    newer = deepcopy(readings[0])
    newer.id = "newer"
    newer.measured_at = (NOW - timedelta(hours=1)).isoformat()
    newer.quality = "suspect"
    r = home_summary(z, s, readings + [newer], d, HomeInput(profile=profile()), NOW)
    assert r["current_vwc"] is None


def test_conflict_is_not_averaged_into_scenario():
    z, s, readings, d = data(age=48)
    d["code"] = "conflict"
    assert (
        home_summary(z, s, readings, d, HomeInput(profile=profile()), NOW)[
            "current_vwc"
        ]
        is None
    )


def test_target_above_fc_and_bad_window_are_rejected():
    with pytest.raises(ValidationError):
        HomeInput(profile=profile(target=0.45))
    # Windows may cross midnight (20 -> 4 is valid); only an empty window is rejected.
    assert HomeInput(allowed_start_hour=20, allowed_end_hour=4).allowed_end_hour == 4
    with pytest.raises(ValidationError):
        HomeInput(allowed_start_hour=6, allowed_end_hour=6)


def test_known_flow_and_missing_weather_are_explicit():
    r = calculate(settings={"profile": profile(flow_l_h=750)})
    assert r["duration_hours"] == 2 and not r["default_flow"]
    assert r["weather"]["et_mm_day"] == 5 and r["default_weather"]


def test_next_time_uses_scenario_threshold_and_allowed_hours():
    r = calculate(
        age=48,
        settings={"profile": profile(), "allowed_start_hour": 4, "allowed_end_hour": 9},
    )
    at = datetime.fromisoformat(r["next_at"])
    assert 4 <= at.hour < 9 and at > NOW
    assert r["crossing_hour"] == 0
    dry = calculate(
        settings={
            "profile": profile(),
            "weather": {
                "kind": "assumed",
                "et_mm_day": 0,
                "rain_mm": 0,
                "rain_hour": 1,
                "uncertainty_vwc": 0.005,
            },
        }
    )
    assert dry["next_at"] is None


def test_duration_that_exceeds_window_requires_flow_review():
    slow = calculate(age=48)
    assert slow["next_at"] and not slow["duration_fits_window"]
    faster = calculate(age=48, settings={"profile": profile(flow_l_h=7500)})
    assert faster["next_at"] and faster["duration_fits_window"]


def test_incompatible_historical_start_is_not_clipped_into_a_measurement():
    result = calculate(age=48, value=20)
    assert result["current_vwc"] is None
    assert result["gross_l"] is None and result["needs_reading"]


def test_demo_target_comes_from_zone_not_air_or_city_data():
    z, s, readings, d = data()
    s.target_vwc = 0.29
    s.lower_vwc = 0.2
    r = home_summary(z, s, readings, d, HomeInput(), NOW)
    assert r["target_vwc"] == 0.29 and r["demo_profile"]
    assert (
        r["profile"]["field_capacity"] == 0.5 and r["profile"]["wilting_point"] == 0.06
    )


def test_home_api_is_read_only_and_role_protected(client):
    before = snapshot()
    r = client.post("/api/zones/z3/home", json={})
    assert r.status_code == 200 and not r.json()["operational_eligible"]
    assert snapshot() == before
    assert (
        client.post(
            "/api/zones/z3/home", json={"profile": profile(target=0.45)}
        ).status_code
        == 422
    )
    as_role(client, "user")
    assert client.post("/api/zones/z3/home", json={}).status_code == 403


def test_stale_home_scenario_does_not_bypass_approval(client):
    with Session(main.engine) as session:
        for m in session.exec(
            select(SoilMeasurement).where(SoilMeasurement.zone_id == "z3")
        ).all():
            m.measured_at = (
                datetime.now(timezone.utc) - timedelta(hours=48)
            ).isoformat()
            session.add(m)
        session.commit()
    home = client.post("/api/zones/z3/home", json={}).json()
    assert home["current_vwc"] is not None and home["source"] == "estimated"
    assert not home["can_review"]
    assert client.get("/api/zones/z3").json()["decision"]["code"] == "insufficient"
    rec = client.post("/api/zones/z3/recommendations").json()
    assert (
        client.patch(
            "/api/recommendations/" + rec["id"],
            json={"status": "approved", "operator": "test"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/irrigation-events",
            json={
                "id": "home-event-test",
                "recommendation_id": rec["id"],
                "volume": 100,
                "unit": "L",
                "volume_kind": "estimated",
                "executed_at": datetime.now(timezone.utc).isoformat(),
                "operator": "test",
            },
        ).status_code
        == 409
    )
    assert client.get("/api/reports/water").json()["total_l"] == 0
