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
  });
  assert.equal(s.points.length, 25);
  assert.ok(s.start && s.stop && s.next);
  assert.ok(s.start.vwc <= 0.18);
  assert.equal(s.stop.vwc, 0.27);
  assert.ok(s.stop.t > s.start.t && s.next.t > s.stop.t);
  assert.equal(data.autoScenario({ startVwc: Number.NaN, threshold: 0.18, target: 0.27, etMmDay: 5, rootDepthM: 0.2, areaM2: 1, efficiency: 1, litresPerHour: 1, now: 0 }), null);
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
