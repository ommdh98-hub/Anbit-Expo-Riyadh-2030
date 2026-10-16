import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => resolve(root, p);

// Transpile the real TypeScript modules; no copies of the logic under test.
function loader(language = "ar") {
  const cache = new Map();
  const document = { documentElement: { lang: language } };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const loaded = { exports: {} };
    cache.set(path, loaded);
    const native = createRequire(path);
    const require = (name) => {
      if (!name.startsWith(".")) return native(name);
      const base = resolve(dirname(path), name);
      const file = [base, base + ".ts", base + ".tsx", base + ".mjs", base + ".json"].find(existsSync);
      if (!file) throw new Error(`Missing import ${name}`);
      if (extname(file) === ".json") return JSON.parse(readFileSync(file, "utf8"));
      if (extname(file) === ".css") return {};
      return load(file);
    };
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require, document, Intl, Date, Number, Math, console });
    return loaded.exports;
  }
  return load;
}
const load = loader();
const data = load(at("components/landscape/data.ts"));
const constants = load(at("components/landscape/constants.ts"));
// Objects come from a separate vm realm; compare their plain JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

test("badges never present an estimate or a simulated reading as a field measurement", () => {
  assert.deepEqual(plain(data.badgeFor("measured")), { kind: "measured", simulated: false });
  assert.deepEqual(plain(data.badgeFor("simulation")), { kind: "measured", simulated: true });
  assert.deepEqual(plain(data.badgeFor("estimated")), { kind: "estimated", simulated: false });
  assert.deepEqual(plain(data.badgeFor("demo")), { kind: "demo", simulated: false });
  assert.equal(data.badgeFor(null), null);
  // Litres derived from a measurement are a calculation, not a measurement.
  assert.equal(data.derivedBadge(data.badgeFor("measured")).kind, "estimated");
  assert.equal(data.derivedBadge(data.badgeFor("demo")).kind, "demo");
  assert.equal(data.derivedBadge(null), null);
});

test("freshness hint uses the largest sensible unit and flags stale readings", () => {
  assert.deepEqual(plain(data.freshness(0.2)), { value: 12, unit: "minute", stale: false });
  assert.deepEqual(plain(data.freshness(5)), { value: 5, unit: "hour", stale: false });
  assert.deepEqual(plain(data.freshness(72)), { value: 3, unit: "day", stale: true });
  assert.equal(data.freshness(3, true).stale, true);
  assert.equal(data.freshness(null), null);
  assert.equal(data.freshness(Number.NaN), null);
});

test("empty zone: empty ring, reading as the primary action, and no 'unavailable' copy", () => {
  const ring = data.ringModel(null, 0.27, 0.18, 0.36);
  assert.deepEqual(plain(ring), { state: "empty", percent: null, targetPercent: 27, fill: 0 });
  assert.equal(data.primaryAction(null), "reading");
  assert.equal(data.primaryAction({ current_vwc: null, needs_reading: false }), "reading");
  assert.equal(data.primaryAction({ current_vwc: 0.2, needs_reading: true }), "reading");
  assert.equal(data.primaryAction({ current_vwc: 0.2, needs_reading: false }), "review");

  const { MoistureRing } = load(at("components/landscape/visuals.tsx"));
  const html = renderToStaticMarkup(React.createElement(MoistureRing, { model: ring }));
  assert.match(html, /ابدأ بقراءة واحدة/);
  assert.doesNotMatch(html, /غير متاح/);
  assert.doesNotMatch(html, /lx-ring-fill/);
});

test("ring states move from dry to good to wet and cap the fill at one turn", () => {
  assert.equal(data.ringModel(0.11, 0.27, 0.18, 0.36).state, "dry");
  assert.equal(data.ringModel(0.25, 0.27, 0.18, 0.36).state, "good");
  const wet = data.ringModel(0.4, 0.27, 0.18, 0.36);
  assert.equal(wet.state, "wet");
  assert.equal(wet.fill, 1);
  assert.equal(data.ringModel(0.135, 0.27, 0.18, 0.36).fill, 0.5);
});

test("manual calculation matches the backend water balance and gives one verdict", () => {
  const base = { startVwc: 0.16, areaM2: 400, rootDepthM: 0.2, efficiency: 0.8, target: 0.27, upper: 0.36, litresPerHour: 4800 };
  // Same case as docs/DEMO.md: 1000 L on 400 m² at 0.2 m and 0.8 efficiency → 17%.
  const r = data.manualCalc({ ...base, litres: 1000 });
  assert.ok(Math.abs(r.afterVwc - 0.17) < 1e-9);
  assert.equal(r.verdict, "insufficient");
  assert.equal(r.minutes, 13);
  assert.ok(Math.abs(r.litresToTarget - 11000) < 1e-6);
  assert.equal(data.manualCalc({ ...base, litres: 11000 }).verdict, "good");
  assert.equal(data.manualCalc({ ...base, litres: 25000 }).verdict, "over");
  assert.equal(data.manualCalc({ ...base, litres: -1 }), null);
  assert.equal(data.manualCalc({ ...base, litres: Number.NaN }), null);
  assert.equal(data.manualCalc({ ...base, litres: 10, efficiency: 0 }), null);
});

test("flow falls back to the labelled demo rate only when the API used its default", () => {
  assert.deepEqual(plain(data.flowFor({ default_flow: true, flow_l_h: 400 }, 600)), {
    litresPerHour: constants.DEMO_APPLICATION_L_PER_M2_H * 600,
    assumed: true,
  });
  assert.deepEqual(plain(data.flowFor({ default_flow: false, flow_l_h: 900 }, 600)), { litresPerHour: 900, assumed: false });
  assert.equal(data.minutesFor(1200, 0), null);
});

test("saving % = (baseline − ANBIT) ÷ baseline × 100, null when nothing is comparable", () => {
  near(data.savingPercent(1000, 720), 28);
  near(data.savingPercent(1000, 1200), -20);
  assert.equal(data.savingPercent(0, 10), null);
  assert.equal(data.savingPercent(1000, null), null);
  // No recorded irrigation is not a 100% saving.
  assert.equal(data.zoneSaving({ area_m2: 400, irrigated_area_m2: 400 }, 0, 0), null);
  const baseline = constants.DEMO_BASELINE.litresPerM2PerDay * 400 * 30;
  assert.equal(data.zoneSaving({ area_m2: 400, irrigated_area_m2: 400 }, baseline / 2, 1), 50);
});

test("report model buckets recorded events against the demo fixed schedule", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const events = [
    { volume_l: 1000, executed_at: "2026-10-14T10:00:00Z" },
    { volume_l: 500, executed_at: "2026-10-10T10:00:00Z" },
    { volume_l: 9999, executed_at: "2026-09-01T10:00:00Z" }, // outside the week
  ];
  const week = data.reportModel("week", events, 100, now);
  assert.equal(week.buckets.length, 7);
  assert.equal(week.baseline, constants.DEMO_BASELINE.litresPerM2PerDay * 100 * 7);
  assert.equal(week.anbit, 1500);
  assert.equal(week.events, 2);
  assert.equal(week.saving, data.savingPercent(week.baseline, 1500));
  assert.equal(week.buckets.at(-1).anbitTotal, 1500);
  assert.equal(week.baselineConfigured, false);
  const day = data.reportModel("day", [], 100, now);
  assert.equal(day.buckets.length, 24);
  assert.equal(day.baseline, constants.DEMO_BASELINE.litresPerM2PerDay * 100);
  assert.equal(day.saving, null);
  assert.equal(data.reportModel("year", [], 100, now).buckets.length, 12);
  assert.match(data.reportCsv(week, ["a", "b", "c"]), /^a,b,c\n/);
});

test("automatic scenario starts below the minimum, stops at the target and plans the next run", () => {
  const s = data.autoScenario({
    startVwc: 0.2,
    threshold: 0.18,
    target: 0.27,
    etMmDay: 5,
    rootDepthM: 0.2,
    areaM2: 400,
    efficiency: 0.8,
    litresPerHour: 4800,
    now: Date.parse("2026-10-15T03:00:00Z"),
    allowedStart: 18,
    allowedEnd: 8,
  });
  assert.equal(s.points.length, 25);
  assert.ok(s.start && s.stop && s.next);
  const riyadhHour = (t) => (new Date(t).getUTCHours() + 3) % 24;
  assert.ok(riyadhHour(s.start.t) >= 18 || riyadhHour(s.start.t) < 8);
  assert.ok(s.start.vwc <= 0.18);
  assert.equal(s.stop.vwc, 0.27);
  assert.ok(s.stop.t > s.start.t && s.next.t > s.stop.t);
  assert.equal(data.autoScenario({ startVwc: Number.NaN, threshold: 0.18, target: 0.27, etMmDay: 5, rootDepthM: 0.2, areaM2: 1, efficiency: 1, litresPerHour: 1, now: 0, allowedStart: 18, allowedEnd: 8 }), null);
});

test("role guard: only survey reaches /landscape", () => {
  assert.equal(data.landscapeAccess("checking"), "checking");
  assert.equal(data.landscapeAccess("anonymous"), "login");
  assert.equal(data.landscapeAccess("error"), "login");
  assert.equal(data.landscapeAccess("ready", "user"), "forbidden");
  assert.equal(data.landscapeAccess("ready", "survey"), "allowed");
  assert.equal(data.landscapeAccess("ready", "admin"), "forbidden");
  const layout = readFileSync(at("app/landscape/layout.tsx"), "utf8");
  assert.match(layout, /<LandscapeGuard>/);
  const guard = readFileSync(at("components/landscape/guard.tsx"), "utf8");
  assert.match(guard, /landscapeAccess\(status, profile\?\.role\)/);
  assert.match(guard, /access === "allowed" && profile/);
});

test("open recommendations follow the zone revision and keep the selected zone first", () => {
  const zones = [
    { id: "a", revision: 2 },
    { id: "b", revision: 1 },
  ];
  const recs = [
    { id: "1", zone_id: "a", revision: 1, status: "suggested", created_at: "2026-10-15", result: { code: "review" } },
    { id: "2", zone_id: "a", revision: 2, status: "approved", created_at: "2026-10-14", result: { code: "review" } },
    { id: "3", zone_id: "b", revision: 1, status: "suggested", created_at: "2026-10-15", result: { code: "measure" } },
    { id: "4", zone_id: "b", revision: 1, status: "executed", created_at: "2026-10-15", result: { code: "review" } },
  ];
  assert.deepEqual(plain(data.openRecommendations(recs, zones, "a").map((o) => o.rec.id)), ["2", "3"]);
  assert.deepEqual(plain(data.recActions(recs[2])), { approve: false, defer: true, execute: false });
  assert.deepEqual(plain(data.recActions(recs[1])), { approve: false, defer: true, execute: true });
  assert.deepEqual(plain(data.recActions(recs[0])), { approve: true, defer: true, execute: false });
});

test("manual calculator: the same litres on 50 m² and 720 m² give different verdicts", () => {
  const base = { litres: 5400, startVwc: 0.16, rootDepthM: 0.15, efficiency: 0.7, target: 0.22, upper: 0.27, litresPerHour: 8640 };
  const small = data.manualPlan({ ...base, areaM2: 50 });
  const large = data.manualPlan({ ...base, areaM2: 720 });
  assert.deepEqual(plain(small.missing), []);
  assert.equal(small.result.verdict, "over");
  assert.equal(large.result.verdict, "insufficient");
  assert.ok(Math.abs(small.depthMm - 108) < 1e-9);
  assert.ok(Math.abs(large.depthMm - 7.5) < 1e-9);
  // Moisture after = current + litres × efficiency ÷ (area × root depth × 1000).
  assert.ok(Math.abs(large.result.afterVwc - (0.16 + (5400 * 0.7) / (720 * 0.15 * 1000))) < 1e-12);
  // Litres and mm to reach the target depend on the chosen area.
  assert.ok(Math.abs(large.litresToTarget - ((0.22 - 0.16) * 0.15 * 1000 * 720) / 0.7) < 1e-6);
  assert.ok(Math.abs(large.mmToTarget - large.litresToTarget / 720) < 1e-9);
  const exact = data.manualPlan({ ...base, areaM2: 720, litres: large.litresToTarget });
  assert.equal(exact.result.verdict, "good");
});

test("manual calculator: no verdict when the area, moisture or root depth is missing", () => {
  const base = { litres: 1000, areaM2: 400, startVwc: 0.16, rootDepthM: 0.3, efficiency: 0.9, target: 0.22, upper: 0.27, litresPerHour: 2000 };
  const noArea = data.manualPlan({ ...base, areaM2: null });
  assert.equal(noArea.result, null);
  assert.deepEqual(plain(noArea.missing), ["area"]);
  assert.equal(noArea.litresToTarget, null);
  assert.deepEqual(plain(data.manualPlan({ ...base, startVwc: null }).missing), ["moisture"]);
  assert.deepEqual(plain(data.manualPlan({ ...base, rootDepthM: null, efficiency: undefined }).missing), ["rootDepth", "efficiency"]);
  assert.equal(data.manualPlan({ ...base, rootDepthM: null }).result, null);
  // The editable area stays within 1..zone area.
  assert.equal(data.clampArea(0, 720), 1);
  assert.equal(data.clampArea(5000, 720), 720);
  assert.equal(data.clampArea(Number.NaN, 720), null);
  assert.equal(data.depthMm(5400, 720), 7.5);
  assert.equal(data.irrigatedArea({ irrigated_area_m2: null }), null);
});

test("reports: zero ANBIT records show no saving and no difference", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const empty = data.reportModel("month", [], 2840, now);
  assert.equal(empty.events, 0);
  assert.equal(empty.saving, null);
  assert.equal(empty.difference, null);
  assert.ok(empty.baseline > 0);
  const one = data.reportModel("month", [{ volume_l: 1000, executed_at: "2026-10-10T03:00:00Z" }], 2840, now);
  assert.equal(one.difference, one.baseline - 1000);
  assert.ok(one.saving != null);
  const page = readFileSync(at("components/landscape/reports-screen.tsx"), "utf8");
  assert.match(page, /لا توجد عمليات ري مسجلة لأنبت في هذه الفترة/);
  assert.match(page, /مقارنة استهلاك المياه/);
  assert.doesNotMatch(page, /id: "day"/);
});

test("reports: the fixed schedule counts only days and zones with ANBIT records", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const zones = [
    { id: "z1", irrigated_area_m2: 600 },
    { id: "z3", irrigated_area_m2: 400 },
  ];
  const schedules = [
    { zone_id: "z1", litres_per_m2_per_day: 6, months: [3, 4, 5, 10, 11] },
    { zone_id: "z3", litres_per_m2_per_day: 3, months: [3, 4, 5, 10, 11] },
  ];
  const none = data.scheduleReport("month", [], zones, schedules, now);
  assert.equal(none.saving, null);
  assert.equal(none.difference, null);
  assert.equal(none.baseline, 0);
  assert.ok(none.estimate > 0);
  // Two events for z1 on the same Riyadh day: the schedule is counted once.
  const events = [
    { zone_id: "z1", volume_l: 1000, executed_at: "2026-10-10T03:00:00Z" },
    { zone_id: "z1", volume_l: 500, executed_at: "2026-10-10T05:00:00Z" },
  ];
  const r = data.scheduleReport("month", events, zones, schedules, now);
  assert.equal(r.recordDays, 1);
  assert.equal(r.baseline, 6 * 600);
  assert.equal(r.anbit, 1500);
  assert.equal(r.difference, 3600 - 1500);
  assert.ok(Math.abs(r.saving - ((3600 - 1500) / 3600) * 100) < 1e-9);
  assert.equal(data.scheduleDepth(schedules, "z3", 7), null);
  assert.deepEqual(plain(data.waterClass({ wucols_class: "low", kc_summer: 0.3 })), { level: "low", derived: false });
  assert.deepEqual(plain(data.waterClass({ wucols_class: null, kc_summer: 0.8 })), { level: "high", derived: true });
});

test("irrigation scenario: starts and runs only inside the zone's window (18→08, 22→04, 04→09)", () => {
  const window = load(at("lib/twin/window.ts"));
  const riyadhHour = (t) => (new Date(t).getUTCHours() + 3) % 24;
  for (const [start, end] of [
    [18, 8],
    [22, 4],
    [4, 9],
  ]) {
    // Already below the minimum at 13:00 Riyadh: it must wait for the window.
    const s = data.autoScenario({
      startVwc: 0.15,
      threshold: 0.18,
      target: 0.22,
      etMmDay: 6,
      rootDepthM: 0.25,
      areaM2: 400,
      efficiency: 0.7,
      litresPerHour: 6000,
      now: Date.parse("2026-10-15T10:00:00Z"),
      allowedStart: start,
      allowedEnd: end,
    });
    assert.ok(s.start, `${start}-${end}`);
    assert.equal(riyadhHour(s.start.t), start, `starts when the window opens: ${start}-${end}`);
    for (const p of s.points) if (p.irrigating) assert.ok(window.inWindow(riyadhHour(p.t), start, end), `${start}-${end} at ${riyadhHour(p.t)}`);
    if (s.next) assert.ok(window.inWindow(riyadhHour(s.next.t), start, end));
  }
  assert.equal(data.autoScenario({ startVwc: 0.15, threshold: 0.18, target: 0.22, etMmDay: 6, rootDepthM: 0.25, areaM2: 400, efficiency: 0.7, litresPerHour: 6000, now: 0, allowedStart: 6, allowedEnd: 6 }), null);
});

test("full refill keeps the earlier figure: 600 m² of sand from 6% to 9.4% is 7,286 L ±1 (12.1 L/m²)", () => {
  const d = data.dailyDose({ current_vwc: 0.06, target_vwc: 0.094, root_depth_m: 0.25, efficiency: 0.7, area_m2: 600, wetted_fraction: 1, et0_mm_day: 5.54, kc: 0.718, raw_mm: 7.5, flow_lph: 9000 });
  assert.ok(Math.abs(d.full_refill_l - 7286) <= 1, String(d.full_refill_l));
  assert.equal(Math.round((d.full_refill_l / 600) * 10) / 10, 12.1);
  // Today's dose is far smaller: one day's need, capped by RAW.
  assert.ok(d.litres < d.full_refill_l / 1.5);
});

test("Western digits in Arabic mode through one shared locale", () => {
  const copy = readFileSync(at("components/landscape/copy.ts"), "utf8");
  assert.match(copy, /AR_LOCALE = "ar-SA-u-nu-latn"/);
  assert.doesNotMatch(copy, /"ar-SA"[^-]/);
  assert.equal(new Intl.NumberFormat("ar-SA-u-nu-latn").format(7286), "7,286");
  assert.match(new Date(Date.UTC(2026, 9, 15, 22, 26)).toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }), /^1:26 ص$/);
  const results = readFileSync(at("components/twin/results.tsx"), "utf8");
  assert.doesNotMatch(results, /"ar-SA"/);
});

test("login and twin copy: no emoji, no ENBT in visible text, Arabic login without English eyebrow", () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const f of ["components/auth-gate.tsx", "components/landscape/home-screen.tsx", "components/twin/setup.tsx", "components/twin/results.tsx", "components/twin/control-room.tsx"])
    assert.doesNotMatch(readFileSync(at(f), "utf8"), emoji, f);
  assert.match(readFileSync(at("components/auth-gate.tsx"), "utf8"), /language === "en" && <span className="reference-eyebrow">WELCOME TO ANBIT<\/span>/);
  const visible = /قاعدة ENBT|مقتطف ENBT|ENBT\.db|ENBT database|no ENBT value/;
  for (const f of ["components/twin/setup.tsx", "components/twin/results.tsx", "components/plant-city-explorer.tsx"]) assert.doesNotMatch(readFileSync(at(f), "utf8"), visible, f);
  const translations = JSON.parse(readFileSync(at("lib/translations.json"), "utf8"));
  const explorer = readFileSync(at("components/plant-city-explorer.tsx"), "utf8");
  for (const [k, v] of Object.entries(translations)) if (explorer.includes(k)) assert.doesNotMatch(`${k} ${v}`, visible, k);
});

test("today's dose: the frontend matches the shared case table (same rule as the backend)", () => {
  const { cases, month } = JSON.parse(readFileSync(at("tests/fixtures/daily-dose.json"), "utf8"));
  assert.equal(month, 10);
  assert.equal(cases.length, 5);
  const tol = { deficit_mm: 6e-4, daily_need_mm: 6e-4, net_mm: 6e-4, gross_mm: 6e-4, effective_area_m2: 6e-3, litres: 0.06, litres_per_m2: 6e-3, full_refill_l: 0.06 };
  for (const c of cases) {
    const d = data.dailyDose(c.inputs);
    for (const [k, t] of Object.entries(tol)) assert.ok(Math.abs(d[k] - c.expected[k]) <= t, `${c.zone} ${k}: ${d[k]} vs ${c.expected[k]}`);
    assert.equal(d.minutes, c.expected.minutes, `${c.zone} minutes`);
    assert.equal(d.refill_days, c.expected.refill_days, `${c.zone} refill days`);
    assert.equal(d.recovery, c.expected.recovery, `${c.zone} recovery`);
    assert.equal(d.recovery_events, c.expected.recovery_events, `${c.zone} recovery events`);
  }
});

test("recovery dose: a zone below vwc_min is brought back above it in one event, capped by RAW", () => {
  const { cases, stressed_cases } = JSON.parse(readFileSync(at("tests/fixtures/daily-dose.json"), "utf8"));
  assert.equal(stressed_cases.length, 5);
  const tol = { net_mm: 6e-4, gross_mm: 6e-4, litres: 0.06, litres_per_m2: 6e-3, full_refill_l: 0.06 };
  for (const c of stressed_cases) {
    const i = c.inputs;
    const d = data.dailyDose(i);
    for (const [k, t] of Object.entries(tol)) assert.ok(Math.abs(d[k] - c.expected[k]) <= t, `${c.zone} ${k}: ${d[k]} vs ${c.expected[k]}`);
    assert.equal(d.minutes, c.expected.minutes, `${c.zone} minutes`);
    assert.equal(d.refill_days, c.expected.refill_days, `${c.zone} refill days`);
    assert.equal(d.recovery, true);
    assert.equal(d.recovery_events, 1);
    const rootMm = i.root_depth_m * 1000;
    near(d.net_mm, Math.round(Math.min((i.vwc_min - i.current_vwc) * rootMm + i.et0_mm_day * i.kc, i.raw_mm) * 1000) / 1000);
    assert.ok(d.net_mm <= i.raw_mm + 1e-9);
    assert.ok(i.current_vwc + d.net_mm / rootMm >= i.vwc_min - 1e-9, c.zone);
  }
  // الممر الأخضر as on Home (12.9% vs 13.8%): within the acceptance limits.
  const z5 = data.dailyDose(stressed_cases.find((c) => c.zone === "z5").inputs);
  assert.ok(z5.litres <= 1500 && z5.litres / z5.effective_area_m2 <= 10);
  // Zones within range keep the same dose with or without vwc_min.
  for (const c of cases) {
    const { vwc_min, ...rest } = c.inputs;
    assert.ok(c.inputs.current_vwc >= vwc_min);
    assert.deepEqual(plain(data.dailyDose(c.inputs)), plain(data.dailyDose(rest)));
    assert.equal(data.dailyDose(c.inputs).recovery, false);
  }
  // RAW caps the recovery: 25 mm below the minimum + 3 mm daily need, RAW 10 mm → 3 events.
  const capped = data.dailyDose({ current_vwc: 0.1, target_vwc: 0.2, root_depth_m: 0.5, efficiency: 0.9, area_m2: 10, wetted_fraction: 1, et0_mm_day: 6, kc: 0.5, raw_mm: 10, vwc_min: 0.15 });
  assert.equal(capped.net_mm, 10);
  assert.equal(capped.recovery_events, 3);
});

test("today's dose acceptance (October 2025, Riyadh): ≤ 1,500 L and ≤ 10 L/m² of effective area per zone", () => {
  const { cases } = JSON.parse(readFileSync(at("tests/fixtures/daily-dose.json"), "utf8"));
  for (const c of cases) {
    const d = data.dailyDose(c.inputs);
    assert.ok(d.litres <= 1500, `${c.zone} ${d.litres} L`);
    assert.ok(d.litres / d.effective_area_m2 <= 10, `${c.zone} ${d.litres_per_m2} L/m²`);
    // Never more than RAW in one event, never more than the deficit.
    assert.ok(d.net_mm <= c.inputs.raw_mm + 1e-9 && d.net_mm <= d.deficit_mm + 1e-9);
    // Drip uses the wetted area; spray the whole area.
    const fw = c.method === "drip" ? 0.4 : 1;
    assert.equal(c.inputs.wetted_fraction, fw);
    assert.ok(Math.abs(d.effective_area_m2 - c.inputs.area_m2 * fw) < 1e-9);
    // Demo readings start near the trigger, never below the minimum.
    assert.ok(c.inputs.current_vwc >= c.vwc_min - 1e-9 && c.inputs.current_vwc <= c.vwc_min + 0.2 * (c.inputs.target_vwc - c.vwc_min) + 1e-9, c.zone);
  }
  // RAW caps a very dry, deep-rooted case.
  const capped = data.dailyDose({ current_vwc: 0.05, target_vwc: 0.3, root_depth_m: 1, efficiency: 0.9, area_m2: 100, wetted_fraction: 1, et0_mm_day: 20, kc: 1, raw_mm: 12, days_to_window: 3 });
  assert.equal(capped.net_mm, 12);
  assert.equal(capped.refill_days, Math.ceil(250 / 12));
  assert.equal(data.dailyDose({ current_vwc: null, target_vwc: 0.2, root_depth_m: 0.3, efficiency: 0.9, area_m2: 10, wetted_fraction: 1, et0_mm_day: 5, kc: 0.5, raw_mm: 10 }), null);
  // The Home and Irrigation cards no longer show "lasts about".
  for (const f of ["components/landscape/home-screen.tsx", "components/landscape/irrigation-screen.tsx", "components/landscape/copy.ts", "components/landscape/dose-lines.tsx"])
    assert.doesNotMatch(readFileSync(at(f), "utf8"), /يكفي نحو/, f);
  assert.match(readFileSync(at("components/landscape/dose-lines.tsx"), "utf8"), /لتر — الرية القادمة/);
  assert.doesNotMatch(readFileSync(at("components/landscape/dose-lines.tsx"), "utf8"), /ري اليوم/);
});

test("dose wording: one moisture condition for the Home hero, the Home card and the Irrigation card", () => {
  const { doseMoisture, DoseLines } = load(at("components/landscape/dose-lines.tsx"));
  // vwc_min 7%, target 9.4% (paspalum on sand).
  assert.equal(doseMoisture(0.0724, 0.07, 0.094), "inRange");
  assert.equal(doseMoisture(0.07, 0.07, 0.094), "inRange");
  assert.equal(doseMoisture(0.069, 0.07, 0.094), "below");
  assert.equal(doseMoisture(0.094, 0.07, 0.094), null);
  assert.equal(doseMoisture(null, 0.07, 0.094), null);
  const c = { t: (ar) => ar, num: (n) => String(Math.round(n * 10) / 10), area: (a) => `${a} م²` };
  const render = (moisture, refill_days, recovery_events = null) =>
    renderToStaticMarkup(
      React.createElement(DoseLines, {
        c,
        dose: { litres: 852.4, litres_per_m2: 5.68, effective_area_m2: 150, minutes: 23, refill_days, recovery: recovery_events != null, recovery_events },
        method: "spray",
        moisture,
        valueClass: "v",
        subClass: "s",
      }),
    );
  const inRange = render("inRange", 2);
  assert.match(inRange, /852\.4 لتر — الرية القادمة/);
  assert.match(inRange, /ضمن النطاق الصحي؛ الرية القادمة تعوّض استهلاك يوم/);
  assert.doesNotMatch(inRange, /الرطوبة أقل من الهدف|تكتمل خلال/);
  const below = render("below", 5, 1);
  assert.match(below, /جرعة استعادة: ترجع الرطوبة إلى النطاق الصحي في رية واحدة/);
  assert.doesNotMatch(below, /ضمن النطاق الصحي؛|تكتمل خلال/);
  assert.match(render("below", 9, 3), /جرعة استعادة: ترجع الرطوبة إلى النطاق الصحي خلال 3 ريات/);
  assert.match(render("below", 9, 2), /خلال ريتين/);
  // Home and Irrigation both use the shared condition; the hero changes only in range.
  const home = readFileSync(at("components/landscape/home-screen.tsx"), "utf8");
  const irrigation = readFileSync(at("components/landscape/irrigation-screen.tsx"), "utf8");
  assert.match(home, /heroMoisture === "inRange"[\s\S]*الري في النافذة القادمة[\s\S]*لا حاجة للري الآن/);
  assert.match(home, /moisture=\{cardMoisture\}/);
  assert.match(home, /الوصول إلى الهدف/);
  assert.match(irrigation, /moisture=\{doseMoisture\(/);
  for (const f of [home, irrigation]) assert.doesNotMatch(f, /function doseMoisture|< ?soil\.lower_vwc/);
});

// Digital Twin section on the Reports page (simulation only).
const twinCopy = {
  t: (ar) => ar,
  num: (n, d = 0) => String(Math.round(n * 10 ** d) / 10 ** d),
  area: (m2) => `${m2} م²`,
  day: () => "16 أكتوبر 2026",
};
const twinReport = () => load(at("components/landscape/twin-report.tsx"));
const lastRunModule = () => load(at("components/twin/last-run.ts"));
const auditFile = () => JSON.parse(readFileSync(resolve(root, "../research/simulation/audit_weather_real2025.json"), "utf8"));
const auditSummary = () => JSON.parse(readFileSync(at("lib/twin/audit-summary.json"), "utf8"));
const fakeStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
const fakeResults = {
  config: { city: "riyadh", season: "spring", weather: "real2025", days: 28 },
  anbit: { waterL: 312_340, stressHours: 61.26, inRangePct: 97.04 },
  sensor: { waterL: 330_000, stressHours: 210, inRangePct: 88.5 },
  fixed: { waterL: 300_100, stressHours: 640.5, inRangePct: 70.25 },
};

test("twin report: the audit summary is copied from the real-2025 audit file, not typed", () => {
  const a = auditFile();
  const s = auditSummary();
  assert.equal(s.source, "research/simulation/audit_weather_real2025.json");
  assert.deepEqual([s.city, s.weather, s.seeds, s.days], [a.city, a.weather, a.seeds, a.days]);
  for (const season of ["summer", "winter", "spring"]) {
    for (const k of ["anbit", "sensor", "fixed"]) {
      const { waterM3, stressH, inRangePct } = a.bySeason[season][k];
      assert.deepEqual(s.seasons[season][k], { waterM3, stressH, inRangePct }, `${season} ${k}`);
    }
    assert.equal(s.seasons[season].savingVsFixedPct, a.bySeason[season].savingVsFixedPct);
  }
  // Site area: the engine's sections for the audit's configuration.
  const engine = load(at("lib/twin/engine.ts"));
  const sections = engine.sectionsFor(engine.defaultConfig({ season: "summer", seed: 1, days: a.days, city: a.city, weather: a.weather }));
  assert.equal(s.sections, sections.length);
  assert.equal(s.siteAreaM2, sections.reduce((t, x) => t + x.areaM2, 0));
});

test("twin report: the section renders each season from the audit values, with badge and footnote", () => {
  const { TwinReport } = twinReport();
  const a = auditFile();
  for (const season of ["summer", "winter", "spring"]) {
    const html = renderToStaticMarkup(React.createElement(TwinReport, { c: twinCopy, summary: auditSummary(), lastRun: null, initialSeason: season }));
    assert.match(html, /نتائج المحاكاة — التوأم الرقمي/);
    assert.match(html, /محاكاة — لا تؤثر على بيانات التشغيل/);
    assert.match(html, /طقس الرياض 2025 الفعلي · 5 تشغيلات × 28 يومًا لكل موسم/);
    assert.match(html, /12 قطاعًا بمساحة 2610 م²/);
    assert.match(html, /نتائج التوأم محاكاة على جدول ثابت مفترض، والتوفير الفعلي يُقاس من سجلات الري في الموقع\./);
    for (const label of ["أنبت", "آلي بالحساسات", "جدول ثابت", "المياه \\(م³\\)", "ساعات الإجهاد", "الوقت داخل النطاق الصحي"]) assert.match(html, new RegExp(label));
    const s = a.bySeason[season];
    for (const k of ["anbit", "sensor", "fixed"]) {
      assert.ok(html.includes(`>${twinCopy.num(s[k].waterM3, 1)}<`), `${season} ${k} water`);
      assert.ok(html.includes(`>${twinCopy.num(s[k].stressH, 1)}<`), `${season} ${k} stress`);
      assert.ok(html.includes(`>${twinCopy.num(s[k].inRangePct, 1)}%<`), `${season} ${k} in range`);
    }
    const stress = ((s.fixed.stressH - s.anbit.stressH) / s.fixed.stressH) * 100;
    const water = -s.savingVsFixedPct;
    const waterText = water > 0 ? `ومياه أكثر ${twinCopy.num(water, 1)}%` : water < 0 ? `ومياه أقل ${twinCopy.num(-water, 1)}%` : "ومياه مساوية";
    assert.ok(html.includes(`ساعات إجهاد أقل ${twinCopy.num(stress, 1)}% من الجدول الثابت، ${waterText}`), season);
  }
  // Summer as in the audit: 77.5% fewer stress hours, 2.5% more water.
  const summer = renderToStaticMarkup(React.createElement(TwinReport, { c: twinCopy, summary: auditSummary(), lastRun: null }));
  assert.match(summer, /ساعات إجهاد أقل 77\.5% من الجدول الثابت، ومياه أكثر 2\.5%/);
});

test("twin report: empty state when no simulation has been run", () => {
  const { TwinReport } = twinReport();
  const html = renderToStaticMarkup(React.createElement(TwinReport, { c: twinCopy, summary: auditSummary(), lastRun: null }));
  assert.match(html, /آخر محاكاة/);
  assert.match(html, /لم تُشغَّل محاكاة بعد/);
  assert.match(html, /<a[^>]*href="\/twin"[^>]*>شغّل محاكاة<\/a>/);
  assert.doesNotMatch(html, /افتح في التوأم/);
  const { readLastRun } = lastRunModule();
  assert.equal(readLastRun(fakeStore()), null);
  assert.equal(readLastRun(null), null);
});

test("twin report: a finished run is saved to storage and shown with a link back to the twin", () => {
  const { saveLastRun, readLastRun, LAST_RUN_KEY } = lastRunModule();
  const store = fakeStore();
  saveLastRun(fakeResults, store, new Date("2026-10-16T09:00:00Z"));
  const run = plain(readLastRun(store));
  assert.deepEqual(run, {
    version: 1,
    savedAt: "2026-10-16T09:00:00.000Z",
    city: "riyadh",
    season: "spring",
    weather: "real2025",
    days: 28,
    anbit: { waterM3: 312.3, stressH: 61.3, inRangePct: 97 },
    sensor: { waterM3: 330, stressH: 210, inRangePct: 88.5 },
    fixed: { waterM3: 300.1, stressH: 640.5, inRangePct: 70.3 },
  });
  const { TwinReport } = twinReport();
  const html = renderToStaticMarkup(React.createElement(TwinReport, { c: twinCopy, summary: auditSummary(), lastRun: run }));
  assert.match(html, /16 أكتوبر 2026 · الرياض · ربيع · طقس 2025 الفعلي · 28 يومًا/);
  assert.match(html, /<a[^>]*href="\/twin"[^>]*>افتح في التوأم<\/a>/);
  assert.doesNotMatch(html, /لم تُشغَّل محاكاة بعد/);
  for (const v of [">312.3<", ">61.3<", ">97%<", ">640.5<"]) assert.ok(html.includes(v), v);
  // Broken or blocked storage never throws and falls back to the empty state.
  store.setItem(LAST_RUN_KEY, "{not json");
  assert.equal(readLastRun(store), null);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => saveLastRun(fakeResults, blocked));
  assert.equal(readLastRun(blocked), null);
  // The twin saves the summary when a run finishes.
  assert.match(readFileSync(at("components/twin/twin-app.tsx"), "utf8"), /if \(sim\.res\) saveLastRun\(sim\.res\)/);
});

test("twin report: operational cards and totals stay operational, with zero records", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const empty = data.reportModel("month", [], 2840, now);
  assert.equal(empty.events, 0);
  assert.equal(empty.anbit, 0);
  assert.equal(empty.saving, null);
  assert.equal(empty.difference, null);
  const page = readFileSync(at("components/landscape/reports-screen.tsx"), "utf8");
  // The section is mounted once, after the operational report, and takes no operational data.
  const mount = page.indexOf("<TwinReportSection />");
  assert.ok(mount > page.indexOf("lx-zone-table") && mount > page.indexOf("lx-report-actions"));
  assert.equal(page.split("<TwinReportSection").length, 2);
  const operational = page.slice(0, mount);
  for (const twinTerm of [/audit-summary/, /last-run/, /lastRun/, /siteAreaM2/, /waterM3/, /stressH/, /التوأم/]) assert.doesNotMatch(operational, twinTerm);
  assert.match(page, /لا توجد عمليات ري مسجلة لأنبت في هذه الفترة/);
  assert.match(page, /ولا تُحسب نسبة توفير دون سجلات/);
  // The twin section reads no operational data.
  const section = readFileSync(at("components/landscape/twin-report.tsx"), "utf8");
  for (const op of [/from "\.\/data"/, /lib\/api/, /useLandscape/, /reportModel|scheduleReport/]) assert.doesNotMatch(section, op);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const f of ["components/landscape/twin-report.tsx", "components/twin/last-run.ts"]) assert.doesNotMatch(readFileSync(at(f), "utf8"), emoji, f);
});

// Zone map on Home (shapes and coverage from the backend via the demo-seed fixture).
const mapCopy = {
  t: (ar) => ar,
  num: (n, d = 0) => String(Math.round(n * 10 ** d) / 10 ** d),
  day: () => "16 أكتوبر",
  time: () => "9:00 ص",
  show: (s) => s,
};
const mapZones = () => JSON.parse(readFileSync(at("tests/fixtures/zone-map.json"), "utf8")).zones;
const zoneMap = () => load(at("components/landscape/zone-map.tsx"));
const renderMap = (zone, highlight = false) =>
  renderToStaticMarkup(React.createElement(zoneMap().default, { c: mapCopy, zone, highlight }));

test("zone map: renders each demo zone with its shape, sensor points and suggested point", () => {
  const zones = mapZones();
  assert.deepEqual(zones.map((z) => z.width * z.height), [150, 120, 80, 200, 100]);
  for (const z of zones) {
    const html = renderMap(z);
    assert.match(html, new RegExp(`data-zone="${z.id}"`));
    assert.match(html, new RegExp(`class="lx-map-outline" x="${z.x}" y="${z.y}" width="${z.width}" height="${z.height}"`));
    assert.equal((html.match(/class="lx-map-pt /g) || []).length, z.points.length, z.id);
    assert.match(html, /مقاس[\s\S]*تقديري[\s\S]*مقترح/);
    for (const p of z.points) assert.ok(p.x >= z.x && p.x <= z.x + z.width && p.y >= z.y && p.y <= z.y + z.height, p.id);
    // Suggested point inside the shape.
    const m = html.match(/class="lx-map-next" data-x="([\d.]+)" data-y="([\d.]+)"/);
    assert.ok(m, z.id);
    const [x, y] = [Number(m[1]), Number(m[2])];
    assert.ok(x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height, `${z.id} ${x},${y}`);
    // Coverage shading only around valid points (z5 readings are stale).
    const valid = data.zoneMapModel(z).points.filter((p) => p.valid).length;
    assert.equal((html.match(/class="lx-map-cover"/g) || []).length, valid, z.id);
  }
  assert.equal(data.zoneMapModel(zones[4]).points.filter((p) => p.valid).length, 0);
});

test("zone map: «أين أقيس؟» pulses the suggested point and shows coverage before and after", () => {
  const zones = mapZones();
  const lines = {
    z1: "القراءة هنا ترفع التغطية من 76.5% إلى 86.75%",
    z2: "القراءة هنا ترفع التغطية من 60% إلى 69.75%",
    z3: "التغطية 100%؛ القراءة هنا اختيارية لتحسين التوزيع",
    z4: "القراءة هنا ترفع التغطية من 76% إلى 78.5%",
    z5: "القراءة هنا ترفع التغطية من 0% إلى 30%",
  };
  for (const z of zones) {
    const m = data.zoneMapModel(z);
    if (m.before < 1) assert.ok(m.after > m.before, z.id);
    else assert.equal(m.after, m.before);
    const off = renderMap(z, false);
    assert.doesNotMatch(off, /lx-map-pulse|ترفع التغطية/);
    const on = renderMap(z, true);
    assert.match(on, /class="lx-map-next is-on"/);
    assert.match(on, /class="lx-map-pulse"/);
    assert.ok(on.includes(lines[z.id]), `${z.id}: ${on.match(/lx-map-line[^>]*>([^<]*)/)?.[1]}`);
  }
  const home = readFileSync(at("components/landscape/home-screen.tsx"), "utf8");
  assert.match(home, /<ZoneMap key=\{zone\.id\} c=\{c\} zone=\{zone\} highlight=\{whereFor === zone\.id\} \/>/);
  assert.match(home, /setWhereFor\(whereFor === zone\.id \? null : zone\.id\)/);
  assert.doesNotMatch(home, /WhereSheet/);
  assert.match(home, /leaf=\{false\}/);
});

test("zone map: sensor colours follow the zone thresholds", () => {
  assert.equal(data.pointState(0.069, 0.07, 0.094), "below");
  assert.equal(data.pointState(0.07, 0.07, 0.094), "inRange");
  assert.equal(data.pointState(0.094, 0.07, 0.094), "inRange");
  assert.equal(data.pointState(0.095, 0.07, 0.094), "above");
  assert.equal(data.pointState(null, 0.07, 0.094), "none");
  const z1 = structuredClone(mapZones()[0]);
  // Latest reading per point: one below min, one in range, one above target.
  const latest = (pid) => z1.measurements.filter((r) => r.point_id === pid).sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1))[0];
  latest("z1-p1").value = 6.5;
  latest("z1-p2").value = 8;
  latest("z1-p3").value = 9.8;
  const html = renderMap(z1);
  const states = [...html.matchAll(/class="lx-map-pt is-(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(states, ["below", "inRange", "above"]);
  // Stale points are drawn hollow, not coloured as a measurement.
  const z5 = renderMap(mapZones()[4]);
  assert.deepEqual([...new Set([...z5.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]))], ["stale"]);
  const css = readFileSync(at("components/landscape/landscape.css"), "utf8");
  for (const [cls, token] of [["is-below", "--lx-dry"], ["is-inRange", "--lx-good"], ["is-above", "--lx-wet"]])
    assert.match(css, new RegExp(`\\.lx-map-pt\\.${cls} \\{\\s*fill: var\\(${token}\\)`));
});

test("zone map: a sensor shows its last reading, time and origin; switching zone switches the map", () => {
  const { pointLine } = zoneMap();
  const z1 = mapZones()[0];
  const p = data.zoneMapModel(z1).points[0];
  assert.match(pointLine(mapCopy, p), /^نقطة 1 · [\d.]+% · 16 أكتوبر 9:00 ص · محاكاة$/);
  assert.match(pointLine(mapCopy, { ...p, origin: "field" }), /· مقاس$/);
  assert.match(pointLine(mapCopy, { ...p, vwc: null, measuredAt: null }), /لا قراءة بعد/);
  const stale = data.zoneMapModel(mapZones()[4]).points[0];
  assert.match(pointLine(mapCopy, stale), /غير محتسبة في التغطية/);
  // Two zones render two different maps.
  const [a, b] = [renderMap(mapZones()[1]), renderMap(mapZones()[4])];
  assert.match(a, /data-zone="z2"/);
  assert.match(b, /data-zone="z5"/);
  assert.notEqual(a.match(/class="lx-map-outline"[^>]*/)[0], b.match(/class="lx-map-outline"[^>]*/)[0]);
  // Overlay: Esc closes, rendered inside the module root.
  const src = readFileSync(at("components/landscape/zone-map.tsx"), "utf8");
  assert.match(src, /e\.key === "Escape" && setLarge\(false\)/);
  assert.match(src, /document\.querySelector\("\.lx"\)/);
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
