"use client";
import { useId, useState } from "react";
import { Layers, MapPin, Microscope } from "lucide-react";
import type { Zone } from "../lib/types";
import { currentLanguage, display } from "../lib/i18n";
import { date, number } from "../lib/api";
import { simpleState } from "./guided-evaluation";
import { suggestedMeasurement } from "../lib/role-home";

const colors: Record<string, string> = {
  insufficient: "#e5e8e0",
  conflict: "#f5dcda",
  measure: "#f4e6c6",
  high: "#dae9ed",
  review: "#e9eccd",
  defer: "#deebd8",
};
type PointFocus = {
  zoneId: string;
  kind: "reading" | "empty" | "suggested";
  pointId?: string;
};
/** API coordinates and validity only. This diagram never interpolates soil moisture. */
export default function SiteMap({
  zones,
  selected,
  onSelect,
  large = false,
  measurementFocus = false,
  focusSuggested = false,
  onReading,
}: {
  zones: Zone[];
  selected: string;
  onSelect: (id: string) => void;
  large?: boolean;
  measurementFocus?: boolean;
  focusSuggested?: boolean;
  onReading?: () => void;
}) {
  const id = useId().replaceAll(":", ""),
    hatch = `map-gap-${id}`;
  const [showReadings, setShowReadings] = useState(true);
  const [showGaps, setShowGaps] = useState(false);
  const [showGeometry, setShowGeometry] = useState(false);
  const [picked, setPicked] = useState<PointFocus | null>(() =>
    focusSuggested ? { zoneId: selected, kind: "suggested" } : null,
  );
  const focus = zones.length === 1 ? zones[0] : null;
  const box = focus
    ? `${focus.x - 2} ${focus.y - 2} ${focus.width + 4} ${focus.height + 4}`
    : "0 0 88 57";
  const chosen = zones.find((z) => z.id === selected);
  const where = chosen ? suggestedMeasurement(chosen) : null;
  const detail = picked?.zoneId === selected ? picked : null;
  const point = chosen?.points.find((p) => p.id === detail?.pointId);
  const latest = point
    ? chosen?.measurements
        .filter((m) => m.point_id === point.id)
        .toSorted(
          (a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at),
        )[0]
    : null;
  const activate = (value: PointFocus) => {
    onSelect(value.zoneId);
    setPicked(value);
  };
  const readingValue = (value: number) =>
    new Intl.NumberFormat(currentLanguage() === "ar" ? "ar-SA" : "en-US", {
      maximumFractionDigits: 3,
    }).format(value);
  const unit = (value: string) =>
    display(
      value === "vwc_percent"
        ? "% حجمية"
        : value === "vwc_fraction"
          ? "م³/م³"
          : value === "raw"
            ? "خام"
            : value,
    );
  return (
    <section
      className={`panel map-panel map-clear measurement-map ${measurementFocus ? "is-focused" : ""} ${large ? "large-map" : ""}`}
      aria-label={display("خريطة مواقع القياس")}
    >
      <div className="section-title map-headline">
        <div>
          <h2>
            {display(
              measurementFocus ? "مواقع القياس في المنطقة" : "خريطة المناطق",
            )}
          </h2>
          <p>
            {display(
              "مخطط تجريبي بإحداثيات محلية، وليس موقع إكسبو الفعلي أو GPS.",
            )}
          </p>
        </div>
        <details className="map-layer-menu">
          <summary>
            <Layers size={17} />
            {display("طبقات اختيارية")}
          </summary>
          <div>
            <label>
              <input
                type="checkbox"
                checked={showReadings}
                onChange={(e) => setShowReadings(e.target.checked)}
              />
              {display("القراءات المحفوظة")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={showGeometry}
                onChange={(e) => setShowGeometry(e.target.checked)}
              />
              {display("نقاط مسجلة بلا قراءات")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={showGaps}
                onChange={(e) => setShowGaps(e.target.checked)}
              />
              {display("فجوات التغطية الهندسية")}
            </label>
          </div>
        </details>
      </div>
      <div
        className="map-simple-key"
        role="group"
        aria-label={display("مفتاح الخريطة")}
      >
        <span>
          <i className="map-key-reading" />
          {display("قراءة صالحة للقرار")}
        </span>
        <span>
          <i className="map-key-excluded" />
          {display("قراءة قديمة أو مستبعدة")}
        </span>
        <span>
          <i className="map-key-suggested" />
          {display("موقع مقترح للقياس")}
        </span>
        {showGeometry && (
          <span>
            <i className="map-key-empty" />
            {display("نقطة بلا قراءة محفوظة")}
          </span>
        )}
      </div>
      <svg
        className="site-map"
        viewBox={box}
        role="group"
        aria-label={display(
          "مخطط تفاعلي لمناطق حديقة تجريبية، وليس خريطة إكسبو أو جهاز GPS",
        )}
      >
        <defs>
          <pattern
            id={hatch}
            width="1.2"
            height="1.2"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="1.2"
              stroke="#9c762f"
              strokeWidth=".23"
            />
          </pattern>
        </defs>
        <rect x="0" y="0" width="88" height="57" rx="2" fill="#edf1e8" />
        <path
          d="M2 27 H85 M35 2 V27 M60 2 V27 M43 28 V53"
          stroke="#fffdf7"
          strokeWidth="2.5"
          fill="none"
        />
        {zones.map((z) => {
          const state = simpleState(z),
            isSelected = z.id === selected,
            suggestion = isSelected ? suggestedMeasurement(z) : null;
          const choose = () => {
            onSelect(z.id);
            setPicked(null);
          };
          const pinX = suggestion
            ? Math.min(
                Math.max(suggestion.x - 7, z.x + 0.5),
                z.x + z.width - 14.5,
              )
            : 0;
          const pinY = suggestion
            ? Math.min(
                Math.max(suggestion.y - 5, z.y + 6.5),
                z.y + z.height - 4,
              )
            : 0;
          return (
            <g className="map-zone" key={z.id} data-selected={isSelected}>
              <rect
                className="map-zone-shape"
                x={z.x}
                y={z.y}
                width={z.width}
                height={z.height}
                rx="1.4"
                fill={colors[z.decision.code] ?? "#e5e8e0"}
                stroke={isSelected ? "#234d36" : "#9dad9b"}
                strokeWidth={isSelected ? ".6" : ".2"}
                tabIndex={0}
                role="button"
                aria-label={display(
                  `${z.name}، ${state.title}. اضغط لتحديد المنطقة.`,
                )}
                aria-pressed={isSelected}
                onClick={choose}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    choose();
                  }
                }}
              />
              {showGaps &&
                z.decision.coverage.uncovered_cells.map((p, i) => (
                  <rect
                    key={i}
                    x={p.x - z.width / 40}
                    y={p.y - z.height / 40}
                    width={z.width / 20}
                    height={z.height / 20}
                    fill={`url(#${hatch})`}
                    pointerEvents="none"
                  />
                ))}
              <rect
                x={z.x + 1}
                y={z.y + 0.4}
                width={z.width - 2}
                height="3.3"
                rx="1"
                fill="#fffefa"
                opacity=".97"
                pointerEvents="none"
              />
              <text
                x={z.x + z.width / 2}
                y={z.y + 2.8}
                textAnchor="middle"
                className="map-label"
                fontSize="1.9"
                pointerEvents="none"
              >
                {display(z.name)}
              </text>
              {z.points.map((p, i) => {
                const reading = z.measurements
                  .filter((m) => m.point_id === p.id)
                  .toSorted(
                    (a, b) =>
                      Date.parse(b.measured_at) - Date.parse(a.measured_at),
                  )[0];
                if (reading ? !showReadings : !showGeometry) return null;
                const valid =
                  !!reading && z.decision.readings_used.includes(reading.id);
                const value: PointFocus = {
                  zoneId: z.id,
                  pointId: p.id,
                  kind: reading ? "reading" : "empty",
                };
                const label = `${display(reading ? "قراءة محفوظة" : "نقطة بلا قراءة محفوظة")} · ${display(p.name || `نقطة ${i + 1}`)}${reading ? ` · ${readingValue(reading.value)} ${unit(reading.unit)} · ${display(valid ? "صالحة للقرار" : "غير مستخدمة للقرار")}` : ""}`;
                return (
                  <g
                    key={p.id}
                    className="map-marker"
                    data-kind={reading ? "reading" : "empty"}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    aria-pressed={
                      detail?.pointId === p.id && detail?.zoneId === z.id
                    }
                    aria-describedby={
                      detail?.pointId === p.id && detail.zoneId === z.id
                        ? `${id}-point-info`
                        : undefined
                    }
                    onClick={() => activate(value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        activate(value);
                      }
                    }}
                  >
                    <circle cx={p.x} cy={p.y} r="2.3" fill="transparent" />
                    <circle
                      className="map-marker-ring"
                      cx={p.x}
                      cy={p.y}
                      r="1"
                      fill={
                        reading ? (valid ? "#256c78" : "#727e79") : "#fffefa"
                      }
                      stroke={reading ? "#fff" : "#727e79"}
                      strokeWidth=".35"
                    />
                    <title>{label}</title>
                  </g>
                );
              })}
              {suggestion && (
                <g
                  className="map-marker map-suggested-marker"
                  data-kind="suggested"
                  data-zone={z.id}
                  data-x={suggestion.x}
                  data-y={suggestion.y}
                  role="button"
                  tabIndex={0}
                  aria-label={`${display("موقع مقترح للقياس")} · ${display(z.name)} · ${display("س:")} ${number(suggestion.x)} · ${display("ص:")} ${number(suggestion.y)} ${display("متر محلي")}`}
                  aria-pressed={detail?.kind === "suggested"}
                  aria-describedby={
                    detail?.kind === "suggested"
                      ? `${id}-point-info`
                      : undefined
                  }
                  onClick={() => activate({ zoneId: z.id, kind: "suggested" })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      activate({ zoneId: z.id, kind: "suggested" });
                    }
                  }}
                >
                  <circle
                    cx={suggestion.x}
                    cy={suggestion.y}
                    r="2.3"
                    fill="transparent"
                  />
                  <path
                    className="map-marker-ring"
                    d={`M${suggestion.x} ${suggestion.y - 1.6}l1.6 1.6-1.6 1.6-1.6-1.6Z`}
                    fill="#fff4d5"
                    stroke="#966113"
                    strokeWidth=".4"
                  />
                  <rect
                    x={pinX}
                    y={pinY}
                    width="14"
                    height="3.2"
                    rx=".75"
                    fill="#fffefa"
                    stroke="#b98b31"
                    strokeWidth=".2"
                  />
                  <text
                    x={pinX + 7}
                    y={pinY + 2.1}
                    textAnchor="middle"
                    className="map-pin-label"
                  >
                    {display("موقع مقترح")}
                  </text>
                </g>
              )}
              {!measurementFocus && (
                <text
                  x={z.x + z.width - 1.3}
                  y={z.y + z.height - 1.2}
                  textAnchor="start"
                  className="map-area"
                  pointerEvents="none"
                >
                  {number(z.area_m2)} {display("م²")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {showGaps && (
        <p className="map-overlay-note">
          {display(
            "الخطوط المائلة فجوات تغطية هندسية، وليست تربة جافة أو نسبة ثقة.",
          )}
        </p>
      )}
      <div className="map-point-info" id={`${id}-point-info`} role="status">
        {detail?.kind === "suggested" && where ? (
          <>
            <div>
              <h3>
                <MapPin size={18} />
                {display("الموقع المقترح")} · {display(chosen?.name)}
              </h3>
              <p>
                <bdi>
                  {display("س:")} {number(where.x)} · {display("ص:")}{" "}
                  {number(where.y)}
                </bdi>{" "}
                {display("متر محلي")}
              </p>
              <p>{display(where.reason)}</p>
            </div>
            {onReading && (
              <button className="primary" onClick={onReading}>
                <Microscope size={18} />
                {display("تسجيل قراءة في هذا الموقع")}
              </button>
            )}
          </>
        ) : point && detail ? (
          <div>
            <h3>
              {display(point.name)} ·{" "}
              {display(
                detail.kind === "reading"
                  ? "قراءة محفوظة"
                  : "نقطة بلا قراءة محفوظة",
              )}
            </h3>
            <p>
              {display("س:")} {number(point.x)} · {display("ص:")}{" "}
              {number(point.y)} {display("متر محلي")}
            </p>
            {latest ? (
              <>
                <p>
                  <strong>
                    {readingValue(latest.value)} {unit(latest.unit)}
                  </strong>{" "}
                  · {date(latest.measured_at)} ·{" "}
                  {display(
                    chosen?.decision.readings_used.includes(latest.id)
                      ? "صالحة للقرار"
                      : "غير مستخدمة للقرار",
                  )}
                </p>
                <p>
                  {display("المصدر:")} {display(latest.source || "غير موثق")}
                </p>
              </>
            ) : (
              <p>{display("هذه نقطة مسجلة؛ لا توجد قراءة محفوظة لها.")}</p>
            )}
          </div>
        ) : (
          <p>
            {display(
              focusSuggested && !where
                ? "لا يوجد موقع قياس مقترح صالح في بيانات المنطقة."
                : "اختر دائرة لعرض القراءة، أو المعين الكهرماني لعرض الموقع المقترح.",
            )}
          </p>
        )}
      </div>
      <p className="map-meaning-note">
        {display(
          "لون المنطقة يصف حالتها، ولا يمثل توزيع رطوبة التربة. الموقع المقترح ليس قراءة أو حساسًا.",
        )}
        {measurementFocus && chosen && (
          <span>
            {" "}
            {display("مساحة المنطقة:")} {number(chosen.area_m2)} {display("م²")}
          </span>
        )}
      </p>
    </section>
  );
}
