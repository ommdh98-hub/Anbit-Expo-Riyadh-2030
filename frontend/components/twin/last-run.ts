// Summary of the last Digital Twin run, kept in this browser only (localStorage)
// so the Reports page can show it. Simulation only: never mixed with operational data.
import type { Results } from "../../lib/twin/engine";

export const LAST_RUN_KEY = "anbit.twin.lastRun";

export type StrategySummary = { waterM3: number; stressH: number; inRangePct: number };
export type LastRun = {
  version: 1;
  savedAt: string;
  city: string;
  season: string;
  weather: string;
  days: number;
  anbit: StrategySummary;
  sensor: StrategySummary;
  fixed: StrategySummary;
};
type Store = Pick<Storage, "getItem" | "setItem">;

const strategy = (e: Results["anbit"]): StrategySummary => ({
  waterM3: Math.round(e.waterL / 100) / 10,
  stressH: Math.round(e.stressHours * 10) / 10,
  inRangePct: Math.round(e.inRangePct * 10) / 10,
});

export function lastRunFrom(r: Results, now = new Date()): LastRun {
  return {
    version: 1,
    savedAt: now.toISOString(),
    city: r.config.city ?? "riyadh",
    season: r.config.season,
    weather: r.config.weather ?? "generated",
    days: r.config.days,
    anbit: strategy(r.anbit),
    sensor: strategy(r.sensor),
    fixed: strategy(r.fixed),
  };
}

const browserStore = (): Store | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function saveLastRun(r: Results, store: Store | null = browserStore(), now = new Date()) {
  try {
    store?.setItem(LAST_RUN_KEY, JSON.stringify(lastRunFrom(r, now)));
  } catch {
    // Private mode or blocked storage: the Reports page shows the empty state.
  }
}

const isStrategy = (v: unknown): v is StrategySummary =>
  !!v && typeof v === "object" && ["waterM3", "stressH", "inRangePct"].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

export function parseLastRun(raw: string | null | undefined): LastRun | null {
  try {
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v?.version !== 1 || typeof v.savedAt !== "string" || !Number.isFinite(v.days) || ![v.anbit, v.sensor, v.fixed].every(isStrategy)) return null;
    return v as LastRun;
  } catch {
    return null;
  }
}

export function readLastRunRaw(store: Store | null = browserStore()): string | null {
  try {
    return store?.getItem(LAST_RUN_KEY) ?? null;
  } catch {
    return null;
  }
}

export const readLastRun = (store: Store | null = browserStore()) => parseLastRun(readLastRunRaw(store));
