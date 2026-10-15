// Display assumptions for the Landscape Teams module. None of these values are
// measurements; every number derived from them carries the "demo" badge.

// Fixed-schedule comparison used until a real baseline is configured.
// 6 L/m² per day (≈ 6 mm/day) on a timer, every day, at 05:00 Riyadh time.
export const DEMO_BASELINE = {
  configured: false,
  litresPerM2PerDay: 6,
  startHour: 5,
} as const;

// Sprinkler application rate used for durations when the API reports its own
// default flow. 12 L/m² per hour ≈ 12 mm/h, a common spray-head rate.
export const DEMO_APPLICATION_L_PER_M2_H = 12;

// A reading older than this is shown as stale even if the API did not flag it.
export const STALE_AFTER_HOURS = 24;

// Half a percentage point of VWC below target still counts as "good".
export const TARGET_TOLERANCE_VWC = 0.005;

export const RIYADH_TZ = "Asia/Riyadh";
export const RIYADH_OFFSET_HOURS = 3;

export const PERIOD_DAYS = { day: 1, week: 7, month: 30, year: 365 } as const;
export type Period = keyof typeof PERIOD_DAYS;
