"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, post } from "../../lib/api";
import type { Recommendation, Zone } from "../../lib/types";
import { useLandscape } from "./context";
import { useCopy, type Copy } from "./copy";
import { autoScenario, clampArea, dailyDose, flowFor, irrigatedArea, manualPlan, minutesFor, openRecommendations, recActions, type ManualMissing } from "./data";
import { DoseLines, doseMoisture } from "./dose-lines";
import { ReadingSheet } from "./sheets";
import { ScreenHeader } from "./shell";
import { LoadingState } from "./states";
import { Sheet, SourceBadge } from "./visuals";
import ZoneSwitcher from "./zone-switcher";

type Mode = "manual" | "auto";

export default function IrrigationScreen() {
  const { zone, summary, loading, error } = useLandscape();
  const c = useCopy();
  const [mode, setMode] = useState<Mode>("auto");
  const [reading, setReading] = useState(false);
  if (!zone) return <LoadingState loading={loading} error={error} />;
  const start = summary?.current_vwc ?? null;
  return (
    <div className="lx-screen lx-irrigation">
      <ScreenHeader
        title={c.t("متى نروي، وكم؟", "When do we irrigate, and how much?")}
        lead={c.t(
          `${c.show(zone.name)} · المساحة المروية ${c.area(irrigatedArea(zone))} من ${c.area(zone.area_m2)}`,
          `${c.show(zone.name)} · irrigated area ${c.area(irrigatedArea(zone))} of ${c.area(zone.area_m2)}`,
        )}
      >
        <ZoneSwitcher />
      </ScreenHeader>
      <div className="lx-segment" role="group" aria-label={c.t("نمط الحساب", "Mode")}>
        {(["manual", "auto"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
            {m === "manual" ? c.t("يدوي", "Manual") : c.t("تلقائي", "Automatic")}
          </button>
        ))}
      </div>
      {mode === "manual" ? (
        // The calculator itself says what is missing, including the current moisture.
        <ManualPanel key={zone.id} zone={zone} startVwc={start} />
      ) : start == null ? (
        <section className="lx-card lx-empty">
          <h2>{c.t("ابدأ بقراءة واحدة", "Start with one reading")}</h2>
          <p>{c.t("نحتاج رطوبة البداية لحساب الري.", "We need a starting moisture to plan irrigation.")}</p>
          <button type="button" className="lx-primary" onClick={() => setReading(true)}>
            {c.t("تسجيل قراءة", "Record a reading")}
          </button>
        </section>
      ) : (
        <AutoPanel key={zone.id} zone={zone} startVwc={start} />
      )}
      <Recommendations />
      <ReadingSheet open={reading} onClose={() => setReading(false)} zone={zone} />
    </div>
  );
}

function useZoneModel(zone: Zone) {
  const { summaries } = useLandscape();
  const summary = summaries[zone.id] ?? null;
  // The zone's own settings only; a missing value stays missing (no hidden defaults).
  const area = irrigatedArea(zone);
  return {
    summary,
    area,
    depth: zone.root_depth_m ?? null,
    efficiency: zone.efficiency ?? null,
    flow: flowFor(summary, area ?? zone.area_m2),
    // The zone's allowed window, the same fallback as the Home summary (4 -> 9).
    window:
      zone.allowed_start_hour != null && zone.allowed_end_hour != null && zone.allowed_start_hour % 24 !== zone.allowed_end_hour % 24
        ? { start: zone.allowed_start_hour, end: zone.allowed_end_hour % 24 }
        : { start: 4, end: 9 },
  };
}

function AutoPanel({ zone, startVwc }: { zone: Zone; startVwc: number }) {
  const c = useCopy();
  const m = useZoneModel(zone);
  // Fixed per mount so the scenario does not drift while the screen is open.
  const [now] = useState(() => Date.now());
  const s = useMemo(
    () =>
      m.area == null || m.depth == null || m.efficiency == null
        ? null
        : autoScenario({
        startVwc,
        threshold: zone.soil.lower_vwc,
        target: zone.soil.target_vwc,
        etMmDay: m.summary?.weather?.et_mm_day ?? 5,
        rootDepthM: m.depth,
        areaM2: m.area,
        efficiency: m.efficiency,
        litresPerHour: m.flow.litresPerHour,
        now,
        allowedStart: m.window.start,
        allowedEnd: m.window.end,
      }),
    [startVwc, zone, m.summary, m.depth, m.area, m.efficiency, m.flow.litresPerHour, m.window.start, m.window.end, now],
  );
  if (!s)
    return (
      <section className="lx-card lx-empty">
        <p>{c.t("لا يمكن حساب السيناريو: أكمل المساحة المروية وعمق الجذور وكفاءة الري لهذه المنطقة.", "The scenario needs the zone's irrigated area, root depth and efficiency.")}</p>
      </section>
    );
  const pct = (v: number) => `${c.num(v * 100)}%`;
  const steps = [
    { t: s.now.t, title: c.t(`تقدير ${pct(s.now.vwc)}`, `Estimate ${pct(s.now.vwc)}`), note: c.t("الآن", "Now") },
    s.start && { t: s.start.t, title: c.t("بدء الري", "Start"), note: c.t("تحت الحد", "Below the minimum") },
    s.stop && {
      t: s.stop.t,
      title: c.t(`إيقاف عند ${pct(s.stop.vwc)}`, `Stop at ${pct(s.stop.vwc)}`),
      note: s.stop.windowClosed ? c.t("انتهت ساعات الري المسموحة", "Allowed hours ended") : c.t("بلغ الهدف", "Target reached"),
    },
    s.next && {
      t: s.next.t,
      title: c.t("الري القادم", "Next irrigation"),
      note: `${c.day(s.next.t, { weekday: "long" })} · ${s.next.night ? c.t("تبخر أقل ليلًا", "less evaporation at night") : c.t("ضمن الساعات المسموحة", "within allowed hours")}`,
    },
  ].filter(Boolean) as { t: number; title: string; note: string }[];
  const data = s.points.map((p) => ({ t: p.t, vwc: Math.round(p.vwc * 1000) / 10 }));
  return (
    <section className="lx-card lx-auto" aria-labelledby="lx-auto-title">
      <div className="lx-card-head">
        <h2 id="lx-auto-title">{c.t("يومك القادم", "The next day")}</h2>
        <span className="lx-badge lx-badge-estimated">
          <i aria-hidden="true" />
          {c.t("تقدير سيناريو — لا يشغّل مضخة", "Scenario estimate — runs no pump")}
        </span>
        <span className="lx-badge">
          <i aria-hidden="true" />
          {c.t(
            `ساعات الري المسموحة ${String(m.window.start).padStart(2, "0")}:00–${String(m.window.end).padStart(2, "0")}:00`,
            `Allowed hours ${String(m.window.start).padStart(2, "0")}:00–${String(m.window.end).padStart(2, "0")}:00`,
          )}
        </span>
        {m.summary?.et_reference && (
          <span className="lx-badge lx-badge-estimated">
            <i aria-hidden="true" />
            {c.t(
              `ET0 شهري 2025 — Open-Meteo · ${c.mm(m.summary.et_reference.net_mm_day)}/يوم`,
              `ET0 monthly 2025 — Open-Meteo · ${c.mm(m.summary.et_reference.net_mm_day)}/day`,
            )}
          </span>
        )}
      </div>
      <ol className="lx-timeline">
        {steps.map((step, i) => (
          <li key={i}>
            <time dateTime={new Date(step.t).toISOString()}>{c.time(step.t)}</time>
            <strong>{step.title}</strong>
            <span>{step.note}</span>
          </li>
        ))}
      </ol>
      <div className="lx-chart lx-chart-day" dir="ltr" role="img" aria-label={c.t("منحنى الرطوبة خلال 24 ساعة مع الهدف والحد الأدنى", "Moisture over 24 hours with target and minimum")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => c.time(t)} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} minTickGap={36} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} width={44} unit="%" domain={[0, "auto"]} />
            <Tooltip labelFormatter={(t) => c.time(Number(t))} formatter={(v) => [`${v}%`, c.t("الرطوبة", "Moisture")]} />
            <ReferenceLine y={zone.soil.target_vwc * 100} stroke="var(--lx-good)" strokeDasharray="4 6" label={{ value: c.t("الهدف", "Target"), position: "insideTopRight", fontSize: 12, fill: "var(--lx-muted)" }} />
            <ReferenceLine y={zone.soil.lower_vwc * 100} stroke="var(--lx-warn)" strokeDasharray="4 6" label={{ value: c.t("الحد الأدنى", "Minimum"), position: "insideBottomRight", fontSize: 12, fill: "var(--lx-muted)" }} />
            <Line type="monotone" dataKey="vwc" stroke="var(--lx-water)" strokeWidth={3} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const missingText = (c: Copy, m: ManualMissing) =>
  ({
    area: c.t("المساحة المروية", "irrigated area"),
    moisture: c.t("الرطوبة الحالية", "current moisture"),
    rootDepth: c.t("عمق الجذور", "root depth"),
    efficiency: c.t("كفاءة الري", "irrigation efficiency"),
  })[m];

function ManualPanel({ zone, startVwc }: { zone: Zone; startVwc: number | null }) {
  const c = useCopy();
  const m = useZoneModel(zone);
  const [value, setValue] = useState("");
  const [areaText, setAreaText] = useState(m.area != null ? String(m.area) : "");
  const litres = value === "" ? null : Number(value);
  const area = areaText === "" ? null : clampArea(Number(areaText), zone.area_m2);
  const plan = manualPlan({
    litres,
    areaM2: area,
    startVwc,
    rootDepthM: m.depth,
    efficiency: m.efficiency,
    target: zone.soil.target_vwc,
    upper: zone.soil.upper_vwc,
    litresPerHour: m.flow.litresPerHour,
  });
  const r = plan.result;
  const pct = (v: number) => `${c.num(v * 100)}%`;
  const verdict =
    r &&
    plan.depthMm != null &&
    area != null &&
    {
      insufficient: c.t(
        `غير كافٍ: ${c.mm(plan.depthMm)} على ${c.area(area)} ترفع الرطوبة إلى ${pct(r.afterVwc)} (الهدف ${pct(zone.soil.target_vwc)})`,
        `Not enough: ${c.mm(plan.depthMm)} over ${c.area(area)} raises moisture to ${pct(r.afterVwc)} (target ${pct(zone.soil.target_vwc)})`,
      ),
      good: c.t(
        `مناسب: ${c.mm(plan.depthMm)} على ${c.area(area)} ترفع الرطوبة إلى ${pct(r.afterVwc)} (الهدف ${pct(zone.soil.target_vwc)})`,
        `Good: ${c.mm(plan.depthMm)} over ${c.area(area)} raises moisture to ${pct(r.afterVwc)} (target ${pct(zone.soil.target_vwc)})`,
      ),
      over: c.t(
        `ري زائد: ${c.mm(plan.depthMm)} على ${c.area(area)} ترفع الرطوبة إلى ${pct(r.afterVwc)} (الحد الأعلى ${pct(zone.soil.upper_vwc)})`,
        `Over-watering: ${c.mm(plan.depthMm)} over ${c.area(area)} raises moisture to ${pct(r.afterVwc)} (upper limit ${pct(zone.soil.upper_vwc)})`,
      ),
    }[r.verdict];
  return (
    <section className="lx-card lx-manual" aria-labelledby="lx-manual-title">
      <div className="lx-card-head">
        <h2 id="lx-manual-title">{c.t("كم لترًا؟", "How many litres?")}</h2>
        <SourceBadge badge={{ kind: "estimated", simulated: false }} />
      </div>
      <label className="lx-field-row">
        {c.t("المساحة المروية (م²)", "Irrigated area (m²)")}
        <input
          type="number"
          inputMode="decimal"
          min={1}
          max={zone.area_m2}
          step={1}
          value={areaText}
          onChange={(e) => setAreaText(e.target.value)}
          onBlur={() => area != null && setAreaText(String(area))}
          dir="ltr"
        />
        <small>
          {area != null && areaText !== "" && Number(areaText) !== area
            ? c.t(`يُحسب على ${c.area(area)}: المسموح من 1 إلى ${c.area(zone.area_m2)}`, `Calculated on ${c.area(area)}: allowed 1 to ${c.area(zone.area_m2)}`)
            : c.t(`من 1 إلى ${c.area(zone.area_m2)} (مساحة المنطقة)`, `1 to ${c.area(zone.area_m2)} (zone area)`)}
        </small>
      </label>
      <label className="lx-big-input">
        <span className="lx-sr">{c.t("الكمية باللتر", "Volume in litres")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={1_000_000}
          step={10}
          value={value}
          placeholder={plan.litresToTarget != null ? String(Math.round(plan.litresToTarget)) : "0"}
          onChange={(e) => setValue(e.target.value)}
          dir="ltr"
        />
        <span aria-hidden="true">{c.t("لتر", "L")}</span>
      </label>
      <div className="lx-manual-result" aria-live="polite">
        {plan.missing.length > 0 ? (
          <p className="lx-caption">
            {c.t(
              `لا يمكن الحكم على الكمية: ينقص ${plan.missing.map((x) => missingText(c, x)).join(c.ar ? "، " : ", ")}.`,
              `No verdict yet: missing ${plan.missing.map((x) => missingText(c, x)).join(", ")}.`,
            )}
          </p>
        ) : (
          <>
            {r && value !== "" && (
              <>
                <div>
                  <span>{c.t("العمق", "Depth")}</span>
                  <strong>{plan.depthMm != null ? c.mm(plan.depthMm) : "—"}</strong>
                </div>
                <div>
                  <span>{c.t("الرطوبة بعد الري", "Moisture after")}</span>
                  <strong>{pct(r.afterVwc)}</strong>
                </div>
                <div>
                  <span>{c.t("المدة", "Duration")}</span>
                  <strong>{c.duration(r.minutes)}</strong>
                </div>
                {verdict && <p className={`lx-verdict lx-verdict-${r.verdict}`}>{verdict}</p>}
              </>
            )}
            {plan.litresToTarget != null && area != null && plan.mmToTarget != null && (
              <p className="lx-caption">
                {c.t(
                  `للوصول إلى الهدف على ${c.area(area)}: ${c.num(Math.round(plan.litresToTarget))} لتر (${c.mm(plan.mmToTarget)})`,
                  `To reach the target over ${c.area(area)}: ${c.num(Math.round(plan.litresToTarget))} L (${c.mm(plan.mmToTarget)})`,
                )}
              </p>
            )}
          </>
        )}
      </div>
      <p className="lx-caption">
        {c.t(
          `الحساب: الرطوبة بعد الري = الحالية + اللترات × الكفاءة ÷ (المساحة × عمق الجذور × 1000). عمق الجذور ${m.depth != null ? `${c.num(m.depth, 2)} م` : "—"}، الكفاءة ${m.efficiency != null ? pct(m.efficiency) : "—"}. 1 لتر/م² = 1 مم.`,
          `Moisture after = current + litres × efficiency ÷ (area × root depth × 1000). Root depth ${m.depth ?? "—"} m, efficiency ${m.efficiency != null ? pct(m.efficiency) : "—"}. 1 L/m² = 1 mm.`,
        )}
      </p>
    </section>
  );
}

function Recommendations() {
  const c = useCopy();
  const { zones, zone, recs, profile, refresh, setZoneId, summaries } = useLandscape();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [executing, setExecuting] = useState<Recommendation | null>(null);
  const open = openRecommendations(recs, zones, zone?.id);
  const current = open.find((o) => o.zone.id === zone?.id) ?? null;
  const others = open.filter((o) => o !== current).slice(0, 4);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إكمال العملية");
    } finally {
      setBusy(false);
    }
  }
  const act = (rec: Recommendation, status: "approved" | "deferred") =>
    run(() => api(`/recommendations/${rec.id}`, { method: "PATCH", body: JSON.stringify({ status, operator: profile.name }) }));
  const litresOf = (rec: Recommendation) => rec.result.estimate?.gross_l ?? null;
  const minutesOf = (rec: Recommendation, z: Zone) => {
    const l = litresOf(rec);
    return l == null ? null : minutesFor(l, flowFor(summaries[z.id] ?? null, z.irrigated_area_m2 ?? z.area_m2).litresPerHour);
  };
  const statusText = (s: string) =>
    s === "approved" ? c.t("معتمدة — بانتظار التنفيذ", "Approved — awaiting execution") : c.t("بانتظار الاعتماد", "Awaiting approval");
  if (!zone) return null;
  return (
    <section className="lx-recs" aria-labelledby="lx-recs-title">
      <h2 id="lx-recs-title" className="lx-section-title">
        {c.t("التوصية", "Recommendation")}
      </h2>
      <article className="lx-card lx-rec">
        {current ? (
          <>
            <div className="lx-rec-main">
              <div>
                <p className="lx-rec-zone">{c.show(zone.name)}</p>
                <RecAmount rec={current.rec} zone={zone} />
                <p className="lx-caption">{statusText(current.rec.status)}</p>
              </div>
              <SourceBadge badge={litresOf(current.rec) != null ? { kind: "estimated", simulated: zone.origin === "simulation" } : null} />
            </div>
            {!recActions(current.rec).approve && current.rec.status === "suggested" && (
              <p className="lx-caption">{c.show(current.rec.result.reason)}</p>
            )}
            <div className="lx-rec-buttons">
              {current.rec.status === "suggested" ? (
                <button type="button" className="lx-primary" disabled={busy || !recActions(current.rec).approve} onClick={() => act(current.rec, "approved")}>
                  {c.t("اعتماد", "Approve")}
                </button>
              ) : (
                <button type="button" className="lx-primary" disabled={busy} onClick={() => setExecuting(current.rec)}>
                  {c.t("تسجيل التنفيذ", "Log execution")}
                </button>
              )}
              <button type="button" className="lx-secondary" disabled={busy} onClick={() => act(current.rec, "deferred")}>
                {c.t("تأجيل", "Defer")}
              </button>
              {current.rec.status === "suggested" && (
                <button type="button" className="lx-secondary" disabled title={c.t("يتاح بعد الاعتماد", "Available after approval")}>
                  {c.t("تسجيل التنفيذ", "Log execution")}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="lx-rec-main">
            <div>
              <p className="lx-rec-zone">{c.show(zone.name)}</p>
              <p className="lx-caption">{c.t("لا توجد توصية مفتوحة لهذه المنطقة.", "No open recommendation for this zone.")}</p>
            </div>
            <button
              type="button"
              className="lx-secondary"
              disabled={busy}
              onClick={() => run(() => api(`/zones/${zone.id}/recommendations`, { method: "POST" }))}
            >
              {c.t("طلب توصية", "Request one")}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="lx-error">
            {c.show(error)}
          </p>
        )}
      </article>
      {others.length > 0 && (
        <ul className="lx-rec-list">
          {others.map(({ rec, zone: z }) => (
            <li key={rec.id}>
              <button type="button" onClick={() => setZoneId(z.id)}>
                <span>{c.show(z.name)}</span>
                <span>{litresOf(rec) != null ? c.litres(litresOf(rec)!) : c.show(rec.result.label)}</span>
                <span className="lx-caption">{statusText(rec.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {executing && (
        <ExecuteSheet
          rec={executing}
          onClose={() => setExecuting(null)}
          onDone={async () => {
            setExecuting(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

// Same presentation as the Home water card: today's dose first, the full refill
// of the stored recommendation second.
function RecAmount({ rec, zone }: { rec: Recommendation; zone: Zone }) {
  const c = useCopy();
  const { summaries } = useLandscape();
  const inputs = summaries[zone.id]?.dose_inputs;
  const dose = inputs ? dailyDose(inputs) : null;
  const full = rec.result.estimate?.gross_l ?? null;
  if (!dose)
    return <p className="lx-rec-amount">{full != null ? c.t(`${c.num(full)} لتر`, `${c.num(full)} L`) : c.show(rec.result.label)}</p>;
  return (
    <>
      <DoseLines
        c={c}
        dose={dose}
        method={zone.irrigation_method}
        moisture={doseMoisture(inputs?.current_vwc, zone.soil.lower_vwc, inputs?.target_vwc ?? zone.soil.target_vwc)}
        valueClass="lx-rec-amount" subClass="lx-caption" />
      <p className="lx-caption">
        {c.t(`تعويض النقص كاملًا: ${c.num(dose.full_refill_l)} لتر`, `Full refill of the deficit: ${c.num(dose.full_refill_l)} L`)}
      </p>
    </>
  );
}

function ExecuteSheet({ rec, onClose, onDone }: { rec: Recommendation; onClose: () => void; onDone: () => Promise<void> }) {
  const c = useCopy();
  const { profile } = useLandscape();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(
        "/irrigation-events",
        post({
          id: crypto.randomUUID(),
          recommendation_id: rec.id,
          volume: Number(f.get("volume")),
          unit: "L",
          volume_kind: String(f.get("kind")),
          executed_at: new Date().toISOString(),
          operator: profile.name,
          notes: String(f.get("notes") || ""),
        }),
      );
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل التنفيذ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={c.t("تسجيل التنفيذ", "Log execution")}>
      <p className="lx-sheet-lead">{c.t("سجل يدوي لما نُفّذ فعلًا. لا يشغّل مضخة.", "A manual record of what was done. It runs no pump.")}</p>
      <form className="lx-form" onSubmit={submit}>
        <label>
          {c.t("الكمية (لتر)", "Volume (L)")}
          <input name="volume" type="number" min={1} max={1_000_000} step={1} required defaultValue={Math.round(rec.result.estimate?.gross_l ?? 0) || ""} dir="ltr" />
        </label>
        <label>
          {c.t("مصدر الكمية", "Volume source")}
          <select name="kind" defaultValue="estimated">
            <option value="estimated">{c.t("تقدير", "Estimate")}</option>
            <option value="measured">{c.t("عدّاد مقاس", "Metered")}</option>
          </select>
        </label>
        <label>
          {c.t("ملاحظة (اختياري)", "Note (optional)")}
          <input name="notes" type="text" maxLength={1000} />
        </label>
        {error && (
          <p role="alert" className="lx-error">
            {c.show(error)}
          </p>
        )}
        <button className="lx-primary" disabled={busy}>
          {busy ? c.t("لحظة…", "One moment…") : c.t("حفظ السجل", "Save record")}
        </button>
      </form>
    </Sheet>
  );
}
