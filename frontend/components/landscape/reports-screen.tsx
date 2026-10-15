"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Printer } from "lucide-react";
import { api } from "../../lib/api";
import type { Report } from "../../lib/types";
import { DEMO_BASELINE, PERIOD_DAYS, type Period } from "./constants";
import { useLandscape } from "./context";
import { useCopy } from "./copy";
import { reportCsv, reportModel } from "./data";
import { OrganicField, SourceBadge } from "./visuals";

const PERIODS: { id: Period; ar: string; en: string }[] = [
  { id: "day", ar: "اليوم", en: "Today" },
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
  const area = (sim.length ? sim : zones).reduce((s, z) => s + (z.irrigated_area_m2 ?? z.area_m2), 0);
  const model = report ? reportModel(report.period, report.data.events, area, report.at) : null;
  const simulated = report?.data.origin === "simulation";
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
            {c.t("مقارنة بجدول ثابت", "Compared with a fixed schedule")}
          </span>
          <h1 id="lx-report-title">{c.t("شوف الفرق مع أنبت", "See the difference with ANBIT")}</h1>
          <p>
            {model?.saving != null
              ? c.t("ري حسب حاجة التربة بدل ري كل يوم بالكمية نفسها.", "Watering by soil need instead of the same amount every day.")
              : c.t("سجّل أول عملية ري لتظهر المقارنة.", "Log a first irrigation to see the comparison.")}
          </p>
        </div>
        <strong className="lx-report-number" aria-live="polite">
          {model?.saving != null ? `${c.num(model.saving)}%` : "—"}
        </strong>
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
              <h2>{c.t("الري التقليدي", "Traditional")}</h2>
              <p className="lx-stat-value">{c.litres(model.baseline)}</p>
              <SourceBadge badge={{ kind: "demo", simulated: false }} />
            </article>
            <article className="lx-stat">
              <h2>{c.t("ري أنبت", "ANBIT")}</h2>
              <p className="lx-stat-value">{c.litres(model.anbit)}</p>
              <span className={`lx-badge lx-badge-${simulated ? "estimated" : "measured"}`}>
                <i aria-hidden="true" />
                {simulated ? c.t("سجلات محاكاة", "Simulation records") : c.t("سجلات تنفيذ", "Execution records")}
              </span>
            </article>
            <article className="lx-stat">
              <h2>{c.t("الفرق", "Difference")}</h2>
              <p className="lx-stat-value">{c.litres(Math.abs(model.difference))}</p>
              <p className="lx-stat-sub">{model.difference >= 0 ? c.t("أقل", "less") : c.t("أكثر", "more")}</p>
            </article>
          </section>

          <div className="lx-charts">
            <figure className="lx-card">
              <figcaption>{c.t("المجموع", "Total")}</figcaption>
              <div className="lx-chart" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 13 }} />
                    <YAxis hide />
                    <Tooltip formatter={(v) => [c.litres(Number(v)), ""]} cursor={false} />
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
                    <Tooltip labelFormatter={(t) => tick(Number(t))} formatter={(v, name) => [c.litres(Number(v)), name === "baselineTotal" ? c.t("جدول ثابت", "Fixed") : c.t("أنبت", "ANBIT")]} />
                    <Line type="monotone" dataKey="baselineTotal" stroke="var(--lx-baseline)" strokeWidth={2.5} dot={false} strokeDasharray="6 6" isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="anbitTotal" stroke="var(--lx-primary)" strokeWidth={3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </figure>
          </div>

          <p className="lx-trust">
            {c.t(
              `الجدول الثابت افتراض عرض: ${c.num(DEMO_BASELINE.litresPerM2PerDay)} لتر/م² يوميًا لمساحة ري ${c.num(area)} م². كميات أنبت من سجلات التنفيذ${simulated ? " في موقع المحاكاة" : ""}.`,
              `The fixed schedule is a demo assumption: ${DEMO_BASELINE.litresPerM2PerDay} L/m² a day over ${c.num(area)} m². ANBIT volumes are logged executions${simulated ? " on the simulation site" : ""}.`,
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
    </div>
  );
}
