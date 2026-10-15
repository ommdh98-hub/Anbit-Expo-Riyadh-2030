"""Read-only experimental planning. Never changes operational decisions or records."""

from datetime import datetime, timedelta
from math import hypot, sqrt
from statistics import mean
from types import SimpleNamespace
from typing import Literal
from pydantic import Field, model_validator
from .schemas import Input
from .engine import conditional_water, vwc
from .simulation import water_balance


class PlantSoilProfile(Input):
    plant: str = Field(min_length=2, max_length=100)
    soil: str = Field(min_length=2, max_length=100)
    provenance: Literal["demo_assumption", "user_supplied"] = "demo_assumption"
    evidence: str = Field(min_length=8, max_length=500)
    field_capacity: float = Field(gt=0, le=1)
    wilting_point: float = Field(ge=0, lt=1)
    threshold: float = Field(ge=0, le=1)
    target: float = Field(ge=0, le=1)
    root_depth_m: float = Field(gt=0, le=3)
    area_m2: float = Field(gt=0, le=1_000_000)
    efficiency: float = Field(gt=0, le=1)
    flow_l_h: float | None = Field(default=None, gt=0, le=1_000_000)

    @model_validator(mode="after")
    def ordered(self):
        if not self.wilting_point < self.threshold < self.target <= self.field_capacity:
            raise ValueError("يلزم: نقطة الذبول < حد التدخل < الهدف ≤ السعة الحقلية")
        return self


class WeatherScenario(Input):
    # No weather connector exists. All values are explicitly assumed hourly scenarios.
    kind: Literal["assumed"] = "assumed"
    et_mm_day: float = Field(ge=0, le=30)
    rain_mm: float = Field(ge=0, le=200)
    rain_hour: int = Field(ge=1, le=24)
    uncertainty_vwc: float = Field(ge=0.005, le=0.3)


class PlanInput(Input):
    profile: PlantSoilProfile
    baseline_mode: Literal["stored", "hypothetical"] = "stored"
    starting_vwc: float | None = Field(default=None, ge=0, le=1)
    weather: WeatherScenario | None = None
    mode: Literal["manual", "automatic_simulation"] = "manual"
    allowed_start_hour: int = Field(default=4, ge=0, le=23)
    allowed_end_hour: int = Field(default=9, ge=1, le=24)
    cooldown_hours: int = Field(default=12, ge=1, le=72)
    hysteresis_vwc: float = Field(default=0.01, ge=0.001, le=0.1)
    last_simulated_hour: int | None = Field(default=None, ge=-72, le=0)

    @model_validator(mode="after")
    def valid(self):
        if self.baseline_mode == "hypothetical" and self.starting_vwc is None:
            raise ValueError("أدخل رطوبة بداية افتراضية")
        if self.baseline_mode == "stored" and self.starting_vwc is not None:
            raise ValueError("البداية المحفوظة يحددها الخادم")
        if self.allowed_start_hour >= self.allowed_end_hour:
            raise ValueError("حدد نافذة ري نهارية مرتبة ضمن اليوم نفسه")
        if self.profile.target - self.profile.threshold < self.hysteresis_vwc:
            raise ValueError("الهدف قريب جدًا من حد التدخل؛ راجع هامش الاستقرار")
        return self


def duration_hours(volume_l, flow_l_h):
    return volume_l / flow_l_h if flow_l_h else None


def volume_to_target(profile, current):
    # Reuse the authoritative formula and its existing validation, without changing it.
    zone = SimpleNamespace(
        area_m2=profile.area_m2,
        irrigated_area_m2=profile.area_m2,
        root_depth_m=profile.root_depth_m,
        efficiency=profile.efficiency,
        root_representative=True,
    )
    soil = SimpleNamespace(
        lower_vwc=profile.threshold,
        target_vwc=profile.target,
        upper_vwc=profile.field_capacity,
    )
    return conditional_water(zone, soil, current)


def plan(zone, decision, payload, now):
    p = payload.profile
    if p.area_m2 > zone.area_m2:
        raise ValueError("مساحة السيناريو تتجاوز مساحة المنطقة")
    stored = payload.baseline_mode == "stored"
    if stored and (
        decision["code"] not in {"review", "defer", "high"}
        or not zone.root_representative
    ):
        raise ValueError(
            "خط البداية غير ممثل؛ أكمل القياس أو اختر بداية افتراضية معلنة"
        )
    current = decision["mean_vwc"] if stored else payload.starting_vwc
    estimate = volume_to_target(p, current)
    result = {
        "kind": "scenario_only",
        "operational_eligible": False,
        "hardware_triggered": False,
        "persisted": False,
        "zone_id": zone.id,
        "revision": zone.revision,
        "generated_at": now.isoformat(),
        "baseline_vwc": current,
        "baseline_origin": zone.origin if stored else "user_hypothesis",
        "baseline_reading_ids": decision["readings_used"] if stored else [],
        "profile": p.model_dump(),
        "mode": payload.mode,
        "estimate": estimate,
        "duration_hours": duration_hours(estimate["gross_l"], p.flow_l_h),
        "weather_kind": "assumed" if payload.weather else "unavailable",
        "forecast": [],
        "schedule": [],
        "crossing_hour": None,
        "next_window_hour": None,
        "blocked": [],
        "measured_coverage": decision["coverage"]["fraction"],
        "limitations": [
            "محاكاة موازنة مبسطة؛ ليست تنبؤ ML ولا تصريح ري",
            "الكفاءة تجمع خسائر التطبيق افتراضيًا؛ التسرب والجريان والصرف غير مقاسة",
            "أشرطة السيناريو حساسية مفترضة وليست فترات ثقة إحصائية",
            "التنفيذ الفعلي يتطلب مسار الموافقة والتسجيل الحالي وقياسًا لاحقًا",
        ],
    }
    w = payload.weather
    if not w:
        result["blocked"].append(
            "لا يتوفر طقس متوقع؛ أدخل سيناريو معلنًا لعرض المستقبل"
        )
        return result
    # No hidden noon/temperature multiplier: ET is the user's assumed crop water loss.
    depth = p.root_depth_m * 1000

    def trajectory(start, irrigation=None):
        theta, runoff = start, 0.0
        rows = []
        for h in range(25):
            if h:
                theta = max(0, theta - w.et_mm_day / 24 / depth)
                if h == w.rain_hour:
                    theta += w.rain_mm / depth
                if irrigation and h == irrigation["hour"]:
                    theta = water_balance(
                        theta,
                        irrigation["volume_l"],
                        p.area_m2,
                        p.root_depth_m,
                        p.efficiency,
                    )["scenario_vwc"]
            if h and theta > p.field_capacity:
                runoff += (theta - p.field_capacity) * depth
                theta = p.field_capacity
            spread = w.uncertainty_vwc * sqrt(1 + h / 6)
            rows.append(
                {
                    "hour": h,
                    "at": (now + timedelta(hours=h)).isoformat(),
                    "vwc": theta,
                    "low": max(0, theta - spread),
                    "high": min(1, theta + spread),
                    "unretained_mm": runoff,
                }
            )
        return rows

    forecast = trajectory(current)
    result["forecast"] = forecast
    crossing = next((r["hour"] for r in forecast if r["low"] <= p.threshold), None)
    result["crossing_hour"] = crossing
    if current > p.field_capacity:
        result["blocked"].append(
            "البداية أعلى من السعة الحقلية؛ يلزم التحقق من التربة والصرف"
        )
    spread_at_crossing = (
        (forecast[crossing]["high"] - forecast[crossing]["low"])
        if crossing is not None
        else w.uncertainty_vwc * 2
    )
    if spread_at_crossing > p.target - p.threshold:
        result["blocked"].append("عدم اليقين أكبر من هامش التدخل؛ يلزم قياس إضافي")
    if p.provenance != "demo_assumption":
        result["limitations"].append(
            "إعدادات أدخلها المستخدم ولم يتحقق النظام من معايرتها"
        )
    if crossing is not None and not result["blocked"]:
        last_recorded = getattr(zone, "last_irrigated_at", None) if stored else None
        since_recorded = (
            (now - datetime.fromisoformat(last_recorded)).total_seconds() / 3600
            if last_recorded
            else None
        )
        # Latest permitted start before the conservative crossing; a too-late window is refused.
        candidates = [
            h
            for h in range(1, max(1, crossing))
            if payload.allowed_start_hour
            <= (now + timedelta(hours=h)).hour
            < payload.allowed_end_hour
            and (
                payload.last_simulated_hour is None
                or h - payload.last_simulated_hour >= payload.cooldown_hours
            )
            and (since_recorded is None or since_recorded + h >= payload.cooldown_hours)
        ]
        if not candidates:
            result["blocked"].append(
                "لا توجد نافذة مسموحة قبل الحد أو بعد فترة الانتظار؛ راجع القياس والموعد"
            )
        else:
            chosen = None
            for h in reversed(candidates):
                amount = volume_to_target(p, forecast[h]["vwc"])["gross_l"]
                hours = duration_hours(amount, p.flow_l_h)
                start_hour = (now + timedelta(hours=h)).hour
                if amount > 0 and (
                    hours is None
                    or (
                        start_hour + hours <= payload.allowed_end_hour
                        and h + hours <= crossing
                    )
                ):
                    chosen = (h, amount, hours)
                    break
            if chosen is None:
                result["blocked"].append(
                    "مدة التطبيق تتجاوز النافذة أو وقت الوصول للحد؛ راجع التدفق"
                )
            else:
                h, amount, hours = chosen
                event = {
                    "hour": h,
                    "at": forecast[h]["at"],
                    "volume_l": amount,
                    "duration_hours": hours,
                    "kind": "simulation_proposal",
                    "post_vwc": p.target,
                    "post_low": max(0, p.target - w.uncertainty_vwc),
                    "post_high": min(p.field_capacity, p.target + w.uncertainty_vwc),
                }
                result["schedule"] = [event]
                scheduled = trajectory(current, event)
                result["scheduled_forecast"] = scheduled
                result["next_window_hour"] = next(
                    (
                        r["hour"]
                        for r in scheduled
                        if r["hour"] >= h + (hours or 0) + payload.cooldown_hours
                        and r["low"] <= p.threshold
                    ),
                    None,
                )
    return result


def spatial_estimate(zone, points, readings, decision):
    used = {r.point_id: r for r in readings if r.id in decision["readings_used"]}
    measured = [
        {
            "x": p.x,
            "y": p.y,
            "vwc": vwc(used[p.id]),
            "reading_id": used[p.id].id,
            "origin": used[p.id].origin,
            "measured_at": used[p.id].measured_at,
        }
        for p in points
        if p.id in used
    ]
    cells = []
    radius = zone.coverage_radius_m
    # No spatial labels or independently validated variogram exist. Restrict support to
    # locations near >=3 distinct valid points; distance/spread is NOT a confidence CI.
    for iy in range(8):
        for ix in range(8):
            x, y = (
                zone.x + (ix + 0.5) * zone.width / 8,
                zone.y + (iy + 0.5) * zone.height / 8,
            )
            nearby = [
                (hypot(x - r["x"], y - r["y"]), r["vwc"])
                for r in measured
                if hypot(x - r["x"], y - r["y"]) <= radius
            ]
            unique = {
                (r["x"], r["y"])
                for r in measured
                if hypot(x - r["x"], y - r["y"]) <= radius
            }
            supported = len(unique) >= 3 and decision["code"] != "conflict"
            value = spread = None
            if supported:
                weights = [1 / max(d, 0.1) ** 2 for d, _ in nearby]
                value = sum(w * v for w, (_, v) in zip(weights, nearby)) / sum(weights)
                spread = max(v for _, v in nearby) - min(v for _, v in nearby)
            cells.append(
                {
                    "x": x,
                    "y": y,
                    "vwc": value,
                    "local_spread": spread,
                    "nearest_m": min(
                        (hypot(x - r["x"], y - r["y"]) for r in measured), default=None
                    ),
                }
            )
    # Fill the largest distance gap, as in the authoritative coverage proposal.
    return {
        "method": "experimental_IDW_not_ML",
        "measured": measured,
        "cells": cells,
        "estimated_support_fraction": sum(c["vwc"] is not None for c in cells)
        / len(cells),
        "measured_coverage": decision["coverage"]["fraction"],
        "next_point": decision["coverage"]["next_point"],
        "operational_eligible": False,
        "uncertainty": "unvalidated_distance_and_local_spread_not_confidence",
        "reason": "لا توجد تسميات مكانية مستقلة لتدريب ML؛ الاستيفاء لا يعوض القياس ولا يتجاوز بوابات القرار",
    }


def savings(current_l, baseline_l=None, verified=False):
    if baseline_l is None or baseline_l <= 0:
        return {"percent": None, "kind": "unavailable"}
    return {
        "percent": (baseline_l - current_l) / baseline_l * 100,
        "kind": "verified_comparison" if verified else "hypothetical_comparison",
    }
