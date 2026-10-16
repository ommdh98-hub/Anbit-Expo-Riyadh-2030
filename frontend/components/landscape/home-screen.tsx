"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock, Droplets, Leaf } from "lucide-react";
import { useLandscape } from "./context";
import { useCopy } from "./copy";
import {
  badgeFor,
  derivedBadge,
  flowFor,
  freshness,
  irrigatedArea,
  minutesFor,
  dailyDose,
  primaryAction,
  ringModel,
  zoneSaving,
} from "./data";
import { MoistureRing, OrganicField, SoilLayers, SourceBadge } from "./visuals";
import { ReadingSheet } from "./sheets";
import ZoneMap from "./zone-map";
import { DoseLines, daysText, doseMoisture } from "./dose-lines";
import ZoneSwitcher from "./zone-switcher";
import { LoadingState } from "./states";

export default function HomeScreen() {
  const { zone, summary, month, profile, loading, error } = useLandscape();
  const c = useCopy();
  const [sheet, setSheet] = useState<"reading" | null>(null);
  // «أين أقيس؟» highlights the suggested point on the map of the zone it was pressed for.
  const [whereFor, setWhereFor] = useState<string | null>(null);
  if (!zone) return <LoadingState loading={loading} error={error} />;
  const soil = zone.soil;
  const ring = ringModel(summary?.current_vwc, soil.target_vwc, soil.lower_vwc, soil.upper_vwc);
  const base = badgeFor(summary?.source);
  const fresh = freshness(summary?.age_hours, summary?.stale);
  const area = irrigatedArea(zone);
  const flow = flowFor(summary, area ?? zone.area_m2);
  const litres = summary?.gross_l ?? null;
  const minutes = litres != null ? minutesFor(litres, flow.litresPerHour) : null;
  // Today's dose (FAO-56 high-frequency irrigation), recomputed from the API's inputs.
  const dose = summary?.dose_inputs ? dailyDose(summary.dose_inputs) : null;
  const usage = month?.by_zone.find((z) => z.id === zone.id);
  const saving = usage ? zoneSaving(zone, usage.litres, usage.events) : null;
  const action = primaryAction(summary);
  const plant = c.show(zone.plant.name);
  const heroMoisture = doseMoisture(summary?.current_vwc, soil.lower_vwc, soil.target_vwc);
  const cardMoisture = doseMoisture(summary?.dose_inputs?.current_vwc ?? summary?.current_vwc, soil.lower_vwc, soil.target_vwc);
  const sentence = {
    empty: c.t("لا نعرف رطوبة هذه المنطقة بعد.", "We don't know this zone's moisture yet."),
    dry: c.t(`أقل من حاجة ${plant} — يحتاج ري اليوم`, `Below what ${plant} needs — irrigate today`),
    good:
      heroMoisture === "inRange"
        ? c.t(`ضمن حاجة ${plant} — الري في النافذة القادمة`, `Within what ${plant} needs — irrigation in the next window`)
        : c.t(`ضمن حاجة ${plant} — لا حاجة للري الآن`, `Within what ${plant} needs — no irrigation now`),
    wet: c.t(`أعلى من حاجة ${plant} — أوقف الري وراقب`, `Above what ${plant} needs — hold irrigation`),
  }[ring.state];
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh", hour: "numeric", hourCycle: "h23" }));
  const greeting = hour < 12 ? c.t("صباح الخير", "Good morning") : c.t("مساء الخير", "Good evening");
  const dash = "—";
  return (
    <div className="lx-screen lx-home">
      <header className="lx-home-head">
        <p className="lx-greeting">
          {greeting}، <span>{c.show(profile.name)}</span>
        </p>
        <ZoneSwitcher />
      </header>

      <section className="lx-hero" aria-labelledby="lx-hero-title">
        <OrganicField tone={ring.state === "wet" ? "water" : "calm"} leaf={false} />
        <MoistureRing model={ring} />
        <div className="lx-hero-copy">
          <SourceBadge badge={base} fresh={fresh} />
          <h1 id="lx-hero-title">{sentence}</h1>
          <p className="lx-hero-zone">
            {c.show(zone.name)} · {plant} · {c.t(`المساحة المروية ${c.area(area)}`, `Irrigated area ${c.area(area)}`)}
          </p>
          <div className="lx-actions">
            {action === "reading" ? (
              <button type="button" className="lx-primary" onClick={() => setSheet("reading")}>
                {c.t("تسجيل قراءة", "Record a reading")}
              </button>
            ) : (
              <Link className="lx-primary" href="/landscape/irrigation">
                {c.t("مراجعة الري", "Review irrigation")}
              </Link>
            )}
            <button
              type="button"
              className="lx-link"
              aria-pressed={whereFor === zone.id}
              onClick={() => setWhereFor(whereFor === zone.id ? null : zone.id)}
            >
              {c.t("أين أقيس؟", "Where to measure?")}
            </button>
          </div>
        </div>
        <ZoneMap key={zone.id} c={c} zone={zone} highlight={whereFor === zone.id} />
        <SoilLayers />
      </section>

      <section className="lx-stats" aria-label={c.t("أرقام اليوم", "Today's numbers")}>
        <article className="lx-stat">
          <Droplets size={20} aria-hidden="true" />
          <h2>{c.t("الاحتياج المائي", "Water need")}</h2>
          {dose ? (
            <DoseLines c={c} dose={dose} method={zone.irrigation_method} moisture={cardMoisture} valueClass="lx-stat-value" subClass="lx-stat-sub" />
          ) : (
            <>
              <p className="lx-stat-value">{litres != null ? c.t(`${c.num(litres)} لتر`, `${c.num(litres)} L`) : dash}</p>
              <p className="lx-stat-sub">
                {litres != null
                  ? [c.area(area), minutes != null ? c.duration(minutes) : null].filter(Boolean).join(" · ")
                  : c.t("بعد أول قراءة", "After the first reading")}
              </p>
            </>
          )}
          {(dose || litres != null) && summary?.et_reference ? (
            <span className="lx-badge lx-badge-estimated" title={c.t(`ET0 ${c.num(summary.et_reference.et0_mm_day, 2)} × Kc ${c.num(summary.et_reference.kc, 2)}`, `ET0 ${summary.et_reference.et0_mm_day} × Kc ${summary.et_reference.kc}`)}>
              <i aria-hidden="true" />
              {c.t("ET0 شهري 2025 — Open-Meteo", "ET0 monthly 2025 — Open-Meteo")}
            </span>
          ) : (
            <SourceBadge badge={dose || litres != null ? derivedBadge(base) : null} />
          )}
        </article>
        <article className="lx-stat">
          <Clock size={20} aria-hidden="true" />
          <h2>{c.t("موعد الري القادم", "Next irrigation")}</h2>
          <p className="lx-stat-value">{summary?.next_at ? c.time(summary.next_at) : dash}</p>
          <p className="lx-stat-sub">
            {summary?.next_at ? c.day(summary.next_at, { weekday: "long" }) : c.t("لا موعد خلال 24 ساعة", "None in the next 24 h")}
          </p>
          <SourceBadge badge={summary?.next_at ? { kind: "estimated", simulated: false } : null} />
        </article>
        <article className="lx-stat">
          <Leaf size={20} aria-hidden="true" />
          <h2>{c.t("التوفير هذا الشهر", "Saved this month")}</h2>
          <p className="lx-stat-value">{saving != null ? `${c.num(saving)}%` : dash}</p>
          <p className="lx-stat-sub">
            {saving != null ? c.t("مقارنة بجدول ثابت", "vs. a fixed schedule") : c.t("لا ري مسجل هذا الشهر", "No irrigation logged this month")}
          </p>
          <SourceBadge badge={saving != null ? { kind: "demo", simulated: false } : null} />
        </article>
      </section>

      <details className="lx-details">
        <summary>
          {c.t("تفاصيل", "Details")}
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <dl>
          <div>
            <dt>{c.t("التغطية", "Coverage")}</dt>
            <dd>{c.num(zone.decision.coverage.fraction * 100)}%</dd>
          </div>
          <div>
            <dt>{c.t("نقاط صالحة", "Valid points")}</dt>
            <dd>
              {c.num(zone.decision.coverage.active_points)} / {c.num(zone.decision.coverage.total_points)}
            </dd>
          </div>
          <div>
            <dt>{c.t("عمق الجذور", "Root depth")}</dt>
            <dd>{zone.root_depth_m != null ? c.t(`${c.num(zone.root_depth_m, 2)} م`, `${zone.root_depth_m} m`) : dash}</dd>
          </div>
          <div>
            <dt>{c.t("كفاءة الري", "Efficiency")}</dt>
            <dd>{zone.efficiency != null ? `${c.num(zone.efficiency * 100)}%` : dash}</dd>
          </div>
          <div>
            <dt>{c.t("معدل التدفق", "Flow")}</dt>
            <dd>
              {c.t(`${c.num(flow.litresPerHour)} لتر/ساعة`, `${c.num(flow.litresPerHour)} L/h`)}
              {flow.assumed && <SourceBadge badge={{ kind: "demo", simulated: false }} />}
            </dd>
          </div>
          {summary?.et_reference && (
            <div>
              <dt>{c.t("الاحتياج اليومي", "Daily need")}</dt>
              <dd>
                {c.t(
                  `ET0 ${c.num(summary.et_reference.et0_mm_day, 2)} × Kc ${c.num(summary.et_reference.kc, 2)} = ${c.mm(summary.et_reference.net_mm_day)}/يوم`,
                  `ET0 ${summary.et_reference.et0_mm_day} × Kc ${summary.et_reference.kc} = ${c.mm(summary.et_reference.net_mm_day)}/day`,
                )}
              </dd>
            </div>
          )}
          {dose && summary?.current_vwc != null && (
            <>
              <div className="lx-detail-wide">
                <dt>{c.t("تفصيل جرعة اليوم", "Today's dose breakdown")}</dt>
                <dd>
                  {[
                    c.t(
                      `الرطوبة من ${c.num(summary.current_vwc * 100, 1)}% إلى ${c.num(soil.target_vwc * 100, 1)}%`,
                      `moisture ${c.num(summary.current_vwc * 100, 1)}% → ${c.num(soil.target_vwc * 100, 1)}%`,
                    ),
                    zone.root_depth_m != null ? c.t(`عمق الجذور ${c.num(zone.root_depth_m, 2)} م`, `root depth ${zone.root_depth_m} m`) : null,
                    c.t(`النقص الصافي ${c.mm(dose.deficit_mm)}`, `net deficit ${c.mm(dose.deficit_mm)}`),
                    c.t(`الاحتياج اليومي ${c.mm(dose.daily_need_mm)}`, `daily need ${c.mm(dose.daily_need_mm)}`),
                    c.t(`جرعة اليوم الصافية ${c.mm(dose.net_mm)}`, `today's net dose ${c.mm(dose.net_mm)}`),
                    zone.efficiency != null
                      ? c.t(
                          `كفاءة ${zone.irrigation_method === "drip" ? "التنقيط" : "الرش"} ${c.num(zone.efficiency * 100)}%`,
                          `${zone.irrigation_method === "drip" ? "drip" : "spray"} efficiency ${c.num(zone.efficiency * 100)}%`,
                        )
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </div>
              {zone.irrigation_method === "drip" && (
                <div>
                  <dt>{c.t("المساحة المبللة (افتراض)", "Wetted area (assumption)")}</dt>
                  <dd>
                    {c.t(
                      `مساحة مبللة ${c.area(dose.effective_area_m2)} من ${c.area(area)}`,
                      `wetted ${c.area(dose.effective_area_m2)} of ${c.area(area)}`,
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt>{c.t("تعويض النقص كاملًا", "Full refill of the deficit")}</dt>
                <dd>{c.t(`${c.num(dose.full_refill_l)} لتر`, `${c.num(dose.full_refill_l)} L`)}</dd>
              </div>
              {dose.refill_days != null && (
                <div>
                  <dt>{c.t("الوصول إلى الهدف", "Reaching the target")}</dt>
                  <dd>{c.t(`تكتمل خلال ${daysText(c, dose.refill_days)} بنفس الجرعة`, `within ${daysText(c, dose.refill_days)} at the same dose`)}</dd>
                </div>
              )}
            </>
          )}
          <div>
            <dt>{c.t("الحدود", "Limits")}</dt>
            <dd>
              {c.num(soil.lower_vwc * 100)}% – {c.num(soil.upper_vwc * 100)}%
            </dd>
          </div>
        </dl>
        <ul className="lx-legend">
          <li>
            <SourceBadge badge={{ kind: "measured", simulated: false }} /> {c.t("قراءة تربة حديثة ومتحققة.", "A fresh, verified soil reading.")}
          </li>
          <li>
            <SourceBadge badge={{ kind: "measured", simulated: true }} /> {c.t("قراءة سُجلت في موقع المحاكاة، لا في الميدان.", "Recorded on the simulation site, not in the field.")}
          </li>
          <li>
            <SourceBadge badge={{ kind: "estimated", simulated: false }} />{" "}
            {c.t("محسوب من آخر قراءة وتبخر مفترض؛ ليس قياسًا.", "Calculated from the last reading and an assumed ET; not a measurement.")}
          </li>
          <li>
            <SourceBadge badge={{ kind: "demo", simulated: false }} />{" "}
            {c.t("قيمة ثابتة للعرض، مثل الجدول الثابت أو معدل الرش.", "A fixed demo value, such as the fixed schedule or the spray rate.")}
          </li>
        </ul>
      </details>

      <ReadingSheet open={sheet === "reading"} onClose={() => setSheet(null)} zone={zone} />
    </div>
  );
}
