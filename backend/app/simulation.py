"""Stateless one-step volume balance; never a forecast or irrigation decision."""

from math import isfinite


def water_balance(start_vwc, volume_l, area_m2, root_depth_m, efficiency):
    values = (start_vwc, volume_l, area_m2, root_depth_m, efficiency)
    if not all(isfinite(v) for v in values) or not (
        0 <= start_vwc <= 1
        and volume_l >= 0
        and area_m2 > 0
        and root_depth_m > 0
        and 0 < efficiency <= 1
    ):
        raise ValueError("مدخلات السيناريو غير صالحة")
    applied = volume_l / area_m2
    effective = applied * efficiency
    delta = effective / (root_depth_m * 1000)
    result = start_vwc + delta
    if not all(isfinite(v) for v in (applied, effective, delta, result)):
        raise ValueError("نتيجة خارج النطاق الحسابي؛ راجع المساحة والعمق")
    return {
        "applied_depth_mm": applied,
        "effective_depth_mm": effective,
        "effective_volume_l": volume_l * efficiency,
        "delta_vwc": delta,
        "scenario_vwc": result,
        "exceeds_volume_limit": result > 1,
    }
