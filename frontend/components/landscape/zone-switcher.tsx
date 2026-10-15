"use client";
import { useLandscape } from "./context";
import { useCopy } from "./copy";
import { moistureState } from "./data";

export default function ZoneSwitcher() {
  const { zones, zoneId, setZoneId, summaries } = useLandscape();
  const c = useCopy();
  const state = (id: string) => {
    const z = zones.find((x) => x.id === id)!;
    return moistureState(summaries[id]?.current_vwc, z.soil.lower_vwc, z.soil.upper_vwc);
  };
  return (
    <div className="lx-zones">
      <div className="lx-pills" role="group" aria-label={c.t("المنطقة", "Zone")}>
        {zones.map((z) => (
          <button
            key={z.id}
            type="button"
            aria-pressed={z.id === zoneId}
            className={z.id === zoneId ? "on" : ""}
            onClick={() => setZoneId(z.id)}
          >
            <i className={`lx-dot lx-dot-${state(z.id)}`} aria-hidden="true" />
            {c.show(z.name)}
          </button>
        ))}
      </div>
      <label className="lx-zone-select">
        <span className="lx-sr">{c.t("المنطقة", "Zone")}</span>
        <i className={`lx-dot lx-dot-${zoneId ? state(zoneId) : "empty"}`} aria-hidden="true" />
        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {c.show(z.name)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
