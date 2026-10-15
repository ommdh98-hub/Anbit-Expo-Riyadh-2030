"use client";
import { display } from "../lib/i18n";
import PlantCityExplorer from "./plant-city-explorer";
export default function IndividualHome() {
  return (
    <section
      className="individual-home"
      aria-label={display("اكتشاف النباتات للأفراد")}
    >
      <PlantCityExplorer journey />
    </section>
  );
}
