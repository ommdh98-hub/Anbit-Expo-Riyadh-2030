"use client";
import { useState } from "react";
import { Layers, MapPin } from "lucide-react";
import { Zone } from "../lib/types";
import { number } from "../lib/api";
export default function SiteMap({
  zones,
  selected,
  onSelect,
  large = false,
}: {
  zones: Zone[];
  selected: string;
  onSelect: (id: string) => void;
  large?: boolean;
}) {
  const [gaps, setGaps] = useState(true);
  const focus = zones.length === 1 ? zones[0] : null;
  const box = focus
    ? `${focus.x - 2} ${focus.y - 2} ${focus.width + 4} ${focus.height + 4}`
    : "0 0 88 57";
  return (
    <section className={`panel map-panel ${large ? "large-map" : ""}`}>
      <div className="section-title">
        <div>
          <h2>خريطة القياسات</h2>
          <p>مخطط توضيحي • إحداثيات محلية بالمتر</p>
        </div>
        <button
          className={`small ${gaps ? "selected" : ""}`}
          onClick={() => setGaps(!gaps)}
          aria-pressed={gaps}
        >
          <Layers size={16} />
          فجوات القياس
        </button>
      </div>
      <svg
        className="site-map"
        viewBox={box}
        role="group"
        aria-label="مخطط حديقة أنبت التجريبية؛ اختر منطقة لعرض تفاصيلها"
      >
        <defs>
          <pattern
            id="gap-hatch"
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
              stroke="#c6973c"
              strokeWidth=".2"
            />
          </pattern>
          <pattern
            id="map-dots"
            width="2"
            height="2"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".055" fill="#d2d7c8" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="88" height="57" rx="2" fill="#efeee5" />
        <rect x="1" y="1" width="86" height="55" fill="url(#map-dots)" />
        <path
          d="M2 27 H85 M35 2 V27 M60 2 V27 M43 28 V53"
          stroke="#fffdf7"
          strokeWidth="2.5"
          fill="none"
        />
        {zones.map((z) => {
          const chosen = selected === z.id;
          const active = new Set(z.decision.readings_used);
          return (
            <g
              key={z.id}
              tabIndex={0}
              role="button"
              aria-label={`${z.name}، ${z.decision.label}`}
              onClick={() => onSelect(z.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(z.id);
                }
              }}
              className="map-zone"
            >
              <rect
                x={z.x}
                y={z.y}
                width={z.width}
                height={z.height}
                rx="1.1"
                fill={chosen ? "#d9e2ca" : "#e3e8d6"}
                stroke={chosen ? "#234D36" : "#becbab"}
                strokeWidth={chosen ? ".45" : ".2"}
              />
              {gaps &&
                z.decision.coverage.uncovered_cells.map((p, i) => (
                  <rect
                    key={i}
                    x={p.x - z.width / 40}
                    y={p.y - z.height / 40}
                    width={z.width / 20}
                    height={z.height / 20}
                    fill="url(#gap-hatch)"
                    pointerEvents="none"
                  />
                ))}
              <rect
                x={z.x + 1.5}
                y={z.y + 1.1}
                width={z.width - 3}
                height="4.6"
                rx=".7"
                fill="#fffdf5"
                opacity=".93"
              />
              <text
                x={z.x + z.width / 2}
                y={z.y + 4.3}
                textAnchor="middle"
                className="map-label"
              >
                {z.name}
              </text>
              {z.points.map((p) => {
                const latest = z.measurements.find((m) => m.point_id === p.id);
                const valid = latest && active.has(latest.id);
                return (
                  <g key={p.id}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r=".85"
                      fill={valid ? "#487e89" : "#a1a29a"}
                      stroke="white"
                      strokeWidth=".35"
                    />
                    <title>
                      {p.name}:{" "}
                      {latest
                        ? `${latest.value} ${latest.unit}`
                        : "لا توجد قراءة"}
                    </title>
                  </g>
                );
              })}
              {chosen && gaps && (
                <g>
                  <circle
                    cx={z.decision.coverage.next_point.x}
                    cy={z.decision.coverage.next_point.y}
                    r="1.5"
                    fill="#fff7e7"
                    stroke="#b67d1d"
                    strokeWidth=".3"
                    strokeDasharray=".5 .3"
                  />
                  <path
                    d={`M${z.decision.coverage.next_point.x - 0.6} ${z.decision.coverage.next_point.y} h1.2 M${z.decision.coverage.next_point.x} ${z.decision.coverage.next_point.y - 0.6} v1.2`}
                    stroke="#b67d1d"
                    strokeWidth=".2"
                  />
                </g>
              )}
              <text
                x={z.x + z.width - 1.5}
                y={z.y + z.height - 1.4}
                textAnchor="start"
                className="map-area"
              >
                {number(z.area_m2)} م²
              </text>
            </g>
          );
        })}
        {!focus && (
          <text x="83" y="55" className="map-area">
            حديقة تجريبية — ليست خريطة إكسبو
          </text>
        )}
      </svg>
      <div className="legend">
        <span>
          <i className="dot blue" />
          قراءة صالحة
        </span>
        <span>
          <i className="dot gray" />
          تحتاج تحديثًا
        </span>
        <span>
          <i className="hatch" />
          فجوة هندسية
        </span>
        <span>
          <MapPin size={14} />
          فحص مقترح
        </span>
      </div>
    </section>
  );
}
