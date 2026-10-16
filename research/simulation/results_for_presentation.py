"""Builds docs/RESULTS_FOR_PRESENTATION.md from generated outputs only.

Every number comes from the audit JSON files, the saved test output and the
reference database; nothing is typed in. Run through scripts/results_for_presentation.sh,
which produces those inputs fresh first.

Usage:
    python3 research/simulation/results_for_presentation.py PYTEST_LOG NODE_TEST_LOG
"""

import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDITS = {
    "generated": ROOT / "research/simulation/audit_weather_generated.json",
    "real2025": ROOT / "research/simulation/audit_weather_real2025.json",
}
SENSOR_COUNT = ROOT / "research/simulation/audit_sensor_count.json"
REFERENCE = ROOT / "data/reference/ANBIT_reference_app.db"
OUT = ROOT / "docs/RESULTS_FOR_PRESENTATION.md"
SEASONS = [("summer", "صيف"), ("winter", "شتاء"), ("spring", "ربيع")]
CITY_NAMES = {"riyadh": "الرياض", "jeddah": "جدة", "dammam": "الدمام", "medina": "المدينة", "tabuk": "تبوك", "abha": "أبها"}
STRATEGIES = [("anbit", "أنبت"), ("sensor", "آلي بالحساسات"), ("fixed", "جدول ثابت")]


def pct(value, digits=1):
    return f"{value:+.{digits}f}%".replace("+", "+") if value is not None else "—"


def reduction(base, value):
    return (base - value) / base * 100 if base else None


def pytest_counts(text):
    passed = re.search(r"(\d+) passed", text)
    failed = re.search(r"(\d+) failed", text)
    if not passed:
        raise SystemExit("pytest summary not found in the log")
    return int(passed.group(1)), int(failed.group(1)) if failed else 0


def node_counts(text):
    found = {k: int(v) for k, v in re.findall(r"ℹ (tests|pass|fail) (\d+)", text)}
    if "tests" not in found:
        raise SystemExit("node --test summary not found in the log")
    return found["tests"], found.get("pass", 0), found.get("fail", 0)


def audit_section(name, audit):
    title = "الطقس المولّد (الافتراضي في التوأم)" if name == "generated" else "طقس 2025 الفعلي (Open-Meteo، إعادة تحليل ERA5)"
    lines = [
        f"### {title}",
        "",
        f"المدينة: {CITY_NAMES.get(audit['city'], audit['city'])}، {audit['seeds']} بذور × {audit['days']} يومًا لكل موسم، الطقس: `{audit.get('weather', 'generated')}`.",
        "",
        "| الموسم | مياه أنبت مقابل الجدول الثابت | مياه أنبت مقابل الآلي بالحساسات | خفض ساعات العطش مقابل الثابت | خفض ساعات العطش مقابل الحساسات |",
        "|---|---|---|---|---|",
    ]
    for key, label in SEASONS:
        s = audit["bySeason"][key]
        # Saving % is (other − ANBIT) ÷ other; water change is its negative.
        lines.append(
            f"| {label} | {pct(-s['savingVsFixedPct'])} | {pct(-s['savingVsSensorPct'])} | "
            f"{reduction(s['fixed']['stressH'], s['anbit']['stressH']):.1f}% | {reduction(s['sensor']['stressH'], s['anbit']['stressH']):.1f}% |"
        )
    lines += [
        "",
        "| الموسم | الطريقة | المياه (م³) | ساعات العطش | داخل النطاق الصحي | الهدر | أحداث ري زائد |",
        "|---|---|---|---|---|---|---|",
    ]
    for key, label in SEASONS:
        s = audit["bySeason"][key]
        for skey, slabel in STRATEGIES:
            x = s[skey]
            lines.append(
                f"| {label} | {slabel} | {x['waterM3']} | {x['stressH']} | {x['inRangePct']}% | {x['wastePct']}% | {x['overEvents']} |"
            )
    return lines


def signed(value, digits=1, suffix=""):
    return "—" if value is None else f"{value:+.{digits}f}{suffix}"


def sensor_count_section(sc):
    """How many real sensors are enough: table per season from audit_sensor_count.json."""
    lines = [
        "## كم حساسًا حقيقيًا يكفي؟ (التوأم الرقمي)",
        "",
        f"محاكاة بطقس {CITY_NAMES.get(sc['city'], sc['city'])} 2025 الفعلي، {sc['seeds']} بذور × {sc['days']} يومًا لكل موسم، استراتيجية أنبت فقط، "
        f"موقع التوأم {sc['sections']} قطاعًا بمساحة {sc['siteAreaM2']:,} م². بقية القطاعات تعمل بحساسات افتراضية كما هي اليوم. "
        f"«مختار»: توزيع جشع بشبكة التغطية في التطبيق (نصف قطر {sc['placement']['radius']:g} قطاع). "
        f"«عشوائي»: {sc['placement']['randomPlacementsPerN']} توزيعات ببذور ثابتة، المتوسط والمدى. N=0 بلا أي قراءة تربة (حد أدنى).",
        "",
    ]
    chosen, random, default = sc["chosen"], sc["random"], sc["default"]
    for key, label in SEASONS:
        lines += [
            f"### {label}",
            "",
            "| N | ساعات الإجهاد (مختار) | التغير عن N=12 | المياه (م³) | تغير المياه عن N=12 | داخل النطاق الصحي | أحداث ري زائد | ساعات الإجهاد (عشوائي: المتوسط [المدى]) | مختار − متوسط العشوائي |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for n in sc["counts"]:
            x = chosen[str(n)]["bySeason"][key]
            d = chosen[str(n)]["vsN12"][key]["stressH"]
            dw = chosen[str(n)]["vsN12"][key]["waterM3"]
            r = random.get(str(n))
            rs = r["summary"][key]["stressH"] if r else None
            rnd = f"{rs['mean']} [{rs['min']}–{rs['max']}]" if rs else "نفس التوزيع"
            gap = f"{signed(x['stressH'] - rs['mean'])} س" if rs else "—"
            lines.append(
                f"| {n} | {x['stressH']} | {signed(d['abs'])} س ({signed(d['pct'], 1, '%')}) | {x['waterM3']} | {signed(dw['abs'])} م³ ({signed(dw['pct'], 1, '%')}) "
                f"| {x['inRangePct']}% | {x['overEvents']} | {rnd} | {gap} |"
            )
        y = default["bySeason"][key]
        lines.append(f"| {len(default['ids'])} (الافتراضي في التوأم) | {y['stressH']} | — | {y['waterM3']} | — | {y['inRangePct']}% | {y['overEvents']} | — | — |")
        lines.append("")
    n = sc["smallestChosenNWithin"]
    lines.append(
        f"أصغر عدد حساسات «مختار» أقل من 12 تبقى ساعات إجهاده ضمن {sc['withinPct']:g}% من N=12 في المواسم الثلاثة: "
        + (f"N={n}." if n is not None and n < 12 else "لا يوجد.")
    )
    # Chosen vs random: how many (N, season) pairs the chosen placement has fewer stress hours.
    pairs = [(n, key) for n in sc["counts"] if str(n) in random for key, _ in SEASONS]
    better = sum(chosen[str(n)]["bySeason"][k]["stressH"] < random[str(n)]["summary"][k]["stressH"]["mean"] for n, k in pairs)
    lines.append(
        f"التوزيع «مختار» بالتغطية الهندسية كانت ساعات إجهاده أقل من متوسط «عشوائي» في {better} من {len(pairs)} حالة (عدد × موسم)."
    )
    lines.append("")
    return lines + soil_placement_section(sc)


def soil_placement_section(sc):
    """Third placement, by soil and plant kind, against «مختار» and «عشوائي» (stress hours)."""
    chosen, random, soil = sc["chosen"], sc["random"], sc["soil"]
    counts = sc["placement"]["soil"]["counts"]
    lines = [
        "### توزيع «حسب التربة والنبات»",
        "",
        "كل نوع تربة (رملية، طميية، طينية) يأخذ حساسًا حقيقيًا قبل أن يأخذ أي نوع حساسًا ثانيًا، ثم كل نوع نبات قدر الإمكان؛ "
        "عند التعادل المساحة الأكبر ثم الترتيب الأصغر. ترتيب الاختيار: " + "، ".join(sc["placement"]["soil"]["order"]) + ".",
        "",
        "| الموسم | N | القطاعات الحقيقية | ساعات الإجهاد (حسب التربة والنبات) | التغير عن N=12 | المياه (م³) | ساعات الإجهاد (مختار) | ساعات الإجهاد (عشوائي: المتوسط) | التربة − مختار | التربة − متوسط العشوائي |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    wins = {}
    for key, label in SEASONS:
        w = {"chosen": 0, "random": 0}
        for n in counts:
            x = soil[str(n)]["bySeason"][key]
            d = soil[str(n)]["vsN12"][key]["stressH"]
            ch = chosen[str(n)]["bySeason"][key]["stressH"]
            rm = random[str(n)]["summary"][key]["stressH"]["mean"]
            w["chosen"] += x["stressH"] < ch
            w["random"] += x["stressH"] < rm
            lines.append(
                f"| {label} | {n} | {'، '.join(soil[str(n)]['ids'])} | {x['stressH']} | {signed(d['abs'])} س ({signed(d['pct'], 1, '%')}) | {x['waterM3']} "
                f"| {ch} | {rm} | {signed(x['stressH'] - ch)} س | {signed(x['stressH'] - rm)} س |"
            )
        wins[key] = w
    lines.append("")
    for key, label in SEASONS:
        lines.append(
            f"- {label}: ساعات إجهاد «حسب التربة والنبات» أقل من «مختار» في {wins[key]['chosen']} من {len(counts)}، "
            f"وأقل من متوسط «عشوائي» في {wins[key]['random']} من {len(counts)}."
        )
    total = len(counts) * len(SEASONS)
    lines.append(
        f"- الإجمالي: أقل من «مختار» في {sum(w['chosen'] for w in wins.values())} من {total} حالة، "
        f"وأقل من متوسط «عشوائي» في {sum(w['random'] for w in wins.values())} من {total} حالة (عدد × موسم)."
    )
    lines.append("")
    return lines


def data_counts():
    con = sqlite3.connect(f"file:{REFERENCE}?mode=ro", uri=True)
    one = lambda sql: con.execute(sql).fetchone()[0]
    days = con.execute("SELECT MIN(n), MAX(n) FROM (SELECT COUNT(*) n FROM weather_daily GROUP BY city_id)").fetchone()
    return {
        "plants": one("SELECT COUNT(*) FROM plants"),
        "landscape": one("SELECT COUNT(*) FROM plants p JOIN landscape_params l USING (plant_id) WHERE p.use_case IN ('landscape', 'both')"),
        "cities": one("SELECT COUNT(*) FROM cities"),
        "cities_with_weather": one("SELECT COUNT(DISTINCT city_id) FROM weather_daily"),
        "weather_rows": one("SELECT COUNT(*) FROM weather_daily"),
        "days_min": days[0],
        "days_max": days[1],
        "year": one("SELECT MIN(substr(date, 1, 4)) FROM weather_daily"),
        "soils": one("SELECT COUNT(*) FROM soil_hydraulics"),
        "targets": one("SELECT COUNT(*) FROM plant_soil_targets"),
    }


def main():
    pytest_log, node_log = Path(sys.argv[1]), Path(sys.argv[2])
    audits = {k: json.loads(p.read_text(encoding="utf-8")) for k, p in AUDITS.items()}
    py_passed, py_failed = pytest_counts(pytest_log.read_text(encoding="utf-8"))
    js_total, js_passed, js_failed = node_counts(node_log.read_text(encoding="utf-8"))
    d = data_counts()
    lines = [
        "# نتائج للعرض التقديمي",
        "",
        f"أُنشئ آليًا في {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC بالأمر `bash scripts/results_for_presentation.sh`. "
        "كل رقم هنا مقروء من ملفات المراجعة ومخرجات الاختبارات والقاعدة المرجعية؛ لا يُكتب أي رقم يدويًا.",
        "",
        "## التوأم الرقمي",
        "",
        "نتائج محاكاة بافتراضات معلنة، وليست قياسًا ميدانيًا. الجدول الثابت افتراض موسمي، والقيمة السالبة في عمود المياه تعني أن أنبت استخدم ماءً أقل.",
        "",
    ]
    for name in ("generated", "real2025"):
        lines += audit_section(name, audits[name]) + [""]
    lines += sensor_count_section(json.loads(SENSOR_COUNT.read_text(encoding="utf-8")))
    lines += [
        "## الاختبارات (تشغيل جديد)",
        "",
        "| المجموعة | الناجحة | الفاشلة | الإجمالي |",
        "|---|---|---|---|",
        f"| الخادم (pytest) | {py_passed} | {py_failed} | {py_passed + py_failed} |",
        f"| الواجهة (node --test) | {js_passed} | {js_failed} | {js_total} |",
        "",
        "## البيانات المرجعية",
        "",
        "| البند | العدد |",
        "|---|---|",
        f"| النباتات | {d['plants']} |",
        f"| نباتات المسطحات الخضراء | {d['landscape']} |",
        f"| المدن | {d['cities']} |",
        f"| مدن لها طقس يومي {d['year']} | {d['cities_with_weather']} |",
        f"| أيام الطقس لكل مدينة | {d['days_min']}–{d['days_max']} |",
        f"| صفوف الطقس اليومي | {d['weather_rows']} |",
        f"| أنواع التربة | {d['soils']} |",
        f"| حدود الرطوبة (نبات × تربة) | {d['targets']} |",
        "",
        "## المصادر",
        "",
        f"- `{AUDITS['generated'].relative_to(ROOT)}`",
        f"- `{AUDITS['real2025'].relative_to(ROOT)}`",
        f"- `{SENSOR_COUNT.relative_to(ROOT)}`",
        f"- `{REFERENCE.relative_to(ROOT)}`",
    ]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
