"""Read-only Home scenarios; never used to approve or record irrigation."""

from datetime import datetime, timedelta, timezone
from math import isfinite
from statistics import mean
from pydantic import Field, model_validator
from .schemas import Input
from .planning import PlantSoilProfile, WeatherScenario, volume_to_target
from .engine import vwc, usable_readings


class HomeInput(Input):
    profile: PlantSoilProfile | None = None
    weather: WeatherScenario | None = None
    allowed_start_hour: int = Field(default=4, ge=0, le=23)
    allowed_end_hour: int = Field(default=9, ge=1, le=24)

    @model_validator(mode="after")
    def ordered_hours(self):
        if self.allowed_start_hour >= self.allowed_end_hour:
            raise ValueError("حدد نافذة ري مرتبة ضمن اليوم نفسه")
        return self


def home_summary(zone, soil, readings, decision, payload, now):
    now = now.astimezone(timezone(timedelta(hours=3)))
    # These are explicit display assumptions, not inferred soil properties.
    assumptions = [
        "تقديرات الرئيسية سيناريو فقط؛ لا تعتمد الري ولا تسجله ولا تشغّل أجهزة.",
        "الطقس مفترض؛ لا نموذج ML مؤهل محليًا ولا حساسات متصلة.",
        "التغطية الهندسية ليست ثقة إحصائية؛ الاستيفاء لا يعوض القياس.",
    ]
    profile = payload.profile
    if profile is None:
        assumptions.append(
            "ملف العرض: FC 50% وWP 6% افتراضان غير معايرين؛ الهدف وحد التدخل من إعدادات المنطقة التجريبية، وليسا مشتقين من رطوبة الهواء."
        )
        try:
            profile = PlantSoilProfile(
                plant=zone.plant_id,
                soil=soil.name,
                provenance="demo_assumption",
                evidence="Explicit Home demo assumptions; no field calibration",
                field_capacity=0.5,
                wilting_point=0.06,
                threshold=soil.lower_vwc,
                target=soil.target_vwc,
                root_depth_m=zone.root_depth_m,
                area_m2=zone.irrigated_area_m2,
                efficiency=zone.efficiency,
            )
        except (ValueError, TypeError):
            profile = None
    if profile and profile.area_m2 > zone.area_m2:
        raise ValueError("مساحة السيناريو تتجاوز مساحة المنطقة")
    weather = payload.weather or WeatherScenario(
        et_mm_day=5, rain_mm=0, rain_hour=18, uncertainty_vwc=0.005
    )
    if payload.weather is None:
        assumptions.append(
            "عند غياب الطقس: ET مفترض 5 مم/يوم ومطر 0؛ ليست توقعات جوية."
        )
    assumptions.append(
        "تقدير الماضي يطرح ET فقط ويحد النتيجة بين WP وFC؛ المطر والري غير الموثقين والصرف والتغير المكاني غير معلومين."
    )
    flow = profile.flow_l_h if profile and profile.flow_l_h else 400
    default_flow = profile is None or profile.flow_l_h is None
    if default_flow:
        assumptions.append(
            "التدفق الافتراضي 400 لتر/ساعة افتراض مدة فقط، وليس قدرة شبكة مقاسة."
        )

    fresh, _ = usable_readings(zone, readings, now)
    latest = {}
    for r in readings:
        if r.point_id not in latest or r.measured_at > latest[r.point_id].measured_at:
            latest[r.point_id] = r
    historical = []
    for r in latest.values():
        value = vwc(r)
        at = datetime.fromisoformat(r.measured_at)
        if (
            value is not None
            and isfinite(value)
            and 0 <= value <= 1
            and r.quality == "verified"
            and r.origin == zone.origin
            and at <= now
            and (
                not zone.last_irrigated_at
                or at > datetime.fromisoformat(zone.last_irrigated_at)
            )
        ):
            historical.append(r)

    current = None
    source = None
    ages = []
    used = []
    conflict = decision["code"] == "conflict"
    if fresh and not conflict:
        current = mean(vwc(r) for r in fresh)
        source = (
            "simulation"
            if zone.origin == "simulation"
            else ("estimated" if zone.origin == "estimated" else "measured")
        )
        used = fresh
    elif historical and profile and not conflict:
        values = [vwc(r) for r in historical]
        if max(values) - min(values) <= zone.conflict_vwc and all(
            profile.wilting_point <= v <= profile.field_capacity for v in values
        ):
            estimates = []
            for r in historical:
                hours = (
                    now - datetime.fromisoformat(r.measured_at)
                ).total_seconds() / 3600
                value = vwc(r) - weather.et_mm_day * hours / 24 / (
                    profile.root_depth_m * 1000
                )
                estimates.append(
                    max(profile.wilting_point, min(profile.field_capacity, value))
                )
            current = mean(estimates)
            source = "estimated"
            used = historical
    for r in used:
        ages.append(
            (now - datetime.fromisoformat(r.measured_at)).total_seconds() / 3600
        )
    stale = bool(ages and max(ages) > zone.freshness_hours)
    estimate = (
        volume_to_target(profile, current) if profile and current is not None else None
    )
    next_at = None
    crossing = None
    if profile and current is not None:
        theta = current
        for h in range(25):
            if h:
                theta -= weather.et_mm_day / 24 / (profile.root_depth_m * 1000)
                if h == weather.rain_hour:
                    theta += weather.rain_mm / (profile.root_depth_m * 1000)
            theta = max(profile.wilting_point, min(profile.field_capacity, theta))
            if theta <= profile.threshold and crossing is None:
                crossing = h
            at = now + timedelta(hours=h)
            if (
                theta <= profile.threshold
                and payload.allowed_start_hour <= at.hour < payload.allowed_end_hour
            ):
                next_at = at.isoformat()
                break
    duration = estimate["gross_l"] / flow if estimate else None
    next_date = datetime.fromisoformat(next_at) if next_at else None
    fits_window = bool(
        next_date
        and duration is not None
        and next_date.hour + next_date.minute / 60 + duration
        <= payload.allowed_end_hour
    )
    return {
        "duration_fits_window": fits_window,
        "zone_id": zone.id,
        "revision": zone.revision,
        "generated_at": now.isoformat(),
        "operational_eligible": False,
        "persisted": False,
        "hardware_triggered": False,
        "ml_used": False,
        "current_vwc": current,
        "source": source,
        "origin": zone.origin,
        "stale": stale,
        "age_hours": max(ages) if ages else None,
        "reading_ids": [r.id for r in used],
        "target_vwc": profile.target if profile else None,
        "profile": profile.model_dump() if profile else None,
        "demo_profile": bool(profile and profile.provenance == "demo_assumption"),
        "gross_l": estimate["gross_l"] if estimate else None,
        "area_m2": profile.area_m2 if profile else None,
        "duration_hours": estimate["gross_l"] / flow if estimate else None,
        "flow_l_h": flow,
        "default_flow": default_flow,
        "weather": weather.model_dump(),
        "default_weather": payload.weather is None,
        "allowed_start_hour": payload.allowed_start_hour,
        "allowed_end_hour": payload.allowed_end_hour,
        "next_at": next_at,
        "crossing_hour": crossing,
        "needs_reading": decision["code"] in {"insufficient", "measure", "conflict"}
        or stale
        or current is None,
        "can_review": bool(
            fresh
            and not stale
            and decision["code"] == "review"
            and decision["estimate"]
        ),
        "condition": decision["soil_condition"],
        "limitations": assumptions,
    }
