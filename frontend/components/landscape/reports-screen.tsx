"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Printer } from "lucide-react";
import { api } from "../../lib/api";
import type { BaselineSchedule, Report } from "../../lib/types";
import { DEMO_BASELINE, PERIOD_DAYS, type Period } from "./constants";
import { useLandscape } from "./context";
import { useCopy } from "./copy";
import { irrigatedArea, reportCsv, reportModel, scheduleReport } from "./data";
import { OrganicField, SourceBadge } from "./visuals";
import TwinReportSection from "./twin-report";

// "Today" is not offered: one day says little about water use.
const PERIODS: { id: Period; ar: string; en: string }[] = [
  { id: "week", ar: "الأسبوع", en: "Week" },
  { id: "month", ar: "الشهر", en: "Month" },
  { id: "year", ar: "السنة", en: "Year" },
];

export default function ReportsScreen() {
  const c = useCopy();
  const { zones } = useLandscape();
  const [period, setPeriod] = useState<Period>("month");
  const [report, setReport] = useState<{ period: Period; data: Report & { origin?: string }; at: number } | null>(null);
  const [error, setError] = useState("");
  const [schedules, setSchedules] = useState<BaselineSchedule[] | null>(null);
  useEffect(() => {
    let live = true;
    api<BaselineSchedule[]>("/baseline-schedules")
      .then((rows) => live && setSchedules(rows))
      .catch(() => live && setSchedules([]));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    api<Report & { origin?: string }>(`/reports/water?days=${PERIOD_DAYS[period]}`)
      .then((data) => live && setReport({ period, data, at: Date.now() }))
      .catch((e) => live && setError(e instanceof Error ? e.message : "تعذر تحميل التقرير"));
    return () => {
      live = false;
    };
  }, [period]);
  const sim = zones.filter((z) => z.origin === "simulation");
  const shownZones = sim.length ? sim : zones;
  const area = shownZones.reduce((s, z) => s + (irrigatedArea(z) ?? 0), 0);
  // Zone schedules from the database when present; the older single demo rate otherwise.
  const fromSchedules = schedules != null && schedules.length > 0;
  const model = report
    ? fromSchedules
      ? scheduleReport(report.period, report.data.events, shownZones, schedules, report.at)
      : reportModel(report.period, report.data.events, area, report.at)
    : null;
  const estimate: number = model == null ? 0 : "estimate" in model ? (model.estimate as number) : model.baseline;
  const simulated = report?.data.origin === "simulation";
  const noRecords = model != null && model.events === 0;
  // Per zone: irrigated area, recorded water, L/m² on that area, and events.
  const zoneRows = shownZones.map((z) => {
    const row = report?.data.by_zone.find((b) => b.id === z.id);
    const a = irrigatedArea(z);
    const litres = row?.litres ?? 0;
    return { id: z.id, name: z.name, area: a, litres, perM2: a ? litres / a : null, events: row?.events ?? 0 };
  });
  const shown = report?.period ?? period;
  const tick = (t: number) =>
    shown === "day" ? c.time(t) : shown === "year" ? c.day(t, { month: "short" }) : c.day(t);
  function download() {
    if (!model) return;
    const csv = reportCsv(model, ["bucket_start_utc", "fixed_schedule_l_demo", "anbit_recorded_l"]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `anbit-water-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const bars = model
    ? [
        { name: c.t("جدول ثابت", "Fixed schedule"), litres: model.baseline, key: "baseline" },
        { name: c.t("أنبت", "ANBIT"), litres: model.anbit, key: "anbit" },
      ]
    : [];
  return (
    <div className="lx-screen lx-reports">
      <section className="lx-report-hero" aria-labelledby="lx-report-title">
        <OrganicField tone="water" />
        <div>
          <span className="lx-badge lx-badge-demo">
            <i aria-hidden="true" />
            {c.t("الجدول الثابت افتراض عرض", "Fixed schedule is a demo assumption")}
          </span>
          <h1 id="lx-report-title">{c.t("مقارنة استهلاك المياه", "Water use comparison")}</h1>
          <p>
            {noRecords
              ? c.t("لا توجد عمليات ري مسجلة لأنبت في هذه الفترة", "No ANBIT irrigation records in this period")
              : model?.saving != null
                ? c.t("ري أنبت المسجل مقارنة بتقدير جدول ثابت لنفس المساحة.", "ANBIT's logged irrigation compared with a fixed-schedule estimate for the same area.")
                : ""}
          </p>
        </div>
        {!noRecords && model?.saving != null && (
          <strong className="lx-report-number" aria-live="polite">
            {`${c.num(model.saving)}%`}
          </strong>
        )}
      </section>

      <div className="lx-segment" role="group" aria-label={c.t("الفترة", "Period")}>
        {PERIODS.map((p) => (
          <button key={p.id} type="button" aria-pressed={period === p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>
            {c.t(p.ar, p.en)}
          </button>
        ))}
      </div>
      {error && !model && (
        <p role="alert" className="lx-error">
          {c.show(error)}
        </p>
      )}

      {model && (
        <>
          <section className="lx-stats lx-stats-report" aria-label={c.t("كميات الفترة", "Period volumes")}>
            <article className="lx-stat">
              <h2>
                {noRecords || !fromSchedules
                  ? c.t("تقدير الجدول الثابت للفترة", "Fixed-schedule estimate for the period")
                  : c.t("الجدول الثابت لأيام التسجيل", "Fixed schedule on logged days")}
              </h2>
              <p className="lx-stat-value">{c.m3(noRecords ? estimate : model.baseline)}</p>
              <SourceBadge badge={{ kind: "demo", simulated: false }} />
            </article>
            <article className="lx-stat">
              <h2>{c.t("ري أنبت المسجل", "ANBIT logged")}</h2>
              <p className="lx-stat-value">{noRecords ? "—" : c.m3(model.anbit)}</p>
              {noRecords ? (
                <p className="lx-stat-sub">{c.t("لا سجلات تنفيذ", "No execution records")}</p>
              ) : (
                <span className={`lx-badge lx-badge-${simulated ? "estimated" : "measured"}`}>
                  <i aria-hidden="true" />
                  {simulated ? c.t("سجلات محاكاة", "Simulation records") : c.t("سجلات تنفيذ", "Execution records")}
                </span>
              )}
            </article>
            {model.difference != null && (
              <article className="lx-stat">
                <h2>{c.t("الفرق", "Difference")}</h2>
                <p className="lx-stat-value">{c.m3(Math.abs(model.difference))}</p>
                <p className="lx-stat-sub">{model.difference >= 0 ? c.t("أقل من الجدول الثابت", "less than the fixed schedule") : c.t("أكثر من الجدول الثابت", "more than the fixed schedule")}</p>
              </article>
            )}
          </section>

          <div className="lx-card lx-zone-table">
            <table>
              <caption>{c.t("المياه حسب المنطقة", "Water by zone")}</caption>
              <thead>
                <tr>
                  <th scope="col">{c.t("المنطقة", "Zone")}</th>
                  <th scope="col">{c.t("المساحة المروية", "Irrigated area")}</th>
                  <th scope="col">{c.t("المياه", "Water")}</th>
                  <th scope="col">{c.t("لتر/م²", "L/m²")}</th>
                  <th scope="col">{c.t("عمليات الري", "Irrigations")}</th>
                </tr>
              </thead>
              <tbody>
                {zoneRows.map((z) => (
                  <tr key={z.id}>
                    <th scope="row">{c.show(z.name)}</th>
                    <td>{c.area(z.area)}</td>
                    <td>{c.m3(z.litres)}</td>
                    <td>{z.perM2 != null ? c.num(z.perM2, 1) : "—"}</td>
                    <td>{c.num(z.events)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!noRecords && (
            <div className="lx-charts">
              <figure className="lx-card">
                <figcaption>{c.t("المجموع", "Total")}</figcaption>
                <div className="lx-chart" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 13 }} />
                      <YAxis hide />
                      <Tooltip formatter={(v) => [c.m3(Number(v)), ""]} cursor={false} />
                      <Bar dataKey="litres" radius={[12, 12, 12, 12]} maxBarSize={72} isAnimationActive={false}>
                        {bars.map((b) => (
                          <Cell key={b.key} fill={b.key === "anbit" ? "var(--lx-primary)" : "var(--lx-baseline)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </figure>
              <figure className="lx-card">
                <figcaption>
                  {c.t("تراكمي عبر الفترة", "Cumulative over the period")}
                  <span className="lx-key">
                    <i className="k-base" /> {c.t("جدول ثابت", "Fixed")} <i className="k-anbit" /> {c.t("أنبت", "ANBIT")}
                  </span>
                </figcaption>
                <div className="lx-chart" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={model.buckets} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tick} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} minTickGap={32} />
                      <YAxis hide />
                      <Tooltip labelFormatter={(t) => tick(Number(t))} formatter={(v, name) => [c.m3(Number(v)), name === "baselineTotal" ? c.t("جدول ثابت", "Fixed") : c.t("أنبت", "ANBIT")]} />
                      <Line type="monotone" dataKey="baselineTotal" stroke="var(--lx-baseline)" strokeWidth={2.5} dot={false} strokeDasharray="6 6" isAnimationActive={false} />
                      <Line type="stepAfter" dataKey="anbitTotal" stroke="var(--lx-primary)" strokeWidth={3} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </figure>
            </div>
          )}

          <p className="lx-trust">
            {c.t(
              fromSchedules
                ? `الجدول الثابت افتراض لكل منطقة: الرش 8 لتر/م² يوميًا في يونيو–سبتمبر، و6 في مارس–مايو وأكتوبر–نوفمبر، و3 في ديسمبر–فبراير، والتنقيط نصف ذلك، على مساحة مروية ${c.area(area)}. يُقارن فقط في الأيام والمناطق التي فيها ري مسجل لأنبت${simulated ? " في موقع المحاكاة" : ""}، ولا تُحسب نسبة توفير دون سجلات.`
                : `تقدير الجدول الثابت افتراض عرض: ${c.num(DEMO_BASELINE.litresPerM2PerDay)} لتر/م² يوميًا (${c.num(DEMO_BASELINE.litresPerM2PerDay)} مم) على مساحة مروية ${c.area(area)}. كميات أنبت من سجلات التنفيذ فقط${simulated ? " في موقع المحاكاة" : ""}، ولا تُحسب نسبة توفير دون سجلات.`,
              fromSchedules
                ? `The fixed schedule is an assumption per zone: spray 8 L/m² a day in Jun–Sep, 6 in Mar–May and Oct–Nov, 3 in Dec–Feb, drip half of that, over an irrigated area of ${c.area(area)}. It is compared only on days and zones with logged ANBIT irrigation${simulated ? " on the simulation site" : ""}; no saving is computed without records.`
                : `The fixed-schedule estimate is a demo assumption: ${DEMO_BASELINE.litresPerM2PerDay} L/m² a day (${DEMO_BASELINE.litresPerM2PerDay} mm) over an irrigated area of ${c.area(area)}. ANBIT volumes come only from execution records${simulated ? " on the simulation site" : ""}; no saving is computed without records.`,
            )}
          </p>
          <div className="lx-actions lx-report-actions">
            <button type="button" className="lx-secondary" onClick={() => window.print()}>
              <Printer size={18} aria-hidden="true" />
              {c.t("طباعة / حفظ PDF", "Print / Save PDF")}
            </button>
            <button type="button" className="lx-secondary" onClick={download}>
              <Download size={18} aria-hidden="true" />
              {c.t("تنزيل CSV", "Download CSV")}
            </button>
          </div>
        </>
      )}

      {/* Simulation only, separate from the operational cards and totals above. */}
      <TwinReportSection />
    </div>
  );
}
