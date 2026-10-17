"use client";
import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import type { Zone } from "../../lib/types";
import type { Copy } from "./copy";
import { zoneMapModel, type MapPoint, type ZoneMapModel } from "./data";

// Zone map for the Home hero: the zone outline at real scale (metres), each
// sensor's representation circle drawn over an "uncovered" zone fill (display
// only; coverage numbers come from the backend), the sensors (fill: measured or estimated; ring: below the minimum,
// in range or above the target) and the suggested next measurement point.
// Geometry only: moisture is never interpolated between points. Not mirrored in RTL.

const pct = (c: Copy, f: number) => `${c.num(f * 100, 2)}%`;

export function coverageLine(c: Copy, m: ZoneMapModel) {
  if (!m.next || m.after == null) return null;
  return m.after > m.before + 1e-9
    ? c.t(`القراءة هنا ترفع التغطية من ${pct(c, m.before)} إلى ${pct(c, m.after)}`, `A reading here raises coverage from ${pct(c, m.before)} to ${pct(c, m.after)}`)
    : c.t(`التغطية ${pct(c, m.before)}؛ القراءة هنا اختيارية لتحسين التوزيع`, `Coverage ${pct(c, m.before)}; a reading here is optional, to improve the spread`);
}

export function radiusLine(c: Copy, m: ZoneMapModel) {
  return c.t(`نصف قطر تمثيل الحساس ${c.num(m.radius, 1)} م (افتراض)`, `Sensor representation radius ${c.num(m.radius, 1)} m (assumption)`);
}

export function pointLine(c: Copy, p: MapPoint) {
  if (p.vwc == null || !p.measuredAt) return c.t(`${p.name} · لا قراءة بعد`, `${p.name} · no reading yet`);
  const origin = p.origin === "simulation" ? c.t("محاكاة", "simulation") : c.t("مقاس", "measured");
  const when = `${c.day(p.measuredAt)} ${c.time(p.measuredAt)}`;
  return [c.show(p.name), `${c.num(p.vwc * 100, 1)}%`, when, origin, p.valid ? null : c.t("قديمة؛ غير محتسبة في التغطية", "stale; not counted in coverage")]
    .filter(Boolean)
    .join(" · ");
}

// Fill: measured (a valid, fresh reading) or estimated (stale or rejected).
// Ring: the reading against the zone's minimum and target.
export const pointClass = (p: MapPoint) => `lx-map-pt ${p.valid ? "is-measured" : "is-estimated"} ring-${p.state}`;

// A round scale length: 5 m on most zones, 2 m on very small ones.
export const scaleMetres = (width: number) => (width >= 12 ? 5 : width >= 5 ? 2 : 1);

// Screen margins (px) around the zone for labels and the scale bar.
const PAD = { x: 12, top: 20, bottom: 26 };

export function ZoneMapSvg({
  c,
  model,
  width,
  height,
  highlight,
  selected,
  onSelect,
  onHover,
}: {
  c: Copy;
  model: ZoneMapModel;
  width: number;
  height: number;
  highlight: boolean;
  selected: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const clip = useId();
  const { rect } = model;
  // One scale for both axes (real proportions), margins in screen pixels.
  const scale = Math.min((width - PAD.x * 2) / rect.width, (height - PAD.top - PAD.bottom) / rect.height);
  const px = (n: number) => n / scale;
  const vw = width / scale;
  const vh = height / scale;
  const x0 = rect.x - (vw - rect.width) / 2;
  const y0 = rect.y - px(PAD.top) - (vh - rect.height - px(PAD.top + PAD.bottom)) / 2;
  const bar = scaleMetres(rect.width);
  const barY = rect.y + rect.height + px(9);
  const font = px(10.5);
  const pick = (id: string) => (e: MouseEvent | KeyboardEvent) => {
    if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(id);
  };
  // The label sits in the margin above the zone (never over the sensors), joined
  // to the marker by a short leader line; kept inside the map horizontally.
  const next = model.next;
  const labelX = next ? Math.min(Math.max(next.x, x0 + px(40)), x0 + vw - px(40)) : 0;
  const labelY = rect.y - px(6);
  return (
    <svg
      className="lx-map-svg"
      viewBox={`${x0} ${y0} ${vw} ${vh}`}
      width={width}
      height={height}
      role="img"
      aria-label={c.t("خريطة المنطقة ونقاط القياس", "Zone map and measurement points")}
      data-points={model.points.length}
      data-scale={scale.toFixed(2)}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
        </clipPath>
      </defs>
      {/* Display only: the zone in the "uncovered" colour, valid sensors' circles on top. */}
      <rect className="lx-map-zone lx-map-gap" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      <g clipPath={`url(#${clip})`}>
        {model.points
          .filter((p) => p.valid)
          .map((p) => (
            <circle key={p.id} className="lx-map-covered" cx={p.x} cy={p.y} r={model.radius} />
          ))}
        {model.points.map((p) => (
          <circle
            key={p.id}
            className={p.valid ? "lx-map-cover" : "lx-map-cover is-stale"}
            cx={p.x}
            cy={p.y}
            r={model.radius}
            strokeWidth={px(1)}
            strokeDasharray={p.valid ? undefined : `${px(4)} ${px(3)}`}
          />
        ))}
      </g>
      <rect className="lx-map-outline" x={rect.x} y={rect.y} width={rect.width} height={rect.height} strokeWidth={px(1.5)} />
      {next && (
        <g className={`lx-map-next${highlight ? " is-on" : ""}`} data-x={next.x} data-y={next.y}>
          {highlight && <circle className="lx-map-pulse" cx={next.x} cy={next.y} r={px(13)} strokeWidth={px(2)} />}
          <path className="lx-map-next-leader" d={`M ${next.x} ${next.y - px(7)} L ${labelX} ${labelY + px(2)}`} strokeWidth={px(1)} />
          <text className="lx-map-next-label" x={labelX} y={labelY} fontSize={font} strokeWidth={px(3)} textAnchor="middle">
            {c.t("القياس التالي", "Next reading")}
          </text>
          <path
            className="lx-map-next-mark"
            d={`M ${next.x} ${next.y - px(7)} L ${next.x + px(7)} ${next.y} L ${next.x} ${next.y + px(7)} L ${next.x - px(7)} ${next.y} Z`}
            strokeWidth={px(1.5)}
          />
        </g>
      )}
      {model.points.map((p) => (
        <circle
          key={p.id}
          className={`${pointClass(p)}${selected === p.id ? " is-selected" : ""}`}
          data-state={p.valid ? "measured" : "estimated"}
          data-ring={p.state}
          cx={p.x}
          cy={p.y}
          r={px(selected === p.id ? 7 : 5.5)}
          strokeWidth={px(2.5)}
          role="button"
          tabIndex={onSelect ? 0 : -1}
          aria-label={pointLine(c, p)}
          onClick={pick(p.id)}
          onKeyDown={pick(p.id)}
          onMouseEnter={() => onHover?.(p.id)}
          onMouseLeave={() => onHover?.(null)}
        >
          <title>{pointLine(c, p)}</title>
        </circle>
      ))}
      <g className="lx-map-scale" data-metres={bar}>
        <path d={`M ${rect.x} ${barY - px(3)} V ${barY} H ${rect.x + bar} V ${barY - px(3)}`} strokeWidth={px(1.5)} />
        {/* Number and unit in one run, centred under the bar (no RTL anchor flip). */}
        <text x={rect.x + bar / 2} y={barY + px(12)} fontSize={font} textAnchor="middle" direction={c.ar ? "rtl" : "ltr"} unicodeBidi="plaintext">
          {c.t(`${c.num(bar)}\u00A0م`, `${bar}\u00A0m`)}
        </text>
      </g>
    </svg>
  );
}

function Legend({ c, model }: { c: Copy; model: ZoneMapModel }) {
  const rings = new Set(model.points.map((p) => p.state));
  return (
    <p className="lx-map-legend">
      <span>
        <i className="k-measured" aria-hidden="true" />
        {c.t("مقاس", "Measured")}
      </span>
      <span>
        <i className="k-estimated" aria-hidden="true" />
        {c.t("تقديري", "Estimated")}
      </span>
      {rings.has("below") && (
        <span>
          <i className="k-ring-below" aria-hidden="true" />
          {c.t("أقل من الحد", "Below minimum")}
        </span>
      )}
      {rings.has("inRange") && (
        <span>
          <i className="k-ring-inRange" aria-hidden="true" />
          {c.t("ضمن النطاق", "In range")}
        </span>
      )}
      {rings.has("above") && (
        <span>
          <i className="k-ring-above" aria-hidden="true" />
          {c.t("أعلى من الهدف", "Above target")}
        </span>
      )}
      <span>
        <i className="k-suggested" aria-hidden="true" />
        {c.t("مقترح", "Suggested")}
      </span>
      <span>
        <i className="k-gap" aria-hidden="true" />
        {c.t("غير مغطى", "Uncovered")}
      </span>
    </p>
  );
}

// Map figure with legend, point details and the coverage line; click the map
// (not a point) to enlarge it in an overlay, Esc closes.
export default function ZoneMap({
  c,
  zone,
  highlight,
  width = 300,
  height = 150,
}: {
  c: Copy;
  zone: Zone;
  highlight: boolean;
  width?: number;
  height?: number;
}) {
  const model = zoneMapModel(zone);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [large, setLarge] = useState(false);
  const point = model.points.find((p) => p.id === (hover ?? selected)) ?? null;
  const line = coverageLine(c, model);
  useEffect(() => {
    if (!large) return;
    const close = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setLarge(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [large]);
  const details = (
    <>
      <Legend c={c} model={model} />
      <p className="lx-map-radius">{radiusLine(c, model)}</p>
      {line && (
        <p className={`lx-map-info lx-map-line${highlight ? " is-on" : ""}`} aria-live="polite">
          {line}
        </p>
      )}
    </>
  );
  const pointInfo = (className: string) =>
    point && (
      <p className={className} aria-live="polite">
        {pointLine(c, point)}
      </p>
    );
  // A second click on the same sensor closes its details.
  const select = (id: string) => setSelected((cur) => (cur === id ? null : id));
  const svg = (w: number, h: number) => (
    <ZoneMapSvg c={c} model={model} width={w} height={h} highlight={highlight} selected={selected} onSelect={select} onHover={setHover} />
  );
  return (
    <figure className="lx-map" data-zone={zone.id}>
      <div className="lx-map-open" onClick={() => setLarge(true)}>
        {svg(width, height)}
        <button type="button" className="lx-map-zoom" onClick={() => setLarge(true)} aria-label={c.t("تكبير الخريطة", "Enlarge the map")}>
          <Maximize2 size={14} aria-hidden="true" />
        </button>
        {/* Over the map, so the hero keeps its height (Home fits 1366 × 768). */}
        {pointInfo("lx-map-tip")}
      </div>
      {details}
      {large &&
        createPortal(
          <div className="lx-map-overlay" role="dialog" aria-modal="true" aria-label={c.t("خريطة المنطقة", "Zone map")} onClick={() => setLarge(false)}>
            <div className="lx-map-panel" onClick={(e) => e.stopPropagation()}>
              <header>
                <strong>{c.show(zone.name)}</strong>
                <button type="button" className="lx-icon" onClick={() => setLarge(false)} aria-label={c.t("إغلاق", "Close")} autoFocus>
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              {svg(720, 400)}
              {details}
              {pointInfo("lx-map-info")}
            </div>
          </div>,
          // Inside the module root (theme and styles), outside the clipped hero.
          document.querySelector(".lx") ?? document.body,
        )}
    </figure>
  );
}
