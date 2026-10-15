"use client";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import {
  ChevronDown,
  Download,
  Printer,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { CITIES, FIXED_SCHEDULE } from "../../lib/twin/constants";
import {
  resultsCsv,
  type EngineSummary,
  type Results as R,
} from "../../lib/twin/engine";
import { smapReference } from "../../lib/twin/smap";
import { TWIN_MODEL } from "../../lib/twin/model";
import { useCopy } from "../landscape/copy";
import { pct, plantName, sensorName, signedSaving, soilName } from "./chrome";
import { heroHeadline, highlights, mostlyRain } from "./headline";

export default function Results({
  r,
  onReplay,
  onEdit,
}: {
  r: R;
  onReplay: () => void;
  onEdit: () => void;
}) {
  const c = useCopy();
  const hero = heroHeadline(r);
  const pills = highlights(r);
  // Every water value on this screen in m³ with one decimal; zero reads "0 م³".
  const m3 = (litres: number) => {
    const v = litres / 1000;
    const text =
      Math.round(v * 10) === 0
        ? c.num(0)
        : new Intl.NumberFormat(c.ar ? "ar-SA" : "en-US", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }).format(v);
    return c.t(`${text} م³`, `${text} m³`);
  };
  const hours = (h: number) => c.t(`${c.num(h)} س`, `${c.num(h)} h`);
  const fixedDepth = FIXED_SCHEDULE.litresPerM2BySeason[r.config.season];
  const daily = r.daily.map((d) => ({
    day: d.day + 1,
    anbit: Math.round(d.anbit),
    sensor: Math.round(d.sensor),
    fixed: Math.round(d.fixed),
  }));
  const avgBand = r.hourly.length
    ? { lo: r.hourly[0].minimum * 100, hi: r.hourly[0].upper * 100 }
    : null;
  const hourly = r.hourly.map((h) => ({
    t: h.t,
    anbit: Math.round(h.anbit * 1000) / 10,
    sensor: Math.round(h.sensor * 1000) / 10,
    fixed: Math.round(h.fixed * 1000) / 10,
  }));
  const smap = smapReference(r.config.city ?? "riyadh", r.config.season);
  const seriesName = (n: unknown) =>
    n === "anbit"
      ? c.t("أنبت", "ANBIT")
      : n === "sensor"
        ? c.t("آلي بالحساسات", "Sensor-only")
        : c.t("جدول ثابت", "Fixed");
  const decisions = r.decisions.ml + r.decisions.rule;
  const avgAnbit = r.hourly.length
    ? r.hourly.reduce((t, h) => t + h.anbit, 0) / r.hourly.length
    : 0;
  function download() {
    const url = URL.createObjectURL(
      new Blob([resultsCsv(r)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `anbit-twin-${r.config.city ?? "riyadh"}-${r.config.season}-${r.config.days}d-seed${r.config.seed}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const cityName = {
    riyadh: c.t("الرياض", "Riyadh"),
    jeddah: c.t("جدة", "Jeddah"),
    dammam: c.t("الدمام", "Dammam"),
    medina: c.t("المدينة", "Medina"),
    tabuk: c.t("تبوك", "Tabuk"),
    abha: c.t("أبها", "Abha"),
  }[r.config.city ?? "riyadh"];
  const seasonName = `${{ summer: c.t("صيف", "Summer"), winter: c.t("شتاء", "Winter"), spring: c.t("ربيع", "Spring") }[r.config.season]} ${cityName}`;
  return (
    <section className="tw-results" aria-labelledby="tw-results-title">
      <div className="tw-hero">
        <div>
          <p className="tw-step">
            {c.t("الخطوة 3 من 3 · النتائج", "Step 3 of 3 · Results")}
          </p>
          <h1 id="tw-results-title">
            {hero.kind === "rainEnough"
              ? c.t(
                  "المطر كفّى — لم تحتج النباتات ريًا",
                  "Rain was enough — the plants needed no irrigation",
                )
              : hero.kind === "saving"
                ? c.t("وفّر أنبت المياه", "ANBIT saved water")
                : hero.kind === "stress"
                  ? c.t("عطش أقل بكثير", "Far less thirst")
                  : c.t(
                      "أنبت استخدم ماءً أكثر هنا",
                      "ANBIT used more water here",
                    )}
          </h1>
          <p>
            {hero.kind === "rainEnough"
              ? c.t(
                  "الجدول الثابت أضاف ماءً لم تحتجه النباتات.",
                  "The fixed schedule added water the plants did not need.",
                )
              : hero.kind === "saving"
                ? c.t(
                    `داخل النطاق الصحي: أنبت ${c.num(r.anbit.inRangePct)}% مقابل ${c.num(r.fixed.inRangePct)}% للجدول الثابت.`,
                    `In the healthy range: ANBIT ${c.num(r.anbit.inRangePct)}% vs ${c.num(r.fixed.inRangePct)}% for the fixed schedule.`,
                  )
                : hero.kind === "stress"
                  ? c.t(
                      `استخدم أنبت ${c.num(hero.extraWaterPct)}% ماء أكثر لأن الجدول الثابت لا يكفي النباتات في هذا السيناريو.`,
                      `ANBIT used ${c.num(hero.extraWaterPct)}% more water because the fixed schedule is not enough for the plants in this scenario.`,
                    )
                  : c.t(
                      "في هذا السيناريو استخدم أنبت ماءً أكثر من الجدول الثابت دون أن يقلّ الإجهاد.",
                      "In this scenario ANBIT used more water than the fixed schedule without less stress.",
                    )}
          </p>
          <span className="tw-chip">
            {c.t("مقارنة بجدول ثابت", "Compared with a fixed schedule")} ·{" "}
            {seasonName} ·{" "}
            {c.t(`${c.num(r.config.days)} يوم`, `${r.config.days} days`)}
          </span>
          {r.savingVsSensor != null && (
            <p className="tw-hero-second">
              {c.t(
                "مقابل الري الآلي بالحساسات فقط:",
                "Against sensor-only automation:",
              )}{" "}
              <strong>
                {/* With no ANBIT irrigation a percentage would read "100%": show the volume instead. */}
                {hero.kind === "rainEnough"
                  ? c.t(`وفّر ${m3(r.sensor.waterL)}`, `saved ${m3(r.sensor.waterL)}`)
                  : signedSaving(c, r.savingVsSensor)}
              </strong>
            </p>
          )}
        </div>
        <div className="tw-hero-figure">
          <strong
            className={`tw-hero-number ${hero.kind === "honest" && hero.value != null && hero.value < 0 ? "warn" : "good"}`}
          >
            {hero.kind === "rainEnough"
              ? m3(hero.savedL)
              : hero.kind === "stress"
                ? `${c.num(hero.value)}%`
                : signedSaving(c, hero.value)}
          </strong>
          <small>
            {hero.kind === "rainEnough"
              ? c.t(
                  "مياه وُفّرت مقابل الجدول الثابت",
                  "water saved vs the fixed schedule",
                )
              : hero.kind === "stress"
                ? c.t(
                    "ساعات إجهاد أقل من الجدول الثابت",
                    "fewer stress hours than the fixed schedule",
                  )
                : hero.kind === "saving"
                  ? c.t(
                      "مياه أقل من الجدول الثابت",
                      "less water than the fixed schedule",
                    )
                  : c.t(
                      "فرق المياه مقابل الجدول الثابت",
                      "water difference vs the fixed schedule",
                    )}
          </small>
        </div>
      </div>

      <div className="tw-card tw-table-wrap">
        <table className="tw-table">
          <caption className="tw-sr">
            {c.t("مقارنة الطرق الثلاث", "Three strategies compared")}
          </caption>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" className="is-anbit">
                {c.t("أنبت", "ANBIT")}
              </th>
              <th scope="col">{c.t("آلي بالحساسات", "Sensor-only")}</th>
              <th scope="col">{c.t("جدول ثابت", "Fixed")}</th>
            </tr>
          </thead>
          <tbody>
            <Row3
              label={c.t("المياه", "Water")}
              r={r}
              get={(e) => m3(e.waterL)}
            />
            <Row3
              label={c.t("الهدر", "Waste")}
              r={r}
              get={(e) => `${c.num(e.wastePct, 1)}%`}
            />
            <Row3
              label={c.t("داخل النطاق الصحي", "In healthy range")}
              r={r}
              get={(e) => `${c.num(e.inRangePct)}%`}
            />
            <Row3
              label={c.t("عطش (تحت الحد)", "Thirst (below minimum)")}
              r={r}
              get={(e) => hours(e.stressHours)}
            />
            <Row3
              label={c.t("رطوبة زائدة", "Too wet")}
              r={r}
              get={(e) => (
                <>
                  {hours(e.wetHours)}
                  {mostlyRain(e) && (
                    <small className="tw-cell-note">
                      {c.t(
                        "بسبب المطر، لا بسبب الري",
                        "from rain, not irrigation",
                      )}
                    </small>
                  )}
                </>
              )}
            />
            <Row3
              label={c.t("أحداث ري زائد", "Over-watering events")}
              r={r}
              get={(e) => c.num(e.overEvents)}
            />
          </tbody>
        </table>
        {pills.length > 0 && (
          <ul
            className="tw-pills"
            aria-label={c.t("أبرز النتائج", "Highlights")}
          >
            {pills.map((p) => (
              <li key={p.kind}>
                {p.kind === "zeroWaste"
                  ? c.t("صفر هدر", "Zero waste")
                  : p.kind === "rangeTimes"
                    ? c.t(
                        `${c.num(p.value, 1)}× وقت أطول في النطاق الصحي`,
                        `${p.value}× more time in the healthy range`,
                      )
                    : p.kind === "noOver"
                      ? c.t("بدون ري زائد", "No over-watering")
                      : c.t(
                          `أحداث ري زائد أقل بـ ${c.num(p.value)}%`,
                          `${Math.round(p.value)}% fewer over-watering events`,
                        )}
              </li>
            ))}
          </ul>
        )}
        <p className="tw-caption">
          {c.t(
            "آلي بالحساسات: أقسام LoRa تروي عند نزول قراءتها تحت الحد وتتوقف عند الهدف، والأقسام بلا حساس تبقى على الجدول الثابت.",
            "Sensor-only: LoRa sections irrigate when their own reading drops below the minimum and stop at target; sections without a sensor stay on the fixed schedule.",
          )}
        </p>
      </div>

      <div className="tw-charts">
        <figure className="tw-card">
          <figcaption>
            {c.t("المياه يوميًا", "Water per day")}
            <Key />
          </figcaption>
          <div className="tw-chart" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={daily}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                barGap={2}
              >
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  minTickGap={8}
                />
                <YAxis hide />
                <Tooltip
                  cursor={false}
                  formatter={(v, n) => [m3(Number(v)), seriesName(n)]}
                  labelFormatter={(d) => c.t(`اليوم ${d}`, `Day ${d}`)}
                />
                <Bar
                  dataKey="fixed"
                  fill="var(--tw-baseline)"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="sensor"
                  fill="var(--tw-water)"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="anbit"
                  fill="var(--tw-good)"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <figure className="tw-card">
          <figcaption>
            {c.t(
              "متوسط الرطوبة مع النطاق الصحي",
              "Average moisture with healthy band",
            )}
            <Key />
          </figcaption>
          <div className="tw-chart" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={hourly}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                {avgBand && (
                  <ReferenceArea
                    y1={avgBand.lo}
                    y2={avgBand.hi}
                    fill="var(--tw-good)"
                    fillOpacity={0.1}
                  />
                )}
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(t) => c.day(t)}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  minTickGap={40}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  width={36}
                  unit="%"
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  labelFormatter={(t) =>
                    `${c.day(Number(t))} ${c.time(Number(t))}`
                  }
                  formatter={(v, n) => [`${v}%`, seriesName(n)]}
                />
                {smap && (
                  <ReferenceLine
                    y={smap.vwc * 100}
                    stroke="var(--tw-warn)"
                    strokeDasharray="2 6"
                  />
                )}
                <Line
                  dataKey="fixed"
                  stroke="var(--tw-baseline)"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="5 5"
                  isAnimationActive={false}
                />
                <Line
                  dataKey="sensor"
                  stroke="var(--tw-water)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="anbit"
                  stroke="var(--tw-good)"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {smap && (
            <p className="tw-caption tw-smap">
              <i aria-hidden="true" />
              {c.t(
                `مرجع موسمي من القمر الصناعي (دقة 9 كم): ${c.num(smap.vwc * 100, 1)}% متوسط شهر ${c.num(smap.month)} (${smap.years.join("، ")})، رطوبة سطحية لا قياس قسم.`,
                `Seasonal satellite reference (9 km resolution): ${(smap.vwc * 100).toFixed(1)}% mean for month ${smap.month} (${smap.years.join(", ")}), surface moisture, not a section reading.`,
              )}{" "}
              {c.t(
                `المتوسط المحاكى لأنبت: ${c.num(avgAnbit * 100, 1)}%.`,
                `Simulated ANBIT average: ${(avgAnbit * 100).toFixed(1)}%.`,
              )}
            </p>
          )}
        </figure>
      </div>

      <details className="tw-card tw-sections">
        <summary>
          {c.t("ملخص الأقسام", "Sections summary")}
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <ul>
          {r.sections.map((s) => (
            <li key={s.id}>
              <details>
                <summary>
                  <span className="tw-sec-id">{s.id}</span>
                  <span>{plantName(c, s.plant)}</span>
                  <span className="tw-caption">
                    {soilName(c, s.soil)} · {sensorName(c, s.lora)}
                  </span>
                  <strong
                    className={s.saving != null && s.saving < 0 ? "warn" : ""}
                  >
                    {signedSaving(c, s.saving)}
                  </strong>
                </summary>
                <dl>
                  <Row
                    label={c.t("المياه", "Water")}
                    a={m3(s.anbit.waterL)}
                    so={m3(s.sensor.waterL)}
                    f={m3(s.fixed.waterL)}
                  />
                  <Row
                    label={c.t("داخل النطاق", "In range")}
                    a={`${c.num(s.anbit.inRangePct)}%`}
                    so={`${c.num(s.sensor.inRangePct)}%`}
                    f={`${c.num(s.fixed.inRangePct)}%`}
                  />
                  <Row
                    label={c.t("عطش (تحت الحد)", "Thirst (below minimum)")}
                    a={hours(s.anbit.stressHours)}
                    so={hours(s.sensor.stressHours)}
                    f={hours(s.fixed.stressHours)}
                  />
                  <Row
                    label={c.t("رطوبة زائدة", "Too wet")}
                    a={hours(s.anbit.wetHours)}
                    so={hours(s.sensor.wetHours)}
                    f={hours(s.fixed.wetHours)}
                  />
                  <Row
                    label={c.t("ري زائد", "Over-watering")}
                    a={c.num(s.anbit.overEvents)}
                    so={c.num(s.sensor.overEvents)}
                    f={c.num(s.fixed.overEvents)}
                  />
                  {s.virtualSignedPct != null && (
                    <div>
                      <dt>
                        {c.t(
                          "انحراف التقدير الافتراضي",
                          "Virtual estimate bias",
                        )}
                      </dt>
                      <dd>
                        {c.t(
                          `${c.num(s.virtualSignedPct, 1)} نقطة`,
                          `${s.virtualSignedPct.toFixed(1)} pts`,
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      </details>

      <div className="tw-actions">
        <button type="button" className="tw-primary" onClick={onReplay}>
          <RotateCcw size={18} aria-hidden="true" />
          {c.t("إعادة التشغيل", "Run again")}
        </button>
        <button type="button" className="tw-ghost" onClick={onEdit}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          {c.t("تعديل السيناريو", "Edit scenario")}
        </button>
        <button type="button" className="tw-ghost" onClick={download}>
          <Download size={18} aria-hidden="true" />
          {c.t("تنزيل CSV", "Download CSV")}
        </button>
        <button
          type="button"
          className="tw-ghost"
          onClick={() => window.print()}
        >
          <Printer size={18} aria-hidden="true" />
          {c.t("طباعة", "Print")}
        </button>
      </div>

      <p className="tw-honest">
        {c.t(
          `نتائج محاكاة بافتراضات معلنة: طقس ${seasonName} مولَّد من البذرة ${r.config.seed} (تبخر المدينة ${CITIES[r.config.city ?? "riyadh"].etSource === "ENBT" ? "من قاعدة ENBT" : "افتراضي"})، تربة ونباتات افتراضية، وجدول ثابت موسمي (افتراض): ${fixedDepth} لتر/م² يوميًا في هذا الموسم عند ${FIXED_SCHEDULE.startHour}:00 (صيف 8، ربيع 6، شتاء 3). الطرق الثلاث على الطقس نفسه. ليست قياسًا ميدانيًا.`,
          `Simulation results with stated assumptions: ${seasonName} weather generated from seed ${r.config.seed} (city ET ${CITIES[r.config.city ?? "riyadh"].etSource === "ENBT" ? "from the ENBT database" : "assumed"}), assumed soils and plants, and a seasonal fixed schedule (assumption) of ${fixedDepth} L/m² a day this season at ${FIXED_SCHEDULE.startHour}:00 (summer 8, spring 6, winter 3). All three strategies share the same weather. Not a field measurement.`,
        )}{" "}
        {decisions > 0 &&
          c.t(
            `قرارات بدء الري: ${c.num(r.decisions.ml)} من توقع النموذج (مدرَّب على بيانات محاكاة) و${c.num(r.decisions.rule)} من قاعدة الموازنة المائية عند خروج الطقس عن نطاق التدريب.`,
            `Irrigation starts: ${r.decisions.ml} from the model prediction (trained on simulated data), ${r.decisions.rule} from the water-balance rule when weather left the training range.`,
          )}{" "}
        {!TWIN_MODEL.regressor_has_signal &&
          c.t(
            "المدة تُحسب دائمًا بالموازنة المائية؛ نموذج المدة لم يجد إشارة في البيانات.",
            "Durations always use the water balance; the duration model found no signal in the data.",
          )}{" "}
        {r.virtualErrorPct != null &&
          c.t(
            `متوسط خطأ الأقسام الافتراضية ${c.num(r.virtualErrorPct, 1)} نقطة رطوبة.`,
            `Virtual sections were off by ${r.virtualErrorPct.toFixed(1)} moisture points on average.`,
          )}
      </p>
    </section>
  );
}

function Row3({
  label,
  r,
  get,
}: {
  label: string;
  r: R;
  get: (e: EngineSummary) => ReactNode;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="is-anbit">{get(r.anbit)}</td>
      <td>{get(r.sensor)}</td>
      <td>{get(r.fixed)}</td>
    </tr>
  );
}
function Row({
  label,
  a,
  so,
  f,
}: {
  label: string;
  a: string;
  so: string;
  f: string;
}) {
  const c = useCopy();
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {a}{" "}
        <small>
          · {c.t("حساسات", "sensors")} {so} · {c.t("ثابت", "fixed")} {f}
        </small>
      </dd>
    </div>
  );
}
function Key() {
  const c = useCopy();
  return (
    <span className="tw-key">
      <i className="k-anbit" /> {c.t("أنبت", "ANBIT")}{" "}
      <i className="k-sensor" /> {c.t("حساسات", "Sensors")}{" "}
      <i className="k-fixed" /> {c.t("ثابت", "Fixed")}
    </span>
  );
}
