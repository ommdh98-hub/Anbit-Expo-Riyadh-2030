// Optional seasonal reference from NASA SMAP (see research/simulation/export_smap_reference.py).
// Shown only next to the simulated average; never used as a section's moisture.
import data from "./smap.json";
import { CITIES, SEASONS, type City, type Season } from "./constants";

type SmapFile = { available: boolean; years?: string[]; cities?: Record<string, Record<string, { vwc: number; n: number }>> };
const SMAP = data as SmapFile;

export type SmapReference = { vwc: number; n: number; month: number; years: string[] };
// Monthly mean VWC for the city and the month the scenario starts in, or null.
export function smapReference(city: City, season: Season, file: SmapFile = SMAP): SmapReference | null {
  const name = CITIES[city].smapCity;
  if (!file.available || !name || !file.cities?.[name]) return null;
  const month = Number(SEASONS[season].start.slice(5, 7));
  const row = file.cities[name][String(month)];
  return row ? { vwc: row.vwc, n: row.n, month, years: file.years ?? [] } : null;
}
