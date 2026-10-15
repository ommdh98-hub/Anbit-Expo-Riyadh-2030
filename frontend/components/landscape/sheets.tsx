"use client";
import { useState, type FormEvent } from "react";
import { api, post } from "../../lib/api";
import { suggestedMeasurement } from "../../lib/role-home";
import type { Zone } from "../../lib/types";
import { useLandscape } from "./context";
import { useCopy } from "./copy";
import { Sheet } from "./visuals";

const riyadhNow = () => {
  const d = new Date(Date.now() + 3 * 3_600_000);
  return d.toISOString().slice(0, 16);
};

export function ReadingSheet({ open, onClose, zone }: { open: boolean; onClose: () => void; zone: Zone }) {
  const c = useCopy();
  const { profile, refresh } = useLandscape();
  const suggested = suggestedMeasurement(zone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const point = String(f.get("point"));
    const at = String(f.get("time") || riyadhNow());
    setBusy(true);
    setError("");
    try {
      await api(
        `/zones/${zone.id}/measurements`,
        post({
          id: crypto.randomUUID(),
          ...(point === "suggested" && suggested ? { x: suggested.x, y: suggested.y } : { point_id: point }),
          value: Number(f.get("value")),
          unit: "vwc_percent",
          measured_at: new Date(`${at}:00+03:00`).toISOString(),
          source: "قياس يدوي ضمن المحاكاة",
          operator: profile.name,
          // Verified field readings need evidence; outside the simulation they stay unverified.
          quality: zone.origin === "simulation" ? "verified" : "unverified",
          origin: zone.origin,
        }),
      );
      await refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ القراءة");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={c.t("تسجيل قراءة", "Record a reading")}>
      <form className="lx-form" onSubmit={submit}>
        <label>
          {c.t("الموقع", "Location")}
          <select name="point" defaultValue={suggested ? "suggested" : zone.points[0]?.id}>
            {suggested && <option value="suggested">{c.t("النقطة المقترحة", "Suggested point")}</option>}
            {zone.points.map((p) => (
              <option key={p.id} value={p.id}>
                {c.show(p.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {c.t("رطوبة التربة (% حجمية)", "Soil moisture (% VWC)")}
          <input name="value" type="number" inputMode="decimal" min={0} max={100} step={0.1} required dir="ltr" />
        </label>
        <label>
          {c.t("وقت القراءة (الرياض)", "Reading time (Riyadh)")}
          <input name="time" type="datetime-local" defaultValue={riyadhNow()} max={riyadhNow()} dir="ltr" />
        </label>
        {error && (
          <p role="alert" className="lx-error">
            {c.show(error)}
          </p>
        )}
        <button className="lx-primary" disabled={busy}>
          {busy ? c.t("لحظة…", "One moment…") : c.t("حفظ القراءة", "Save reading")}
        </button>
      </form>
    </Sheet>
  );
}

export function WhereSheet({ open, onClose, zone }: { open: boolean; onClose: () => void; zone: Zone }) {
  const c = useCopy();
  const p = suggestedMeasurement(zone);
  const pad = 2;
  return (
    <Sheet open={open} onClose={onClose} title={c.t("أين أقيس؟", "Where to measure?")}>
      <svg
        className="lx-sketch"
        viewBox={`${zone.x - pad} ${zone.y - pad} ${zone.width + pad * 2} ${zone.height + pad * 2}`}
        role="img"
        aria-label={c.t("رسم مبسط للمنطقة مع النقطة المقترحة", "Simple zone sketch with the suggested point")}
      >
        <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} rx={Math.min(zone.width, zone.height) * 0.12} />
        {zone.points.map((pt) => (
          <circle key={pt.id} className="lx-sketch-point" cx={pt.x} cy={pt.y} r={Math.max(zone.width, zone.height) * 0.018} />
        ))}
        {p && (
          <g className="lx-sketch-target">
            <circle cx={p.x} cy={p.y} r={Math.max(zone.width, zone.height) * 0.07} />
            <circle cx={p.x} cy={p.y} r={Math.max(zone.width, zone.height) * 0.028} />
          </g>
        )}
      </svg>
      <p className="lx-sheet-lead">
        {p
          ? c.show(zone.decision.coverage.next_point.reason)
          : c.t("النقاط الحالية تغطي المنطقة. قِس في أقدم نقطة.", "Current points cover the zone. Measure at the oldest point.")}
      </p>
      <p className="lx-caption">{c.t("على عمق الجذور، بعيدًا عن الرشاشات والممرات.", "At root depth, away from sprinklers and paths.")}</p>
    </Sheet>
  );
}
