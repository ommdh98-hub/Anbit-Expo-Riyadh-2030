from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select
import json
import os
from . import reference
from .dose import WETTED_FRACTION
from .models import (
    BaselineSchedule,
    Sensor,
    Site,
    Zone,
    Plant,
    SoilProfile,
    ReferenceSource,
    MeasurementPoint,
    SoilMeasurement,
)


def seed_demo(session: Session):
    if session.get(Site, "demo"):
        return
    session.add(Site(id="demo", name="حديقة أنبت التجريبية"))
    if not session.get(ReferenceSource, "demo"):
        session.add(
            ReferenceSource(
                id="demo",
                title="افتراضات فريق أنبت للعرض",
                description="قيم محاكاة وليست مرجعًا زراعيًا أو بيانات من إكسبو.",
            )
        )
    if not session.get(ReferenceSource, "grow-right"):
        session.add(
            ReferenceSource(
                id="grow-right",
                title="Grow Right — ملفات الفريق السابقة",
                description="ثمانية نباتات وسبع مدن؛ بيانات غير موثقة خارجيًا. لا تُستخدم درجة الملاءمة في الري.",
            )
        )
    session.commit()
    # Grow Right reference entries: kept in the plant catalogue (older records and
    # tests refer to them), but no longer used by the demo zones.
    names = [
        ("rosemary", "إكليل الجبل"),
        ("basil", "الريحان"),
        ("mint", "النعناع"),
        ("thyme", "الزعتر"),
        ("parsley", "البقدونس"),
    ]
    for key, name in names:
        if not session.get(Plant, key):
            session.add(
                Plant(
                    id=key,
                    name=name,
                    notes="اسم مستفاد من قاعدة Grow Right. الاحتياجات المائية والتربة والشمس تحتاج مراجعة مصدر زراعي قبل التشغيل الميداني.",
                    source_id="grow-right",
                )
            )
    # Demo site from the read-only reference database (labelled demo assumptions).
    # Thresholds and root zone come from plant_soil_targets for (plant, soil);
    # the embedded values are the same numbers, used only when the file is absent.
    if not session.get(ReferenceSource, "anbit-reference"):
        session.add(
            ReferenceSource(
                id="anbit-reference",
                title="قاعدة أنبت المرجعية",
                description="معاملات FAO-56 وجامعة أريزونا وجامعة كاليفورنيا وتصنيف WUCOLS، وخصائص تربة Hanson 2000. قيم عرض تحتاج معايرة ميدانية.",
            )
        )
        session.commit()
    soil_names = {"sand": "تربة رملية", "sandy_loam": "تربة رملية طميية", "loam": "تربة طميية"}
    # "demo": zones are irrigation valve sectors (areas below) with readings near
    # each zone's trigger. "test": the explicit scenario the API tests rely on
    # (larger areas; dry, wet, conflicting and stale readings), chosen with
    # ANBIT_SEED_SCENARIO=test by the test fixture only.
    scenario = os.getenv("ANBIT_SEED_SCENARIO", "demo")
    layouts = TEST_LAYOUTS if scenario == "test" else DEMO_LAYOUTS
    for i, spec in enumerate(DEMO_ZONES, 1):
        x, y, w, h = layouts[i - 1]
        area = w * h
        target = reference.plant_soil_target(spec["plant"], spec["soil"]) or spec["fallback"]
        plant_key = f"ref-{spec['plant']}"
        if not session.get(Plant, plant_key):
            session.add(
                Plant(
                    id=plant_key,
                    name=spec["plant_name"],
                    notes=f"نبات مسطحات خضراء من القاعدة المرجعية (رقم {spec['plant']}). معاملات عرض موثقة المصدر، تحتاج معايرة ميدانية.",
                    source_id="anbit-reference",
                )
            )
        soil = session.get(SoilProfile, f"soil-{i}") or SoilProfile(id=f"soil-{i}", name="", lower_vwc=0, target_vwc=0, upper_vwc=0)
        soil.name = f"{soil_names[spec['soil']]} (افتراض عرض)"
        soil.lower_vwc, soil.target_vwc, soil.upper_vwc = target["vwc_min"], target["vwc_target"], target["vwc_max"]
        soil.calibration = "demo_assumption"
        session.add(soil)
        session.commit()
        spray = spec["method"] == "spray"
        zone = Zone(
            id=f"z{i}",
            site_id="demo",
            name=spec["name"],
            plant_id=plant_key,
            soil_id=f"soil-{i}",
            x=x,
            y=y,
            width=w,
            height=h,
            area_m2=area,
            irrigated_area_m2=area,
            root_depth_m=target["root_zone_m"],
            efficiency=0.7 if spray else 0.9,
            method="رش" if spray else "تنقيط",
            root_representative=True,
            homogeneous=True,
            soil_class=spec["soil"],
            reference_plant_id=spec["plant"],
            irrigation_method=spec["method"],
            flow_rate_lph=spec["rate_mm_h"] * area,
            allowed_start_hour=18,
            allowed_end_hour=8,
            wetted_fraction=WETTED_FRACTION[spec["method"]],
        )
        if scenario != "test":
            zone.coverage_radius_m = DEMO_COVERAGE_RADIUS_M
        session.add(zone)
        session.commit()
        # Fixed-schedule comparison (assumption): spray 8 / 6 / 3 L/m²/day by season, drip half.
        for season, months, depth in [("summer", [6, 7, 8, 9], 8), ("shoulder", [3, 4, 5, 10, 11], 6), ("winter", [12, 1, 2], 3)]:
            session.add(
                BaselineSchedule(
                    id=f"z{i}-{season}",
                    zone_id=zone.id,
                    start_hour=5,
                    litres_per_m2_per_day=depth if spray else depth / 2,
                    months=json.dumps(months),
                    label="افتراض",
                )
            )
        coords = [
            (x + w * 0.25, y + h * 0.25),
            (x + w * 0.75, y + h * 0.25),
            (x + w * 0.25, y + h * 0.75),
            (x + w * 0.75, y + h * 0.75),
        ]
        if i == 1:
            coords = coords[:3]
        for j, (px, py) in enumerate(coords):
            pid = f"z{i}-p{j+1}"
            session.add(MeasurementPoint(id=pid, zone_id=zone.id, x=px, y=py, name=f"نقطة {j+1}"))
            session.commit()
            session.add(
                Sensor(
                    id=f"{pid}-manual",
                    zone_id=zone.id,
                    point_id=pid,
                    kind="manual",
                    depth_m=round(target["root_zone_m"] / 2, 2),
                    notes="نقطة قياس يدوي في موقع العرض",
                )
            )
            band = target["vwc_target"] - target["vwc_min"]
            if scenario == "test":
                value = spec["test_readings"][j % len(spec["test_readings"])]
                step = 1.0
            else:
                # Near the trigger: 10% of the way from the minimum to the target,
                # never below the minimum; earlier readings slightly wetter.
                value = round((target["vwc_min"] + 0.1 * band) * 100, 2)
                step = round(0.04 * band * 100, 2)
            for history in [2, 1, 0]:
                timestamp = datetime.now(timezone.utc) - timedelta(hours=demo_reading_age_hours(zone.id) + history * 8)
                session.add(
                    SoilMeasurement(
                        id=f"{pid}-m{history}",
                        zone_id=zone.id,
                        point_id=pid,
                        value=round(value + history * step, 2),
                        unit="vwc_percent",
                        measured_at=timestamp.isoformat(),
                        source="مولد سيناريو العرض",
                        operator="فريق أنبت",
                        quality="verified",
                        origin="simulation",
                    )
                )
    session.commit()


# Age of each demo zone's latest simulated reading (hours): fresh readings, except
# الممر الأخضر, whose readings are stale on purpose (an estimated, stressed zone).
DEMO_READING_AGE_HOURS = {"z5": 72}


def demo_reading_age_hours(zone_id):
    return DEMO_READING_AGE_HOURS.get(zone_id, 1)


def refresh_demo_readings(session: Session, now=None):
    """Keep the demo site's simulated readings as old as on the day they were
    seeded, so Home shows the same values on any later day.

    Only readings with origin "simulation" in the demo site's simulation zones
    move; every reading of a zone moves by the same amount (spacing and values
    unchanged) so its latest reading is demo_reading_age_hours old. Readings
    never move backwards, and a zone irrigated after its latest reading is left
    as it is (moving would make old readings look newer than the irrigation).
    Called at startup for the demo database only; returns {zone_id: hours moved}."""
    now = now or datetime.now(timezone.utc)
    moved = {}
    zones = session.exec(select(Zone).where(Zone.site_id == "demo", Zone.origin == "simulation")).all()
    for zone in zones:
        readings = session.exec(
            select(SoilMeasurement).where(SoilMeasurement.zone_id == zone.id, SoilMeasurement.origin == "simulation")
        ).all()
        if not readings:
            continue
        latest = max(datetime.fromisoformat(r.measured_at) for r in readings)
        if zone.last_irrigated_at and datetime.fromisoformat(zone.last_irrigated_at) > latest:
            continue
        shift = now - timedelta(hours=demo_reading_age_hours(zone.id)) - latest
        if shift <= timedelta(0):
            continue
        for r in readings:
            r.measured_at = (datetime.fromisoformat(r.measured_at) + shift).isoformat()
            session.add(r)
        moved[zone.id] = round(shift.total_seconds() / 3600, 2)
    session.commit()
    return moved


# Demo zones: reference plant id, soil class, method and application rate (mm/h),
# readings (% VWC) that set each scenario, and fallback limits equal to the reference.
DEMO_ZONES = [
    {
        "name": "المدخل الرئيسي",
        "plant": 22,
        "plant_name": "باسبالوم",
        "soil": "sand",
        "method": "spray",
        "rate_mm_h": 15,
        "test_readings": [6.0],  # test scenario: dry, but only three points
        "fallback": {"root_zone_m": 0.25, "vwc_min": 0.07, "vwc_target": 0.094, "vwc_max": 0.1, "taw_mm": 15.0, "raw_mm": 7.5},
    },
    {
        "name": "ممر النخيل",
        "plant": 1,
        "plant_name": "نخيل التمر",
        "soil": "sandy_loam",
        "method": "drip",
        "rate_mm_h": 5,
        "test_readings": [23.0],  # test scenario: above field capacity
        "fallback": {"root_zone_m": 1.5, "vwc_min": 0.15, "vwc_target": 0.198, "vwc_max": 0.21, "taw_mm": 180.0, "raw_mm": 90.0},
    },
    {
        "name": "أحواض الشجيرات",
        "plant": 41,
        "plant_name": "الجهنمية",
        "soil": "loam",
        "method": "drip",
        "rate_mm_h": 5,
        "test_readings": [16.0],  # test scenario: below the minimum, review
        "fallback": {"root_zone_m": 0.5, "vwc_min": 0.18, "vwc_target": 0.255, "vwc_max": 0.27, "taw_mm": 75.0, "raw_mm": 45.0},
    },
    {
        "name": "المسطح الأوسط",
        "plant": 21,
        "plant_name": "نجيل برمودا",
        "soil": "sandy_loam",
        "method": "spray",
        "rate_mm_h": 15,
        "test_readings": [22.0, 9.5],  # test scenario: points disagree
        "fallback": {"root_zone_m": 0.25, "vwc_min": 0.15, "vwc_target": 0.198, "vwc_max": 0.21, "taw_mm": 30.0, "raw_mm": 15.0},
    },
    {
        "name": "الممر الأخضر",
        "plant": 33,
        "plant_name": "جازانيا",
        "soil": "sandy_loam",
        "method": "drip",
        "rate_mm_h": 5,
        "test_readings": [18.0],  # test scenario: in range but stale
        "fallback": {"root_zone_m": 0.3, "vwc_min": 0.138, "vwc_target": 0.198, "vwc_max": 0.21, "taw_mm": 36.0, "raw_mm": 21.6},
    },
]


# Demo zones as irrigation valve sectors (demo assumption, "افتراض"), in metres
# (x, y, width, height); the zone map draws these rectangles and the coverage
# grid uses them: z1 150 m², z2 120 m² (long, narrow strip), z3 80 m²,
# z4 200 m², z5 100 m² (narrow strip). Sensor points sit at the quarter points.
DEMO_LAYOUTS = [(4, 4, 15, 10), (23, 4, 30, 4), (57, 4, 10, 8), (4, 18, 20, 10), (28, 18, 25, 4)]
# Coverage radius for the demo valve sectors (demo assumption): the model default
# of 8 m covers these small areas completely, so the demo uses 4 m.
DEMO_COVERAGE_RADIUS_M = 4
# Explicit test scenario (ANBIT_SEED_SCENARIO=test): the earlier, larger layout.
TEST_LAYOUTS = [(4, 4, 30, 20), (38, 4, 20, 20), (62, 4, 20, 20), (4, 30, 36, 20), (46, 30, 36, 20)]
