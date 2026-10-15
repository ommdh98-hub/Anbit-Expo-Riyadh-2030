import pytest
from pydantic import ValidationError
from sqlmodel import Session, select
from app import main
from app.models import (
    Zone,
    SoilMeasurement,
    MeasurementPoint,
    Recommendation,
    IrrigationEvent,
    SoilProfile,
)
from app.schemas import SimulationInput
from app.simulation import water_balance
from test_api import client, reading, as_role


def payload(**kw):
    return dict(
        volume_l=1000, irrigated_area_m2=400, root_depth_m=0.2, efficiency=0.8, **kw
    )


def test_units_and_determinism():
    r = water_balance(0.16, 1000, 400, 0.2, 0.8)
    assert r["applied_depth_mm"] == 2.5
    assert r["effective_depth_mm"] == 2
    assert r["effective_volume_l"] == 800
    assert r["delta_vwc"] == 0.01
    assert r["scenario_vwc"] == pytest.approx(0.17)
    assert r == water_balance(0.16, 1000, 400, 0.2, 0.8)
    assert water_balance(0.16, 0, 400, 0.2, 0.8)["scenario_vwc"] == 0.16
    assert water_balance(0.9, 1000, 1, 0.1, 1)["exceeds_volume_limit"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("volume_l", -1),
        ("irrigated_area_m2", 0),
        ("root_depth_m", 0),
        ("efficiency", 0),
        ("efficiency", 1.01),
        ("volume_l", "NaN"),
        ("root_depth_m", "Infinity"),
        ("volume_l", 1000001),
    ],
)
def test_invalid_api(client, field, value):
    p = payload()
    p[field] = value
    assert client.post("/api/zones/z3/simulate", json=p).status_code == 422


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite(value):
    with pytest.raises(ValidationError):
        SimulationInput(**(payload() | {"volume_l": value}))
    with pytest.raises(ValueError):
        water_balance(0.2, value, 400, 0.2, 0.8)


def test_missing_and_baseline_modes(client):
    assert (
        client.post("/api/zones/z3/simulate", json={"volume_l": 100}).status_code == 422
    )
    for zone in ["z1", "z4", "z5"]:
        assert (
            client.post(f"/api/zones/{zone}/simulate", json=payload()).status_code
            == 422
        )
        r = client.post(
            f"/api/zones/{zone}/simulate",
            json=payload(baseline_mode="hypothetical", starting_vwc=0.2),
        )
        assert r.status_code == 200
        assert r.json()["baseline_origin"] == "user_hypothesis"
        assert r.json()["baseline_reading_ids"] == []
    assert (
        client.post(
            "/api/zones/z3/simulate", json=payload(starting_vwc=0.2)
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/zones/z3/simulate", json=payload(baseline_mode="hypothetical")
        ).status_code
        == 422
    )
    p = payload()
    p["irrigated_area_m2"] = 401
    assert client.post("/api/zones/z3/simulate", json=p).status_code == 422
    assert client.post("/api/zones/absent/simulate", json=payload()).status_code == 404


def snapshot():
    with Session(main.engine) as s:
        return {
            model.__name__: [row.model_dump() for row in s.exec(select(model)).all()]
            for model in [
                Zone,
                SoilMeasurement,
                MeasurementPoint,
                Recommendation,
                IrrigationEvent,
                SoilProfile,
            ]
        }


def test_no_writes_or_official_changes(client):
    rec = client.post("/api/zones/z3/recommendations").json()
    client.patch(
        f"/api/recommendations/{rec['id']}",
        json={"status": "approved", "operator": "الفريق"},
    )
    before = snapshot()
    report = client.get("/api/reports/water").json()
    first = client.post("/api/zones/z3/simulate", json=payload())
    assert first.status_code == 200
    assert first.json()["baseline_origin"] == "simulation"
    assert len(first.json()["baseline_reading_ids"]) == 4
    assert first.json() == client.post("/api/zones/z3/simulate", json=payload()).json()
    assert snapshot() == before
    assert client.get("/api/reports/water").json() == report
    assert client.get("/api/zones/z3").json()["decision"]["code"] == "review"


def test_invalidated_baseline_and_new_reading(client):
    z = client.get("/api/zones/z1").json()
    p = z["decision"]["coverage"]["next_point"]
    as_role(client, "survey")
    client.post("/api/zones/z1/measurements", json=reading(x=p["x"], y=p["y"]))
    as_role(client, "user")
    assert client.post("/api/zones/z1/simulate", json=payload()).status_code == 200
    with Session(main.engine) as s:
        z = s.get(Zone, "z3")
        z.last_irrigated_at = reading()["measured_at"]
        s.add(z)
        s.commit()
    assert client.post("/api/zones/z3/simulate", json=payload()).status_code == 422


def test_overflow_controlled(client):
    p = payload()
    p["root_depth_m"] = 5e-324
    p["irrigated_area_m2"] = 5e-324
    assert client.post("/api/zones/z3/simulate", json=p).status_code == 422


def test_missing_root_assumption(client):
    with Session(main.engine) as s:
        z = s.get(Zone, "z3")
        z.root_representative = False
        z.root_depth_m = None
        s.add(z)
        s.commit()
    assert client.post("/api/zones/z3/simulate", json=payload()).status_code == 422
    assert (
        client.post(
            "/api/zones/z3/simulate",
            json=payload(baseline_mode="hypothetical", starting_vwc=0.2),
        ).status_code
        == 200
    )
