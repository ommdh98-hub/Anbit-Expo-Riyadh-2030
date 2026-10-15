"use client";
import { ClipboardCheck, MapPin, Microscope } from "lucide-react";
import type { Zone } from "../lib/types";
import { display } from "../lib/i18n";
import { number } from "../lib/api";
import { measurementStatus, suggestedMeasurement } from "../lib/role-home";
import { simpleState } from "./guided-evaluation";
import SiteMap from "./site-map";
import GardenIllustration from "./garden-illustration";

export default function SurveyHome({
  zones,
  zone,
  onSelect,
  onReading,
  onDetails,
  busy,
  feedback,
}: {
  zones: Zone[];
  zone: Zone;
  onSelect: (id: string) => void;
  onReading: () => void;
  onDetails: () => void;
  busy: boolean;
  feedback: string;
}) {
  const d = zone.decision,
    p = suggestedMeasurement(zone);
  const needsMeasurement = ["insufficient", "measure", "conflict"].includes(
    d.code,
  );
  return (
    <section
      className="survey-home"
      aria-label={display("واجهة قياسات فرق المسطحات الخضراء")}
    >
      <div className="role-home-intro">
        <p>
          {display(
            "اختر المنطقة، افحص الموقع المقترح، ثم أدخل القراءة التي قستها.",
          )}{" "}
          <small>
            {display("بيانات الموقع الحالي محاكاة؛ لا توجد حساسات متصلة.")}
          </small>
        </p>
        <GardenIllustration />
      </div>
      <section className="quick-panel role-zone-picker">
        <h2>{display("اختر منطقة القياس")}</h2>
        <div
          className="quick-zone-grid"
          role="group"
          aria-label={display("اختيار المنطقة")}
        >
          {zones.map((item) => (
            <button
              key={item.id}
              className={`quick-zone-choice ${item.id === zone.id ? "is-selected" : ""}`}
              aria-pressed={item.id === zone.id}
              disabled={busy}
              onClick={() => onSelect(item.id)}
            >
              <strong>{display(item.name)}</strong>
              <small>{display(measurementStatus(item))}</small>
            </button>
          ))}
        </div>
      </section>
      <section
        className="quick-result survey-current"
        aria-live="polite"
        aria-label={display("المنطقة المحددة")}
      >
        <div className="survey-action-heading">
          <div>
            <h2>{display(zone.name)}</h2>
            <p className="survey-status">{display(measurementStatus(zone))}</p>
          </div>
          <button className="primary" onClick={onReading} disabled={busy}>
            <Microscope size={19} />
            {display("تسجيل قراءة")}
          </button>
        </div>
        <p>{display(simpleState(zone).text)}</p>
        {feedback && (
          <p className="survey-feedback" role="status">
            {display(feedback)}
          </p>
        )}
        <div className="survey-location">
          <MapPin size={22} />
          <div>
            <h3>
              {display(
                needsMeasurement
                  ? "الموقع التالي المقترح للقياس"
                  : "موقع قياس اختياري",
              )}
            </h3>
            {p ? (
              <>
                <p>
                  {display("س:")} {number(p.x)} {display("م، ص:")} {number(p.y)}{" "}
                  {display("م.")}
                </p>
                <p>{display(p.reason)}</p>
              </>
            ) : (
              <p>
                {display(
                  "لا يوجد موقع قياس مقترح صالح في البيانات الحالية. افتح تفاصيل المنطقة لتراجع نقاط القياس المحفوظة.",
                )}
              </p>
            )}
            <small>
              {display(
                "الإحداثيات بالمتر داخل مخطط الموقع، وليست GPS. الموقع المقترح ليس قراءة أو حساسًا.",
              )}
            </small>
          </div>
        </div>
        <details className="survey-details">
          <summary>{display("ما المعلومات المتاحة وما الذي ينقص؟")}</summary>
          <p>
            {display("نقاط بقراءات صالحة:")} {number(d.coverage.active_points)}{" "}
            {display("من")} {number(d.coverage.total_points)}.
          </p>
          <p>{display(d.reason)}</p>
          <p>
            {display("المتطلبات الناقصة:")}{" "}
            {display(d.missing.join("، ") || "لا توجد وفق القواعد الحالية")}
          </p>
          <p>
            {display("القراءات المستبعدة:")}{" "}
            {display(d.rejected.map((r) => r.reason).join("، ") || "لا يوجد")}
          </p>
          <p>{display(d.coverage.caveat)}</p>
          <p>{display(d.validity)}</p>
          <button onClick={onDetails}>
            <ClipboardCheck size={16} />
            {display("سجل القياسات والفحوصات")}
          </button>
        </details>
      </section>
      <details className="survey-optional-map">
        <summary>
          {display("خريطة مواقع القراءات والموقع المقترح (اختياري)")}
        </summary>
        <SiteMap
          key={zone.id}
          zones={[zone]}
          selected={zone.id}
          onSelect={onSelect}
          measurementFocus
        />
      </details>
    </section>
  );
}
