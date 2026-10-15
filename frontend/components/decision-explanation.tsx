"use client";
import { display } from "../lib/i18n";
import { useState } from "react";
import { Zone } from "../lib/types";
import { number, date } from "../lib/api";
import { waterRisk } from "../lib/water-risk.mjs";

export default function DecisionExplanation({
  zone,
  emptyLabel = "غير متاح",
  compact = false,
}: {
  zone: Zone;
  emptyLabel?: string;
  compact?: boolean;
}) {
  const [proposed, setProposed] = useState("");
  const d = zone.decision,
    e = d.estimate;
  return (
    <section
      className="decision-explanation"
      aria-label={display("حالة التربة وتقدير الماء")}
    >
      <h3>
        {display(
          d.soil_condition ?? "لا تتوفر بيانات كافية لتحديد حالة التربة.",
        )}
      </h3>
      <p>
        {display(
          zone.origin === "simulation"
            ? "التقييم من قراءات محاكاة محفوظة، وليس قياسًا ميدانيًا."
            : "التقييم من القراءات المحفوظة المقبولة وفق قواعد المنطقة.",
        )}
        {display(" ")}
        {display(" لا يصف نتيجة سيناريو افتراضي. ")}
      </p>
      <p>
        {display(" كمية الري الحسابية: ")}
        {display(" ")}
        <strong>{display(e ? `${number(e.gross_l)} لتر` : emptyLabel)}</strong>
      </p>
      <p>{display(" تقدير حسابي مشروط، وليس كمية ري معتمدة ميدانيًا. ")}</p>
      {display(
        !e && (
          <p>
            {display(
              " لا تُحسب كمية إلا عند تبرير مراجعة الري واكتمال متطلبات القياس والمعايرة وتمثيل الجذور والمساحة والعمق والكفاءة. ",
            )}
          </p>
        ),
      )}
      <details>
        <summary>{display(" الحدود والوحدات والافتراضات ")}</summary>
        <p>
          {display(" الأدنى / المستهدف / الأعلى: ")}
          {display(" ")}
          {display(
            zone.soil
              ? `${number(zone.soil.lower_vwc * 100)}% / ${number(zone.soil.target_vwc * 100)}% / ${number(zone.soil.upper_vwc * 100)}% حجمية`
              : emptyLabel,
          )}
          .{display(" ")}
          {display(
            zone.soil?.calibration === "field_validated"
              ? "معايرة حقلية وفق الملف المحفوظ."
              : "حدود إعدادات تجريبية؛ لا تثبت الحالة المثالية أو التشبع.",
          )}
        </p>
        <p>
          {display(
            " الحالة الأعلى تعني تجاوز قراءة للحد الأعلى؛ الحالة الأقل تعتمد على المتوسط. عند كفاية البيانات، المساواة بالحدود تُعد ضمن النطاق. ",
          )}
        </p>
        {display(
          e && (
            <>
              <p>{display(e.formula)}</p>
              <p>
                {display(" المساحة ")}
                {display(number(e.area_m2))}
                {display(" م²؛ عمق الجذور ")}
                {display(" ")}
                {display(number(e.root_depth_m))}
                {display(" م؛ الكفاءة ")}
                {display(number(e.efficiency))}
                {display(" (كسر بين 0 و1). ")}
              </p>
              <p>
                {display(" VWC الحالي ")}
                {display(number(e.current_vwc))}
                {display(" والمستهدف ")}
                {display(" ")}
                {display(number(e.target_vwc))}
                {display(" كسرًا حجميًا؛ الفرق لا يقل عن صفر. صافي الماء ")}
                {display(number(e.net_l))}
                {display(" لتر، والإجمالي بعد الكفاءة ")}
                {display(" ")}
                {display(number(e.gross_l))}
                {display(" لتر. ")}
              </p>
            </>
          ),
        )}
        <p>{display(d.coverage.caveat)}</p>
        <p>
          {display(" المتطلبات الناقصة: ")}
          {display(" ")}
          {display(d.missing.join("، ") || "لا توجد وفق القواعد الحالية")}.
        </p>
        <p>
          {display(" آخر تقييم: ")}
          {display(date(d.evaluated_at))}
          {display(
            " . المقارنة تعتمد على قراءات قبل أي ري لاحق، وتتطلب تحديث القياس بعد التنفيذ. افتراض تجانس المنطقة وتمثيل عمق الجذور يحتاج تحققًا. ",
          )}
        </p>
      </details>
      <details>
        <summary>{display(" هل تتجاوز كمية مقترحة هذا التقدير؟ ")}</summary>
        <label>
          {display(" كمية مقترحة للمقارنة فقط (لتر) ")}
          <input
            type="number"
            min="0"
            step="any"
            value={proposed}
            onChange={(event) => setProposed(event.target.value)}
            placeholder={display("أدخل كمية اختيارية")}
          />
        </label>
        <p role="status">
          {display(
            waterRisk(proposed === "" ? null : Number(proposed), e?.gross_l),
          )}
        </p>
        <p>
          {display(
            " مقارنة بالرقم المعروض المقرّب إلى 0.1 لتر، تحت الافتراضات نفسها، وليست إثباتًا لوجود إفراط أو أمان الري. لا تُقيّم عملية سابقة ولا تحسب هدرًا أو وفرًا. هذه الكمية لا تُحفظ ولا تُرسل للتنفيذ؛ الاستهلاك المسجل يظهر في سجل التنفيذ وتقارير المياه. ",
          )}
        </p>
      </details>
      <p className="footnote">
        {display(
          compact
            ? "لا اتصال بطقس حي؛ بيانات المدن لا تعدّل حساب التربة."
            : " الطقس الحي والمتوقع: غير متاح. مناخ المدن في دليل النباتات سياق عام مستقل؛ الرطوبة الجوية ليست رطوبة تربة ولا تعدّل هذا الحساب. ",
        )}
      </p>
    </section>
  );
}
