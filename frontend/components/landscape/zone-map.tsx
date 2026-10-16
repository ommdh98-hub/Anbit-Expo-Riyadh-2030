"use client";
import {
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import type { Zone } from "../../lib/types";
import type { Copy } from "./copy";
import { zoneMapModel, type MapPoint, type ZoneMapModel } from "./data";

// Compact zone map for the Home hero: the zone outline (metres), sensor points
// coloured by their last reading, the coverage radius around valid points and
// the suggested next measurement point. Geometry only: moisture is never
// interpolated between points. A map is not mirrored in RTL.

const pct = (c: Copy, f: number) => `${c.num(f * 100, 2)}%`;

export function coverageLine(c: Copy, m: ZoneMapModel) {
  if (!m.next || m.after == null) return null;
  return m.after > m.before + 1e-9
    ? c.t(
        `القراءة هنا ترفع التغطية من ${pct(c, m.before)} إلى ${pct(c, m.after)}`,
        `A reading here raises coverage from ${pct(c, m.before)} to ${pct(c, m.after)}`,
      )
    : c.t(
        `التغطية ${pct(c, m.before)}؛ القراءة هنا اختيارية لتحسين التوزيع`,
        `Coverage ${pct(c, m.before)}; a reading here is optional, to improve the spread`,
      );
}

export function pointLine(c: Copy, p: MapPoint) {
  if (p.vwc == null || !p.measuredAt)
    return c.t(`${p.name} · لا قراءة بعد`, `${p.name} · no reading yet`);
  const origin =
    p.origin === "simulation"
      ? c.t("محاكاة", "simulation")
      : c.t("مقاس", "measured");
  const when = `${c.day(p.measuredAt)} ${c.time(p.measuredAt)}`;
  return [
    c.show(p.name),
    `${c.num(p.vwc * 100, 1)}%`,
    when,
    origin,
    p.valid ? null : c.t("غير محتسبة في التغطية", "not counted in coverage"),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ZoneMapSvg({
  c,
  model,
  width,
  height,
  highlight,
  selected,
  onSelect,
}: {
  c: Copy;
  model: ZoneMapModel;
  width: number;
  height: number;
  highlight: boolean;
  selected: string | null;
  onSelect?: (id: string) => void;
}) {
  const clip = useId();
  const { rect } = model;
  const pad = Math.max(rect.width, rect.height) * 0.06;
  const vw = rect.width + pad * 2;
  const vh = rect.height + pad * 2;
  // Marker sizes in screen pixels, converted to metres for this box.
  const scale = Math.min(width / vw, height / vh);
  const px = (n: number) => n / scale;
  const pick = (id: string) => (e: MouseEvent | KeyboardEvent) => {
    if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(id);
  };
  return (
    <svg
      className="lx-map-svg"
      viewBox={`${rect.x - pad} ${rect.y - pad} ${vw} ${vh}`}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={c.t(
        "خريطة المنطقة ونقاط القياس",
        "Zone map and measurement points",
      )}
      data-points={model.points.length}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
        </clipPath>
      </defs>
      <rect
        className="lx-map-zone"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={px(6)}
      />
      <g clipPath={`url(#${clip})`}>
        {model.points
          .filter((p) => p.valid)
          .map((p) => (
            <circle
              key={p.id}
              className="lx-map-cover"
              cx={p.x}
              cy={p.y}
              r={model.radius}
            />
          ))}
      </g>
      <rect
        className="lx-map-outline"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={px(6)}
        strokeWidth={px(2)}
      />
      {model.next && (
        <g
          className={`lx-map-next${highlight ? " is-on" : ""}`}
          data-x={model.next.x}
          data-y={model.next.y}
        >
          {highlight && (
            <circle
              className="lx-map-pulse"
              cx={model.next.x}
              cy={model.next.y}
              r={px(14)}
              strokeWidth={px(2)}
            />
          )}
          <circle
            className="lx-map-next-ring"
            cx={model.next.x}
            cy={model.next.y}
            r={px(8)}
            strokeWidth={px(2)}
          />
          <circle
            className="lx-map-next-dot"
            cx={model.next.x}
            cy={model.next.y}
            r={px(2.5)}
          />
        </g>
      )}
      {model.points.map((p) => (
        <circle
          key={p.id}
          className={`lx-map-pt is-${p.valid ? p.state : "stale"}${selected === p.id ? " is-selected" : ""}`}
          data-state={p.valid ? p.state : "stale"}
          cx={p.x}
          cy={p.y}
          r={px(selected === p.id ? 7 : 5.5)}
          strokeWidth={px(2)}
          role="button"
          tabIndex={onSelect ? 0 : -1}
          aria-label={pointLine(c, p)}
          onClick={pick(p.id)}
          onKeyDown={pick(p.id)}
        />
      ))}
    </svg>
  );
}

function Legend({ c }: { c: Copy }) {
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
      <span>
        <i className="k-suggested" aria-hidden="true" />
        {c.t("مقترح", "Suggested")}
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
  width = 260,
  height = 170,
}: {
  c: Copy;
  zone: Zone;
  highlight: boolean;
  width?: number;
  height?: number;
}) {
  const model = zoneMapModel(zone);
  const [selected, setSelected] = useState<string | null>(null);
  const [large, setLarge] = useState(false);
  const point = model.points.find((p) => p.id === selected) ?? null;
  const line = highlight ? coverageLine(c, model) : null;
  useEffect(() => {
    if (!large) return;
    const close = (e: globalThis.KeyboardEvent) =>
      e.key === "Escape" && setLarge(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [large]);
  const details = (
    <>
      <Legend c={c} />
      {point && (
        <p className="lx-map-info" aria-live="polite">
          {pointLine(c, point)}
        </p>
      )}
      {line && (
        <p className="lx-map-info lx-map-line" aria-live="polite">
          {line}
        </p>
      )}
    </>
  );
  return (
    <figure className="lx-map" data-zone={zone.id}>
      <div className="lx-map-open" onClick={() => setLarge(true)}>
        <ZoneMapSvg
          c={c}
          model={model}
          width={width}
          height={height}
          highlight={highlight}
          selected={selected}
          onSelect={setSelected}
        />
        <button
          type="button"
          className="lx-map-zoom"
          onClick={() => setLarge(true)}
          aria-label={c.t("تكبير الخريطة", "Enlarge the map")}
        >
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      {details}
      {large &&
        createPortal(
          <div
            className="lx-map-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={c.t("خريطة المنطقة", "Zone map")}
            onClick={() => setLarge(false)}
          >
            <div className="lx-map-panel" onClick={(e) => e.stopPropagation()}>
              <header>
                <strong>{c.show(zone.name)}</strong>
                <button
                  type="button"
                  className="lx-icon"
                  onClick={() => setLarge(false)}
                  aria-label={c.t("إغلاق", "Close")}
                  autoFocus
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <ZoneMapSvg
                c={c}
                model={model}
                width={720}
                height={420}
                highlight={highlight}
                selected={selected}
                onSelect={setSelected}
              />
              {details}
            </div>
          </div>,
          // Inside the module root (theme and styles), outside the clipped hero.
          document.querySelector(".lx") ?? document.body,
        )}
    </figure>
  );
}
