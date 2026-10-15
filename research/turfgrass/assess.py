"""Offline only. Reads the supplied ZIP; does not import or write ANBIT runtime data.
Usage: python research/turfgrass/assess.py SOURCE.zip OUTPUT.json
"""

import csv, io, json, math, sys, zipfile, hashlib
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean


def assess(path):
    with zipfile.ZipFile(path) as z:
        contents = {n: z.read(n).decode("utf-8-sig") for n in z.namelist()}
    assert len(contents) == 7
    tables = {
        n: list(csv.DictReader(io.StringIO(s)))
        for n, s in contents.items()
        if n.endswith(".csv")
    }
    measured = tables["Turfgrass_Burnley_MEASURED_Hourly.csv"]
    modeled = tables["Turfgrass_UTC_MODELED_Hourly.csv"]
    pairs = tables["Turfgrass_MEASURED_NextHour_Prediction.csv"]
    combined = tables["Turfgrass_AllSources_LABELED_Hourly.csv"]
    assert (len(measured), len(modeled), len(pairs), len(combined)) == (
        3792,
        2808,
        3788,
        6600,
    )

    def key(r):
        return (r["Year"], r["Treatment"], r["Time"])

    assert len(set(map(key, measured))) == len(measured)
    assert {r["DataType"] for r in pairs + measured} == {"measured"}
    assert {r["DataType"] for r in modeled} == {"modeled_UTC"}
    serial = lambda r: json.dumps(r, sort_keys=True)
    assert Counter(map(serial, combined)) == Counter(map(serial, measured + modeled))
    lookup = {key(r): r for r in measured}
    grouped = defaultdict(list)
    for r in measured:
        grouped[(r["Year"], r["Treatment"])].append(r)
    group_profiles = {}
    for k, rows in grouped.items():
        times = [datetime.fromisoformat(r["Time"]) for r in rows]
        assert all(b - a == timedelta(hours=1) for a, b in zip(times, times[1:]))
        group_profiles["|".join(k)] = {
            "rows": len(rows),
            "start": str(times[0]),
            "end": str(times[-1]),
            "missing_irrigation": sum(r["IrrigationAmount_mm"] == "" for r in rows),
        }
    target = "Target_SoilMoisture_NextHour_Percent"
    moisture = "SoilMoistureContent_Percent"
    assert len(set(map(key, pairs))) == len(pairs)
    pair_groups = defaultdict(list)
    for row in pairs:
        pair_groups[(row["Year"], row["Treatment"])].append(row)
    for group, rows in pair_groups.items():
        times = [datetime.fromisoformat(row["Time"]) for row in rows]
        assert all(b - a == timedelta(hours=1) for a, b in zip(times, times[1:]))
        assert len(rows) == len(grouped[group]) - 1
    for r in pairs:
        t = datetime.fromisoformat(r["Time"]) + timedelta(hours=1)
        nxt = lookup[(r["Year"], r["Treatment"], str(t))]
        assert float(r[target]) == float(nxt[moisture])
        assert {k: v for k, v in r.items() if k != target} == lookup[key(r)]
    profiles = {}
    for n, rows in tables.items():
        profiles[n] = {
            "rows": len(rows),
            "columns": list(rows[0]),
            "missing": {
                k: sum(r[k] == "" for r in rows)
                for k in rows[0]
                if any(r[k] == "" for r in rows)
            },
            "exact_duplicates": len(rows) - len({serial(r) for r in rows}),
        }
    ranges = {}
    for k in measured[0]:
        if k in [
            "Time",
            "Year",
            "Site",
            "Treatment",
            "DataType",
            "SourceFile",
            "ClimateSourceFile",
        ]:
            continue
        vals = [float(r[k]) for r in measured if r[k] != ""]
        if vals:
            assert all(math.isfinite(v) for v in vals)
            ranges[k] = {
                "min": min(vals),
                "max": max(vals),
                "negative": sum(v < 0 for v in vals),
            }
    # Prespecified univariate OLS per treatment. No future weather/action inputs;
    # only current measured moisture is used. Fit 2021, evaluate untouched 2022.
    results = []
    coefficients = {}
    for treatment in ["Irrigated", "Unirrigated"]:
        train = [
            r for r in pairs if r["Year"] == "2021" and r["Treatment"] == treatment
        ]
        test = [r for r in pairs if r["Year"] == "2022" and r["Treatment"] == treatment]
        x = [float(r[moisture]) for r in train]
        y = [float(r[target]) for r in train]
        xm, ym = mean(x), mean(y)
        slope = sum((a - xm) * (b - ym) for a, b in zip(x, y)) / sum(
            (a - xm) ** 2 for a in x
        )
        intercept = ym - slope * xm
        coefficients[treatment] = {
            "slope": slope,
            "intercept": intercept,
            "train_n": len(train),
            "test_n": len(test),
        }

        def event(r):
            nxt = lookup[
                (
                    r["Year"],
                    r["Treatment"],
                    str(datetime.fromisoformat(r["Time"]) + timedelta(hours=1)),
                )
            ]
            a, b = r["IrrigationAmount_mm"], nxt["IrrigationAmount_mm"]
            if (a and float(a) > 0) or (b and float(b) > 0):
                return "event_window"
            return "unknown_irrigation" if not a or not b else "no_recorded_event"

        for segment in [
            "all",
            "event_window",
            "no_recorded_event",
            "unknown_irrigation",
        ]:
            rows = [r for r in test if segment == "all" or event(r) == segment]
            for model in ["persistence", "ols_current_moisture"]:
                errors = [
                    (
                        float(r[moisture])
                        if model == "persistence"
                        else intercept + slope * float(r[moisture])
                    )
                    - float(r[target])
                    for r in rows
                ]
                results.append(
                    {
                        "treatment": treatment,
                        "segment": segment,
                        "model": model,
                        "n": len(rows),
                        "mae_pp": mean(abs(v) for v in errors) if errors else None,
                        "rmse_pp": (
                            math.sqrt(mean(v * v for v in errors)) if errors else None
                        ),
                    }
                )
    return {
        "archive_sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        "source": "https://zenodo.org/records/10972539",
        "profiles": profiles,
        "measured_groups": group_profiles,
        "measured_ranges": ranges,
        "verified_target_pairs": len(pairs),
        "combined_equals_union": True,
        "metadata_quality_report": json.loads(
            contents["Turfgrass_Quality_Report.json"]
        ),
        "archive_readme": contents["Turfgrass_README.md"],
        "coefficients_research_only": coefficients,
        "evaluation": results,
        "event_definition": "Irrigation >0 at current OR next row, used ONLY to stratify evaluation; unknown is not zero. Hour interval convention unverified.",
    }


if __name__ == "__main__":
    source, output = map(Path, sys.argv[1:])
    if source.resolve() == output.resolve() or output.suffix != ".json":
        raise ValueError("Separate JSON output required")
    result = assess(source)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "groups": result["measured_groups"],
                "results": result["evaluation"],
                "ranges": result["measured_ranges"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
