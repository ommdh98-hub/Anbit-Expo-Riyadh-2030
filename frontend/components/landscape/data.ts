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
import type { HomeSummary } from "../../lib/home";

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
  difference: number;
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
    difference: baseline - a,
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
};
export type AutoPoint = { t: number; vwc: number; irrigating: boolean };
export type AutoScenario = {
  points: AutoPoint[];
  now: { t: number; vwc: number };
  start: { t: number; vwc: number } | null;
  stop: { t: number; vwc: number; litres: number } | null;
  next: { t: number; night: boolean } | null;
};
// Evaporation is weighted toward daytime (07:00–18:00 Riyadh) and normalised
// so a full day still removes exactly the assumed ET.
const etWeight = (hour: number) => (hour >= 7 && hour < 18 ? 1.6 : 0.4);
const ET_NORMAL = Array.from({ length: 24 }, (_, h) => etWeight(h)).reduce((s, w) => s + w, 0) / 24;
const isNight = (hour: number) => hour >= 20 || hour < 6;

// Scenario only: a simple hourly balance, never a schedule sent to hardware.
export function autoScenario(input: AutoInput): AutoScenario | null {
  const { startVwc, threshold, target, etMmDay, rootDepthM, areaM2, efficiency, litresPerHour, now } = input;
  if (
    !Number.isFinite(startVwc) ||
    !(rootDepthM > 0) ||
    !(areaM2 > 0) ||
    !(efficiency > 0) ||
    !(litresPerHour > 0) ||
    !(threshold < target)
  )
    return null;
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
    if (!start && theta <= threshold) {
      irrigating = true;
      start = { t: i === 1 && startVwc <= threshold ? now : t, vwc: theta };
    }
    if (irrigating) {
      theta += gainPerStep;
      if (theta >= target) {
        theta = target;
        irrigating = false;
        stop = { t, vwc: theta, litres: (litresPerHour * (t - start!.t)) / HOUR };
      }
    } else if (stop && crossing === null && theta <= threshold) crossing = t;
    if (i % (1 / step) === 0 && i * step <= 24) points.push({ t, vwc: theta, irrigating });
  }
  let next: AutoScenario["next"] = null;
  const from = stop?.t ?? (start ? null : now);
  const until = crossing ?? (start ? null : findCrossing(points, threshold));
  if (from != null && until != null) {
    // Prefer the latest night hour before the projected crossing: less evaporation.
    let night: number | null = null;
    for (let t = Math.ceil(from / HOUR) * HOUR; t <= until; t += HOUR)
      if (isNight(riyadhHour(t))) night = t;
    next = night != null ? { t: night, night: true } : { t: until, night: false };
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
