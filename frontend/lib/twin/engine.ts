// Digital Twin engine. Pure and deterministic: the same config (and seed) always
// produces the same run. No I/O, no clock, no network, no database.
import {
  BAND,
  CITIES,
  DEFAULT_ALLOWED,
  EMITTERS,
  FIXED_SCHEDULE,
  LORA_NOISE,
  PLANTS,
  RAIN_INFILTRATION,
  MICROCLIMATE_GRADIENT,
  RIYADH_ET_REF,
  SAME_SOIL_WEIGHT,
  SEASONS,
  SECTION_ET_NOISE,
  SECTION_GRID,
  SECTION_TEMPLATES,
  SOIL_ET_DEVIATION,
  SOILS,
  STEP_MINUTES,
  STEPS_PER_DAY,
  VIRTUAL_BLEND_PER_HOUR,
  VIRTUAL_MARGIN_K,
  VIRTUAL_NEIGHBOURS,
  VIRTUAL_RATE_UNCERTAINTY,
  VIRTUAL_SIGMA_CAP,
  type City,
  type PlantKind,
  type Season,
  type SoilKind,
} from "./constants";
import { TWIN_MODEL, predictNeed, toSensorIndex, type TwinModel } from "./model";
import weather2025 from "./weather2025.json";
import { hoursToWindowEnd, inWindow, windowLength } from "./window";

export type SimConfig = {
  seed: number;
  days: number;
  season: Season;
  rain: boolean;
  sections: number;
  allowedStart: number;
  allowedEnd: number;
  city: City;
  // Margin k for virtual sections (see constants.ts); 0 acts on the raw estimate.
  virtualMarginK?: number;
  // "generated" (default, audited) or "real2025": daily ET0, temperature, humidity
  // and rain from Open-Meteo 2025 for cities in weather2025.json.
  weather?: WeatherSource;
  // Research only (sensor-count audit): ids of the sections with a real (LoRa)
  // sensor. Omitted, each section keeps its template default (today's layout).
  realSensors?: string[];
};
export type WeatherSource = "generated" | "real2025";
type RealCity = { first: string; et0: number[]; tmax: number[]; tmin: number[]; rh: number[]; rain: number[]; et0_monthly?: number[] };
const REAL = weather2025 as unknown as { available: boolean; year: number; source: string; cities: Partial<Record<City, RealCity>> };
export const realWeatherAvailable = (city: City) => Boolean(REAL.available && REAL.cities[city]);
export const REAL_WEATHER_SOURCE = REAL.source;
// Calendar months of each season, for showing the 2025 monthly ET0 range.
export const SEASON_MONTHS: Record<Season, number[]> = { summer: [6, 7, 8, 9], winter: [12, 1, 2], spring: [3, 4, 5] };
// Lowest and highest 2025 monthly mean ET0 (mm/day) for a city in a season, or null.
export function seasonEt0Range(city: City, season: Season) {
  const monthly = REAL.cities[city]?.et0_monthly;
  if (!monthly || monthly.length !== 12) return null;
  const values = SEASON_MONTHS[season].map((m) => monthly[m - 1]);
  return { min: Math.min(...values), max: Math.max(...values) };
}
// Reference ET of the generated weather (season preset scaled by the city).
export const generatedEtMmDay = (city: City, season: Season) => (SEASONS[season].etMmDay * CITIES[city].etRefMmDay) / RIYADH_ET_REF;
export const defaultConfig = (over: Partial<SimConfig> = {}): SimConfig => ({
  seed: 2030,
  days: 7,
  season: "summer",
  rain: true,
  sections: 12,
  allowedStart: DEFAULT_ALLOWED.start,
  allowedEnd: DEFAULT_ALLOWED.end,
  city: "riyadh",
  weather: "generated",
  ...over,
});

const STEP_H = STEP_MINUTES / 60;

// mulberry32: small, fast, seedable.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = (r: () => number) => {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

export type WeatherStep = { tempC: number; rh: number; light: number; etMm: number; rainMm: number; etDayMm: number };

// Diurnal ET weight: a sine between 06:00 and 18:00 peaking at noon, small at night.
export const etWeight = (hour: number) => 0.04 + Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
const WEIGHT_SUM = Array.from({ length: STEPS_PER_DAY }, (_, i) => etWeight((i * STEP_MINUTES) / 60)).reduce((s, w) => s + w, 0);

export function weatherFor(config: SimConfig): WeatherStep[] {
  const season = SEASONS[config.season];
  const city = CITIES[config.city ?? "riyadh"];
  // Season preset scaled to the city: ET by city ÷ Riyadh, plus temperature,
  // humidity and rain-chance adjustments (see constants.ts).
  const s = {
    ...season,
    tMin: season.tMin + city.tempOffset,
    tMax: season.tMax + city.tempOffset,
    rhMin: Math.max(5, season.rhMin + city.rhOffset),
    rhMax: Math.min(95, season.rhMax + city.rhOffset),
    etMmDay: (season.etMmDay * city.etRefMmDay) / RIYADH_ET_REF,
    rainChance: Math.min(0.6, season.rainChance * city.rainFactor),
  };
  const r = rng(config.seed ^ 0x9e3779b9);
  const out: WeatherStep[] = [];
  const real = config.weather === "real2025" ? REAL.cities[config.city ?? "riyadh"] : undefined;
  if (real) return realWeather(config, real, season.start, r);
  for (let d = 0; d < config.days; d++) {
    const factor = 0.85 + r() * 0.3;
    const tShift = (r() - 0.5) * 3;
    const etDay = s.etMmDay * factor;
    const rainy = config.rain && r() < s.rainChance;
    const rainTotal = rainy ? s.rainMm[0] + r() * (s.rainMm[1] - s.rainMm[0]) : 0;
    const rainStart = Math.floor(r() * STEPS_PER_DAY);
    const rainSteps = rainy ? 4 + Math.floor(r() * 8) : 0;
    for (let i = 0; i < STEPS_PER_DAY; i++) {
      const hour = (i * STEP_MINUTES) / 60;
      const swing = Math.cos((2 * Math.PI * (hour - 15)) / 24);
      const raining = rainy && i >= rainStart && i < rainStart + rainSteps;
      const sun = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
      out.push({
        tempC: (s.tMin + s.tMax) / 2 + tShift + ((s.tMax - s.tMin) / 2) * swing - (raining ? 3 : 0),
        rh: Math.min(98, (s.rhMin + s.rhMax) / 2 - ((s.rhMax - s.rhMin) / 2) * swing + (raining ? 30 : 0)),
        light: Math.round(10 + 85 * sun * (raining ? 0.5 : 1)),
        etMm: (etDay * etWeight(hour)) / WEIGHT_SUM * (raining ? 0.3 : 1),
        rainMm: raining ? rainTotal / rainSteps : 0,
        etDayMm: etDay,
      });
    }
  }
  return out;
}

// Same day of the year in 2025 as the season's start date (e.g. 1 July).
function startIndex(start: string) {
  const month = Number(start.slice(5, 7));
  const day = Number(start.slice(8, 10));
  return Math.round((Date.UTC(2025, month - 1, day) - Date.UTC(2025, 0, 1)) / 86_400_000);
}

// Daily 2025 values with the same diurnal shapes as the generated weather. Only
// the hour a rain event starts and its length come from the seed.
function realWeather(config: SimConfig, real: RealCity, start: string, r: () => number): WeatherStep[] {
  const out: WeatherStep[] = [];
  const first = startIndex(start);
  for (let d = 0; d < config.days; d++) {
    const k = (first + d) % real.et0.length;
    const etDay = real.et0[k];
    const tMin = real.tmin[k];
    const tMax = real.tmax[k];
    const rainTotal = config.rain ? real.rain[k] : 0;
    const rainy = rainTotal > 0;
    const rainStart = Math.floor(r() * STEPS_PER_DAY);
    const rainSteps = 4 + Math.floor(r() * 8);
    for (let i = 0; i < STEPS_PER_DAY; i++) {
      const hour = (i * STEP_MINUTES) / 60;
      const swing = Math.cos((2 * Math.PI * (hour - 15)) / 24);
      const raining = rainy && i >= rainStart && i < rainStart + rainSteps;
      const sun = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
      out.push({
        tempC: (tMin + tMax) / 2 + ((tMax - tMin) / 2) * swing - (raining ? 3 : 0),
        rh: Math.max(5, Math.min(98, real.rh[k] - 10 * swing + (raining ? 30 : 0))),
        light: Math.round(10 + 85 * sun * (raining ? 0.5 : 1)),
        // The daily total equals the reference ET0 (rain-hour damping aside).
        etMm: (etDay * etWeight(hour)) / WEIGHT_SUM * (raining ? 0.3 : 1),
        rainMm: raining ? rainTotal / rainSteps : 0,
        etDayMm: etDay,
      });
    }
  }
  return out;
}

export type Section = {
  id: string;
  index: number;
  plant: PlantKind;
  soil: SoilKind;
  areaM2: number;
  lora: boolean;
  rootDepthM: number;
  kc: number;
  wp: number;
  fc: number;
  minimum: number;
  target: number;
  upper: number;
  flowLh: number;
  efficiency: number;
  lossFactor: number;
  trueSpread: number;
  neighbours: number[];
  neighbourWeights: number[];
};
export function sectionsFor(config: SimConfig): Section[] {
  const r = rng(config.seed ^ 0x51ed270b);
  const list = SECTION_TEMPLATES.slice(0, Math.max(1, Math.min(12, config.sections)));
  // Smooth microclimate across the 4 × 3 grid, and one deviation per soil kind.
  const gx = (r() * 2 - 1) * MICROCLIMATE_GRADIENT;
  const gy = (r() * 2 - 1) * MICROCLIMATE_GRADIENT;
  const soilDev = { sandy: (r() * 2 - 1) * SOIL_ET_DEVIATION, loam: (r() * 2 - 1) * SOIL_ET_DEVIATION, clay: (r() * 2 - 1) * SOIL_ET_DEVIATION };
  const out = list.map((t, index) => {
    const soil = SOILS[t.soil];
    const plant = PLANTS[t.plant];
    const emitter = plant.drip ? EMITTERS.drip : EMITTERS.spray;
    const aw = soil.fc - soil.wp;
    return {
      id: t.id,
      index,
      plant: t.plant,
      soil: t.soil,
      areaM2: t.areaM2,
      lora: config.realSensors ? config.realSensors.includes(t.id) : t.lora,
      rootDepthM: plant.rootDepthM,
      kc: plant.kc,
      wp: soil.wp,
      fc: soil.fc,
      minimum: soil.wp + BAND.minimum * aw,
      target: soil.wp + BAND.target * aw,
      upper: soil.wp + BAND.upper * aw,
      flowLh: emitter.mmPerHour * t.areaM2,
      efficiency: emitter.efficiency,
      lossFactor: soil.lossFactor,
      trueSpread:
        (1 + (gx * (SECTION_GRID[index].col - 1.5)) / 1.5 + gy * (SECTION_GRID[index].row - 1)) *
        (1 + soilDev[t.soil]) *
        (1 + (r() * 2 - 1) * SECTION_ET_NOISE),
      neighbours: [] as number[],
      neighbourWeights: [] as number[],
    };
  });
  // The nearest LoRa sections inform each virtual one, weighted by inverse grid
  // distance and doubled for the same soil kind.
  for (const s of out) {
    if (s.lora) continue;
    const near = out
      .filter((o) => o.lora)
      .map((o) => ({ i: o.index, soil: o.soil, d: Math.hypot(SECTION_GRID[o.index].col - SECTION_GRID[s.index].col, SECTION_GRID[o.index].row - SECTION_GRID[s.index].row) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, VIRTUAL_NEIGHBOURS);
    s.neighbours = near.map((o) => o.i);
    s.neighbourWeights = near.map((o) => (1 / Math.max(0.5, o.d)) * (o.soil === s.soil ? SAME_SOIL_WEIGHT : 1));
  }
  return out;
}

// Moisture loss for one step. Water stress slows ET below the minimum.
function loss(s: Section, m: number, etMm: number, spread: number) {
  const stress = Math.max(0, Math.min(1, (m - s.wp) / (s.minimum - s.wp)));
  return (etMm * s.kc * s.lossFactor * spread * stress) / (s.rootDepthM * 1000);
}
const gainFor = (s: Section, litres: number) => (litres * s.efficiency) / (s.areaM2 * s.rootDepthM * 1000);
export const litresToTarget = (s: Section, m: number) => Math.max(0, ((s.target - m) * s.rootDepthM * 1000 * s.areaM2) / s.efficiency);

export { inWindow, hoursToWindowEnd } from "./window";

export type Bed = {
  m: number;
  valve: boolean;
  remainingL: number;
  waterL: number;
  wastedL: number;
  inRange: number;
  stress: number;
  overEvents: number;
  irrigations: number;
  steps: number;
  lastL: number;
  // Steps above the upper limit, and those that followed rain with no
  // irrigation by this strategy in the previous 24 h.
  wet: number;
  wetAfterRain: number;
  lastIrrigated: number;
  lastRain: number;
};
const NEVER = -1e9;
const bed = (m: number): Bed => ({
  m,
  valve: false,
  remainingL: 0,
  waterL: 0,
  wastedL: 0,
  inRange: 0,
  stress: 0,
  overEvents: 0,
  irrigations: 0,
  steps: 0,
  lastL: 0,
  wet: 0,
  wetAfterRain: 0,
  lastIrrigated: NEVER,
  lastRain: NEVER,
});

export type HourPoint = { t: number; anbit: number; sensor: number; fixed: number; minimum: number; upper: number };
export type DayPoint = { day: number; anbit: number; sensor: number; fixed: number };
export type SimState = {
  config: SimConfig;
  model: TwinModel;
  startMs: number;
  total: number;
  i: number;
  weather: WeatherStep[];
  sections: Section[];
  anbit: Bed[];
  // Sensor-only automation: LoRa sections react to their own reading, others keep the fixed schedule.
  sensor: Bed[];
  fixed: Bed[];
  est: number[];
  // Water the virtual estimator has subtracted so far, per section (VWC fraction).
  virtualLoss: number[];
  noise: () => number;
  sensorNoise: () => number;
  curves: number[][];
  hourly: HourPoint[];
  daily: DayPoint[];
  decisions: { ml: number; rule: number; mlEvaluated: number; agree: number };
  estError: { sum: number; signed: number[]; n: number };
  calibration: { ratio: number[]; anchor: (number | null)[]; nominalMm: number; wet: boolean; irrigated: Set<number> };
};
// Neighbour calibration window: twelve hours, long enough to rise above sensor noise.
const CALIBRATION_STEPS = (12 * 60) / STEP_MINUTES;

export function createSim(config: SimConfig, model: TwinModel = TWIN_MODEL): SimState {
  const sections = sectionsFor(config);
  const r = rng(config.seed ^ 0x2545f491);
  const start = sections.map((s) => s.target - (0.05 + r() * 0.25) * (s.target - s.minimum));
  return {
    config,
    model,
    startMs: Date.parse(SEASONS[config.season].start),
    total: config.days * STEPS_PER_DAY,
    i: 0,
    weather: weatherFor(config),
    sections,
    anbit: start.map(bed),
    sensor: start.map(bed),
    fixed: start.map(bed),
    est: start.slice(),
    virtualLoss: sections.map(() => 0),
    noise: rng(config.seed ^ 0x7f4a7c15),
    sensorNoise: rng(config.seed ^ 0x3c6ef372),
    curves: sections.map(() => []),
    hourly: [],
    daily: Array.from({ length: config.days }, (_, day) => ({ day, anbit: 0, sensor: 0, fixed: 0 })),
    decisions: { ml: 0, rule: 0, mlEvaluated: 0, agree: 0 },
    estError: { sum: 0, signed: sections.map(() => 0), n: 0 },
    calibration: { ratio: sections.map(() => 1), anchor: sections.map(() => null), nominalMm: 0, wet: false, irrigated: new Set() },
  };
}

// Uncertainty of a virtual estimate (VWC fraction); zero for LoRa sections.
export function uncertainty(state: SimState, s: Section) {
  if (s.lora) return 0;
  return Math.min(VIRTUAL_SIGMA_CAP * (s.fc - s.wp), VIRTUAL_RATE_UNCERTAINTY * state.virtualLoss[s.index]);
}
// The value ANBIT acts on: the reading itself for LoRa, estimate − k·σ for virtual.
export function decisionValue(state: SimState, s: Section) {
  const k = state.config.virtualMarginK ?? VIRTUAL_MARGIN_K;
  return Math.max(s.wp, state.est[s.index] - k * uncertainty(state, s));
}

export const hourAt = (i: number) => ((i % STEPS_PER_DAY) * STEP_MINUTES) / 60;
export const timeAt = (state: SimState, i: number) => state.startMs + i * STEP_MINUTES * 60_000;

// Persistence forecast: today's ET shape continues; no knowledge of future rain.
function project(state: SimState, s: Section, m: number, from: number, steps: number) {
  const etDay = state.weather[Math.min(from, state.total - 1)].etDayMm;
  let lowest = m;
  for (let k = 1; k <= steps; k++) {
    const etMm = (etDay * etWeight(hourAt(from + k))) / WEIGHT_SUM;
    m = Math.max(s.wp, m - loss(s, m, etMm, 1));
    lowest = Math.min(lowest, m);
  }
  return lowest;
}

export type Decision = { need: boolean; source: "ml" | "rule"; predicted: number };
// Would this section fall below its minimum before the next chance to irrigate?
export function decide(state: SimState, s: Section, est: number, i: number): Decision {
  const { allowedStart, allowedEnd } = state.config;
  const hour = hourAt(i);
  const ahead = Math.round((hoursToWindowEnd(hour, allowedStart, allowedEnd) + (24 - windowLength(allowedStart, allowedEnd))) / STEP_H);
  const predicted = project(state, s, est, i, ahead);
  const rule = predicted < s.minimum;
  const w = state.weather[i];
  const x = [toSensorIndex(predicted, s.wp, s.fc, state.model), w.tempC, w.rh, w.light, w.rainMm > 0 ? 1 : 0];
  const p = predictNeed(x, state.model);
  if (p === null) return { need: rule, source: "rule", predicted };
  state.decisions.mlEvaluated += 1;
  if (p >= 0.5 === rule) state.decisions.agree += 1;
  return { need: p >= 0.5, source: "ml", predicted };
}

function record(b: Bed, s: Section, before: number, irrigated: boolean, rained: boolean) {
  const i = b.steps;
  if (irrigated) b.lastIrrigated = i;
  if (rained) b.lastRain = i;
  b.steps += 1;
  if (b.m >= s.minimum && b.m <= s.upper) b.inRange += 1;
  if (b.m < s.minimum) b.stress += 1;
  if (b.m > s.upper) {
    b.wet += 1;
    if (b.lastRain > b.lastIrrigated && i - b.lastIrrigated > STEPS_PER_DAY) b.wetAfterRain += 1;
  }
  if (irrigated && before <= s.upper && b.m > s.upper) b.overEvents += 1;
}

// Applies weather, irrigation and bounds. Excess above field capacity is drained;
// the share caused by irrigation is counted as wasted water.
function advance(b: Bed, s: Section, w: WeatherStep, applyL: number) {
  const before = b.m;
  let m = b.m - loss(s, b.m, w.etMm, s.trueSpread);
  m += (w.rainMm * RAIN_INFILTRATION) / (s.rootDepthM * 1000);
  const gain = (applyL * s.efficiency) / (s.areaM2 * s.rootDepthM * 1000);
  m += gain;
  if (m > s.fc) {
    const excess = Math.min(m - s.fc, gain);
    b.wastedL += (excess * s.areaM2 * s.rootDepthM * 1000) / s.efficiency;
    m = s.fc;
  }
  b.m = Math.max(s.wp, m);
  b.waterL += applyL;
  b.lastL = applyL;
  record(b, s, before, applyL > 0, w.rainMm > 0);
}

function fixedStep(b: Bed, s: Section, startNow: boolean, capacity: number, litresPerM2: number) {
  if (startNow) {
    b.remainingL = litresPerM2 * s.areaM2;
    b.irrigations += 1;
  }
  const litres = Math.min(b.remainingL, capacity);
  b.remainingL -= litres;
  b.valve = litres > 0;
  return litres;
}
// Delivers only what is left to reach the target, then closes the valve:
// the last step is partial instead of a full 15 minutes.
function deliver(b: Bed, s: Section, reading: number, capacity: number) {
  const litres = Math.min(capacity, litresToTarget(s, reading));
  if (litres < capacity) b.valve = false;
  return litres;
}

export function step(state: SimState) {
  if (state.i >= state.total) return false;
  const i = state.i;
  const w = state.weather[i];
  const hour = hourAt(i);
  const day = Math.floor(i / STEPS_PER_DAY);
  const { allowedStart, allowedEnd } = state.config;
  const open = inWindow(hour, allowedStart, allowedEnd);
  const fixedStart = i % STEPS_PER_DAY === (FIXED_SCHEDULE.startHour * 60) / STEP_MINUTES;
  const fixedDepth = FIXED_SCHEDULE.litresPerM2BySeason[state.config.season];
  for (const s of state.sections) {
    const capacity = s.flowLh * STEP_H;
    // Fixed schedule: same depth every day at the same hour, whatever the soil says.
    const f = state.fixed[s.index];
    const fixedL = fixedStep(f, s, fixedStart, capacity, fixedDepth);
    advance(f, s, w, fixedL);
    state.daily[day].fixed += fixedL;

    // Sensor-only automation: a LoRa section opens when its own reading is below
    // the minimum (inside the allowed hours) and stops at target. No forecast, no
    // virtual sensors: sections without LoRa keep the fixed schedule.
    const so = state.sensor[s.index];
    let sensorL: number;
    if (s.lora) {
      const reading = Math.max(s.wp, Math.min(s.fc, so.m + gaussian(state.sensorNoise) * LORA_NOISE));
      if (so.valve && !open) so.valve = false;
      else if (!so.valve && open && w.rainMm === 0 && reading < s.minimum) {
        so.valve = true;
        so.irrigations += 1;
      }
      sensorL = so.valve ? deliver(so, s, reading, capacity) : 0;
    } else sensorL = fixedStep(so, s, fixedStart, capacity, fixedDepth);
    advance(so, s, w, sensorL);
    state.daily[day].sensor += sensorL;

    // ANBIT: decides on the sensed (LoRa) or conservatively estimated (virtual) value only.
    const a = state.anbit[s.index];
    const est = decisionValue(state, s);
    if (a.valve && (est >= s.target || !open)) a.valve = false;
    else if (!a.valve && open && w.rainMm === 0) {
      const d = decide(state, s, est, i);
      const needHours = litresToTarget(s, est) / s.flowLh;
      const late = hoursToWindowEnd(hour, allowedStart, allowedEnd) <= needHours + 1;
      // Nothing to add when the reading is already at target.
      if (d.need && est < s.target && (late || est <= s.minimum)) {
        a.valve = true;
        a.irrigations += 1;
        if (d.source === "ml") state.decisions.ml += 1;
        else state.decisions.rule += 1;
      }
    }
    const anbitL = a.valve ? deliver(a, s, est, capacity) : 0;
    advance(a, s, w, anbitL);
    state.daily[day].anbit += anbitL;
  }
  updateEstimates(state, i, w);
  for (const s of state.sections) {
    const curve = state.curves[s.index];
    curve.push(state.anbit[s.index].m);
    if (curve.length > STEPS_PER_DAY) curve.shift();
  }
  if ((i + 1) % (60 / STEP_MINUTES) === 0) {
    const avg = (beds: Bed[]) => beds.reduce((t, b) => t + b.m, 0) / beds.length;
    state.hourly.push({
      t: timeAt(state, i + 1),
      anbit: avg(state.anbit),
      sensor: avg(state.sensor),
      fixed: avg(state.fixed),
      minimum: state.sections.reduce((t, s) => t + s.minimum, 0) / state.sections.length,
      upper: state.sections.reduce((t, s) => t + s.upper, 0) / state.sections.length,
    });
  }
  state.i += 1;
  return true;
}

// LoRa reads the true value with noise. Virtual sections run the water balance
// for their own soil and plant, with the evaporation rate calibrated by how fast
// their LoRa neighbours actually dried over the last hours (no irrigation, no rain).
function updateEstimates(state: SimState, i: number, w: WeatherStep) {
  for (const s of state.sections) {
    const a = state.anbit[s.index];
    if (s.lora) state.est[s.index] = Math.max(s.wp, Math.min(s.fc, a.m + gaussian(state.noise) * LORA_NOISE));
  }
  const cal = state.calibration;
  cal.nominalMm += w.etMm;
  cal.wet ||= w.rainMm > 0;
  for (const s of state.sections) if (s.lora && state.anbit[s.index].lastL > 0) cal.irrigated.add(s.index);
  if ((i + 1) % CALIBRATION_STEPS === 0) {
    // Each LoRa section's observed drying rate ÷ the nominal model.
    const implied: (number | null)[] = state.sections.map((s) => {
      if (!s.lora || cal.irrigated.has(s.index) || cal.wet) return null;
      const before = cal.anchor[s.index];
      const now = state.est[s.index];
      // Only well-watered beds: stress would hide the evaporation rate.
      if (before == null || now < s.minimum || cal.nominalMm <= 0) return null;
      return Math.max(0.5, Math.min(1.5, ((before - now) * s.rootDepthM * 1000) / (s.kc * s.lossFactor * cal.nominalMm)));
    });
    // Each virtual section blends only its own neighbours' rates.
    for (const s of state.sections) {
      if (s.lora) continue;
      let wsum = 0;
      let rsum = 0;
      s.neighbours.forEach((n, k) => {
        const r = implied[n];
        if (r == null) return;
        wsum += s.neighbourWeights[k];
        rsum += s.neighbourWeights[k] * r;
      });
      if (wsum > 0) cal.ratio[s.index] = (1 - VIRTUAL_BLEND_PER_HOUR) * cal.ratio[s.index] + VIRTUAL_BLEND_PER_HOUR * (rsum / wsum);
    }
    cal.anchor = state.sections.map((s) => (s.lora ? state.est[s.index] : null));
    cal.nominalMm = 0;
    cal.wet = false;
    cal.irrigated.clear();
  }
  for (const s of state.sections) {
    if (s.lora) continue;
    const a = state.anbit[s.index];
    const lost = loss(s, state.est[s.index], w.etMm, cal.ratio[s.index]);
    state.virtualLoss[s.index] += lost;
    let e = state.est[s.index] - lost;
    e += (w.rainMm * RAIN_INFILTRATION) / (s.rootDepthM * 1000);
    e += gainFor(s, a.lastL);
    state.est[s.index] = Math.max(s.wp, Math.min(s.fc, e));
    const diff = state.est[s.index] - a.m;
    state.estError.sum += Math.abs(diff);
    state.estError.signed[s.index] += diff;
    state.estError.n += 1;
  }
}

export function runSteps(state: SimState, n: number) {
  let k = 0;
  while (k < n && step(state)) k++;
  return k;
}
export function runAll(config: SimConfig, model?: TwinModel) {
  const state = createSim(config, model);
  while (step(state));
  return state;
}

// Next start ANBIT would make for one section, from its current estimate (rule only).
export function predictNext(state: SimState, index: number): number | null {
  const s = state.sections[index];
  if (state.anbit[index].valve) return timeAt(state, state.i);
  const { allowedStart, allowedEnd } = state.config;
  let m = decisionValue(state, s);
  const etDay = state.weather[Math.min(state.i, state.total - 1)].etDayMm;
  for (let k = 0; k < 7 * STEPS_PER_DAY; k++) {
    const i = state.i + k;
    const hour = hourAt(i);
    if (inWindow(hour, allowedStart, allowedEnd)) {
      const ahead = Math.round((hoursToWindowEnd(hour, allowedStart, allowedEnd) + (24 - windowLength(allowedStart, allowedEnd))) / STEP_H);
      const low = project(state, s, m, i, ahead);
      const late = hoursToWindowEnd(hour, allowedStart, allowedEnd) <= litresToTarget(s, m) / s.flowLh + 1;
      if (low < s.minimum && m < s.target && (late || m <= s.minimum)) return timeAt(state, i);
    }
    m = Math.max(s.wp, m - loss(s, m, (etDay * etWeight(hourAt(i + 1))) / WEIGHT_SUM, 1));
  }
  return null;
}

export const savingPercent = (fixedL: number, anbitL: number) => (fixedL > 0 ? ((fixedL - anbitL) / fixedL) * 100 : null);
const sum = (beds: Bed[], k: keyof Bed) => beds.reduce((t, b) => t + (b[k] as number), 0);

export type SectionView = { id: string; m: number; est: number; valve: boolean; lora: boolean; state: "dry" | "good" | "wet" };
export type Snapshot = {
  i: number;
  total: number;
  timeMs: number;
  sections: SectionView[];
  avgMoisture: number;
  needing: number;
  anbitL: number;
  fixedL: number;
  saving: number | null;
  done: boolean;
};
export function moistureState(s: Section, m: number): SectionView["state"] {
  return m < s.minimum ? "dry" : m > s.upper ? "wet" : "good";
}
export function snapshot(state: SimState): Snapshot {
  const anbitL = sum(state.anbit, "waterL");
  const fixedL = sum(state.fixed, "waterL");
  return {
    i: state.i,
    total: state.total,
    timeMs: timeAt(state, state.i),
    sections: state.sections.map((s) => ({
      id: s.id,
      m: state.anbit[s.index].m,
      est: state.est[s.index],
      valve: state.anbit[s.index].valve,
      lora: s.lora,
      state: moistureState(s, state.anbit[s.index].m),
    })),
    avgMoisture: state.anbit.reduce((t, b) => t + b.m, 0) / state.anbit.length,
    needing: state.sections.filter((s) => state.anbit[s.index].valve || decisionValue(state, s) <= s.minimum).length,
    anbitL,
    fixedL,
    saving: savingPercent(fixedL, anbitL),
    done: state.i >= state.total,
  };
}

export type EngineSummary = {
  waterL: number;
  wastedL: number;
  wastePct: number;
  inRangePct: number;
  stressHours: number;
  wetHours: number;
  wetAfterRainHours: number;
  overEvents: number;
  irrigations: number;
};
const engineSummary = (beds: Bed[]): EngineSummary => {
  const steps = sum(beds, "steps") || 1;
  const waterL = sum(beds, "waterL");
  const wastedL = sum(beds, "wastedL");
  return {
    waterL,
    wastedL,
    wastePct: waterL > 0 ? (wastedL / waterL) * 100 : 0,
    inRangePct: (sum(beds, "inRange") / steps) * 100,
    stressHours: sum(beds, "stress") * STEP_H,
    wetHours: sum(beds, "wet") * STEP_H,
    wetAfterRainHours: sum(beds, "wetAfterRain") * STEP_H,
    overEvents: sum(beds, "overEvents"),
    irrigations: sum(beds, "irrigations"),
  };
};
export type Results = {
  config: SimConfig;
  anbit: EngineSummary;
  sensor: EngineSummary;
  fixed: EngineSummary;
  saving: number | null;
  savingVsSensor: number | null;
  daily: DayPoint[];
  hourly: HourPoint[];
  sections: {
    id: string;
    plant: PlantKind;
    soil: SoilKind;
    lora: boolean;
    anbit: EngineSummary;
    sensor: EngineSummary;
    fixed: EngineSummary;
    saving: number | null;
    virtualSignedPct: number | null;
  }[];
  decisions: SimState["decisions"];
  virtualErrorPct: number | null;
};
export function results(state: SimState): Results {
  const anbit = engineSummary(state.anbit);
  const sensor = engineSummary(state.sensor);
  const fixed = engineSummary(state.fixed);
  const virtualCount = state.sections.filter((s) => !s.lora).length;
  const perSection = virtualCount ? state.estError.n / virtualCount : 0;
  return {
    config: state.config,
    anbit,
    sensor,
    fixed,
    saving: savingPercent(fixed.waterL, anbit.waterL),
    savingVsSensor: savingPercent(sensor.waterL, anbit.waterL),
    daily: state.daily.slice(0, Math.ceil(state.i / STEPS_PER_DAY)),
    hourly: state.hourly,
    sections: state.sections.map((s) => {
      const a = engineSummary([state.anbit[s.index]]);
      const so = engineSummary([state.sensor[s.index]]);
      const f = engineSummary([state.fixed[s.index]]);
      return {
        id: s.id,
        plant: s.plant,
        soil: s.soil,
        lora: s.lora,
        anbit: a,
        sensor: so,
        fixed: f,
        saving: savingPercent(f.waterL, a.waterL),
        virtualSignedPct: !s.lora && perSection ? (state.estError.signed[s.index] / perSection) * 100 : null,
      };
    }),
    decisions: state.decisions,
    virtualErrorPct: state.estError.n ? (state.estError.sum / state.estError.n) * 100 : null,
  };
}

export function resultsCsv(r: Results) {
  const strategies = ["anbit", "sensor", "fixed"] as const;
  const cols = ["water_l", "waste_l", "in_range_pct", "stress_h", "over_events"];
  const lines = [["kind", "id", ...strategies.flatMap((k) => cols.map((c) => `${k}_${c}`)), "saving_vs_fixed_pct", "saving_vs_sensor_pct"].join(",")];
  const cells = (e: EngineSummary) => [e.waterL.toFixed(0), e.wastedL.toFixed(0), e.inRangePct.toFixed(1), e.stressHours.toFixed(1), e.overEvents];
  const pctCell = (v: number | null) => (v == null ? "" : v.toFixed(1));
  lines.push(["total", "all", ...strategies.flatMap((k) => cells(r[k])), pctCell(r.saving), pctCell(r.savingVsSensor)].join(","));
  for (const s of r.sections)
    lines.push(["section", s.id, ...strategies.flatMap((k) => cells(s[k])), pctCell(s.saving), pctCell(savingPercent(s.sensor.waterL, s.anbit.waterL))].join(","));
  lines.push("", "day,anbit_l,sensor_l,fixed_l");
  for (const d of r.daily) lines.push([d.day + 1, d.anbit.toFixed(0), d.sensor.toFixed(0), d.fixed.toFixed(0)].join(","));
  lines.push("", `city,${r.config.city},season,${r.config.season},days,${r.config.days},seed,${r.config.seed}`);
  return lines.join("\n");
}
