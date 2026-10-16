// Offline audit of the Digital Twin engine. Runs the real TypeScript engine
// (transpiled in memory) over seasons × seeds and prints JSON.
//
// Usage (from the repository root):
//   node research/simulation/audit_twin.mjs [engineDir] [seeds] [days] [city] [weather]
// engineDir defaults to frontend/lib/twin; seeds to 5; days to 28; city to riyadh.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ts = createRequire(resolve(repo, "frontend/package.json"))("typescript");
const engineDir = resolve(repo, process.argv[2] || "frontend/lib/twin");
const seeds = Number(process.argv[3] || 5);
const days = Number(process.argv[4] || 28);
const city = process.argv[5] || "riyadh";
// "generated" (default) or "real2025" (Open-Meteo 2025 daily weather).
const weather = process.argv[6] || "generated";

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

const strategies = (s) => ["anbit", "sensor", "fixed"].filter((k) => Array.isArray(s[k]));
const summary = (beds) => {
  const t = (k) => beds.reduce((a, b) => a + b[k], 0);
  const steps = t("steps") || 1;
  return { waterL: t("waterL"), wastedL: t("wastedL"), inRange: (t("inRange") / steps) * 100, stressH: t("stress") / 4, wetH: (t("wet") || 0) / 4, wetRainH: (t("wetAfterRain") || 0) / 4, over: t("overEvents") };
};

const rows = [];
const signed = {};
const perRun = {};
const overshoot = { sum: 0, n: 0 };
for (const season of ["summer", "winter", "spring"]) {
  for (let seed = 1; seed <= seeds; seed++) {
    // City and weather are always passed explicitly, so the UI defaults never change an audit.
    const config = e.defaultConfig({ season, seed, days, city, weather });
    const s = e.createSim(config);
    const aw = s.sections.map((x) => x.fc - x.wp);
    const runSigned = {};
    while (s.i < s.total) {
      const open = s.anbit.map((b) => b.valve);
      e.step(s);
      for (const x of s.sections) {
        if (!x.lora) {
          const d = s.est[x.index] - s.anbit[x.index].m;
          (signed[x.id] ||= []).push(d);
          (runSigned[x.id] ||= []).push(d);
        }
        // Overshoot measured on the step the valve closes, LoRa sections only.
        if (x.lora && open[x.index] && !s.anbit[x.index].valve) {
          overshoot.sum += Math.max(0, (s.anbit[x.index].m - x.target) / aw[x.index]);
          overshoot.n += 1;
        }
      }
    }
    for (const [id, v] of Object.entries(runSigned)) (perRun[id] ||= []).push(v.reduce((t, x) => t + x, 0) / v.length);
    const row = { season, seed };
    for (const k of strategies(s)) row[k] = summary(s[k]);
    rows.push(row);
  }
}
const mean = (a) => a.reduce((t, x) => t + x, 0) / a.length;
const bySeason = {};
for (const season of ["summer", "winter", "spring"]) {
  const rs = rows.filter((r) => r.season === season);
  const out = {};
  for (const k of ["anbit", "sensor", "fixed"].filter((k) => rs[0][k])) {
    const w = mean(rs.map((r) => r[k].waterL));
    out[k] = {
      waterM3: +(w / 1000).toFixed(1),
      wastePct: +mean(rs.map((r) => (r[k].waterL ? (r[k].wastedL / r[k].waterL) * 100 : 0))).toFixed(2),
      inRangePct: +mean(rs.map((r) => r[k].inRange)).toFixed(1),
      stressH: +mean(rs.map((r) => r[k].stressH)).toFixed(1),
      wetH: +mean(rs.map((r) => r[k].wetH)).toFixed(1),
      wetRainH: +mean(rs.map((r) => r[k].wetRainH)).toFixed(1),
      overEvents: +mean(rs.map((r) => r[k].over)).toFixed(1),
    };
  }
  out.savingVsFixedPct = +mean(rs.map((r) => ((r.fixed.waterL - r.anbit.waterL) / r.fixed.waterL) * 100)).toFixed(1);
  if (rs[0].sensor) out.savingVsSensorPct = +mean(rs.map((r) => ((r.sensor.waterL - r.anbit.waterL) / r.sensor.waterL) * 100)).toFixed(1);
  bySeason[season] = out;
}
const virtualSignedVwcPoints = Object.fromEntries(Object.entries(signed).map(([id, v]) => [id, +(mean(v) * 100).toFixed(2)]));
console.log(
  JSON.stringify(
    {
      engine: engineDir.replace(repo + "/", ""),
      city,
      weather,
      seeds,
      days,
      bySeason,
      virtualSignedVwcPoints,
      virtualWorstRunVwcPoints: Object.fromEntries(
        Object.entries(perRun).map(([id, v]) => [id, +(v.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) * 100).toFixed(2)]),
      ),
      virtualMeanSigned: +(mean(Object.values(signed).flat()) * 100).toFixed(2),
      loraOvershootPctOfAvailableWater: +((overshoot.sum / (overshoot.n || 1)) * 100).toFixed(2),
      loraValveCloses: overshoot.n,
    },
    null,
    1,
  ),
);
