"""Dependency-free, reproducible measured-only forecasting research. No runtime model.

Usage: .venv/bin/python research/turfgrass/forecast.py SOURCE.zip OUTPUT.json
Models are fixed before the 2022 holdout. No tuning or future weather inputs.
"""

import csv
import hashlib
import io
import json
import math
import random
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean, median

MOISTURE = "SoilMoistureContent_Percent"
HORIZONS = (1, 3, 6, 12, 24)
PAST_WEATHER = ("AirTemperature_DegC", "RelativeHumidity_Percent", "Rainfall_mm")


def examples(rows, horizon):
    """Exact same-series timestamps; features are exclusively available at/before origin."""
    lookup = {datetime.fromisoformat(r["Time"]): r for r in rows}
    result = []
    for t, row in sorted(lookup.items()):
        offsets = [0, 1, 3, 6, 24]
        times = [t - timedelta(hours=h) for h in offsets]
        target_time = t + timedelta(hours=horizon)
        if any(s not in lookup for s in times) or target_time not in lookup:
            continue
        lag = [float(lookup[s][MOISTURE]) for s in times]
        x = [
            lag[0],
            *(lag[0] - a for a in lag[1:]),
            math.sin(2 * math.pi * t.hour / 24),
            math.cos(2 * math.pi * t.hour / 24),
            t.timetuple().tm_yday / 366,
        ]
        for name in PAST_WEATHER:
            value = row[name]
            # Missingness is explicit; no future fill or validation-set imputation.
            x.extend([float(value) if value else 0, float(not value)])
        target = lookup[target_time]
        window = [lookup.get(t + timedelta(hours=h)) for h in range(horizon + 1)]
        amounts = [r["IrrigationAmount_mm"] for r in window if r]
        event = (
            "positive_record_window"
            if any(a and float(a) > 0 for a in amounts)
            else (
                "unknown_event_window"
                if any(not a for a in amounts)
                else "no_recorded_irrigation"
            )
        )
        result.append(
            {
                "time": t,
                "target_time": target_time,
                "feature_times": times,
                "x": x,
                "current": lag[0],
                "y": float(target[MOISTURE]),
                "delta": float(target[MOISTURE]) - lag[0],
                "event": event,
            }
        )
    return result


def solve(matrix, values):
    a = [row[:] + [v] for row, v in zip(matrix, values)]
    for i in range(len(a)):
        pivot = max(range(i, len(a)), key=lambda j: abs(a[j][i]))
        a[i], a[pivot] = a[pivot], a[i]
        scale = a[i][i]
        if abs(scale) < 1e-12:
            raise ValueError("Singular design")
        a[i] = [v / scale for v in a[i]]
        for j in range(len(a)):
            if i != j:
                factor = a[j][i]
                a[j] = [v - factor * w for v, w in zip(a[j], a[i])]
    return [row[-1] for row in a]


def ridge(train):
    n = len(train[0]["x"])
    means = [mean(r["x"][i] for r in train) for i in range(n)]
    scales = [
        math.sqrt(mean((r["x"][i] - means[i]) ** 2 for r in train)) or 1
        for i in range(n)
    ]

    def design(row):
        return [1] + [(v - m) / s for v, m, s in zip(row["x"], means, scales)]

    xs = [design(r) for r in train]
    matrix = [
        [
            sum(x[i] * x[j] for x in xs) + (10 if i == j and i else 0)
            for j in range(n + 1)
        ]
        for i in range(n + 1)
    ]
    coef = solve(
        matrix,
        [sum(x[i] * r["delta"] for x, r in zip(xs, train)) for i in range(n + 1)],
    )
    return lambda r: r["current"] + sum(c * x for c, x in zip(coef, design(r)))


def boosted_stumps(train):
    # Squared-error boosting, 30 depth-one trees, learning rate .1; no test-set tuning.
    base = mean(r["delta"] for r in train)
    fitted = [base] * len(train)
    splits = []
    for i in range(len(train[0]["x"])):
        vals = sorted({r["x"][i] for r in train})
        splits.extend(
            (i, vals[min(len(vals) - 1, len(vals) * q // 10)]) for q in range(1, 10)
        )
    trees = []
    for _ in range(30):
        residual = [r["delta"] - p for r, p in zip(train, fitted)]
        best = None
        for i, cut in splits:
            left = [j for j, r in enumerate(train) if r["x"][i] <= cut]
            right = [j for j, r in enumerate(train) if r["x"][i] > cut]
            if min(len(left), len(right)) < 20:
                continue
            a, b = mean(residual[j] for j in left), mean(residual[j] for j in right)
            score = sum((residual[j] - a) ** 2 for j in left) + sum(
                (residual[j] - b) ** 2 for j in right
            )
            if best is None or score < best[0]:
                best = (score, i, cut, a, b)
        if best is None:
            break
        _, i, cut, a, b = best
        trees.append((i, cut, 0.1 * a, 0.1 * b))
        fitted = [
            p + 0.1 * (a if r["x"][i] <= cut else b) for p, r in zip(fitted, train)
        ]
    return (
        lambda r: r["current"]
        + base
        + sum(a if r["x"][i] <= cut else b for i, cut, a, b in trees)
    )


def quantile90(values):
    values = sorted(values)
    return values[min(len(values) - 1, math.ceil((len(values) + 1) * 0.9) - 1)]


def metrics(rows, predict, radius):
    errors = [predict(r) - r["y"] for r in rows]
    if not errors:
        return {"n": 0}
    days = defaultdict(list)
    for r, e in zip(rows, errors):
        days[r["time"].date()].append(abs(e))
    blocks = list(days.values())
    rng = random.Random(2030)
    samples = []
    for _ in range(200):
        drawn = [e for block in rng.choices(blocks, k=len(blocks)) for e in block]
        samples.append(mean(drawn))
    samples.sort()
    return {
        "n": len(rows),
        "mae_pp": mean(abs(e) for e in errors),
        "rmse_pp": math.sqrt(mean(e * e for e in errors)),
        "mae_day_block_interval_95_pp": [samples[4], samples[194]],
        "prediction_interval_nominal": 0.9,
        "interval_half_width_pp": radius,
        "test_interval_coverage": mean(abs(e) <= radius for e in errors),
    }


def run(path):
    with zipfile.ZipFile(path) as z:
        rows = list(
            csv.DictReader(
                io.StringIO(
                    z.read("Turfgrass_Burnley_MEASURED_Hourly.csv").decode("utf-8-sig")
                )
            )
        )
    assert len(rows) == 3792 and {r["DataType"] for r in rows} == {"measured"}
    grouped = defaultdict(list)
    for r in rows:
        grouped[(r["Year"], r["Treatment"])].append(r)
    evaluation, segments = [], []
    for treatment in ("Irrigated", "Unirrigated"):
        # Estimate a dry-loss parameter using measured 2021 dry/nonirrigated hours ONLY.
        original = grouped[("2021", treatment)]
        # Use first 70% only to keep the uncertainty calibration block separate.
        original = original[: int(len(original) * 0.7)]
        dry = [
            max(0, float(a[MOISTURE]) - float(b[MOISTURE]))
            for a, b in zip(original, original[1:])
            if all(
                r["IrrigationAmount_mm"]
                and float(r["IrrigationAmount_mm"]) == 0
                and r["Rainfall_mm"]
                and float(r["Rainfall_mm"]) == 0
                for r in (a, b)
            )
        ]
        loss_pp_h = median(dry)
        for h in HORIZONS:
            ex21 = examples(grouped[("2021", treatment)], h)
            split = datetime.fromisoformat(
                grouped[("2021", treatment)][
                    int(len(grouped[("2021", treatment)]) * 0.7)
                ]["Time"]
            )
            train = [r for r in ex21 if r["target_time"] < split]
            calibration = [r for r in ex21 if r["time"] >= split]
            test = examples(grouped[("2022", treatment)], h)
            assert max(r["target_time"] for r in train) < min(
                r["time"] for r in calibration
            )
            assert max(r["target_time"] for r in calibration) < min(
                r["time"] for r in test
            )
            assert all(
                max(r["feature_times"]) <= r["time"] < r["target_time"]
                for r in train + calibration + test
            )
            models = {
                "persistence": lambda r: r["current"],
                "balance_dry_scenario": lambda r, h=h: max(
                    0, r["current"] - loss_pp_h * h
                ),
                "ridge_lags_weather": ridge(train),
                "boosted_stumps": boosted_stumps(train),
            }
            for name, predict in models.items():
                radius = quantile90([abs(predict(r) - r["y"]) for r in calibration])
                info = {
                    "treatment": treatment,
                    "horizon_h": h,
                    "model": name,
                    "train_n": len(train),
                    "calibration_n": len(calibration),
                    "train_last_target": str(max(r["target_time"] for r in train)),
                    "calibration_first_origin": str(
                        min(r["time"] for r in calibration)
                    ),
                    "test_first_origin": str(min(r["time"] for r in test)),
                }
                evaluation.append(info | metrics(test, predict, radius))
                for segment in (
                    "positive_record_window",
                    "no_recorded_irrigation",
                    "unknown_event_window",
                ):
                    segments.append(
                        info
                        | {"segment": segment}
                        | metrics(
                            [r for r in test if r["event"] == segment], predict, radius
                        )
                    )
    return {
        "source": "https://zenodo.org/records/10972539",
        "archive_sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        "operational_eligible": False,
        "measured_rows": len(rows),
        "modeled_rows_used": 0,
        "split": "First 70% of 2021 train; final 30% calibrate intervals, purged crossing targets; all 2022 test, each treatment separately",
        "features": "current/1/3/6/24h moisture, past deltas, hour sin/cos, day of year, current completed-hour temperature/air RH/rain + missing flags",
        "event_evaluation": "Positive reported irrigation at origin through target, evaluation only; source hour-end convention; no causal claims",
        "balance_baseline": "Empirical dry root-storage loss from training dry hours; no future rain/irrigation; not calibrated FAO-56. ET, FC and representative root depth unavailable.",
        "limitations": [
            "Single Melbourne site, two short summers; no Saudi validation",
            "CS650 at 0.05m and hour-end averaging described in source article; cleaned derivative calibration and unit conversion not independently audited",
            "Errors are source moisture-percentage points, not accuracy percentages or verified root-zone VWC errors",
            "2022 treatment averages differ from 2021 sampling; correlated hours are not independent trials",
            "Day-block intervals are descriptive; 90% calibration bands do not guarantee 90% coverage after shift",
            "Irrigation/rain timing is retrospective for evaluation only; no irrigation-optimality targets",
            "Original OLS failure retained in results.json; no model activated for operational decisions",
        ],
        "evaluation": evaluation,
        "event_evaluation_results": segments,
    }


if __name__ == "__main__":
    source, output = map(Path, sys.argv[1:])
    if source.resolve() == output.resolve() or output.name in {
        "results.json",
        "assess.py",
    }:
        raise ValueError("Preserve previous study and source archive")
    result = run(source)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    for r in result["evaluation"]:
        print(
            r["treatment"],
            r["horizon_h"],
            r["model"],
            round(r["mae_pp"], 4),
            round(r["rmse_pp"], 4),
        )
