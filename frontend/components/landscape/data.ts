// Pure adapters between the API and the Landscape screens. No React, no fetch:
// every value that the backend does not provide is returned with its source kind.
import {
  DEMO_APPLICATION_L_PER_M2_H,
  DEMO_BASELINE,
  PERIOD_DAYS,
  RIYADH_OFFSET_HOURS,
  STALE_AFTER_HOURS,
  TARGET_TOLERANCE_VWC,
  type Period,
} from "./constants";
import type { Recommendation, WaterEvent, Zone } from "../../lib/types";
import { inWindow } from "../../lib/twin/window";
import type { HomeSummary } from "../../lib/home";
import { suggestedMeasurement } from "../../lib/role-home";

export type Role = "user" | "survey";
export type Access = "checking" | "login" | "forbidden" | "allowed";

// Role guard: the route is only for Landscape Teams. The server enforces writes.
export function landscapeAccess(
  status: "checking" | "ready" | "anonymous" | "error",
  role?: Role | string | null,
): Access {
  if (status === "checking") return "checking";
  if (status !== "ready" || !role) return "login";
  return role === "survey" ? "allowed" : "forbidden";
}

export type SourceKind = "measured" | "estimated" | "demo";
export type Badge = { kind: SourceKind; simulated: boolean };

// One badge per number. A reading from the simulation site is a reading, but it
// is never presented as a field measurement.
export function badgeFor(
  source: HomeSummary["source"] | "demo" | undefined,
): Badge | null {
  if (source === "measured") return { kind: "measured", simulated: false };
  if (source === "simulation") return { kind: "measured", simulated: true };
  if (source === "estimated") return { kind: "estimated", simulated: false };
  if (source === "demo") return { kind: "demo", simulated: false };
  return null;
}

// Quantities calculated from a moisture value are estimates at best.
export function derivedBadge(base: Badge | null): Badge | null {
  if (!base) return null;
  return base.kind === "demo"
    ? base
    : { kind: "estimated", simulated: base.simulated };
}

export type Freshness = {
  value: number;
  unit: "minute" | "hour" | "day";
  stale: boolean;
};
export function freshness(
  ageHours: number | null | undefined,
  apiStale = false,
): Freshness | null {
  if (ageHours == null || !Number.isFinite(ageHours) || ageHours < 0)
    return null;
  const stale = apiStale || ageHours > STALE_AFTER_HOURS;
  if (ageHours < 1)
    return { value: Math.max(1, Math.round(ageHours * 60)), unit: "minute", stale };
  if (ageHours < 24) return { value: Math.round(ageHours), unit: "hour", stale };
  return { value: Math.round(ageHours / 24), unit: "day", stale };
}

export type MoistureState = "empty" | "dry" | "good" | "wet";
export function moistureState(
  current: number | null | undefined,
  threshold: number,
  upper: number,
): MoistureState {
  if (current == null || !Number.isFinite(current)) return "empty";
  if (current < threshold) return "dry";
  if (current > upper) return "wet";
  return "good";
}

export type RingModel = {
  state: MoistureState;
  percent: number | null;
  targetPercent: number;
  fill: number;
};
// Outer ring is the target; the inner arc is current ÷ target, capped at one turn.
export function ringModel(
  current: number | null | undefined,
  target: number,
  threshold: number,
  upper: number,
): RingModel {
  const state = moistureState(current, threshold, upper);
  if (state === "empty")
    return { state, percent: null, targetPercent: Math.round(target * 100), fill: 0 };
  return {
    state,
    percent: Math.round((current as number) * 100),
    targetPercent: Math.round(target * 100),
    fill: Math.max(0, Math.min(1, (current as number) / target)),
  };
}

export type PrimaryAction = "reading" | "review";
export function primaryAction(summary: HomeSummary | null | undefined): PrimaryAction {
  if (!summary || summary.current_vwc == null || summary.needs_reading)
    return "reading";
  return "review";
}

// Application rate: the API's flow when it was supplied, otherwise the demo rate.
export function flowFor(summary: Pick<HomeSummary, "default_flow" | "flow_l_h"> | null, areaM2: number) {
  if (summary && !summary.default_flow && summary.flow_l_h > 0)
    return { litresPerHour: summary.flow_l_h, assumed: false };
  return { litresPerHour: DEMO_APPLICATION_L_PER_M2_H * areaM2, assumed: true };
}
export function minutesFor(litres: number, litresPerHour: number) {
  if (!(litres >= 0) || !(litresPerHour > 0)) return null;
  return Math.round((litres / litresPerHour) * 60);
}

export type ManualInput = {
  litres: number;
  startVwc: number;
  areaM2: number;
  rootDepthM: number;
  efficiency: number;
  target: number;
  upper: number;
  litresPerHour: number;
};
export type ManualResult = {
  afterVwc: number;
  deltaVwc: number;
  minutes: number | null;
  litresToTarget: number;
  verdict: "insufficient" | "good" | "over";
};
// Same instantaneous balance as the backend simulator:
// ΔVWC = (L / m² × efficiency) / (root_depth_m × 1000). No drainage or ET.
export function manualCalc(input: ManualInput): ManualResult | null {
  const { litres, startVwc, areaM2, rootDepthM, efficiency, target, upper } = input;
  if (
    !Number.isFinite(litres) ||
    litres < 0 ||
    !(areaM2 > 0) ||
    !(rootDepthM > 0) ||
    !(efficiency > 0 && efficiency <= 1) ||
    !Number.isFinite(startVwc)
  )
    return null;
  const deltaVwc = ((litres / areaM2) * efficiency) / (rootDepthM * 1000);
  const afterVwc = startVwc + deltaVwc;
  const litresToTarget = Math.max(
    0,
    ((target - startVwc) * rootDepthM * 1000 * areaM2) / efficiency,
  );
  const verdict =
    afterVwc > upper
      ? "over"
      : afterVwc < target - TARGET_TOLERANCE_VWC
        ? "insufficient"
        : "good";
  return {
    afterVwc,
    deltaVwc,
    minutes: minutesFor(litres, input.litresPerHour),
    litresToTarget,
    verdict,
  };
}

// Irrigated area as stored for the zone; null when it was never set.
export const irrigatedArea = (zone: Pick<Zone, "irrigated_area_m2">) =>
  zone.irrigated_area_m2 != null && zone.irrigated_area_m2 > 0 ? zone.irrigated_area_m2 : null;
// Water depth over an area: 1 L/m² = 1 mm.
export const depthMm = (litres: number, areaM2: number | null) => (areaM2 && areaM2 > 0 && litres >= 0 ? litres / areaM2 : null);
// Editable area for the calculator, kept within 1..zone area.
export function clampArea(value: number, zoneAreaM2: number) {
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(1, zoneAreaM2), Math.max(1, value));
}

export type ManualMissing = "area" | "moisture" | "rootDepth" | "efficiency";
export type ManualPlanInput = {
  litres: number | null;
  areaM2: number | null;
  startVwc: number | null | undefined;
  rootDepthM: number | null | undefined;
  efficiency: number | null | undefined;
  target: number;
  upper: number;
  litresPerHour: number;
};
export type ManualPlan = {
  missing: ManualMissing[];
  depthMm: number | null;
  litresToTarget: number | null;
  mmToTarget: number | null;
  result: ManualResult | null;
};
// The calculator only gives a verdict when every input it rests on is known.
export function manualPlan(input: ManualPlanInput): ManualPlan {
  const missing: ManualMissing[] = [];
  if (!(input.areaM2 != null && input.areaM2 > 0)) missing.push("area");
  if (input.startVwc == null || !Number.isFinite(input.startVwc)) missing.push("moisture");
  if (!(input.rootDepthM != null && input.rootDepthM > 0)) missing.push("rootDepth");
  if (!(input.efficiency != null && input.efficiency > 0 && input.efficiency <= 1)) missing.push("efficiency");
  const depth = input.litres != null && input.areaM2 ? depthMm(input.litres, input.areaM2) : null;
  if (missing.length) return { missing, depthMm: depth, litresToTarget: null, mmToTarget: null, result: null };
  const base = {
    startVwc: input.startVwc as number,
    areaM2: input.areaM2 as number,
    rootDepthM: input.rootDepthM as number,
    efficiency: input.efficiency as number,
    target: input.target,
    upper: input.upper,
    litresPerHour: input.litresPerHour,
  };
  const toTarget = manualCalc({ ...base, litres: 0 })!.litresToTarget;
  const result = input.litres != null && input.litres >= 0 ? manualCalc({ ...base, litres: input.litres }) : null;
  return { missing, depthMm: depth, litresToTarget: toTarget, mmToTarget: toTarget / base.areaM2, result };
}

export function baselineLitres(areaM2: number, days: number) {
  return DEMO_BASELINE.litresPerM2PerDay * Math.max(0, areaM2) * Math.max(0, days);
}

// Saving % = (baseline − ANBIT) ÷ baseline × 100. Null when nothing comparable exists.
export function savingPercent(
  baseline: number | null | undefined,
  anbit: number | null | undefined,
): number | null {
  if (baseline == null || !(baseline > 0) || anbit == null || !Number.isFinite(anbit))
    return null;
  return ((baseline - anbit) / baseline) * 100;
}

// Monthly saving for one zone; no recorded irrigation means nothing to compare.
export function zoneSaving(
  zone: Pick<Zone, "area_m2" | "irrigated_area_m2">,
  recordedLitres: number,
  events: number,
  days = 30,
) {
  if (!events) return null;
  return savingPercent(
    baselineLitres(zone.irrigated_area_m2 ?? zone.area_m2, days),
    recordedLitres,
  );
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const riyadhHour = (ms: number) =>
  (new Date(ms).getUTCHours() + RIYADH_OFFSET_HOURS) % 24;

export type Bucket = {
  t: number;
  baseline: number;
  anbit: number;
  baselineTotal: number;
  anbitTotal: number;
};
export type ReportModel = {
  period: Period;
  days: number;
  baseline: number;
  anbit: number;
  // Null when ANBIT has no irrigation records: there is nothing to compare.
  difference: number | null;
  saving: number | null;
  events: number;
  buckets: Bucket[];
  baselineConfigured: boolean;
};
// Buckets for the line chart: hourly today, daily for week/month, monthly for a year.
export function reportModel(
  period: Period,
  events: Pick<WaterEvent, "volume_l" | "executed_at">[],
  irrigatedAreaM2: number,
  now: number,
): ReportModel {
  const days = PERIOD_DAYS[period];
  const count = period === "day" ? 24 : period === "year" ? 12 : days;
  const width = (days * DAY) / count;
  const start = now - days * DAY;
  const rows: Bucket[] = Array.from({ length: count }, (_, i) => ({
    t: start + i * width,
    baseline: 0,
    anbit: 0,
    baselineTotal: 0,
    anbitTotal: 0,
  }));
  const daily = baselineLitres(irrigatedAreaM2, 1);
  rows.forEach((row) => {
    // A fixed timer: the whole daily volume lands in its start hour.
    row.baseline =
      period === "day"
        ? riyadhHour(row.t) === DEMO_BASELINE.startHour
          ? daily
          : 0
        : daily * (width / DAY);
  });
  let used = 0;
  for (const e of events) {
    const at = Date.parse(e.executed_at);
    if (!Number.isFinite(at) || at < start || at > now || !(e.volume_l >= 0)) continue;
    const i = Math.min(count - 1, Math.floor((at - start) / width));
    rows[i].anbit += e.volume_l;
    used += 1;
  }
  let b = 0;
  let a = 0;
  for (const row of rows) {
    b += row.baseline;
    a += row.anbit;
    row.baselineTotal = b;
    row.anbitTotal = a;
  }
  const baseline = period === "day" ? b : baselineLitres(irrigatedAreaM2, days);
  return {
    period,
    days,
    baseline,
    anbit: a,
    difference: used ? baseline - a : null,
    saving: used ? savingPercent(baseline, a) : null,
    events: used,
    buckets: rows,
    baselineConfigured: DEMO_BASELINE.configured,
  };
}

export function reportCsv(model: ReportModel, header: string[]) {
  const lines = [header.join(",")];
  for (const r of model.buckets)
    lines.push(
      [new Date(r.t).toISOString(), r.baseline.toFixed(1), r.anbit.toFixed(1)].join(","),
    );
  return lines.join("\n");
}

export type AutoInput = {
  startVwc: number;
  threshold: number;
  target: number;
  etMmDay: number;
  rootDepthM: number;
  areaM2: number;
  efficiency: number;
  litresPerHour: number;
  now: number;
  // Allowed irrigation window (Riyadh hours); may cross midnight, e.g. 18 -> 8.
  allowedStart: number;
  allowedEnd: number;
};
export type AutoPoint = { t: number; vwc: number; irrigating: boolean };
export type AutoScenario = {
  points: AutoPoint[];
  now: { t: number; vwc: number };
  start: { t: number; vwc: number } | null;
  stop: { t: number; vwc: number; litres: number; windowClosed: boolean } | null;
  next: { t: number; night: boolean } | null;
};
// Evaporation is weighted toward daytime (07:00–18:00 Riyadh) and normalised
// so a full day still removes exactly the assumed ET.
const etWeight = (hour: number) => (hour >= 7 && hour < 18 ? 1.6 : 0.4);
const ET_NORMAL = Array.from({ length: 24 }, (_, h) => etWeight(h)).reduce((s, w) => s + w, 0) / 24;
const isNight = (hour: number) => hour >= 20 || hour < 6;

// Scenario only: a simple hourly balance, never a schedule sent to hardware.
// Irrigation starts and runs only inside the allowed window (the same rules as
// the Digital Twin and the Home summary), and stops at the target or when the
// window closes.
export function autoScenario(input: AutoInput): AutoScenario | null {
  const { startVwc, threshold, target, etMmDay, rootDepthM, areaM2, efficiency, litresPerHour, now, allowedStart, allowedEnd } = input;
  if (
    !Number.isFinite(startVwc) ||
    !(rootDepthM > 0) ||
    !(areaM2 > 0) ||
    !(efficiency > 0) ||
    !(litresPerHour > 0) ||
    !(threshold < target) ||
    allowedStart % 24 === allowedEnd % 24
  )
    return null;
  const open = (t: number) => inWindow(riyadhHour(t), allowedStart, allowedEnd);
  const step = 0.25;
  const depthMm = rootDepthM * 1000;
  const gainPerStep = (litresPerHour * step * efficiency) / (areaM2 * depthMm);
  let theta = startVwc;
  let irrigating = false;
  let start: AutoScenario["start"] = null;
  let stop: AutoScenario["stop"] = null;
  let crossing: number | null = null;
  const points: AutoPoint[] = [{ t: now, vwc: theta, irrigating: false }];
  // 7-day horizon to find the next irrigation; the chart shows the first 24 h.
  for (let i = 1; i <= 168 / step; i++) {
    const t = now + i * step * HOUR;
    const hour = riyadhHour(t);
    theta = Math.max(0, theta - ((etMmDay / 24) * step * (etWeight(hour) / ET_NORMAL)) / depthMm);
    if (!start && theta <= threshold && open(t)) {
      irrigating = true;
      start = { t: i === 1 && startVwc <= threshold && open(now) ? now : t, vwc: theta };
    }
    if (irrigating) {
      if (!open(t)) {
        irrigating = false;
        stop = { t, vwc: theta, litres: (litresPerHour * (t - start!.t)) / HOUR, windowClosed: true };
      } else {
        theta += gainPerStep;
        if (theta >= target) {
          theta = target;
          irrigating = false;
          stop = { t, vwc: theta, litres: (litresPerHour * (t - start!.t)) / HOUR, windowClosed: false };
        }
      }
    } else if (stop && crossing === null && theta <= threshold) crossing = t;
    if (i % (1 / step) === 0 && i * step <= 24) points.push({ t, vwc: theta, irrigating });
  }
  let next: AutoScenario["next"] = null;
  const from = stop?.t ?? (start ? null : now);
  const until = crossing ?? (start ? null : findCrossing(points, threshold));
  if (from != null && until != null) {
    // Latest allowed hour before the projected crossing (night preferred: less
    // evaporation); if the window is closed until then, its first hour after.
    let best: number | null = null;
    for (let t = Math.ceil(from / HOUR) * HOUR; t <= until; t += HOUR) if (open(t)) best = t;
    if (best == null) for (let t = Math.ceil(until / HOUR) * HOUR; t <= until + 48 * HOUR; t += HOUR) if (open(t)) { best = t; break; }
    if (best != null) next = { t: best, night: isNight(riyadhHour(best)) };
  }
  return { points, now: { t: now, vwc: startVwc }, start, stop, next };
}
function findCrossing(points: AutoPoint[], threshold: number) {
  return points.find((p) => p.vwc <= threshold)?.t ?? null;
}

export type OpenRec = { rec: Recommendation; zone: Zone };
// Open = suggested or approved, for the zone's current data revision.
export function openRecommendations(recs: Recommendation[], zones: Zone[], first?: string): OpenRec[] {
  const byId = new Map(zones.map((z) => [z.id, z]));
  return recs
    .filter((r) => {
      const z = byId.get(r.zone_id);
      return z && r.revision === z.revision && ["suggested", "approved"].includes(r.status);
    })
    .map((rec) => ({ rec, zone: byId.get(rec.zone_id)! }))
    .sort((a, b) =>
      a.zone.id === first ? -1 : b.zone.id === first ? 1 : b.rec.created_at.localeCompare(a.rec.created_at),
    );
}
// UI hints only; the API re-checks freshness and status for every action.
export function recActions(rec: Recommendation) {
  return {
    approve: rec.status === "suggested" && rec.result.code === "review",
    defer: rec.status === "suggested" || rec.status === "approved",
    execute: rec.status === "approved",
  };
}

export type ScheduleRow = { zone_id: string; litres_per_m2_per_day: number; months: number[] };
const riyadhParts = (ms: number) => {
  const d = new Date(ms + RIYADH_OFFSET_HOURS * HOUR);
  return { day: d.toISOString().slice(0, 10), month: d.getUTCMonth() + 1 };
};
// Fixed-schedule depth (L/m²/day) for a zone in a month, or null when none is set.
export function scheduleDepth(schedules: ScheduleRow[], zoneId: string, month: number) {
  const row = schedules.find((s) => s.zone_id === zoneId && s.months.includes(month));
  return row ? row.litres_per_m2_per_day : null;
}
export type ScheduleReport = ReportModel & { estimate: number; recordDays: number };
// Comparison against baseline_schedules: the fixed schedule is counted only for
// the days and zones where ANBIT recorded irrigation, so a saving is never shown
// without records. `estimate` is the whole-period schedule, for information only.
export function scheduleReport(
  period: Period,
  events: Pick<WaterEvent, "zone_id" | "volume_l" | "executed_at">[],
  zones: Pick<Zone, "id" | "irrigated_area_m2">[],
  schedules: ScheduleRow[],
  now: number,
): ScheduleReport {
  const days = PERIOD_DAYS[period];
  const count = period === "day" ? 24 : period === "year" ? 12 : days;
  const width = (days * DAY) / count;
  const start = now - days * DAY;
  const area = new Map(zones.map((z) => [z.id, irrigatedArea(z)]));
  const rows: Bucket[] = Array.from({ length: count }, (_, i) => ({ t: start + i * width, baseline: 0, anbit: 0, baselineTotal: 0, anbitTotal: 0 }));
  const recorded = new Set<string>();
  let used = 0;
  for (const e of events) {
    const at = Date.parse(e.executed_at);
    if (!Number.isFinite(at) || at < start || at > now || !(e.volume_l >= 0) || !area.has(e.zone_id)) continue;
    const i = Math.min(count - 1, Math.floor((at - start) / width));
    rows[i].anbit += e.volume_l;
    used += 1;
    const { day, month } = riyadhParts(at);
    const key = `${e.zone_id}|${day}`;
    if (recorded.has(key)) continue;
    recorded.add(key);
    const depth = scheduleDepth(schedules, e.zone_id, month);
    const a = area.get(e.zone_id);
    if (depth != null && a) rows[i].baseline += depth * a;
  }
  let estimate = 0;
  for (let t = start; t < now; t += DAY) {
    const { month } = riyadhParts(t);
    for (const z of zones) {
      const depth = scheduleDepth(schedules, z.id, month);
      const a = area.get(z.id);
      if (depth != null && a) estimate += depth * a;
    }
  }
  let b = 0;
  let a = 0;
  for (const row of rows) {
    b += row.baseline;
    a += row.anbit;
    row.baselineTotal = b;
    row.anbitTotal = a;
  }
  return {
    period,
    days,
    baseline: b,
    anbit: a,
    difference: used ? b - a : null,
    saving: used ? savingPercent(b, a) : null,
    events: used,
    buckets: rows,
    baselineConfigured: true,
    estimate,
    recordDays: recorded.size,
  };
}

// Water class from WUCOLS when listed; otherwise derived from summer Kc and marked as such.
export function waterClass(p: { wucols_class: string | null; kc_summer: number }) {
  if (p.wucols_class) return { level: p.wucols_class, derived: false };
  const level = p.kc_summer >= 0.7 ? "high" : p.kc_summer >= 0.4 ? "moderate" : "low";
  return { level, derived: true };
}

// Today's irrigation dose (FAO-56 high-frequency irrigation). One implementation
// for the frontend; backend/app/dose.py is the same rule, and both are checked
// against tests/fixtures/daily-dose.json.
//   daily need (mm) = ET0 × Kc;  net = min(deficit to target, daily need × days to window, RAW)
//   below vwc_min (recovery): net = min((vwc_min − current) × root zone mm + daily need, RAW)
//   gross = net ÷ efficiency;  litres = gross × effective area (area × wetted fraction)
export type DoseInputs = {
  current_vwc: number | null;
  target_vwc: number | null;
  root_depth_m: number | null;
  efficiency: number | null;
  area_m2: number | null;
  wetted_fraction: number | null;
  et0_mm_day: number | null;
  kc: number | null;
  raw_mm: number | null;
  flow_lph?: number | null;
  days_to_window?: number;
  vwc_min?: number | null;
};
export type DailyDose = {
  deficit_mm: number;
  daily_need_mm: number;
  net_mm: number;
  gross_mm: number;
  effective_area_m2: number;
  litres: number;
  litres_per_m2: number;
  minutes: number | null;
  refill_days: number | null;
  recovery: boolean;
  recovery_events: number | null;
  full_refill_l: number;
};
const roundTo = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
export function dailyDose(i: DoseInputs): DailyDose | null {
  const { current_vwc, target_vwc, root_depth_m, efficiency, area_m2, et0_mm_day, kc } = i;
  if (
    current_vwc == null ||
    target_vwc == null ||
    root_depth_m == null ||
    efficiency == null ||
    area_m2 == null ||
    et0_mm_day == null ||
    kc == null ||
    !(root_depth_m > 0) ||
    !(efficiency > 0 && efficiency <= 1) ||
    !(area_m2 > 0)
  )
    return null;
  const fw = i.wetted_fraction && i.wetted_fraction > 0 && i.wetted_fraction <= 1 ? i.wetted_fraction : 1;
  const effectiveArea = area_m2 * fw;
  const deficit = Math.max(0, target_vwc - current_vwc) * root_depth_m * 1000;
  const daily = et0_mm_day * kc;
  const rawCap = i.raw_mm != null && i.raw_mm > 0 ? i.raw_mm : null;
  const recovery = i.vwc_min != null && current_vwc < i.vwc_min;
  let net: number;
  let recoveryEvents: number | null = null;
  if (recovery) {
    const need = ((i.vwc_min as number) - current_vwc) * root_depth_m * 1000 + daily;
    net = rawCap != null ? Math.min(need, rawCap) : need;
    recoveryEvents = net >= need - 1e-9 ? 1 : Math.ceil(need / net - 1e-9);
  } else {
    const caps = [deficit, daily * Math.max(1, i.days_to_window ?? 1)];
    if (rawCap != null) caps.push(rawCap);
    net = Math.max(0, Math.min(...caps));
  }
  const gross = net / efficiency;
  const litres = gross * effectiveArea;
  return {
    deficit_mm: roundTo(deficit, 3),
    daily_need_mm: roundTo(daily, 3),
    net_mm: roundTo(net, 3),
    gross_mm: roundTo(gross, 3),
    effective_area_m2: roundTo(effectiveArea, 2),
    litres: roundTo(litres, 1),
    litres_per_m2: roundTo(gross, 2),
    minutes: i.flow_lph ? Math.round((litres / i.flow_lph) * 60) : null,
    refill_days: net > 0 && deficit > net + 1e-9 ? Math.ceil(deficit / net - 1e-9) : null,
    recovery,
    recovery_events: recoveryEvents,
    full_refill_l: roundTo((deficit / efficiency) * effectiveArea, 1),
  };
}

// Zone map (Home): the zone rectangle, its sensor points coloured by their last
// reading, the coverage radius around valid points and the suggested next point.
// Coverage numbers come from the backend (engine.coverage); nothing is recomputed here.
export type PointState = "below" | "inRange" | "above" | "none";
export function pointState(vwc: number | null | undefined, vwcMin: number, target: number): PointState {
  if (vwc == null || !Number.isFinite(vwc)) return "none";
  if (vwc < vwcMin) return "below";
  if (vwc > target) return "above";
  return "inRange";
}
export type MapPoint = {
  id: string;
  name: string;
  x: number;
  y: number;
  vwc: number | null;
  measuredAt: string | null;
  origin: string | null;
  valid: boolean;
  state: PointState;
};
export type ZoneMapModel = {
  rect: { x: number; y: number; width: number; height: number };
  radius: number;
  points: MapPoint[];
  next: { x: number; y: number } | null;
  before: number;
  after: number | null;
};
const readingVwc = (r: { value: number; unit: string }) =>
  r.unit === "vwc_percent" ? r.value / 100 : r.unit === "vwc_fraction" ? r.value : null;
export function zoneMapModel(zone: Zone): ZoneMapModel {
  const cov = zone.decision.coverage;
  const rejected = new Set((cov.rejected ?? []).map((r) => r.id));
  const points = zone.points.map((p) => {
    const latest = zone.measurements
      .filter((m) => m.point_id === p.id)
      .reduce<Zone["measurements"][number] | null>((a, m) => (!a || m.measured_at > a.measured_at ? m : a), null);
    const vwc = latest ? readingVwc(latest) : null;
    return {
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      vwc,
      measuredAt: latest?.measured_at ?? null,
      origin: latest?.origin ?? null,
      valid: !!latest && !rejected.has(latest.id) && vwc != null,
      state: pointState(vwc, zone.soil.lower_vwc, zone.soil.target_vwc),
    };
  });
  const next = suggestedMeasurement(zone);
  return {
    rect: { x: zone.x, y: zone.y, width: zone.width, height: zone.height },
    radius: cov.radius_m,
    points,
    next: next ? { x: next.x, y: next.y } : null,
    before: cov.fraction,
    after: next && cov.next_point.coverage_after != null ? cov.next_point.coverage_after : null,
  };
}
