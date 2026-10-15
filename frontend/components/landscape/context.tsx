"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../lib/api";
import type { Recommendation, Report, Zone } from "../../lib/types";
import type { HomeSummary } from "../../lib/home";
import type { Role } from "./data";

export type Profile = { username: string; name: string; role: Role };
type Store = {
  profile: Profile;
  zones: Zone[];
  summaries: Record<string, HomeSummary | null>;
  month: Report | null;
  recs: Recommendation[];
  zoneId: string;
  zone: Zone | null;
  summary: HomeSummary | null;
  loading: boolean;
  error: string;
  setZoneId: (id: string) => void;
  refresh: () => Promise<void>;
};
const Ctx = createContext<Store | null>(null);
const ZONE_KEY = "anbit-landscape-zone";

export function LandscapeProvider({ profile, children }: { profile: Profile; children: ReactNode }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [summaries, setSummaries] = useState<Record<string, HomeSummary | null>>({});
  const [month, setMonth] = useState<Report | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [zoneId, setZone] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [z, r, m] = await Promise.all([
        api<Zone[]>("/zones"),
        api<Recommendation[]>("/recommendations"),
        api<Report>("/reports/water?days=30"),
      ]);
      // The Home summary is a read-only scenario; one failing zone must not hide the rest.
      const entries = await Promise.all(
        z.map((zone) =>
          api<HomeSummary>(`/zones/${zone.id}/home`, { method: "POST", body: "{}" })
            .then((s) => [zone.id, s] as const)
            .catch(() => [zone.id, null] as const),
        ),
      );
      setZones(z);
      setRecs(r);
      setMonth(m);
      setSummaries(Object.fromEntries(entries));
      setZone((current) => {
        if (current && z.some((x) => x.id === current)) return current;
        let saved = "";
        try {
          saved = localStorage.getItem(ZONE_KEY) ?? "";
        } catch {
          /* Storage is optional. */
        }
        return z.some((x) => x.id === saved) ? saved : (z[0]?.id ?? "");
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // Initial load from the API; state updates happen after the awaits resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  const setZoneId = (id: string) => {
    setZone(id);
    try {
      localStorage.setItem(ZONE_KEY, id);
    } catch {
      /* Storage is optional. */
    }
  };
  const zone = zones.find((z) => z.id === zoneId) ?? null;
  return (
    <Ctx.Provider
      value={{
        profile,
        zones,
        summaries,
        month,
        recs,
        zoneId,
        zone,
        summary: zone ? (summaries[zone.id] ?? null) : null,
        loading,
        error,
        setZoneId,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
export function useLandscape() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useLandscape outside LandscapeProvider");
  return value;
}
