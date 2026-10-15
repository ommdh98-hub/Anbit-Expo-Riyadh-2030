"use client";
import PlantCityExplorer from "../plant-city-explorer";
import { useCopy } from "./copy";
import { ScreenHeader } from "./shell";

// The existing explorer, unchanged, under this module's header.
export default function PlantsScreen() {
  const c = useCopy();
  return (
    <div className="lx-screen lx-plants">
      <ScreenHeader
        title={c.t("النباتات والمدن", "Plants & Cities")}
        lead={c.t("اختر مدينة، ثم نباتًا يناسبها.", "Pick a city, then a plant that suits it.")}
      />
      <div className="lx-plants-body">
        <PlantCityExplorer />
      </div>
    </div>
  );
}
