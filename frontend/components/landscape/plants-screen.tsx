"use client";
import { useEffect, useState } from "react";
import PlantCityExplorer from "../plant-city-explorer";
import { api } from "../../lib/api";
import { useCopy, type Copy } from "./copy";
import { waterClass } from "./data";
import { ScreenHeader } from "./shell";

type LandscapePlant = {
  plant_id: number;
  name_ar: string;
  name_en: string;
  use_case: string;
  category: string;
  kc_summer: number;
  kc_winter: number;
  root_zone_m: number;
  irrigation_method: string;
  wucols_class: string | null;
  sources: string;
};
type Filter = "all" | "landscape";

const levelText = (c: Copy, level: string) =>
  ({ high: c.t("مرتفع", "High"), moderate: c.t("متوسط", "Moderate"), low: c.t("منخفض", "Low"), "low-moderate": c.t("منخفض إلى متوسط", "Low to moderate"), very_low: c.t("منخفض جدًا", "Very low") })[level] ?? level;
const categoryText = (c: Copy, category: string) =>
  ({
    turf_warm: c.t("نجيل دافئ", "Warm-season turf"),
    turf_cool: c.t("نجيل بارد", "Cool-season turf"),
    palm: c.t("نخيل", "Palm"),
    tree: c.t("أشجار", "Trees"),
    shrub: c.t("شجيرات", "Shrubs"),
    groundcover: c.t("غطاء أرضي", "Ground cover"),
    ornamental_grass: c.t("أعشاب زينة", "Ornamental grass"),
  })[category] ?? category;

// The existing explorer, unchanged, plus a landscape filter from the reference database.
export default function PlantsScreen() {
  const c = useCopy();
  const [filter, setFilter] = useState<Filter>("all");
  const [plants, setPlants] = useState<LandscapePlant[] | null>(null);
  useEffect(() => {
    if (filter !== "landscape" || plants) return;
    let live = true;
    api<{ plants: LandscapePlant[] }>("/reference/landscape-plants")
      .then((r) => live && setPlants(r.plants))
      .catch(() => live && setPlants([]));
    return () => {
      live = false;
    };
  }, [filter, plants]);
  return (
    <div className="lx-screen lx-plants">
      <ScreenHeader
        title={c.t("النباتات والمدن", "Plants & Cities")}
        lead={c.t("اختر مدينة، ثم نباتًا يناسبها.", "Pick a city, then a plant that suits it.")}
      />
      <div className="lx-segment" role="group" aria-label={c.t("عرض النباتات", "Plant view")}>
        {(["all", "landscape"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? c.t("كل النباتات", "All plants") : c.t("نباتات المسطحات الخضراء", "Landscape plants")}
          </button>
        ))}
      </div>
      {filter === "all" ? (
        <div className="lx-plants-body">
          <PlantCityExplorer />
        </div>
      ) : (
        <section className="lx-card lx-zone-table" aria-live="polite">
          {plants == null ? (
            <p role="status">{c.t("نجهّز القائمة…", "Loading…")}</p>
          ) : plants.length === 0 ? (
            <p>{c.t("القاعدة المرجعية غير مثبتة على هذا الخادم.", "The reference database is not installed on this server.")}</p>
          ) : (
            <table>
              <caption>{c.t("نباتات المسطحات الخضراء (القاعدة المرجعية)", "Landscape plants (reference database)")}</caption>
              <thead>
                <tr>
                  <th scope="col">{c.t("النبات", "Plant")}</th>
                  <th scope="col">{c.t("الفئة", "Category")}</th>
                  <th scope="col">{c.t("Kc صيفًا", "Kc summer")}</th>
                  <th scope="col">{c.t("Kc شتاءً", "Kc winter")}</th>
                  <th scope="col">{c.t("الاحتياج المائي", "Water use")}</th>
                  <th scope="col">{c.t("الري", "Irrigation")}</th>
                </tr>
              </thead>
              <tbody>
                {plants.map((p) => {
                  const w = waterClass(p);
                  return (
                    <tr key={p.plant_id}>
                      <th scope="row">{c.ar ? p.name_ar : p.name_en}</th>
                      <td>{categoryText(c, p.category)}</td>
                      <td>{c.num(p.kc_summer, 2)}</td>
                      <td>{c.num(p.kc_winter, 2)}</td>
                      <td>
                        {levelText(c, w.level)}
                        {w.derived && <small className="lx-cell-note">{c.t(" (مشتق من Kc)", " (from Kc)")}</small>}
                      </td>
                      <td>{p.irrigation_method === "spray" ? c.t("رش", "Spray") : c.t("تنقيط", "Drip")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="lx-caption">
            {c.t(
              "المصادر: FAO-56 وجامعة أريزونا (AZ1195) وجامعة كاليفورنيا 2018 وتصنيف WUCOLS. معاملات الأعشاب الزينية والأغطية الأرضية معامل نبات من WUCOLS وليست Kc زراعيًا. قيم عرض تحتاج معايرة ميدانية.",
              "Sources: FAO-56, University of Arizona (AZ1195), University of California 2018 and WUCOLS. Ornamental and ground-cover values are WUCOLS plant factors, not agricultural Kc. Demo values that need field calibration.",
            )}
          </p>
        </section>
      )}
    </div>
  );
}
