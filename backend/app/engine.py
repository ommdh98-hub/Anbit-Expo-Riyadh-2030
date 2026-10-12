"""Pure, deterministic decision functions. No database or UI dependencies."""

from datetime import datetime, timezone
from math import hypot
from statistics import mean


def vwc(measurement):
    if measurement.unit == "vwc_percent":
        return measurement.value / 100
    if measurement.unit == "vwc_fraction":
        return measurement.value
    return None  # Raw sensor output is not calibrated VWC.


def usable_readings(zone, readings, now):
    latest = {}
    for reading in readings:
        if (
            reading.point_id not in latest
            or reading.measured_at > latest[reading.point_id].measured_at
        ):
            latest[reading.point_id] = reading
    usable, rejected = [], []
    for reading in latest.values():
        age = (now - datetime.fromisoformat(reading.measured_at)).total_seconds() / 3600
        reason = None
        if vwc(reading) is None:
            reason = "قيمة خام غير معايرة"
        elif reading.quality != "verified":
            reason = "جودة القراءة غير متحققة"
        elif age < 0 or age > zone.freshness_hours:
            reason = "قراءة قديمة أو ذات وقت غير صالح"
        elif zone.last_irrigated_at and reading.measured_at <= zone.last_irrigated_at:
            reason = "قراءة سابقة لآخر عملية ري؛ يلزم قياس جديد"
        elif reading.origin != zone.origin:
            reason = "مصدر البيانات لا يطابق وضع المنطقة"
        if reason:
            rejected.append({"id": reading.id, "reason": reason})
        else:
            usable.append(reading)
    return usable, rejected


def coverage(zone, points, readings, now=None):
    now = now or datetime.now(timezone.utc)
    valid, rejected = usable_readings(zone, readings, now)
    valid_ids = {r.point_id for r in valid}
    active = [p for p in points if p.id in valid_ids]
    # Cell-centre quadrature on a 20x20 grid inside a rectangular zone.
    cells = [
        (zone.x + (i + 0.5) * zone.width / 20, zone.y + (j + 0.5) * zone.height / 20)
        for i in range(20)
        for j in range(20)
    ]
    distances = [
        min(
            (hypot(x - p.x, y - p.y) for p in active),
            default=hypot(zone.width, zone.height),
        )
        for x, y in cells
    ]
    covered = sum(d <= zone.coverage_radius_m for d in distances) / len(cells)
    # With no usable points, start at the centre (including stale-point regions).
    index = max(range(len(cells)), key=lambda i: distances[i])
    x, y = (
        cells[index] if active else (zone.x + zone.width / 2, zone.y + zone.height / 2)
    )
    return {
        "fraction": covered,
        "active_points": len(active),
        "total_points": len(points),
        "radius_m": zone.coverage_radius_m,
        "required_fraction": zone.min_coverage,
        "uncovered_cells": [
            {"x": x, "y": y}
            for (x, y), d in zip(cells, distances)
            if d > zone.coverage_radius_m
        ],
        "next_point": {
            "x": round(x, 2),
            "y": round(y, 2),
            "distance_m": round(distances[index], 2),
            "reason": (
                "توجد مساحة بعيدة عن نقاط القياس الصالحة؛ يُقترح فحصها قبل اعتماد قرار الري."
                if active and covered < zone.min_coverage
                else (
                    "التغطية الهندسية كافية وفق إعدادات العرض؛ هذه نقطة اختيارية لتحسين التوزيع، وليست طلبًا إلزاميًا."
                    if active
                    else "لا توجد نقاط بقراءات صالحة حديثة؛ ابدأ بفحص وسط المنطقة."
                )
            ),
        },
        "rejected": rejected,
        "method": "شبكة هندسية 20×20، واختيار أبعد مركز خلية عن أقرب قراءة صالحة.",
        "caveat": "التغطية مؤشر هندسي وليست نسبة ثقة علمية. اختلاف التربة والنبات والعمق يتطلب تحققًا مستقلًا.",
    }


def decide(zone, soil, points, readings, now=None):
    now = now or datetime.now(timezone.utc)
    valid, rejected = usable_readings(zone, readings, now)
    cov = coverage(zone, points, readings, now)
    values = [vwc(r) for r in valid]
    missing = []
    code, label, reason = (
        "insufficient",
        "بيانات غير كافية",
        "لا توجد قراءات صالحة حديثة تسمح بتقييم المنطقة.",
    )
    rules = [
        "latest-per-point",
        "unit-vwc",
        "quality-verified",
        "freshness",
        "origin-isolation",
    ]
    if not values:
        missing.append("قراءات حجمية متحققة وحديثة")
    elif max(values) - min(values) > zone.conflict_vwc:
        code, label, reason = (
            "conflict",
            "قراءات متعارضة",
            "الفرق بين القراءات يتجاوز حد الاختلاف التجريبي؛ يلزم فحص إضافي.",
        )
        rules.append("spatial-disagreement")
    elif cov["fraction"] < zone.min_coverage:
        code, label, reason = (
            "measure",
            "قياس إضافي مطلوب",
            "توزيع القراءات الصالحة لا يغطي الحد الهندسي التجريبي للمنطقة.",
        )
        missing.append("تغطية مكانية كافية")
        rules.append("geometric-coverage")
    elif (
        not zone.homogeneous
        or not soil
        or (zone.origin != "simulation" and soil.calibration != "field_validated")
    ):
        missing.append("معايرة ملائمة وتحقق من تمثيل التربة والنبات")
        reason = "التغطية الهندسية وحدها لا تثبت تمثيل القراءات أو ملاءمة الحدود."
    elif max(values) > soil.upper_vwc:
        code, label, reason = (
            "high",
            "رطوبة مرتفعة تستدعي المراجعة",
            "تجاوزت قراءة الحد الأعلى للمنطقة؛ راجع الصرف وأجّل الري.",
        )
        rules.append("zone-upper-vwc")
    elif mean(values) < soil.lower_vwc:
        code, label, reason = (
            "review",
            "مراجعة الحاجة للري",
            "متوسط الرطوبة أقل من الحد الأدنى المحدد لهذه المنطقة ضمن إعدادات المحاكاة.",
        )
        rules.append("zone-lower-vwc")
    else:
        code, label, reason = (
            "defer",
            "تأجيل الري",
            "رطوبة التربة ضمن النطاق المحدد للمنطقة؛ يُقترح تأجيل الري ومتابعة القياس.",
        )
        rules.append("zone-vwc-range")
    estimate = None
    if code == "review":
        if all(
            [
                zone.irrigated_area_m2,
                zone.root_depth_m,
                zone.efficiency,
                zone.root_representative,
            ]
        ):
            deficit = max(0, soil.target_vwc - mean(values))
            net = zone.irrigated_area_m2 * zone.root_depth_m * deficit * 1000
            estimate = {
                "net_l": round(net, 1),
                "gross_l": round(net / zone.efficiency, 1),
                "deficit_fraction": round(deficit, 4),
                "area_m2": zone.irrigated_area_m2,
                "root_depth_m": zone.root_depth_m,
                "efficiency": zone.efficiency,
                "label": (
                    "تقدير محاكاة"
                    if zone.origin == "simulation"
                    else "تقدير حسابي مشروط"
                ),
                "formula": "المساحة × عمق الجذور × فرق الرطوبة الحجمية × 1000 ÷ الكفاءة",
            }
        else:
            missing.append(
                "مساحة الري وعمق الجذور والكفاءة والتحقق من تمثيل كامل العمق"
            )
    return {
        "code": code,
        "label": label,
        "reason": reason,
        "rules": rules,
        "missing": missing,
        "readings_used": [r.id for r in valid],
        "rejected": rejected,
        "sources": sorted({r.source for r in valid}),
        "mean_vwc": mean(values) if values else None,
        "coverage": cov,
        "estimate": estimate,
        "origin": zone.origin,
        "validity": (
            "محاكاة توضيحية غير معتمدة زراعيًا"
            if zone.origin == "simulation"
            else "تحتاج مراجعة مختص"
        ),
        "caveats": [
            "ليست أمر تشغيل لمضخة.",
            "تمثيل منطقة الجذور والتجانس افتراضان معلنان في المحاكاة.",
        ],
        "inspection_priority": {"insufficient": 3, "conflict": 2, "measure": 1}.get(
            code, 0
        ),
        "evaluated_at": now.isoformat(),
    }
