// Sensor-count experiment for the Digital Twin: how many real (LoRa) sensors are
// enough? Runs the real TypeScript engine (transpiled in memory), ANBIT strategy,
// with the same weather, seasons, seeds and duration as the real2025 audit, for
// N real sensors placed (a) greedily with the app's coverage grid and (b) at
// random (5 fixed RNG seeds), and (c) by soil and plant kind (soil_placement.mjs)
// for N = 8, 6, 4, 3, 2. All other sections use virtual sensors as today.
//
// Usage (from the repository root):
//   node research/simulation/audit_sensor_count.mjs > research/simulation/audit_sensor_count.json
// Optional: --quick (1 seed × 2 days, for tests).
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { soilPlantOrder } from "./soil_placement.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ts = createRequire(resolve(repo, "frontend/package.json"))("typescript");
const engineDir = resolve(repo, "frontend/lib/twin");
const quick = process.argv.includes("--quick");
// Same as research/simulation/audit_weather_real2025.json.
const SEEDS = quick ? 1 : 5;
const DAYS = quick ? 2 : 28;
const CITY = "riyadh";
const WEATHER = "real2025";
const SEASONS = ["summer", "winter", "spring"];
const COUNTS = [12, 8, 6, 4, 3, 2, 0];
const RANDOM_PLACEMENTS = 5;
const SOIL_COUNTS = [8, 6, 4, 3, 2];
const WITHIN = 0.1;

const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path).exports;
  const mod = { exports: {} };
  cache.set(path, mod);
  const req = (n) => {
    if (!n.startsWith(".")) return createRequire(path)(n);
    const b = resolve(dirname(path), n);
    const f = [b, b + ".ts", b + ".json"].find((x) => existsSync(x));
    return extname(f) === ".json" ? JSON.parse(readFileSync(f, "utf8")) : load(f);
  };
  const out = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: 1, target: 9, esModuleInterop: true } }).outputText;
  vm.runInNewContext(out, { module: mod, exports: mod.exports, require: req, Math, Date, JSON, Set, console });
  return mod.exports;
}
const e = load(resolve(engineDir, "engine.ts"));
const c = load(resolve(engineDir, "constants.ts"));
const ids = c.SECTION_TEMPLATES.map((t) => t.id);
const defaultIds = c.SECTION_TEMPLATES.filter((t) => t.lora).map((t) => t.id);
const cols = Math.max(...c.SECTION_GRID.map((g) => g.col)) + 1;
const rows = Math.max(...c.SECTION_GRID.map((g) => g.row)) + 1;

// Greedy order from the app's coverage grid (backend/app/engine.py), via Python.
const python = resolve(repo, ".venv/bin/python");
const placement = JSON.parse(
  execFileSync(python, [resolve(repo, "research/simulation/sensor_placement.py"), JSON.stringify({ ids, cols, rows })], {
    env: { ...process.env, PYTHONPATH: resolve(repo, "backend") },
    encoding: "utf8",
  }),
);
const byGrid = (list) => [...list].sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
const chosenIds = (n) => byGrid(placement.order.slice(0, n));
// Soil and plant placement: first N of a fixed greedy order.
const soilOrder = soilPlantOrder(c.SECTION_TEMPLATES);
const soilIds = (n) => byGrid(soilOrder.slice(0, n));
// Random placement r for N: Fisher–Yates with the engine's own seeded RNG.
const randomSeed = (n, r) => 1000 * n + r;
function randomIds(n, r) {
  const rand = e.rng(randomSeed(n, r));
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return byGrid(a.slice(0, n));
}

// Same per-run summary and rounding as audit_twin.mjs, ANBIT only.
const total = (beds, k) => beds.reduce((a, b) => a + (b[k] || 0), 0);
const mean = (a) => a.reduce((t, x) => t + x, 0) / a.length;
function run(realSensors) {
  const bySeason = {};
  let soilReadings = 0;
  for (const season of SEASONS) {
    const rs = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const config = e.defaultConfig({ season, seed, days: DAYS, city: CITY, weather: WEATHER, ...(realSensors ? { realSensors } : {}) });
      const s = e.createSim(config);
      const real = s.sections.filter((x) => x.lora).length;
      while (s.i < s.total) {
        e.step(s);
        soilReadings += real;
      }
      const steps = total(s.anbit, "steps") || 1;
      rs.push({ waterL: total(s.anbit, "waterL"), inRange: (total(s.anbit, "inRange") / steps) * 100, stressH: total(s.anbit, "stress") / 4, over: total(s.anbit, "overEvents") });
    }
    bySeason[season] = {
      waterM3: +(mean(rs.map((r) => r.waterL)) / 1000).toFixed(1),
      inRangePct: +mean(rs.map((r) => r.inRange)).toFixed(1),
      stressH: +mean(rs.map((r) => r.stressH)).toFixed(1),
      overEvents: +mean(rs.map((r) => r.over)).toFixed(1),
    };
  }
  return { bySeason, soilReadings };
}

const METRICS = ["stressH", "waterM3", "inRangePct", "overEvents"];
const change = (x, ref) =>
  Object.fromEntries(
    SEASONS.map((season) => [
      season,
      Object.fromEntries(
        METRICS.map((m) => {
          const a = x[season][m];
          const b = ref[season][m];
          return [m, { abs: +(a - b).toFixed(1), pct: b ? +(((a - b) / b) * 100).toFixed(1) : null }];
        }),
      ),
    ]),
  );
const summarize = (list) =>
  Object.fromEntries(
    SEASONS.map((season) => [
      season,
      Object.fromEntries(
        METRICS.map((m) => {
          const v = list.map((x) => x.bySeason[season][m]);
          return [m, { mean: +mean(v).toFixed(1), min: Math.min(...v), max: Math.max(...v) }];
        }),
      ),
    ]),
  );

const log = (msg) => process.stderr.write(`${msg}\n`);
const defaultRun = run(null);
log(`default (${defaultIds.length} real) done`);
const chosen = {};
const random = {};
for (const n of COUNTS) {
  const ids_ = chosenIds(n);
  chosen[n] = { ids: ids_, ...run(ids_) };
  log(`N=${n} chosen done`);
  // With 12 or 0 sensors every placement is the same one.
  if (n === 12 || n === 0) continue;
  const runs = [];
  for (let r = 1; r <= RANDOM_PLACEMENTS; r++) {
    const rIds = randomIds(n, r);
    runs.push({ rngSeed: randomSeed(n, r), ids: rIds, ...run(rIds) });
    log(`N=${n} random ${r} done`);
  }
  random[n] = { runs, summary: summarize(runs) };
}
const soil = {};
for (const n of SOIL_COUNTS) {
  const ids_ = soilIds(n);
  soil[n] = { ids: ids_, ...run(ids_) };
  log(`N=${n} soil done`);
}
const ref = chosen[12].bySeason;
for (const n of COUNTS) {
  chosen[n].vsN12 = change(chosen[n].bySeason, ref);
  if (random[n]) {
    random[n].meanVsN12 = change(
      Object.fromEntries(SEASONS.map((s) => [s, Object.fromEntries(METRICS.map((m) => [m, random[n].summary[s][m].mean]))])),
      ref,
    );
  }
}
for (const n of SOIL_COUNTS) soil[n].vsN12 = change(soil[n].bySeason, ref);
// Smallest N (chosen placement) whose stress hours stay within 10% of N=12 in every season.
const within = COUNTS.filter((n) => SEASONS.every((s) => chosen[n].bySeason[s].stressH <= ref[s].stressH * (1 + WITHIN) + 1e-9));
const smallest = within.length ? Math.min(...within) : null;

console.log(
  JSON.stringify(
    {
      note: "Generated by research/simulation/audit_sensor_count.mjs. Simulation only; ANBIT strategy.",
      engine: "frontend/lib/twin",
      city: CITY,
      weather: WEATHER,
      seeds: SEEDS,
      days: DAYS,
      seasons: SEASONS,
      counts: COUNTS,
      sections: ids.length,
      siteAreaM2: c.SECTION_TEMPLATES.reduce((t, x) => t + x.areaM2, 0),
      placement: {
        method: "Greedy on the app's 20x20 coverage grid (backend/app/engine.py _grid), one grid unit per section, radius in grid units.",
        radius: placement.radius,
        order: placement.order,
        coverageSteps: placement.steps,
        randomPlacementsPerN: RANDOM_PLACEMENTS,
        randomSeed: "1000 × N + r, r = 1..5, engine rng (mulberry32)",
        soil: {
          method: "Greedy by kind (research/simulation/soil_placement.mjs): fewest real sensors on the section's soil kind, then on its plant kind; ties to larger area, then lower index.",
          counts: SOIL_COUNTS,
          order: soilOrder,
        },
      },
      default: { ids: defaultIds, ...defaultRun },
      chosen,
      random,
      soil,
      withinPct: WITHIN * 100,
      smallestChosenNWithin: smallest,
    },
    null,
    1,
  ),
);
