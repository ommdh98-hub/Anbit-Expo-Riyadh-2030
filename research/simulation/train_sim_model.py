"""Offline research only. Trains the Digital Twin's small decision trees on a
synthetic, rule-generated dataset. Never imports or writes ANBIT runtime data.

Usage (from the repository root):
    python3 research/simulation/train_sim_model.py

Reads   research/simulation/smart_irrigation_training_data.csv
Writes  research/simulation/metrics.json
        frontend/lib/twin/model.json

Standard library only (no scikit-learn): a CART tree is small enough to write
out, and the exported JSON is evaluated identically in the browser.
"""

import csv
import hashlib
import json
import math
import random
from collections import Counter
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "research/simulation/smart_irrigation_training_data.csv"
METRICS = ROOT / "research/simulation/metrics.json"
MODEL = ROOT / "frontend/lib/twin/model.json"

SEED = 42
TEST_FRACTION = 0.2
FEATURES = ["soilMoisture", "temperature", "humidity", "lightLevel", "rainDetected"]
# relayState is the actuator output, drySoilRisk is derived from soilMoisture and
# waterLevel is a tank level unrelated to the soil decision: excluded as leakage.
EXCLUDED = ["relayState", "drySoilRisk", "waterLevel"]
CLASSIFIER = {"max_depth": 4, "min_leaf": 20}
REGRESSOR = {"max_depth": 3, "min_leaf": 50}


def load():
    with DATA.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames
        rows = list(reader)
    return columns, rows


def num(row, key):
    return float(row[key])


# ---------------------------------------------------------------- CART


def _gini(pos, n):
    if n == 0:
        return 0.0
    p = pos / n
    return 2 * p * (1 - p)


def _best_split(X, y, idx, kind, min_leaf):
    """Exhaustive split search; ties keep the first feature/threshold found."""
    n = len(idx)
    best = None
    if kind == "class":
        total_pos = sum(y[i] for i in idx)
        parent = _gini(total_pos, n)
    else:
        total = sum(y[i] for i in idx)
        total_sq = sum(y[i] * y[i] for i in idx)
        parent = total_sq / n - (total / n) ** 2
    for f in range(len(FEATURES)):
        order = sorted(idx, key=lambda i: X[i][f])
        left_n = 0
        left_a = 0.0
        left_b = 0.0
        for k in range(n - 1):
            i = order[k]
            left_n += 1
            left_a += y[i]
            left_b += y[i] * y[i]
            here, nxt = X[i][f], X[order[k + 1]][f]
            if here == nxt or left_n < min_leaf or n - left_n < min_leaf:
                continue
            right_n = n - left_n
            if kind == "class":
                impurity = (
                    left_n * _gini(left_a, left_n)
                    + right_n * _gini(total_pos - left_a, right_n)
                ) / n
            else:
                lv = left_b / left_n - (left_a / left_n) ** 2
                ra, rb = total - left_a, total_sq - left_b
                rv = rb / right_n - (ra / right_n) ** 2
                impurity = (left_n * lv + right_n * rv) / n
            gain = parent - impurity
            if gain > 1e-12 and (best is None or gain > best[0] + 1e-12):
                best = (gain, f, (here + nxt) / 2)
    return best


def build(X, y, idx, kind, depth, max_depth, min_leaf):
    n = len(idx)
    value = sum(y[i] for i in idx) / n
    leaf = {"p": round(value, 6)} if kind == "class" else {"v": round(value, 4)}
    leaf["n"] = n
    if depth >= max_depth or n < 2 * min_leaf or value in (0.0, 1.0) and kind == "class":
        return leaf
    split = _best_split(X, y, idx, kind, min_leaf)
    if not split:
        return leaf
    _, f, t = split
    left = [i for i in idx if X[i][f] <= t]
    right = [i for i in idx if X[i][f] > t]
    return {
        "f": f,
        "t": round(t, 4),
        "l": build(X, y, left, kind, depth + 1, max_depth, min_leaf),
        "r": build(X, y, right, kind, depth + 1, max_depth, min_leaf),
    }


def predict(node, x):
    while "f" in node:
        node = node["l"] if x[node["f"]] <= node["t"] else node["r"]
    return node.get("p", node.get("v"))


def depth_of(node):
    return 0 if "f" not in node else 1 + max(depth_of(node["l"]), depth_of(node["r"]))


def leaves_of(node):
    return 1 if "f" not in node else leaves_of(node["l"]) + leaves_of(node["r"])


# ---------------------------------------------------------------- metrics


def classification(y_true, y_pred):
    tp = sum(1 for a, b in zip(y_true, y_pred) if a == 1 and b == 1)
    tn = sum(1 for a, b in zip(y_true, y_pred) if a == 0 and b == 0)
    fp = sum(1 for a, b in zip(y_true, y_pred) if a == 0 and b == 1)
    fn = sum(1 for a, b in zip(y_true, y_pred) if a == 1 and b == 0)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "accuracy": round((tp + tn) / len(y_true), 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "confusion": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
    }


def regression(y_true, y_pred):
    errors = [a - b for a, b in zip(y_true, y_pred)]
    mu = mean(y_true)
    ss_tot = sum((a - mu) ** 2 for a in y_true)
    ss_res = sum(e * e for e in errors)
    return {
        "mae": round(mean(abs(e) for e in errors), 3),
        "rmse": round(math.sqrt(ss_res / len(errors)), 3),
        "r2": round(1 - ss_res / ss_tot, 4) if ss_tot else 0.0,
    }


def pearson(a, b):
    ma, mb = mean(a), mean(b)
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = math.sqrt(sum((x - ma) ** 2 for x in a))
    vb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return cov / (va * vb) if va and vb else 0.0


# ---------------------------------------------------------------- audit


def audit(columns, rows):
    need = [r for r in rows if r["irrigationNeeded"] == "1"]
    dry_max = max(num(r, "soilMoisture") for r in need)
    wet_min = min(num(r, "soilMoisture") for r in rows if r["irrigationNeeded"] == "0" and r["rainDetected"] == "0")
    rule_hits = sum(
        1 for r in rows if (num(r, "soilMoisture") <= dry_max) == (r["irrigationNeeded"] == "1")
    )
    minutes = [num(r, "predictedMinutes") for r in need]
    return {
        "rows": len(rows),
        "columns": columns,
        "sha256": hashlib.sha256(DATA.read_bytes()).hexdigest(),
        "time_or_location_columns": [
            c for c in columns if any(w in c.lower() for w in ("time", "date", "lat", "lon", "location", "site", "city"))
        ],
        "duplicate_rows": len(rows) - len({tuple(r.values()) for r in rows}),
        "class_balance": dict(Counter(r["irrigationNeeded"] for r in rows)),
        "ranges": {
            c: [min(num(r, c) for r in rows), max(num(r, c) for r in rows)]
            for c in columns
            if c != "drySoilRisk"
        },
        "generating_rule_found": f"irrigationNeeded = soilMoisture <= {dry_max:g}",
        "generating_rule_matches_rows": rule_hits,
        "separation_gap": [dry_max, wet_min],
        "rain_with_need": sum(1 for r in need if r["rainDetected"] == "1"),
        # Rain only ever appears with wet soil, so it adds nothing beyond soilMoisture.
        "rain_with_dry_soil": sum(1 for r in rows if r["rainDetected"] == "1" and num(r, "soilMoisture") <= dry_max),
        "relay_on_without_need": sum(1 for r in rows if r["relayState"] == "1" and r["irrigationNeeded"] == "0"),
        "predicted_minutes_when_needed": {
            "min": min(minutes),
            "max": max(minutes),
            "mean": round(mean(minutes), 3),
            "corr_soilMoisture": round(pearson([num(r, "soilMoisture") for r in need], minutes), 4),
            "corr_temperature": round(pearson([num(r, "temperature") for r in need], minutes), 4),
            "corr_humidity": round(pearson([num(r, "humidity") for r in need], minutes), 4),
            "corr_lightLevel": round(pearson([num(r, "lightLevel") for r in need], minutes), 4),
        },
        "predicted_minutes_when_not_needed": sorted({num(r, "predictedMinutes") for r in rows if r["irrigationNeeded"] == "0"}),
    }


# ---------------------------------------------------------------- main


def main():
    columns, rows = load()
    facts = audit(columns, rows)

    order = list(range(len(rows)))
    random.Random(SEED).shuffle(order)
    cut = int(len(rows) * (1 - TEST_FRACTION))
    train, test = order[:cut], order[cut:]
    X = [[num(r, f) for f in FEATURES] for r in rows]
    y_need = [int(r["irrigationNeeded"]) for r in rows]
    y_min = [num(r, "predictedMinutes") for r in rows]

    clf = build(X, y_need, train, "class", 0, **CLASSIFIER)
    clf_pred = [1 if predict(clf, X[i]) >= 0.5 else 0 for i in test]

    # Simple rule baseline: one soilMoisture threshold, chosen on the training split only.
    candidates = sorted({X[i][0] for i in train})
    best_t = max(candidates, key=lambda t: sum((X[i][0] <= t) == bool(y_need[i]) for i in train))
    rule_pred = [1 if X[i][0] <= best_t else 0 for i in test]
    truth = [y_need[i] for i in test]

    # Minutes are only defined when irrigation is needed.
    train_need = [i for i in train if y_need[i] == 1]
    test_need = [i for i in test if y_need[i] == 1]
    reg = build(X, y_min, train_need, "reg", 0, **REGRESSOR)
    reg_pred = [predict(reg, X[i]) for i in test_need]
    mean_pred = [mean(y_min[i] for i in train_need)] * len(test_need)
    truth_min = [y_min[i] for i in test_need]

    metrics = {
        "note": "Synthetic, rule-generated data. Scores measure how well a tree recovers the generator's rule, not real-world irrigation accuracy.",
        "seed": SEED,
        "split": {"train": len(train), "test": len(test), "test_fraction": TEST_FRACTION},
        "features": FEATURES,
        "excluded_as_leakage": EXCLUDED,
        "audit": facts,
        "classifier": {
            "params": CLASSIFIER,
            "depth": depth_of(clf),
            "leaves": leaves_of(clf),
            "test": classification(truth, clf_pred),
        },
        "rule_baseline": {
            "rule": f"soilMoisture <= {best_t:g}",
            "test": classification(truth, rule_pred),
        },
        "regressor_minutes": {
            "params": REGRESSOR,
            "depth": depth_of(reg),
            "leaves": leaves_of(reg),
            "test_rows": len(test_need),
            "test": regression(truth_min, reg_pred),
            "mean_baseline_test": regression(truth_min, mean_pred),
        },
    }

    samples = []
    for i in test[:40]:
        samples.append(
            {
                "x": X[i],
                "need_p": predict(clf, X[i]),
                "minutes": predict(reg, X[i]),
            }
        )
    model = {
        "version": 1,
        "label": "Decision trees trained on synthetic, rule-generated data",
        "dataset_sha256": facts["sha256"],
        "seed": SEED,
        "features": FEATURES,
        "feature_ranges": {f: facts["ranges"][f] for f in FEATURES},
        "soil_moisture_index": {
            "min": 10,
            "max": 90,
            "assumption": "Sensor index 10 = wilting point, 90 = field capacity of the section's soil, linear in between. Not a calibrated VWC conversion.",
        },
        "classifier": clf,
        "regressor_minutes": reg,
        "regressor_has_signal": metrics["regressor_minutes"]["test"]["r2"] > 0.05,
        "metrics": {
            "classifier_accuracy": metrics["classifier"]["test"]["accuracy"],
            "rule_accuracy": metrics["rule_baseline"]["test"]["accuracy"],
            "minutes_r2": metrics["regressor_minutes"]["test"]["r2"],
        },
        "samples": samples,
    }

    METRICS.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    MODEL.write_text(json.dumps(model, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({k: metrics[k] for k in ("classifier", "rule_baseline", "regressor_minutes")}, indent=2))
    print("audit:", facts["generating_rule_found"], "| rows matching:", facts["generating_rule_matches_rows"], "/", facts["rows"])


if __name__ == "__main__":
    main()
