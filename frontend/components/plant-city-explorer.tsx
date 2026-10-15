"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Info, MapPin, Sprout, ArrowDown } from "lucide-react";
import { display } from "../lib/i18n";
import data from "../data/plant-city.json";
import {
  assessmentLabels,
  cityResults,
  plantNames,
  cityNames,
} from "../lib/plant-city.mjs";
import GardenIllustration from "./garden-illustration";
import GrowingGuide, { guideForPlant, careText } from "./growing-guide";

export default function PlantCityExplorer({
  journey = false,
}: {
  journey?: boolean;
}) {
  const [city, setCity] = useState("");
  const [plantId, setPlantId] = useState<number | null>(null);
  const id = useId();
  const selected =
    plantId === null
      ? null
      : cityResults(data, Number(city)).find((r) => r.plant_id === plantId);
  const guideRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (plantId !== null) {
      guideRef.current?.focus({ preventScroll: true });
      guideRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    }
  }, [plantId]);
  function choosePlant(next: number) {
    if (next === plantId) {
      guideRef.current?.focus({ preventScroll: true });
      guideRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    }
    setPlantId(next);
  }
  return (
    <section
      className="plant-explorer plant-discovery"
      aria-label={display("استكشاف النباتات والعناية")}
    >
      <section className="plant-picker-bar" aria-labelledby={`${id}-city`}>
        <div className="plant-picker-heading">
          {journey ? <GardenIllustration /> : <Sprout size={34} aria-hidden />}
          <div>
            <h2 id={`${id}-city`}>1. {display("اختر مدينتك")}</h2>
            <p>
              {data.cities.length} {display("مدينة")} · {data.plants.length}{" "}
              {display("نباتًا للاستكشاف")}
            </p>
          </div>
        </div>
        <label className="explorer-selector">
          {display("المدينة")}
          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setPlantId(null);
            }}
          >
            <option value="">{display("اختر مدينة لعرض النباتات")}</option>
            {data.cities.map((c) => (
              <option key={c.id} value={c.id}>
                {display(cityNames[c.id])}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section
        className="choose-plant"
        ref={cardsRef}
        tabIndex={-1}
        aria-labelledby={`${id}-plants`}
      >
        <h2 id={`${id}-plants`}>2. {display("اختر نباتك")}</h2>
        {!city ? (
          <p className="plant-empty" role="status">
            <MapPin size={20} aria-hidden />
            {display("اختر مدينتك لتظهر النباتات ومعلومات زراعتها.")}
          </p>
        ) : (
          <PlantMatches
            cityId={Number(city)}
            onChoose={choosePlant}
            selectedId={plantId}
            guideId={`${id}-guide`}
          />
        )}
      </section>
      <section
        className="plant-growing-section"
        ref={guideRef}
        id={`${id}-guide`}
        tabIndex={-1}
        aria-labelledby={`${id}-grow-title`}
      >
        <div className="care-navigation">
          <h2 id={`${id}-grow-title`}>3. {display("كيف تزرعه؟")}</h2>
          {selected && (
            <button
              onClick={() => {
                cardsRef.current?.focus({ preventScroll: true });
                cardsRef.current?.scrollIntoView({
                  behavior: "auto",
                  block: "start",
                });
              }}
            >
              {display("اختيار نبات آخر")}
            </button>
          )}
        </div>
        {selected && plantId !== null ? (
          <GrowingGuide
            key={plantId}
            plantId={plantId}
            name={plantNames[plantId]}
            city={cityNames[Number(city)]}
            suitability={assessmentLabels[selected.score]}
          />
        ) : (
          <p className="plant-empty">
            <ArrowDown size={20} aria-hidden />
            {display(
              "اختر نباتًا وافتح كيفية الزراعة لعرض خطواته والعناية به.",
            )}
          </p>
        )}
      </section>
      <PlantDataInfo id={`${id}-info`} assessment={selected ?? undefined} />
    </section>
  );
}

export function PlantDataInfo({
  id,
  assessment,
}: {
  id?: string;
  assessment?: (typeof data.assessments)[number];
}) {
  return (
    <details className="explorer-provenance discovery-info" id={id}>
      <summary>
        <Info size={17} aria-hidden />
        {display("المصدر وكيفية قراءة التقييم")}
      </summary>
      <p>
        {display(
          "مقارنة قواعدية للحرارة والرطوبة الجوية من مقتطف ENBT.db غير متحقق مستقلًا: 50 نقطة لكل معيار مطابق، وليست نسبة نجاح أو دقة. لا تشمل التربة أو الملوحة أو الموسم أو ظروف حديقتك.",
        )}
      </p>
      <p>
        {display(
          "الرطوبة الجوية ليست رطوبة التربة. وحدات المناخ وفتراته ومنشئ البيانات وترخيصها غير موثقة مستقلًا؛ لم ننقل سجلات الري أو نستخدمها في حساباته.",
        )}
      </p>
      {assessment && (
        <p>
          {display(plantNames[assessment.plant_id])} ·{" "}
          <bdi>
            {data.plants.find((p) => p.id === assessment.plant_id)?.name}
          </bdi>{" "}
          · {assessment.score}/100 {display("مؤشر ملاءمة قواعدي")}
          <br />
          {display("معيار الحرارة:")}{" "}
          {display(
            assessment.temperature_match
              ? "يطابق النطاق المسجل"
              : "لا يطابق النطاق المسجل",
          )}
          <br />
          {display("معيار الرطوبة الجوية:")}{" "}
          {display(
            assessment.air_humidity_match
              ? "يطابق النطاق المسجل"
              : "لا يطابق النطاق المسجل",
          )}
        </p>
      )}
      <p>
        {display(
          "دليل العناية مستقل عن نقاط الملاءمة، وله مراجع زراعية مرتبطة داخل كل نبات. لا تتوفر مواعيد محلية موثقة لكل مدينة أو وصفة ري ثابتة.",
        )}
      </p>
    </details>
  );
}

export function PlantMatches({
  cityId,
  onChoose,
  selectedId,
  guideId,
}: {
  cityId: number;
  onChoose?: (id: number) => void;
  selectedId?: number | null;
  guideId?: string;
}) {
  const results = cityResults(data, cityId);
  if (!results.length)
    return (
      <p role="status">
        {display("لا توجد معلومات لهذه المدينة؛ اختر مدينة من القائمة.")}
      </p>
    );
  return (
    <>
      <p className="plant-results-status" role="status">
        <strong>{display(cityNames[cityId])}</strong> · {results.length}{" "}
        {display("نباتًا · ترتيب تنازلي حسب نقاط التقييم القواعدي")}
      </p>
      <div className="explorer-results">
        {results.map((r) => {
          const guide = guideForPlant(r.plant_id);
          return (
            <article
              className="plant-match"
              key={r.id}
              data-score={r.score}
              data-selected={selectedId === r.plant_id}
            >
              <div className="plant-match-heading">
                <span className="plant-match-icon">
                  <Sprout size={24} aria-hidden />
                </span>
                <h3>{display(plantNames[r.plant_id])}</h3>
              </div>
              <p className="plant-category" data-score={r.score}>
                {display(assessmentLabels[r.score])}
              </p>
              {guide && (
                <p className="plant-description">
                  {careText(guide.description)}
                </p>
              )}
              {onChoose ? (
                <button
                  className="care-open primary"
                  onClick={() => onChoose(r.plant_id)}
                  aria-controls={guideId}
                  aria-label={`${display("كيفية الزراعة")}: ${display(plantNames[r.plant_id])}`}
                >
                  {display("كيفية الزراعة")}
                </button>
              ) : (
                <details className="plant-match-details">
                  <summary>
                    {display("كيفية الزراعة")} ·{" "}
                    {display(plantNames[r.plant_id])}
                  </summary>
                  <GrowingGuide
                    plantId={r.plant_id}
                    name={plantNames[r.plant_id]}
                    city={cityNames[cityId]}
                    suitability={assessmentLabels[r.score]}
                  />
                </details>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
