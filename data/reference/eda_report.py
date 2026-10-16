"""EDA report for ANBIT data (Arabic, RTL HTML with embedded charts).

Usage:
  python3 eda_report.py --enbt ENBT.db --csv smart_irrigation_training_data.csv \
      --ref ANBIT_reference.db [--extra path/to/anbit.db ...] --out EDA_report.html

--extra profiles any other SQLite database (e.g. backend/anbit.db) or CSV with a
generic per-table / per-column profile, read-only.
"""
import argparse
import base64
import html
import io
import sqlite3
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

INK, MUTED, MARK, GRID = "#1E2722", "#5A645E", "#2E6B3F", "#E3E2DA"
plt.rcParams.update({"font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": MUTED,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False,
                     "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6})


def fig_b64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def table(df, max_rows=40):
    return df.head(max_rows).to_html(index=False, border=0, classes="t", float_format=lambda x: f"{x:,.3g}")


def profile_frame(df):
    rows = []
    for c in df.columns:
        s = df[c]
        num = pd.api.types.is_numeric_dtype(s)
        rows.append({"العمود": c, "النوع": str(s.dtype), "مفقود": int(s.isna().sum()),
                     "قيم فريدة": int(s.nunique()),
                     "أدنى": s.min() if num else "", "وسيط": s.median() if num else "",
                     "أعلى": s.max() if num else "",
                     "مثال": "" if num else html.escape(str(s.dropna().iloc[0]) if s.notna().any() else "")[:40]})
    return pd.DataFrame(rows)


def profile_sqlite(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    parts = []
    for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        df = pd.read_sql(f'SELECT * FROM "{t}" LIMIT 200000', con)
        n = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        dups = int(df.duplicated().sum()) if len(df) else 0
        parts.append(f"<h4>{html.escape(t)} — {n:,} صف، {len(df.columns)} عمود، مكرر: {dups}</h4>" +
                     (table(profile_frame(df)) if len(df.columns) else ""))
    con.close()
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--enbt", required=True)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--extra", nargs="*", default=[])
    ap.add_argument("--out", default="EDA_report.html")
    a = ap.parse_args()
    S = []  # sections (title, html)

    con = sqlite3.connect(f"file:{a.enbt}?mode=ro", uri=True)
    plant = pd.read_sql("SELECT * FROM Plant", con)
    cities = pd.read_sql("SELECT * FROM Cities", con)
    suit = pd.read_sql("SELECT * FROM PlantCitySuitability", con)
    hist = pd.read_sql("SELECT * FROM IrrigationHistory", con)
    weather_n = con.execute("SELECT COUNT(*) FROM WeatherHistory").fetchone()[0]
    fk_target = con.execute("SELECT sql FROM sqlite_master WHERE name='PlantCitySuitability'").fetchone()[0]
    con.close()

    # ---- overview
    ov = pd.DataFrame([
        ("Plant", len(plant), "37 نباتًا: 17 فاكهة وخضار (معرّف 1–17) و20 عشبًا وغطاءً أرضيًا (21–40)؛ المعرّفات 18–20 غير موجودة"),
        ("Cities", len(cities), "14 مدينة بقيم سنوية واحدة؛ لا إحداثيات"),
        ("PlantCitySuitability", len(suit), "تقييم 50+50 لكل نبات ومدينة؛ expected_water نسخة من water_needs"),
        ("IrrigationHistory", len(hist), "365 صفًا لكل نبات ومدينة، دون تاريخ"),
        ("WeatherHistory", weather_n, "فارغ"),
    ], columns=["الجدول", "الصفوف", "الملاحظة"])
    S.append(("نظرة عامة على قاعدة ENBT", table(ov) +
              f"<p class='note'>المفاتيح الأجنبية في PlantCitySuitability وIrrigationHistory تشير إلى جدول اسمه "
              f"<code>Plants</code> غير موجود (الجدول الفعلي <code>Plant</code>)، فلا يُفرض أي ربط.</p>"))

    # ---- plants: units
    p = plant.copy()
    p["group"] = np.where(p.id >= 21, "Turf & groundcover", "Fruit & vegetables")
    fig, ax = plt.subplots(1, 2, figsize=(9, 3.2))
    for i, (col, title) in enumerate([("root_depth", "root_depth (as stored)"), ("water_needs", "water_needs (as stored)")]):
        for j, (g, d) in enumerate(p.groupby("group")):
            ax[i].scatter(np.full(len(d), j) + np.random.uniform(-.12, .12, len(d)), d[col], s=22, color=MARK, alpha=.8)
        ax[i].set_xticks([0, 1], sorted(p.group.unique()))
        ax[i].set_title(title, color=INK, fontsize=10)
    img = fig_b64(fig)
    S.append(("وحدات مختلطة في جدول النباتات",
              f"<img src='data:image/png;base64,{img}'><ul>"
              f"<li>عمق الجذور: الفاكهة بالمتر (0.4–6)، والأعشاب بالسنتيمتر (20–120). صُحّح في القاعدة النظيفة إلى <code>root_depth_m</code>.</li>"
              f"<li><code>water_needs</code>: مقياسان (25–80 و1–7) بلا وحدة موثقة. استُبدل بمعاملات FAO-56 (Kc شهري، عمق جذور فعّال، نسبة استنزاف p).</li>"
              f"<li><code>growth_days</code> يخلط عمر الإثمار (نخيل 2,555 يومًا) بدورة المحصول (خيار 70 يومًا).</li></ul>"))

    # ---- cities
    S.append(("المدن", table(cities) +
              "<p class='note'>القيم سنوية ثابتة. وحدة سرعة الرياح غير موثقة (6–12، الأرجح كم/ساعة). "
              "أُضيفت الإحداثيات والأسماء العربية، وجدولا طقس يومي وشهري يُملآن من Open-Meteo.</p>"))

    # ---- suitability
    cross = pd.crosstab(suit.suitability_score, suit.recommendation).reset_index()
    S.append(("الملاءمة", table(cross) +
              f"<p class='note'>العمود recommendation مشتق بالكامل من الدرجة (100=Excellent، 50=Good، 0=Poor). "
              f"expected_water يساوي water_needs في كل الصفوف ({(suit.merge(plant[['id','water_needs']], left_on='plant_id', right_on='id').eval('expected_water==water_needs')).mean():.0%}).</p>"))

    # ---- irrigation history
    h = hist.merge(plant[["id", "crop_coefficient"]], left_on="plant_id", right_on="id", suffixes=("", "_p")) \
            .merge(cities[["id", "name", "evapotranspiration"]].rename(columns={"evapotranspiration": "et0"}),
                   left_on="city_id", right_on="id", suffixes=("", "_c"))
    h["ratio"] = h.irrigation_liters / (h.et0 * h.crop_coefficient)
    h = h.sort_values(["plant_id", "city_id", "id"])
    h["idx"] = h.groupby(["plant_id", "city_id"]).cumcount()
    riy = h[(h.city_id == 1)]
    month_t = riy.groupby(riy.idx // 30.5).temperature.mean()
    same_day = h[(h.city_id == 1) & (h.idx == 0)].temperature.nunique()
    fig, ax = plt.subplots(1, 3, figsize=(12, 3.2))
    ax[0].plot(month_t.index + 1, month_t.values, color=MARK, lw=2)
    ax[0].set_title("Riyadh temperature by record order (month bins)", color=INK, fontsize=10)
    ax[0].set_ylim(0, 45)
    groups = [(g, d.ratio.values) for g, d in h.assign(g=np.where(h.plant_id >= 21, "Turf", "Fruit/Veg")).groupby("g")]
    ax[1].boxplot([d for _, d in groups], tick_labels=[g for g, _ in groups], showfliers=False,
                  medianprops={"color": MARK})
    ax[1].axhline(1 / 0.8, color=MUTED, ls="--", lw=1)
    ax[1].set_title("irrigation / (ET0 x Kc)", color=INK, fontsize=10)
    share = h.assign(r=h.rainfall > 0.465).groupby("name").r.mean().sort_values()
    ax[2].barh(share.index, share.values * 100, color=MARK)
    ax[2].set_title("% rows with rain > 0.465 mm", color=INK, fontsize=10)
    img = fig_b64(fig)
    S.append(("سجل الري (IrrigationHistory): بيانات مولّدة",
              f"<img src='data:image/png;base64,{img}'><ul>"
              f"<li>لا يوجد عمود تاريخ؛ الحرارة في الرياض شبه ثابتة طوال «السنة» (لا موسمية).</li>"
              f"<li>لليوم نفسه في المدينة نفسها {same_day} قيمة حرارة مختلفة (لكل نبات طقس مستقل).</li>"
              f"<li>الري المسجل يساوي على الوسيط {h[h.plant_id<21].ratio.median():.2f}× (فاكهة) و{h[h.plant_id>=21].ratio.median():.2f}× (أعشاب) "
              f"من ET0×Kc؛ الخط المتقطع = 1/0.8 (كفاءة ري 80%). إن كانت الوحدة لتر/م²/يوم فالسجل يتضمن ريًا زائدًا.</li>"
              f"<li>حذف القيم الشاذة بطريقة IQR في المشروع السابق أزال أيام المطر: {share.max():.0%} من صفوف {share.idxmax()}. "
              f"في القاعدة النظيفة لم يُحذف أي صف، وأُضيف العمود rain_flag.</li>"
              f"<li>القرار: نُقل إلى جدول <code>irrigation_history_synthetic</code>، ولا يُستخدم مصدرًا للطقس أو هدفًا لتدريب كمية الري.</li></ul>"))

    # ---- training CSV
    d = pd.read_csv(a.csv)
    need = d[d.irrigationNeeded == 1]
    fig, ax = plt.subplots(1, 2, figsize=(9, 3.2))
    for lab, part in d.groupby("irrigationNeeded"):
        ax[0].hist(part.soilMoisture, bins=40, color=MARK if lab else "#A8B5AC", alpha=.9, label=str(lab))
    ax[0].legend(title="irrigationNeeded")
    ax[0].set_title("soilMoisture by label", color=INK, fontsize=10)
    b = need.groupby(pd.cut(need.soilMoisture, [9, 15, 20, 25, 30, 36])).predictedMinutes.mean()
    ax[1].bar([str(i) for i in b.index], b.values, color=MARK)
    ax[1].set_ylim(0, 30)
    ax[1].set_title("predictedMinutes vs dryness", color=INK, fontsize=10)
    img = fig_b64(fig)
    S.append(("ملف تدريب التوأم (smart_irrigation_training_data.csv)",
              f"<img src='data:image/png;base64,{img}'><ul>"
              f"<li>{len(d):,} صف، دون تكرار أو قيم مفقودة، ولا أعمدة وقت أو موقع.</li>"
              f"<li>irrigationNeeded منفصل تمامًا عند رطوبة 36/42: كل قيمة ≤36 تحتاج ري، وكل قيمة ≥42 لا تحتاج. دقة 100% متوقعة ولا تعني دقة ميدانية.</li>"
              f"<li>predictedMinutes ثابت تقريبًا ({need.predictedMinutes.mean():.1f} دقيقة) مهما جفّت التربة: لا يصلح لحساب المدة.</li>"
              f"<li>soilMoisture مؤشر حساس 10–90، وليس رطوبة حجمية.</li></ul>"))

    # ---- reference DB
    ref = sqlite3.connect(f"file:{a.ref}?mode=ro", uri=True)
    prov = pd.read_sql("SELECT table_name AS 'الجدول', origin AS 'المصدر', rows AS 'الصفوف', notes AS 'ملاحظات' FROM data_provenance", ref)
    lp = pd.read_sql("""SELECT p.name_ar AS 'النبات', l.category AS 'الفئة', l.kc_summer AS 'Kc صيف', l.kc_winter AS 'Kc شتاء',
                        l.root_zone_m AS 'عمق الجذور م', l.depletion_p AS 'p', l.irrigation_method AS 'الري', l.sources AS 'المصادر'
                        FROM landscape_params l JOIN plants p USING(plant_id)""", ref)
    soils = pd.read_sql("SELECT soil_class AS 'التربة', fc_vwc AS 'السعة الحقلية', wp_vwc AS 'نقطة الذبول', aw_vwc AS 'الماء المتاح' FROM soil_hydraulics", ref)
    tg = pd.read_sql("""SELECT p.name_ar AS 'النبات', t.soil_class AS 'التربة', t.vwc_min AS 'الحد الأدنى', t.vwc_target AS 'الهدف',
                        t.vwc_max AS 'الأعلى', t.taw_mm AS 'TAW مم', t.raw_mm AS 'RAW مم' FROM plant_soil_targets t JOIN plants p USING(plant_id)
                        WHERE t.soil_class IN ('sand','sandy_loam','loam') AND p.name_en IN
                        ('Bermuda Grass','Paspalum Vaginatum','Date Palm','Bougainvillea','Gazania')""", ref)
    srcs = pd.read_sql("SELECT key AS 'المفتاح', citation AS 'المرجع' FROM sources", ref)
    ref.close()
    S.append(("القاعدة النظيفة ANBIT_reference.db", table(prov)))
    S.append(("معاملات نباتات المسطحات الخضراء", table(lp)))
    S.append(("خصائص التربة", table(soils)))
    S.append(("حدود الرطوبة المقترحة (أمثلة)", table(tg) +
              "<p class='note'>الحد الأدنى = السعة الحقلية − p × الماء المتاح (منطق RAW في FAO-56)، والهدف = نقطة الذبول + 0.9 × الماء المتاح. "
              "قيم عرض موثقة المصدر، وتحتاج معايرة ميدانية قبل التشغيل.</p>"))
    S.append(("المراجع", table(srcs)))

    for x in a.extra:
        pth = Path(x)
        body = profile_sqlite(pth) if pth.suffix in (".db", ".sqlite") else table(profile_frame(pd.read_csv(pth)))
        S.append((f"ملف إضافي: {html.escape(pth.name)}", body))

    css = """body{font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;direction:rtl;max-width:1100px;margin:32px auto;padding:0 16px;color:#1E2722;background:#FFFFFF;line-height:1.7}
    h1{font-size:28px}h2{font-size:20px;margin-top:40px;border-top:1px solid #E3E2DA;padding-top:24px}h4{margin:20px 0 6px}
    .t{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0;display:block;overflow-x:auto}.t th,.t td{padding:6px 8px;border-bottom:1px solid #EFEEE8;text-align:right;white-space:nowrap}
    .t th{color:#5A645E;font-weight:600}img{max-width:100%;margin:8px 0}.note{color:#5A645E;font-size:14px}code{background:#F4F3EE;padding:1px 5px;border-radius:4px}"""
    doc = (f"<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'><title>تحليل بيانات أنبت</title>"
           f"<style>{css}</style></head><body><h1>تحليل البيانات الاستكشافي وتنظيفها — أنبت</h1>"
           + "".join(f"<h2>{t}</h2>{b}" for t, b in S) + "</body></html>")
    Path(a.out).write_text(doc, encoding="utf-8")
    print("written", a.out, round(Path(a.out).stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
