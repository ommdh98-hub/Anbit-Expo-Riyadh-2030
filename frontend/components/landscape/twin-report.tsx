"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import audit from "../../lib/twin/audit-summary.json";
import { parseLastRun, readLastRunRaw, type LastRun, type StrategySummary } from "../twin/last-run";
import { useCopy, type Copy } from "./copy";

// Digital Twin results on the Reports page. Simulation only: these numbers come
// from the audit file and this browser's last twin run, never from operational
// records, and are kept apart from the operational cards and totals above.
export type AuditSummary = typeof audit;
type Season = "summer" | "winter" | "spring";
type Strategy = "anbit" | "sensor" | "fixed";

const SEASONS: { id: Season; ar: string; en: string }[] = [
  { id: "summer", ar: "صيف", en: "Summer" },
  { id: "winter", ar: "شتاء", en: "Winter" },
  { id: "spring", ar: "ربيع", en: "Spring" },
];
const STRATEGIES: { id: Strategy; ar: string; en: string }[] = [
  { id: "anbit", ar: "أنبت", en: "ANBIT" },
  { id: "sensor", ar: "آلي بالحساسات", en: "Sensor automation" },
  { id: "fixed", ar: "جدول ثابت", en: "Fixed schedule" },
];
const CITIES: Record<string, [string, string]> = {
  riyadh: ["الرياض", "Riyadh"],
  jeddah: ["جدة", "Jeddah"],
  dammam: ["الدمام", "Dammam"],
  medina: ["المدينة", "Medina"],
  tabuk: ["تبوك", "Tabuk"],
  abha: ["أبها", "Abha"],
};

const cityName = (c: Copy, id: string) => (CITIES[id] ? c.t(...CITIES[id]) : id);
const seasonName = (c: Copy, id: string) => {
  const s = SEASONS.find((x) => x.id === id);
  return s ? c.t(s.ar, s.en) : id;
};
const weatherName = (c: Copy, id: string) =>
  id === "real2025" ? c.t("طقس 2025 الفعلي", "Actual 2025 weather") : c.t("طقس مولّد", "Generated weather");
const daysName = (c: Copy, n: number) =>
  c.t(n === 1 ? "يوم واحد" : n === 2 ? "يومان" : n <= 10 ? `${c.num(n)} أيام` : `${c.num(n)} يومًا`, `${n} ${n === 1 ? "day" : "days"}`);

// "ساعات إجهاد أقل X% من الجدول الثابت، ومياه أكثر Y%" from the season totals.
export function seasonLine(c: Copy, s: Record<Strategy, StrategySummary> & { savingVsFixedPct: number }) {
  const stress = s.fixed.stressH > 0 ? ((s.fixed.stressH - s.anbit.stressH) / s.fixed.stressH) * 100 : 0;
  const water = -s.savingVsFixedPct;
  const stressText =
    stress >= 0
      ? c.t(`ساعات إجهاد أقل ${c.num(stress, 1)}% من الجدول الثابت`, `${c.num(stress, 1)}% fewer stress hours than the fixed schedule`)
      : c.t(`ساعات إجهاد أكثر ${c.num(-stress, 1)}% من الجدول الثابت`, `${c.num(-stress, 1)}% more stress hours than the fixed schedule`);
  const waterText =
    water === 0
      ? c.t("ومياه مساوية", "and the same water")
      : water > 0
        ? c.t(`ومياه أكثر ${c.num(water, 1)}%`, `and ${c.num(water, 1)}% more water`)
        : c.t(`ومياه أقل ${c.num(-water, 1)}%`, `and ${c.num(-water, 1)}% less water`);
  return `${stressText}${c.t("، ", ", ")}${waterText}`;
}

function Bars({ c, title, values, format }: { c: Copy; title: string; values: Record<Strategy, number>; format: (v: number) => string }) {
  const max = Math.max(...STRATEGIES.map((s) => values[s.id]), 0) || 1;
  return (
    <figure className="lx-twin-metric">
      <figcaption>{title}</figcaption>
      <ul>
        {STRATEGIES.map((s) => (
          <li key={s.id} className={`lx-twin-row is-${s.id}`}>
            <span className="lx-twin-label">{c.t(s.ar, s.en)}</span>
            <span className="lx-twin-track" aria-hidden="true">
              <span className="lx-twin-bar" style={{ width: `${(values[s.id] / max) * 100}%` }} />
            </span>
            <span className="lx-twin-value">{format(values[s.id])}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const pick = (s: Record<Strategy, StrategySummary>, k: keyof StrategySummary) =>
  ({ anbit: s.anbit[k], sensor: s.sensor[k], fixed: s.fixed[k] }) as Record<Strategy, number>;

function Metrics({ c, s }: { c: Copy; s: Record<Strategy, StrategySummary> }) {
  return (
    <div className="lx-twin-metrics">
      <Bars c={c} title={c.t("المياه (م³)", "Water (m³)")} values={pick(s, "waterM3")} format={(v) => c.num(v, 1)} />
      <Bars c={c} title={c.t("ساعات الإجهاد", "Stress hours")} values={pick(s, "stressH")} format={(v) => c.num(v, 1)} />
      <Bars c={c} title={c.t("الوقت داخل النطاق الصحي", "Time in the healthy range")} values={pick(s, "inRangePct")} format={(v) => `${c.num(v, 1)}%`} />
    </div>
  );
}

export function TwinReport({
  c,
  summary,
  lastRun,
  initialSeason = "summer",
}: {
  c: Copy;
  summary: AuditSummary;
  lastRun: LastRun | null;
  initialSeason?: Season;
}) {
  const [season, setSeason] = useState<Season>(initialSeason);
  const s = summary.seasons[season];
  return (
    <section className="lx-twin-report" aria-labelledby="lx-twin-title">
      <header className="lx-twin-head">
        <h2 id="lx-twin-title">{c.t("نتائج المحاكاة — التوأم الرقمي", "Simulation results — Digital Twin")}</h2>
        <span className="lx-sim-badge" role="note">
          <i aria-hidden="true" />
          {c.t("محاكاة — لا تؤثر على بيانات التشغيل", "Simulation — does not affect operational data")}
        </span>
      </header>

      <div className="lx-card lx-twin-part">
        <h3>
          {summary.weather === "real2025"
            ? c.t(
                `طقس ${cityName(c, summary.city)} 2025 الفعلي · ${c.num(summary.seeds)} تشغيلات × ${daysName(c, summary.days)} لكل موسم`,
                `Actual 2025 weather, ${cityName(c, summary.city)} · ${summary.seeds} runs × ${summary.days} days per season`,
              )
            : c.t(
                `طقس مولّد · ${c.num(summary.seeds)} تشغيلات × ${daysName(c, summary.days)} لكل موسم`,
                `Generated weather · ${summary.seeds} runs × ${summary.days} days per season`,
              )}
        </h3>
        <p className="lx-caption">
          {c.t(
            `موقع التوأم في المراجعة: ${c.num(summary.sections)} قطاعًا بمساحة ${c.area(summary.siteAreaM2)}، والقيم مجموع القطاعات بمتوسط التشغيلات.`,
            `Twin site in the audit: ${summary.sections} sections, ${c.area(summary.siteAreaM2)}; values are the site total, averaged over the runs.`,
          )}
        </p>
        <div className="lx-segment" role="group" aria-label={c.t("الموسم", "Season")}>
          {SEASONS.map((x) => (
            <button key={x.id} type="button" aria-pressed={season === x.id} className={season === x.id ? "on" : ""} onClick={() => setSeason(x.id)}>
              {c.t(x.ar, x.en)}
            </button>
          ))}
        </div>
        <p className="lx-twin-line">{seasonLine(c, s)}</p>
        <Metrics c={c} s={s} />
      </div>

      <div className="lx-card lx-twin-part">
        <h3>{c.t("آخر محاكاة", "Last simulation")}</h3>
        {lastRun ? (
          <>
            <p className="lx-caption">
              {[
                c.day(lastRun.savedAt, { day: "numeric", month: "long", year: "numeric" }),
                cityName(c, lastRun.city),
                seasonName(c, lastRun.season),
                weatherName(c, lastRun.weather),
                daysName(c, lastRun.days),
              ].join(" · ")}
            </p>
            <Metrics c={c} s={lastRun} />
            <Link className="lx-secondary" href="/twin">
              {c.t("افتح في التوأم", "Open in the twin")}
            </Link>
          </>
        ) : (
          <>
            <p className="lx-caption">{c.t("لم تُشغَّل محاكاة بعد", "No simulation has been run yet")}</p>
            <Link className="lx-primary" href="/twin">
              {c.t("شغّل محاكاة", "Run a simulation")}
            </Link>
          </>
        )}
      </div>

      <p className="lx-trust">
        {c.t(
          "نتائج التوأم محاكاة على جدول ثابت مفترض، والتوفير الفعلي يُقاس من سجلات الري في الموقع.",
          "Twin results are a simulation against an assumed fixed schedule; actual savings are measured from the site's irrigation records.",
        )}
      </p>
    </section>
  );
}

const subscribeStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

export default function TwinReportSection() {
  const c = useCopy();
  // localStorage is read in the browser only; the server renders the empty state.
  const raw = useSyncExternalStore(subscribeStorage, () => readLastRunRaw(), () => null);
  const lastRun = useMemo(() => parseLastRun(raw), [raw]);
  return <TwinReport c={c} summary={audit} lastRun={lastRun} />;
}
