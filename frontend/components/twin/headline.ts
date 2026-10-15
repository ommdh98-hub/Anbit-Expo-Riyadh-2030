// Picks the strongest honest headline for the results hero. Pure: reads the
// engine's results, never changes them.
import type { Results } from "../../lib/twin/engine";

export type Headline =
  // ANBIT applied nothing: rain covered the need. Shown in m³, never as "100%".
  | { kind: "rainEnough"; savedL: number }
  // ANBIT used no more water than the fixed schedule.
  | { kind: "saving"; value: number }
  // ANBIT used more water, but cut the hours below the minimum.
  | { kind: "stress"; value: number; extraWaterPct: number }
  // More water and no less stress: show the saving as it is.
  | { kind: "honest"; value: number | null };

type Input = Pick<Results, "saving" | "anbit" | "fixed">;

export function heroHeadline(r: Input): Headline {
  if (r.anbit.waterL === 0 && r.fixed.waterL > 0) return { kind: "rainEnough", savedL: r.fixed.waterL };
  if (r.saving != null && r.saving >= 0) return { kind: "saving", value: r.saving };
  const fixed = r.fixed.stressHours;
  const anbit = r.anbit.stressHours;
  if (r.saving != null && fixed > 0 && anbit < fixed)
    return { kind: "stress", value: ((fixed - anbit) / fixed) * 100, extraWaterPct: Math.abs(r.saving) };
  return { kind: "honest", value: r.saving };
}

export type Highlight =
  | { kind: "zeroWaste" }
  | { kind: "rangeTimes"; value: number }
  | { kind: "noOver" }
  | { kind: "fewerOver"; value: number };

// Minimum fixed-schedule figures before a comparison pill is meaningful.
export const PILL_MIN_FIXED_OVER_EVENTS = 5;
export const PILL_MIN_FIXED_IN_RANGE_PCT = 10;

// Small pills under the comparison table; each appears only when it is true.
export function highlights(r: Pick<Results, "anbit" | "fixed">): Highlight[] {
  const out: Highlight[] = [];
  if (r.anbit.waterL > 0 && Math.round(r.anbit.wastedL) === 0) out.push({ kind: "zeroWaste" });
  if (r.fixed.inRangePct >= PILL_MIN_FIXED_IN_RANGE_PCT) {
    // Rounded first so a pill never claims "1×".
    const times = Math.round((r.anbit.inRangePct / r.fixed.inRangePct) * 10) / 10;
    if (times > 1) out.push({ kind: "rangeTimes", value: times });
  }
  if (r.anbit.overEvents === 0) out.push({ kind: "noOver" });
  else if (r.fixed.overEvents >= PILL_MIN_FIXED_OVER_EVENTS && r.anbit.overEvents < r.fixed.overEvents)
    out.push({ kind: "fewerOver", value: ((r.fixed.overEvents - r.anbit.overEvents) / r.fixed.overEvents) * 100 });
  return out;
}

// Most of the time above the upper limit followed rain, not irrigation.
export const mostlyRain = (e: { wetHours: number; wetAfterRainHours: number }) => e.wetHours > 0 && e.wetAfterRainHours / e.wetHours > 0.5;
