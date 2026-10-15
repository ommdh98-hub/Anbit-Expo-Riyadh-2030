"use client";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FastForward, Pause, Play, X } from "lucide-react";
import { SPEEDS, type SpeedId } from "../../lib/twin/constants";
import { sectionsFor, type SimConfig, type Snapshot } from "../../lib/twin/engine";
import { blobs, MAP } from "../../lib/twin/shapes";
import { useCopy, type Copy } from "../landscape/copy";
import { pct, plantName, sensorName, signedSaving, soilName } from "./chrome";
import type { SectionDetail } from "./use-twin-sim";

type Props = {
  config: SimConfig;
  snap: Snapshot | null;
  playing: boolean;
  speed: SpeedId;
  detail: SectionDetail | null;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onSpeed: (id: SpeedId) => void;
  onInspect: (index: number) => void;
  onCloseDetail: () => void;
};

const speedLabel = (c: Copy, id: SpeedId) =>
  ({
    "1x": "1x",
    "10x": "10x",
    "60x": "60x",
    day: c.t("يوم/ث", "1 day/s"),
    week: c.t("أسبوع/10ث", "1 wk/10 s"),
  })[id];

export default function ControlRoom(p: Props) {
  const c = useCopy();
  const specs = useMemo(() => sectionsFor(p.config), [p.config]);
  const shapes = useMemo(() => blobs(specs.map((s) => s.id)), [specs]);
  const [open, setOpen] = useState<number | null>(null);
  const s = p.snap;
  const progress = s ? s.i / s.total : 0;
  const { onInspect, playing } = p;
  // Keep the open sheet current while the run plays.
  useEffect(() => {
    if (open === null || !playing) return;
    const id = setInterval(() => onInspect(open), 1000);
    return () => clearInterval(id);
  }, [open, playing, onInspect]);
  const select = (index: number) => {
    setOpen(index);
    p.onInspect(index);
  };
  return (
    <section className="tw-room" aria-labelledby="tw-room-title">
      <h1 id="tw-room-title" className="tw-sr">
        {c.t("غرفة التحكم", "Control room")}
      </h1>
      <div className="tw-clockbar">
        <div className="tw-clock" aria-live="off">
          <strong>{s ? c.time(s.timeMs) : "—"}</strong>
          <span>{s ? c.day(s.timeMs, { weekday: "long", day: "numeric", month: "long" }) : ""}</span>
        </div>
        <div className="tw-controls">
          <div className="tw-seg tw-speeds" role="group" aria-label={c.t("السرعة", "Speed")}>
            {SPEEDS.map((sp) => (
              <button key={sp.id} type="button" aria-pressed={p.speed === sp.id} onClick={() => p.onSpeed(sp.id)}>
                {speedLabel(c, sp.id)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="tw-round tw-round-main"
            onClick={p.playing ? p.onPause : p.onResume}
            aria-label={p.playing ? c.t("إيقاف مؤقت", "Pause") : c.t("تشغيل", "Play")}
            disabled={s?.done}
          >
            {p.playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button type="button" className="tw-round" onClick={p.onSkip} aria-label={c.t("انتقل إلى النهاية", "Skip to end")} disabled={s?.done}>
            <FastForward size={20} className="tw-flip" />
          </button>
        </div>
        <div
          className="tw-progress"
          role="progressbar"
          aria-label={c.t("تقدم المحاكاة", "Simulation progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>

      <div className="tw-counters">
        <Counter label={c.t("متوسط الرطوبة", "Avg. moisture")} value={s ? pct(c, s.avgMoisture, 1) : "—"} />
        <Counter label={c.t("أقسام تحتاج ماء", "Sections needing water")} value={s ? `${c.num(s.needing)} / ${c.num(s.sections.length)}` : "—"} />
        <Counter label={c.t("المياه المستخدمة", "Water used")} value={s ? c.litres(s.anbitL) : "—"} />
        <Counter
          label={c.t("التوفير مقابل الجدول الثابت", "Saving vs fixed schedule")}
          value={s ? signedSaving(c, s.saving) : "—"}
          tone={s?.saving != null && s.saving < 0 ? "warn" : undefined}
        />
      </div>

      <div className="tw-garden">
        <svg viewBox={`0 0 ${MAP.width} ${MAP.height}`} role="group" aria-label={c.t("خريطة الحديقة المجردة", "Abstract garden map")}>
          <defs>
            <filter id="tw-soft" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="0.6" />
            </filter>
          </defs>
          {shapes.map((b, i) => {
            const v = s?.sections[i];
            const spec = specs[i];
            const label = `${b.id} · ${plantName(c, spec.plant)} · ${v ? pct(c, v.m, 1) : ""}${v?.valve ? ` · ${c.t("المحبس مفتوح", "valve open")}` : ""}`;
            return (
              <g
                key={b.id}
                className={`tw-bed tw-bed-${v?.state ?? "good"} ${v?.valve ? "is-open" : ""} ${open === i ? "is-selected" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={() => select(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(i);
                  }
                }}
              >
                <path d={b.d} filter="url(#tw-soft)" style={{ fillOpacity: v ? 0.45 + Math.min(1, (v.m - spec.wp) / (spec.fc - spec.wp)) * 0.5 : 0.6 }} />
                {v?.valve && <circle className="tw-pulse" cx={b.cx} cy={b.cy} r={18} />}
                <text x={b.cx} y={b.cy + 4} textAnchor="middle">
                  {b.id}
                </text>
                <circle className={spec.lora ? "tw-sensor-lora" : "tw-sensor-virtual"} cx={b.cx} cy={b.cy + 16} r={3} />
              </g>
            );
          })}
        </svg>
        <ul className="tw-legend">
          <li>
            <i className="dry" /> {c.t("جاف", "Dry")}
          </li>
          <li>
            <i className="good" /> {c.t("مناسب", "Good")}
          </li>
          <li>
            <i className="wet" /> {c.t("رطب", "Wet")}
          </li>
          <li>
            <i className="lora" /> LoRa
          </li>
          <li>
            <i className="virtual" /> {c.t("افتراضي", "Virtual")}
          </li>
        </ul>
      </div>

      {open !== null && (
        <SectionSheet
          detail={p.detail?.index === open ? p.detail : null}
          onClose={() => {
            setOpen(null);
            p.onCloseDetail();
          }}
          onRefresh={() => p.onInspect(open)}
        />
      )}
    </section>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`tw-counter ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionSheet({ detail, onClose, onRefresh }: { detail: SectionDetail | null; onClose: () => void; onRefresh: () => void }) {
  const c = useCopy();
  const d = detail;
  return (
    <aside className="tw-sheet" aria-label={d ? d.spec.id : c.t("تفاصيل القسم", "Section details")}>
      <header>
        <h2>{d ? `${d.spec.id} · ${plantName(c, d.spec.plant)}` : "…"}</h2>
        <button type="button" className="tw-icon" onClick={onClose} aria-label={c.t("إغلاق", "Close")}>
          <X size={18} />
        </button>
      </header>
      {d && (
        <>
          <div className="tw-sheet-chart" dir="ltr" role="img" aria-label={c.t("رطوبة آخر 24 ساعة", "Moisture, last 24 hours")}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.curve.map((p) => ({ t: p.t, v: Math.round(p.vwc * 1000) / 10 }))} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                <ReferenceArea y1={d.spec.minimum * 100} y2={d.spec.upper * 100} fill="var(--tw-good)" fillOpacity={0.12} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => c.time(t)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} unit="%" domain={[Math.floor(d.spec.wp * 100), Math.ceil(d.spec.fc * 100)]} />
                <Tooltip labelFormatter={(t) => c.time(Number(t))} formatter={(v) => [`${v}%`, c.t("الرطوبة", "Moisture")]} />
                <Line dataKey="v" stroke="var(--tw-water)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <dl className="tw-facts">
            <div>
              <dt>{c.t("الرطوبة", "Moisture")}</dt>
              <dd>{pct(c, d.m, 1)}</dd>
            </div>
            <div>
              <dt>{c.t("قراءة أنبت", "ANBIT reading")}</dt>
              <dd>
                {pct(c, d.est, 1)} <small>{sensorName(c, d.spec.lora)}</small>
              </dd>
            </div>
            <div>
              <dt>{c.t("التربة", "Soil")}</dt>
              <dd>{soilName(c, d.spec.soil)}</dd>
            </div>
            <div>
              <dt>{c.t("المحبس", "Valve")}</dt>
              <dd>{d.valve ? c.t("مفتوح", "Open") : c.t("مغلق", "Closed")}</dd>
            </div>
            <div>
              <dt>{c.t("الري القادم", "Next irrigation")}</dt>
              <dd>{d.next ? `${c.day(d.next, { weekday: "short" })} ${c.time(d.next)}` : c.t("لا حاجة خلال 7 أيام", "None within 7 days")}</dd>
            </div>
            <div>
              <dt>{c.t("الهدف · الحد الأدنى", "Target · minimum")}</dt>
              <dd>
                {pct(c, d.spec.target)} · {pct(c, d.spec.minimum)}
              </dd>
            </div>
          </dl>
          <p className="tw-model">
            <span>{c.t("توقع النموذج (مدرَّب على بيانات محاكاة)", "Model prediction (trained on simulated data)")}</span>
            <strong>
              {d.modelNeed == null
                ? c.t("خارج نطاق التدريب — تُستخدم قاعدة الموازنة المائية", "Outside training range — water-balance rule used")
                : d.modelNeed >= 0.5
                  ? c.t("يحتاج ري", "Needs water")
                  : c.t("لا يحتاج الآن", "Not now")}
            </strong>
          </p>
          <p className="tw-caption">
            {d.spec.lora
              ? c.t("LoRa: حساس فيزيائي محاكى بضجيج قياس.", "LoRa: a simulated physical sensor with measurement noise.")
              : c.t("افتراضي: يُقدَّر من التربة والتبخر، ويُعاير بسرعة جفاف أقسام LoRa المجاورة.", "Virtual: estimated from soil and evaporation, calibrated by how fast neighbouring LoRa sections dry.")}
          </p>
          <button type="button" className="tw-ghost" onClick={onRefresh}>
            {c.t("تحديث", "Refresh")}
          </button>
        </>
      )}
    </aside>
  );
}
