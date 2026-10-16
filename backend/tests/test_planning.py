from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import json
import pytest
from pydantic import ValidationError
from sqlmodel import Session, select
from app import main
from app.models import (
    Zone,
    SoilMeasurement,
    Recommendation,
    IrrigationEvent,
    MeasurementPoint,
)
from app.planning import (
    PlantSoilProfile,
    PlanInput,
    plan,
    volume_to_target,
    duration_hours,
    savings,
    spatial_estimate,
)
from test_api import client, as_role


def profile(**kw):
    return (
        dict(
            plant="turfgrass",
            soil="demo loamy sand",
            provenance="demo_assumption",
            evidence="FAO56 example36; not local calibration",
            field_capacity=0.15,
            wilting_point=0.06,
            threshold=0.105,
            target=0.14,
            root_depth_m=0.2,
            area_m2=300,
            efficiency=0.8,
            flow_l_h=None,
        )
        | kw
    )


def payload(**kw):
    return (
        dict(
            profile=profile(),
            baseline_mode="hypothetical",
            starting_vwc=0.12,
            weather=dict(
                kind="assumed",
                et_mm_day=5,
                rain_mm=0,
                rain_hour=18,
                uncertainty_vwc=0.005,
            ),
            mode="automatic_simulation",
            allowed_start_hour=0,
            allowed_end_hour=24,
        )
        | kw
    )


@pytest.mark.parametrize(
    "kw",
    [
        dict(target=0.45),
        dict(wilting_point=0.13),
        dict(threshold=0.14),
        dict(efficiency=0),
        dict(root_depth_m=-1),
        dict(field_capacity=1.1),
        dict(flow_l_h=0),
        dict(target=float("nan")),
        dict(area_m2=float("inf")),
    ],
)
def test_profile_constraints(kw):
    with pytest.raises(ValidationError):
        PlantSoilProfile(**profile(**kw))


def test_authoritative_volume_regression_and_duration():
    p = PlantSoilProfile(**profile(field_capacity=0.5, target=0.45, threshold=0.25))
    assert volume_to_target(p, 0.2)["gross_l"] == 18750
    assert volume_to_target(p, 0.5)["gross_l"] == 0
    assert duration_hours(800, 400) == 2
    assert duration_hours(800, None) is None


def run_plan(client, **changes):
    # This test fixture's engine is isolated; no production database is imported for writes.
    z = client.get("/api/zones/z3").json()
    with Session(main.engine) as s:
        zone = s.get(Zone, "z3")
        return plan(
            zone,
            z["decision"],
            PlanInput(**payload(**changes)),
            datetime(2026, 10, 14, 0, tzinfo=timezone.utc),
        )


def test_simulation_and_gates_remain_stateless(client):
    before = client.get("/api/zones").json()
    events = client.get("/api/irrigation-events").json()
    r = client.post("/api/zones/z3/plan", json=payload())
    assert r.status_code == 200, r.text
    result = r.json()
    assert (
        not result["operational_eligible"]
        and not result["hardware_triggered"]
        and not result["persisted"]
    )
    assert result["kind"] == "scenario_only" and len(result["forecast"]) == 25
    assert all(
        0 <= r["vwc"] <= 0.15 and 0 <= r["low"] <= r["high"] <= 1
        for r in result["forecast"]
    )
    assert client.get("/api/irrigation-events").json() == events
    after = client.get("/api/zones").json()
    for a, b in zip(before, after):
        assert a["revision"] == b["revision"] and a["measurements"] == b["measurements"]
    assert (
        client.post(
            "/api/zones/z1/plan",
            json=payload(baseline_mode="stored", starting_vwc=None),
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/zones/z3/plan",
            json=payload(baseline_mode="stored", starting_vwc=None),
        ).status_code
        == 200
    )


def test_schedule_and_cooldown(client):
    r = run_plan(client)
    assert r["schedule"] and r["schedule"][0]["hour"] <= r["crossing_hour"]
    assert r["schedule"][0]["kind"] == "simulation_proposal"
    assert r["schedule"][0]["duration_hours"] is None
    blocked = run_plan(client, last_simulated_hour=0, cooldown_hours=72)
    assert not blocked["schedule"] and blocked["blocked"]
    limited = run_plan(client, profile=profile(flow_l_h=0.01))
    assert not limited["schedule"] and limited["blocked"]
    flowing = run_plan(client, profile=profile(flow_l_h=4000))
    assert flowing["schedule"]
    event = flowing["schedule"][0]
    assert event["duration_hours"] == pytest.approx(event["volume_l"] / 4000)
    assert event["hour"] + event["duration_hours"] <= flowing["crossing_hour"]


def test_weather_missing_rain_and_uncertainty(client):
    assert run_plan(client, weather=None)["forecast"] == []
    wide = run_plan(
        client,
        weather=dict(
            kind="assumed", et_mm_day=5, rain_mm=0, rain_hour=1, uncertainty_vwc=0.05
        ),
    )
    assert not wide["schedule"] and wide["blocked"]
    wet = run_plan(
        client,
        weather=dict(
            kind="assumed", et_mm_day=0, rain_mm=100, rain_hour=1, uncertainty_vwc=0.005
        ),
    )
    assert wet["forecast"][1]["vwc"] == 0.15 and wet["forecast"][1]["unretained_mm"] > 0
    assert wet["crossing_hour"] is None
    assert (
        client.post(
            "/api/zones/z3/plan", json=payload(weather={"kind": "live"})
        ).status_code
        == 422
    )


def test_roles_and_no_forecast_bypass(client):
    as_role(client, "user")
    assert client.post("/api/zones/z3/plan", json=payload()).status_code == 403
    assert client.post("/api/irrigation-events", json={}).status_code == 403
    as_role(client, "survey")
    assert client.post("/api/zones/z3/plan", json=payload()).status_code == 200
    assert (
        client.post(
            "/api/zones/z3/plan", json=payload(profile=profile(area_m2=1000000))
        ).status_code
        == 422
    )
    assert (
        client.post("/api/zones/z3/plan", json=payload(starting_vwc=12)).status_code
        == 422
    )


def test_spatial_sparse_and_coverage_independence(client):
    z = client.get("/api/zones/z1").json()
    r = client.get("/api/zones/z1/spatial").json()
    assert r["method"] == "experimental_IDW_not_ML" and not r["operational_eligible"]
    assert len(r["measured"]) == len(z["decision"]["readings_used"])
    assert any(c["vwc"] is None for c in r["cells"])
    with Session(main.engine) as s:
        zone = s.get(Zone, "z1")
        points, readings, _ = main.zone_data(s, zone)
        sparse = spatial_estimate(
            zone,
            points,
            readings,
            z["decision"] | {"readings_used": z["decision"]["readings_used"][:1]},
        )
    assert len(sparse["measured"]) == 1 and sparse["estimated_support_fraction"] == 0
    assert all(c["vwc"] is None for c in sparse["cells"])
    assert r["next_point"] == z["decision"]["coverage"]["next_point"]
    assert r["measured_coverage"] == z["decision"]["coverage"]["fraction"]
    dense = client.get("/api/zones/z3/spatial").json()
    assert len(dense["measured"]) > 1
    assert all(c["local_spread"] >= 0 for c in dense["cells"] if c["vwc"] is not None)
    conflict = client.get("/api/zones/z4/spatial").json()
    assert conflict["estimated_support_fraction"] == 0


def test_spatial_supported_cells_and_rejected_points(client):
    from types import SimpleNamespace

    with Session(main.engine) as s:
        z = s.get(Zone, "z3")
        points = [
            SimpleNamespace(id=f"p{i}", x=z.x + 1 + i, y=z.y + 1 + i % 2)
            for i in range(3)
        ]
        readings = [
            SimpleNamespace(
                id=f"r{i}",
                point_id=f"p{i}",
                value=10 + i,
                unit="vwc_percent",
                origin="simulation",
                measured_at="2026-10-14T00:00:00Z",
            )
            for i in range(3)
        ]
        d = {
            "readings_used": [r.id for r in readings],
            "code": "measure",
            "coverage": {"fraction": 0.1, "next_point": {"x": z.x + 10, "y": z.y + 10}},
        }
        r = spatial_estimate(z, points, readings, d)
        assert 0 < r["estimated_support_fraction"] < 1
        assert all(0.1 <= c["vwc"] <= 0.12 for c in r["cells"] if c["vwc"] is not None)
        assert all(
            c["local_spread"] == pytest.approx(0.02)
            for c in r["cells"]
            if c["vwc"] is not None
        )
        assert r["measured_coverage"] == 0.1
        d["readings_used"] = []
        assert (
            spatial_estimate(z, points, readings, d)["estimated_support_fraction"] == 0
        )


def test_savings_missing_zero_and_negative():
    assert savings(10)["percent"] is None
    assert savings(10, 0)["percent"] is None
    assert savings(120, 100) == {"percent": -20, "kind": "hypothetical_comparison"}
    assert savings(80, 100, True)["percent"] == 20


def test_executive_origin_totals_and_proposals(client):
    report = client.get("/api/reports/executive?days=7").json()
    groups = {g["origin"]: g for g in report["groups"]}
    assert groups["simulation"]["total_l"] == sum(
        e["volume_l"] for e in report["events"] if e["origin"] == "simulation"
    )
    assert groups["field"]["total_l"] == 0
    assert report["savings"]["percent"] is None and report["scenario_water_l"] is None
    assert all(z["estimated_moisture"] is None for z in report["zones"])
    assert not report["forecast_quality"]["operational_eligible"]
    assert client.get("/api/reports/executive?days=0").status_code == 422
    # Create an eligible recommendation only in the fixture database; it stays proposed.
    client.post("/api/zones/z3/recommendations")
    r = client.get("/api/reports/executive").json()
    assert len(r["proposals"]) == 1 and r["proposals"][0]["gross_l"] == 21111.1
    assert r["groups"] == report["groups"]


def test_executive_separates_fixture_origins_and_retains_linked_old_decision(client):
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    with Session(main.engine) as s:
        for i, (origin, amount) in enumerate(
            [("field", 100), ("manual", 200), ("estimated", 300), ("simulation", 400)]
        ):
            rec = Recommendation(
                id=f"report-test-rec-{i}",
                zone_id="z3",
                revision=1,
                status="executed",
                result_json="{}",
                created_at=(now - timedelta(days=20)).isoformat(),
            )
            s.add(rec)
            s.add(
                IrrigationEvent(
                    id=f"report-test-event-{i}",
                    recommendation_id=rec.id,
                    zone_id="z3",
                    volume_l=amount,
                    volume_kind="measured" if i == 0 else "estimated",
                    executed_at=now.isoformat(),
                    operator="isolated-test",
                    origin=origin,
                )
            )
        s.commit()
    r = client.get("/api/reports/executive?days=7").json()
    groups = {g["origin"]: g for g in r["groups"]}
    assert groups["field"]["total_l"] == 100 and groups["field"]["measured_l"] == 100
    assert groups["manual"]["total_l"] == 200 and groups["estimated"]["total_l"] == 300
    assert groups["simulation"]["total_l"] == 400
    assert len(r["decisions"]) == 4 and all(
        v["outcome"] == "recorded_execution" for v in r["decisions"]
    )
    assert not r["proposals"] and r["savings"]["percent"] is None


def test_research_has_all_horizons_and_honest_baselines():
    root = Path(__file__).resolve().parents[2]
    data = json.loads((root / "research/turfgrass/forecast_results.json").read_text())
    assert data["modeled_rows_used"] == 0 and data["measured_rows"] == 3792
    assert {r["horizon_h"] for r in data["evaluation"]} == {1, 3, 6, 12, 24}
    assert {r["model"] for r in data["evaluation"]} == {
        "persistence",
        "balance_dry_scenario",
        "ridge_lags_weather",
        "boosted_stumps",
    }
    assert len(data["evaluation"]) == 40 and not data["operational_eligible"]
    for r in data["evaluation"]:
        assert (
            r["train_last_target"]
            < r["calibration_first_origin"]
            < r["test_first_origin"]
        )
        assert r["mae_pp"] >= 0 and r["rmse_pp"] >= r["mae_pp"]
        assert 0 <= r["test_interval_coverage"] <= 1
    old = json.loads((root / "research/turfgrass/results.json").read_text())
    assert old["archive_sha256"] == data["archive_sha256"]


def test_future_values_cannot_enter_features():
    path = Path(__file__).resolve().parents[2] / "research/turfgrass/forecast.py"
    spec = importlib.util.spec_from_file_location("forecast_research", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    from datetime import timedelta

    rows = [
        dict(
            Time=str(datetime(2021, 1, 1) + timedelta(hours=h)),
            SoilMoistureContent_Percent=str(20 - h * 0.01),
            AirTemperature_DegC="30",
            RelativeHumidity_Percent="50",
            Rainfall_mm="0",
            IrrigationAmount_mm="0",
        )
        for h in range(60)
    ]
    base = module.examples(rows, 6)[0]
    changed = deepcopy(rows)
    for row in changed[25:]:
        row["AirTemperature_DegC"] = "1000"
        row["SoilMoistureContent_Percent"] = "99"
    altered = module.examples(changed, 6)[0]
    assert base["x"] == altered["x"] and base["y"] != altered["y"]
    assert max(base["feature_times"]) <= base["time"] < base["target_time"]
