"""Today's irrigation dose (FAO-56 high-frequency irrigation). One implementation
for the backend; frontend/components/landscape/data.ts (dailyDose) mirrors it and
both are checked against frontend/tests/fixtures/daily-dose.json.

  daily need (mm)  = ET0 (Riyadh, current month, 2025) x Kc (plant, month)
  net dose (mm)    = min(deficit to target, daily need x days to next window, RAW)
  recovery dose    = min((vwc_min - current) x root zone mm + daily need, RAW)
                     when current < vwc_min: a stressed plant is brought back above
                     its minimum in the next irrigation (or in N events if RAW caps it)
  gross dose (mm)  = net / efficiency
  litres           = gross mm x effective area   (area x wetted fraction)

The full refill of the deficit is kept for information only.
"""

import math

# Wetted fraction fw (FAO-56, localized irrigation); demo assumptions.
WETTED_FRACTION = {"spray": 1.0, "drip": 0.4}


def daily_dose(
    *,
    current_vwc,
    target_vwc,
    root_depth_m,
    efficiency,
    area_m2,
    wetted_fraction,
    et0_mm_day,
    kc,
    raw_mm,
    flow_lph=None,
    days_to_window=1,
    vwc_min=None,
):
    inputs = (current_vwc, target_vwc, root_depth_m, efficiency, area_m2, et0_mm_day, kc)
    if any(v is None for v in inputs) or root_depth_m <= 0 or not 0 < efficiency <= 1 or area_m2 <= 0:
        return None
    fw = wetted_fraction if wetted_fraction and 0 < wetted_fraction <= 1 else 1.0
    effective_area = area_m2 * fw
    deficit_mm = max(0.0, target_vwc - current_vwc) * root_depth_m * 1000
    daily_mm = et0_mm_day * kc
    raw_cap = raw_mm if raw_mm is not None and raw_mm > 0 else None
    recovery = vwc_min is not None and current_vwc < vwc_min
    if recovery:
        recovery_mm = (vwc_min - current_vwc) * root_depth_m * 1000 + daily_mm
        net_mm = min(recovery_mm, raw_cap) if raw_cap is not None else recovery_mm
        recovery_events = 1 if net_mm >= recovery_mm - 1e-9 else math.ceil(recovery_mm / net_mm - 1e-9)
    else:
        caps = [deficit_mm, daily_mm * max(1, days_to_window)]
        if raw_cap is not None:
            caps.append(raw_cap)
        net_mm = max(0.0, min(caps))
        recovery_events = None
    gross_mm = net_mm / efficiency
    litres = gross_mm * effective_area
    refill_days = math.ceil(deficit_mm / net_mm - 1e-9) if net_mm > 0 and deficit_mm > net_mm + 1e-9 else None
    return {
        "deficit_mm": round(deficit_mm, 3),
        "daily_need_mm": round(daily_mm, 3),
        "net_mm": round(net_mm, 3),
        "gross_mm": round(gross_mm, 3),
        "effective_area_m2": round(effective_area, 2),
        "litres": round(litres, 1),
        "litres_per_m2": round(gross_mm, 2),
        "minutes": round(litres / flow_lph * 60) if flow_lph else None,
        "refill_days": refill_days,
        "recovery": recovery,
        "recovery_events": recovery_events,
        "full_refill_l": round(deficit_mm / efficiency * effective_area, 1),
    }
