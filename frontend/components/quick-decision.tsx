"use client";
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Droplets,
  MapPin,
  Microscope,
  ShieldAlert,
} from "lucide-react";
import type { Zone, Recommendation } from "../lib/types";
import { display } from "../lib/i18n";
import { number } from "../lib/api";
import { simpleState } from "./guided-evaluation";
import { waterRisk } from "../lib/water-risk.mjs";
import { suggestedMeasurement } from "../lib/role-home";

export default function QuickDecision({
  zones,
  zone,
  onSelect,
  onReading,
  onDetails,
  onMap,
  onExecute,
  recommendation,
  busy,
  canMeasure,
  outlook,
}: {
  zones: Zone[];
  zone: Zone;
  onSelect: (id: string) => void;
  onReading: () => void;
  onDetails: () => void;
  onMap: () => void;
  onExecute?: () => void;
  recommendation?: Recommendation;
  busy: boolean;
  canMeasure: boolean;
  outlook?: ReactNode;
}) {
  const [proposed, setProposed] = useState("");
  const d = zone.decision,
    status = simpleState(zone),
    next = suggestedMeasurement(zone);
  const needsMeasurement = ["insufficient", "measure", "conflict"].includes(
    d.code,
  );
  const estimate =
    d.code === "review" &&
    d.estimate &&
    Number.isFinite(d.estimate.gross_l) &&
    d.estimate.gross_l >= 0
      ? d.estimate
      : null;
  const canExecute =
    canMeasure &&
    !!estimate &&
    recommendation?.status === "approved" &&
    !!onExecute;
  const primaryLabel = needsMeasurement
    ? canMeasure
      ? "تسجيل قراءة"
      : "عرض متطلبات القياس"
    : canExecute
      ? "تسجيل تنفيذ الري"
      : d.code === "review"
        ? "مراجعة التوصية"
        : "مراجعة حالة المنطقة";
  const primaryAction =
    needsMeasurement && canMeasure
      ? onReading
      : canExecute
        ? onExecute
        : onDetails;
  const hasProposal =
    proposed.trim() !== "" &&
    Number.isFinite(Number(proposed)) &&
    Number(proposed) >= 0;
  const risk = hasProposal
    ? waterRisk(Number(proposed), estimate?.gross_l)
    : "أدخل كمية لمقارنتها بالتقدير";
  return (
    <section
      className="quick-home management-dashboard"
      aria-label={display("قرار الري المبسط")}
    >
      <div className="quick-panel compact-zone-picker">
        <h2>
          <span className="workflow-step">1</span>
          {display("اختر المنطقة")}
        </h2>
        <select
          className="compact-zone-select"
          aria-label={display("اختيار المنطقة")}
          value={zone.id}
          disabled={busy}
          onChange={(event) => {
            onSelect(event.target.value);
            setProposed("");
          }}
        >
          {zones.map((item) => (
            <option key={item.id} value={item.id}>
              {display(item.name)}
            </option>
          ))}
        </select>
        <div
          className="quick-zone-grid"
          role="group"
          aria-label={display("اختيار المنطقة")}
        >
          {zones.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={zone.id === item.id}
              className={`quick-zone-choice ${zone.id === item.id ? "is-selected" : ""}`}
              disabled={busy}
              onClick={() => {
                onSelect(item.id);
                setProposed("");
              }}
            >
              <strong>{display(item.name)}</strong>
            </button>
          ))}
        </div>
      </div>
      {outlook && (
        <>
          <div className="planning-primary">
            <div>
              <strong>{display(status.title)}</strong>
              <p>{display(status.text)}</p>
            </div>
            <button className="primary" disabled={busy} onClick={primaryAction}>
              {display(primaryLabel)}
            </button>
            <button onClick={onMap}>{display("أين أقيس؟")}</button>
          </div>
          {outlook}
        </>
      )}
      <DecisionDetails optional={!!outlook}>
        <div className="quick-result compact-zone-result" aria-live="polite">
          <div className="management-status-heading">
            <div>
              <p className="management-eyebrow">
                <span className="workflow-step">2</span>
                {display("حالة المنطقة")}
              </p>
              <h2>{display(zone.name)}</h2>
            </div>
            <span className={`quick-status-code code-${d.code}`}>
              {display(status.title)}
            </span>
          </div>
          <p className="quick-state-explain">{display(status.text)}</p>
          <div className="management-facts">
            <div>
              <span>{display("رطوبة التربة")}</span>
              <strong>
                {d.mean_vwc === null
                  ? display("غير متاح")
                  : `${number(d.mean_vwc * 100)}%`}
              </strong>
              <small>{display("متوسط القراءات الصالحة، وليس كل التربة")}</small>
            </div>
            <div>
              <span>{display("الاحتياج المائي المحسوب")}</span>
              <strong>
                {estimate
                  ? `${number(estimate.gross_l)} ${display("لتر")}`
                  : display("غير متاح")}
              </strong>
              <small>
                {display(
                  estimate
                    ? "تقدير مشروط وليس أمر ري"
                    : "يتطلب بيانات كافية وافتراضات صالحة",
                )}
              </small>
            </div>
            <div>
              <span>{display("نقاط بقراءات صالحة:")}</span>
              <strong>
                {number(d.coverage.active_points)} /{" "}
                {number(d.coverage.total_points)}
              </strong>
              <small>{display("التغطية الهندسية ليست نسبة ثقة")}</small>
            </div>
          </div>
          <div className="quick-next compact-next-action">
            <div>
              <p className="management-eyebrow">
                <span className="workflow-step">3</span>
                {display("الخطوة التالية")}
              </p>
              <strong>
                {display(
                  needsMeasurement
                    ? "أكمل القياس قبل قرار الري"
                    : canExecute
                      ? "سجّل العملية بعد تنفيذها في المحاكاة"
                      : "راجع حالة المنطقة قبل أي إجراء",
                )}
              </strong>
            </div>
            <div className="quick-buttons">
              <button
                className="primary"
                disabled={busy}
                onClick={primaryAction}
                data-testid="zone-next-action"
              >
                {needsMeasurement ? (
                  <Microscope size={19} />
                ) : (
                  <Droplets size={19} />
                )}{" "}
                {display(primaryLabel)}
                <ArrowLeft size={16} />
              </button>
              {canMeasure && !needsMeasurement && (
                <button disabled={busy} onClick={onReading}>
                  <Microscope size={18} />
                  {display("تسجيل قراءة")}
                </button>
              )}
              <button onClick={onMap}>
                <MapPin size={18} />
                {display(
                  next && needsMeasurement ? "أين أقيس؟" : "عرض الخريطة",
                )}
              </button>
            </div>
          </div>
          {canMeasure && next && (
            <p className="management-location">
              <MapPin size={17} />
              <span>
                {display(
                  needsMeasurement
                    ? "الموقع التالي المقترح للقياس"
                    : "موقع قياس اختياري",
                )}
                :{" "}
                <bdi>
                  {display("س:")} {number(next.x)} · {display("ص:")}{" "}
                  {number(next.y)}
                </bdi>{" "}
                {display("متر محلي")}
              </span>
            </p>
          )}
          <details className="management-details">
            <summary>{display("تفاصيل القرار والقياسات")}</summary>
            <p>{display(d.reason)}</p>
            <p>
              {display("المتطلبات الناقصة:")}{" "}
              {display(d.missing.join("، ") || "لا توجد وفق القواعد الحالية")}
            </p>
            <p>{display(d.coverage.caveat)}</p>
            <p>{display(d.validity)}</p>
            {canMeasure && !next && (
              <p>
                {display(
                  "لا يوجد موقع قياس مقترح صالح في البيانات الحالية. افتح تفاصيل المنطقة لتراجع نقاط القياس المحفوظة.",
                )}
              </p>
            )}
            <button onClick={onDetails}>
              {display("افتح سجل المنطقة وجميع الإجراءات")}
            </button>
          </details>
        </div>
        <details className="quick-optional">
          <summary>
            {display("هل كمية الري التي أفكر بها أكبر من التقدير؟ (اختياري)")}
          </summary>
          <p>
            {display(
              "مقارنة حسابية فقط، وليست إثباتًا لهدر ماء أو توصية بتنفيذ الري.",
            )}
          </p>
          <label htmlFor="quick-proposal">
            {display("كمية الري التي تريد مقارنتها (لتر)")}
          </label>
          <input
            id="quick-proposal"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
            placeholder={display("مثال: 500")}
          />
          <p role="status">
            <ShieldAlert size={16} />
            {display(risk)}
          </p>
          <small>
            {display(
              "لا تُحفظ هذه القيمة ولا تُستخدم في التنفيذ أو تقارير المياه.",
            )}
          </small>
          <p>
            {display("هل حدث هدر للماء؟")}{" "}
            <strong>{display("غير مثبت")}</strong>.{" "}
            {display("لا نحسب الهدر الفعلي من القراءات وحدها")}
          </p>
        </details>
        <details className="management-data-info">
          <summary>{display("البيانات والافتراضات")}</summary>
          <p>
            {display(
              "الأرقام والحالات من محرك أنبت وقراءات المحاكاة الحالية. طقس حي: غير متاح. المناخ العام للمدن لا يغيّر قرار الري.",
            )}
          </p>
          <p>
            {display(
              "الإحداثيات بالمتر داخل مخطط الموقع، وليست GPS. الموقع المقترح ليس قراءة أو حساسًا.",
            )}
          </p>
        </details>
      </DecisionDetails>
    </section>
  );
}
function DecisionDetails({
  optional,
  children,
}: {
  optional: boolean;
  children: ReactNode;
}) {
  return optional ? (
    <details className="planning-existing-details">
      <summary>{display("تفاصيل حالة المنطقة والحساب الحالي")}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
