from datetime import datetime, timezone, timedelta
from copy import deepcopy
import pytest
from sqlmodel import Session
from app import main
from app.models import Zone, SoilProfile
from app.engine import decide, conditional_water
from test_api import client, as_role
from test_simulation import snapshot


def fixture_data():
    with Session(main.engine) as s:
        z = s.get(Zone, "z3")
        points, readings, soil = main.zone_data(s, z)
        return z, soil, points, readings


@pytest.mark.parametrize(
    "value,code", [(0.199, "review"), (0.2, "defer"), (0.3, "defer"), (0.301, "high")]
)
def test_boundaries(client, value, code):
    z, s, p, r = fixture_data()
    s.lower_vwc = 0.2
    s.target_vwc = 0.25
    s.upper_vwc = 0.3
    for m in r:
        m.value = value
        m.unit = "vwc_fraction"
    d = decide(z, s, p, r)
    assert d["code"] == code
    assert (
        d["soil_condition"]
        == {
            "review": "رطوبة أقل من الحد المحدد",
            "defer": "رطوبة ضمن النطاق المحدد",
            "high": "رطوبة أعلى من الحد المحدد",
        }[code]
    )


@pytest.mark.parametrize(
    "case",
    [
        "missing",
        "stale",
        "post",
        "conflict",
        "unverified",
        "raw",
        "invalid",
        "calibration",
        "coverage",
    ],
)
def test_unknown_condition(client, case):
    z, s, p, r = fixture_data()
    if case == "missing":
        r = []
    if case == "stale":
        for m in r:
            m.measured_at = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    if case == "post":
        z.last_irrigated_at = datetime.now(timezone.utc).isoformat()
    if case == "conflict":
        r[0].value = 95
        r[0].unit = "vwc_percent"
    if case == "unverified":
        for m in r:
            m.quality = "unverified"
    if case == "raw":
        for m in r:
            m.unit = "air_humidity"
    if case == "invalid":
        for m in r:
            m.value = float("nan")
    if case == "calibration":
        s.target_vwc = 1.2
    if case == "coverage":
        z.min_coverage = 1
        z.coverage_radius_m = 0.01
    d = decide(z, s, p, r)
    assert d["soil_condition"] == "لا تتوفر بيانات كافية لتحديد حالة التربة."
    assert d["estimate"] is None


def test_liters_units_and_no_mutation(client):
    z, s, p, r = fixture_data()
    before = snapshot()
    d = decide(z, s, p, r)
    e = d["estimate"]
    assert e["gross_l"] == 13000
    assert e["label"] == "تقدير حسابي مشروط، وليس كمية ري معتمدة ميدانيًا."
    assert e["gross_l"] == pytest.approx(
        round(
            e["area_m2"]
            * e["root_depth_m"]
            * max(0, e["target_vwc"] - e["current_vwc"])
            * 1000
            / e["efficiency"],
            1,
        )
    )
    for m in r:
        m.value = m.value / 100
        m.unit = "vwc_fraction"
    assert decide(z, s, p, r)["estimate"] == e
    assert snapshot() == before
    assert conditional_water(z, s, s.target_vwc + 0.01)["gross_l"] == 0


@pytest.mark.parametrize(
    "field,value",
    [
        ("efficiency", 0),
        ("efficiency", -1),
        ("efficiency", 1.1),
        ("efficiency", float("inf")),
        ("root_depth_m", None),
        ("irrigated_area_m2", -1),
        ("irrigated_area_m2", 100000),
        ("root_representative", False),
    ],
)
def test_missing_assumptions(client, field, value):
    z, s, p, r = fixture_data()
    setattr(z, field, value)
    assert decide(z, s, p, r)["estimate"] is None


def test_reporting_api_read_only_and_climate_isolation(client):
    before = snapshot()
    for _ in range(2):
        d = client.get("/api/zones/z3").json()["decision"]
        assert d["origin"] == "simulation"
        assert d["estimate"]["current_vwc"] == d["mean_vwc"]
        assert client.get("/api/reports/water").json()["events_count"] == 0
    assert snapshot() == before
    as_role(client, "survey")
    assert (
        client.post(
            "/api/zones/z3/measurements", json={"unit": "air_humidity"}
        ).status_code
        == 422
    )
