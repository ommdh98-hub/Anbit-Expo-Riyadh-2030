// Digital Twin assumptions. Simulation only: none of these values is measured,
// and nothing here reads or writes ANBIT's operational data.

export const STEP_MINUTES = 15;
export const STEPS_PER_DAY = (24 * 60) / STEP_MINUTES;
export const DEFAULT_SEED = 2030;

export type Season = "summer" | "winter" | "spring";
export type SoilKind = "sandy" | "loam" | "clay";
export type PlantKind = "turf" | "palm" | "olive" | "shrub" | "bougainvillea" | "flowers";

// Weather presets for Riyadh. Reference ET (mm/day) is an assumed seasonal level,
// not a forecast; each day varies ±15% from the seed.
export const SEASONS: Record<
  Season,
  { start: string; tMin: number; tMax: number; rhMin: number; rhMax: number; etMmDay: number; rainChance: number; rainMm: [number, number] }
> = {
  summer: { start: "2026-07-01T00:00:00+03:00", tMin: 30, tMax: 44, rhMin: 8, rhMax: 25, etMmDay: 9, rainChance: 0.01, rainMm: [1, 4] },
  winter: { start: "2026-01-10T00:00:00+03:00", tMin: 9, tMax: 21, rhMin: 30, rhMax: 65, etMmDay: 3, rainChance: 0.12, rainMm: [2, 12] },
  spring: { start: "2026-04-01T00:00:00+03:00", tMin: 19, tMax: 33, rhMin: 18, rhMax: 45, etMmDay: 6, rainChance: 0.08, rainMm: [2, 10] },
};

// Volumetric water content limits per soil (fractions). Typical textbook ranges.
export const SOILS: Record<SoilKind, { wp: number; fc: number; lossFactor: number }> = {
  sandy: { wp: 0.05, fc: 0.15, lossFactor: 1.15 },
  loam: { wp: 0.1, fc: 0.3, lossFactor: 1.0 },
  clay: { wp: 0.2, fc: 0.4, lossFactor: 0.85 },
};

// Management band as fractions of the soil's available water (fc − wp).
// MINIMUM matches the training data's decision threshold mapped onto this scale.
export const BAND = { minimum: 0.36, target: 0.6, upper: 0.85 } as const;

// Crop coefficients, root depth and emitter type per plant (assumed).
export const PLANTS: Record<PlantKind, { kc: number; rootDepthM: number; drip: boolean }> = {
  turf: { kc: 0.8, rootDepthM: 0.15, drip: false },
  palm: { kc: 0.9, rootDepthM: 0.6, drip: true },
  olive: { kc: 0.55, rootDepthM: 0.5, drip: true },
  shrub: { kc: 0.5, rootDepthM: 0.3, drip: true },
  bougainvillea: { kc: 0.45, rootDepthM: 0.3, drip: true },
  flowers: { kc: 0.7, rootDepthM: 0.2, drip: false },
};
// Application rate (mm/h = L/m²/h) and efficiency per emitter type.
export const EMITTERS = {
  spray: { mmPerHour: 15, efficiency: 0.7 },
  drip: { mmPerHour: 5, efficiency: 0.9 },
} as const;

export type SectionTemplate = { id: string; plant: PlantKind; soil: SoilKind; areaM2: number; lora: boolean };
// Twelve sections; LoRa marks a simulated physical sensor, the rest are virtual.
export const SECTION_TEMPLATES: SectionTemplate[] = [
  { id: "S01", plant: "turf", soil: "sandy", areaM2: 400, lora: true },
  { id: "S02", plant: "palm", soil: "loam", areaM2: 220, lora: false },
  { id: "S03", plant: "turf", soil: "loam", areaM2: 360, lora: true },
  { id: "S04", plant: "shrub", soil: "sandy", areaM2: 140, lora: true },
  { id: "S05", plant: "flowers", soil: "loam", areaM2: 90, lora: false },
  { id: "S06", plant: "olive", soil: "clay", areaM2: 180, lora: true },
  { id: "S07", plant: "turf", soil: "clay", areaM2: 320, lora: false },
  { id: "S08", plant: "bougainvillea", soil: "sandy", areaM2: 110, lora: true },
  { id: "S09", plant: "palm", soil: "sandy", areaM2: 260, lora: true },
  { id: "S10", plant: "flowers", soil: "clay", areaM2: 80, lora: false },
  { id: "S11", plant: "turf", soil: "sandy", areaM2: 300, lora: true },
  { id: "S12", plant: "shrub", soil: "loam", areaM2: 150, lora: false },
];
// Grid positions (column, row) for neighbours and the map, 4 columns × 3 rows.
export const SECTION_GRID = SECTION_TEMPLATES.map((_, i) => ({ col: i % 4, row: Math.floor(i / 4) }));

// Fixed schedule used for comparison: every day at 05:00, the same depth on every section.
// Assumption: a seasonal timer, as a site might set it by hand three times a year.
export const FIXED_SCHEDULE = {
  startHour: 5,
  litresPerM2BySeason: { summer: 8, spring: 6, winter: 3 },
} as const;

// ANBIT may start irrigation only inside this window (wraps past midnight).
export const DEFAULT_ALLOWED = { start: 18, end: 8 } as const;

// Sensor noise for LoRa (VWC fraction, 1σ) and how fast the virtual estimator
// adopts a new evaporation calibration from its LoRa neighbours (share per
// 12-hour calibration window).
export const LORA_NOISE = 0.002;
export const VIRTUAL_BLEND_PER_HOUR = 0.3;
// True evaporation differs from the nominal model (unknown to ANBIT) in three
// layered ways, all seeded: a smooth microclimate gradient across the garden
// (shade, wind; up to ±8% edge to edge), a shared deviation per soil kind
// (±8%: real soils of one texture behave alike), and a small independent part
// per section (±2%). Smooth and soil-shared parts are what make neighbouring
// LoRa sensors informative for a virtual section.
export const MICROCLIMATE_GRADIENT = 0.08;
export const SOIL_ET_DEVIATION = 0.08;
export const SECTION_ET_NOISE = 0.02;
// Neighbour weighting for virtual calibration: inverse grid distance, ×2 for the same soil kind.
export const SAME_SOIL_WEIGHT = 2;
export const VIRTUAL_NEIGHBOURS = 3;

// Virtual sections never get an absolute reading, so their level error builds up
// as small evaporation-rate errors accumulate over the water the model subtracts;
// rate calibration improves the rate but does not reset the level. ANBIT treats a
// virtual estimate as uncertain by σ = min(cap × available water, rate uncertainty
// × cumulative modelled loss), and decides, doses and stops on estimate − k·σ.
// LoRa sections read the soil directly and use no margin.
export const VIRTUAL_RATE_UNCERTAINTY = 0.1;
export const VIRTUAL_SIGMA_CAP = 0.12;
export const VIRTUAL_MARGIN_K = 1;
export const RAIN_INFILTRATION = 0.8;

export const DURATIONS = { hours: 1, days: 7, weeks: 28 } as const;

export type City = "riyadh" | "jeddah" | "dammam" | "medina" | "tabuk" | "abha";
// City scaling applied on top of each season preset. Reference ET (mm/day) is a
// per-city annual average from the team's ENBT database where available; the
// season's ET is multiplied by city ÷ Riyadh. Temperature, humidity and rain
// adjustments are coarse assumptions for a demo, not climate normals.
export const RIYADH_ET_REF = 8.5;
export const CITIES: Record<
  City,
  { etRefMmDay: number; etSource: "ENBT" | "assumption"; tempOffset: number; rhOffset: number; rainFactor: number; smapCity: string | null }
> = {
  riyadh: { etRefMmDay: 8.5, etSource: "ENBT", tempOffset: 0, rhOffset: 0, rainFactor: 1, smapCity: "Riyadh" },
  medina: { etRefMmDay: 8.2, etSource: "ENBT", tempOffset: 1, rhOffset: -3, rainFactor: 0.6, smapCity: "Medina" },
  tabuk: { etRefMmDay: 7.2, etSource: "ENBT", tempOffset: -3, rhOffset: 3, rainFactor: 0.8, smapCity: "Tabuk" },
  abha: { etRefMmDay: 3.8, etSource: "ENBT", tempOffset: -10, rhOffset: 20, rainFactor: 3, smapCity: "Abha" },
  // No ENBT value: coastal, humid, warm winters. Clearly an assumption.
  jeddah: { etRefMmDay: 7.0, etSource: "assumption", tempOffset: 3, rhOffset: 35, rainFactor: 0.6, smapCity: null },
  // No ENBT value; Al-Hasa (6.3) is the nearest ENBT city. Assumption.
  dammam: { etRefMmDay: 6.5, etSource: "assumption", tempOffset: 1, rhOffset: 25, rainFactor: 0.7, smapCity: null },
};

// Playback speeds as simulated seconds per real second.
export const SPEEDS = [
  { id: "1x", simSecondsPerSecond: 60 },
  { id: "10x", simSecondsPerSecond: 600 },
  { id: "60x", simSecondsPerSecond: 3600 },
  { id: "day", simSecondsPerSecond: 86_400 },
  { id: "week", simSecondsPerSecond: 60_480 },
] as const;
export type SpeedId = (typeof SPEEDS)[number]["id"];
