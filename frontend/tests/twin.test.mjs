import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => resolve(root, p);

// Transpile the real modules; nothing under test is copied.
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path).exports;
  const loaded = { exports: {} };
  cache.set(path, loaded);
  const native = createRequire(path);
  const require = (name) => {
    if (!name.startsWith(".")) return native(name);
    const base = resolve(dirname(path), name);
    const file = [base, base + ".ts", base + ".tsx", base + ".mjs"].find((f) => existsSync(f) && !f.endsWith("/"));
    if (extname(file) === ".json") return JSON.parse(readFileSync(file, "utf8"));
    return load(file);
  };
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require, Math, Date, JSON, console, Set });
  return loaded.exports;
}
const engine = load(at("lib/twin/engine.ts"));
const model = load(at("lib/twin/model.ts"));
const C = load(at("lib/twin/constants.ts"));
const smap = load(at("lib/twin/smap.ts"));
const plain = (v) => JSON.parse(JSON.stringify(v));
const cfg = (over = {}) => engine.defaultConfig({ days: 7, ...over });

test("moisture stays between wilting point and field capacity, for every bed and step", () => {
  for (const season of ["summer", "winter", "spring"]) {
    const s = engine.createSim(cfg({ season, days: 5, seed: 11 }));
    while (engine.step(s)) {
      for (const sec of s.sections) {
        for (const bed of [s.anbit[sec.index], s.fixed[sec.index]]) {
          assert.ok(bed.m >= sec.wp - 1e-12 && bed.m <= sec.fc + 1e-12, `${season} ${sec.id} ${bed.m}`);
        }
        const e = s.est[sec.index];
        assert.ok(e >= sec.wp - 1e-12 && e <= sec.fc + 1e-12);
      }
    }
  }
});

test("same seed gives identical results; a different seed changes them", () => {
  const a = plain(engine.results(engine.runAll(cfg({ seed: 5 }))));
  const b = plain(engine.results(engine.runAll(cfg({ seed: 5 }))));
  const c = plain(engine.results(engine.runAll(cfg({ seed: 6 }))));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(plain(engine.weatherFor(cfg({ seed: 5 }))), plain(engine.weatherFor(cfg({ seed: 5 }))));
});

test("ANBIT, sensor-only and the fixed schedule see identical weather", () => {
  const s = engine.createSim(cfg({ season: "winter", days: 7, seed: 3 }));
  assert.deepEqual(plain(s.weather), plain(engine.weatherFor(s.config)));
  let compared = 0;
  while (s.i < s.total) {
    const before = s.sections.map((x) => [s.anbit[x.index].m, s.fixed[x.index].m, s.sensor[x.index].m]);
    engine.step(s);
    for (const x of s.sections) {
      const a = s.anbit[x.index];
      const f = s.fixed[x.index];
      const [ma, mf] = before[x.index];
      // Same weather, no irrigation, unstressed and below capacity: identical change.
      if (!a.lastL && !f.lastL && ma >= x.minimum && mf >= x.minimum && a.m < x.fc && f.m < x.fc && a.m > x.wp && f.m > x.wp) {
        assert.ok(Math.abs(a.m - ma - (f.m - mf)) < 1e-12);
        compared++;
      }
      const so = s.sensor[x.index];
      const ms = before[x.index][2];
      if (!so.lastL && !f.lastL && ms >= x.minimum && mf >= x.minimum && so.m < x.fc && f.m < x.fc && so.m > x.wp && f.m > x.wp)
        assert.ok(Math.abs(so.m - ms - (f.m - mf)) < 1e-12);
    }
  }
  assert.ok(compared > 100);
});

test("ANBIT differs from the fixed schedule and keeps beds in range more often", () => {
  const winter = engine.results(engine.runAll(cfg({ season: "winter", seed: 2030 })));
  assert.ok(winter.anbit.waterL < winter.fixed.waterL);
  assert.ok(winter.saving > 0);
  assert.ok(winter.anbit.inRangePct > winter.fixed.inRangePct);
  assert.ok(winter.anbit.overEvents < winter.fixed.overEvents);
  const spring = engine.results(engine.runAll(cfg({ season: "spring", seed: 2030 })));
  assert.ok(spring.anbit.inRangePct > spring.fixed.inRangePct);
});

test("ANBIT only opens valves inside the allowed hours, including windows across midnight", () => {
  for (const [start, end] of [
    [18, 8],
    [22, 5],
    [1, 6],
  ]) {
    const s = engine.createSim(cfg({ season: "summer", days: 4, allowedStart: start, allowedEnd: end }));
    let opened = 0;
    while (s.i < s.total) {
      const hour = engine.hourAt(s.i);
      engine.step(s);
      for (const b of s.anbit) {
        if (b.lastL > 0) {
          opened++;
          assert.ok(engine.inWindow(hour, start, end), `valve open at ${hour} for ${start}-${end}`);
        }
      }
      for (const x of s.sections)
        if (x.lora && s.sensor[x.index].lastL > 0) assert.ok(engine.inWindow(hour, start, end), `sensor-only at ${hour}`);
    }
    assert.ok(opened > 0);
  }
  assert.equal(engine.inWindow(23, 18, 8), true);
  assert.equal(engine.inWindow(12, 18, 8), false);
  assert.equal(engine.hoursToWindowEnd(18, 18, 8), 14);
  assert.equal(engine.hoursToWindowEnd(12, 18, 8), 0);
});

test("saving % = (fixed − ANBIT) ÷ fixed × 100, negative when ANBIT uses more", () => {
  assert.ok(Math.abs(engine.savingPercent(1000, 720) - 28) < 1e-9);
  assert.ok(Math.abs(engine.savingPercent(1000, 1200) + 20) < 1e-9);
  assert.equal(engine.savingPercent(0, 10), null);
  // Riyadh summer: the fixed timer under-waters, ANBIT uses more to avoid stress.
  const summer = engine.results(engine.runAll(cfg({ season: "summer", seed: 2030, days: 14 })));
  assert.ok(summer.saving < 0);
  assert.ok(summer.anbit.stressHours < summer.fixed.stressHours);
  assert.match(engine.resultsCsv(summer), /^kind,id,anbit_water_l,/);
});

test("model JSON in the browser reproduces the Python predictions", () => {
  const m = model.TWIN_MODEL;
  assert.ok(m.samples.length >= 20);
  for (const s of m.samples) {
    assert.equal(model.evaluate(m.classifier, s.x), s.need_p);
    assert.equal(model.evaluate(m.regressor_minutes, s.x), s.minutes);
  }
  assert.deepEqual(plain(m.features), ["soilMoisture", "temperature", "humidity", "lightLevel", "rainDetected"]);
  for (const leak of ["relayState", "drySoilRisk", "waterLevel"]) assert.ok(!m.features.includes(leak));
  // Out of the training range (e.g. 44 °C) returns null so the rule takes over.
  assert.equal(model.predictNeed([30, 44, 20, 90, 0]), null);
  assert.equal(model.predictNeed([20, 30, 50, 50, 0]), 1);
  assert.equal(model.toSensorIndex(0.1, 0.1, 0.3), 10);
  assert.equal(model.toSensorIndex(0.3, 0.1, 0.3), 90);
  const metrics = JSON.parse(readFileSync(at("../research/simulation/metrics.json"), "utf8"));
  assert.equal(metrics.audit.rows, 15420);
  assert.deepEqual(metrics.audit.time_or_location_columns, []);
  assert.equal(metrics.audit.generating_rule_matches_rows, 15420);
});

test("role guard: /twin is for survey only and calls no operational endpoint", () => {
  const data = load(at("components/landscape/data.ts"));
  assert.equal(data.landscapeAccess("ready", "survey"), "allowed");
  assert.equal(data.landscapeAccess("ready", "user"), "forbidden");
  assert.equal(data.landscapeAccess("anonymous"), "login");
  assert.match(readFileSync(at("app/twin/layout.tsx"), "utf8"), /<TwinGuard>/);
  const guard = readFileSync(at("components/twin/guard.tsx"), "utf8");
  assert.match(guard, /landscapeAccess\(status, role\)/);
  // Every API path in the twin module: only the read-only session check.
  const files = ["components/twin", "lib/twin", "app/twin"].flatMap((d) =>
    readdirSync(at(d)).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => join(at(d), f)),
  );
  const apis = files.flatMap((f) => readFileSync(f, "utf8").match(/\/api\/[a-z/_-]+/g) ?? []);
  assert.deepEqual([...new Set(apis)], ["/api/auth/me"]);
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /lib\/api["']/);
});

test("constants describe twelve sections with LoRa and virtual sensors", () => {
  assert.equal(C.SECTION_TEMPLATES.length, 12);
  assert.ok(C.SECTION_TEMPLATES.some((s) => s.lora) && C.SECTION_TEMPLATES.some((s) => !s.lora));
  const secs = engine.sectionsFor(cfg());
  for (const s of secs) {
    assert.ok(s.wp < s.minimum && s.minimum < s.target && s.target < s.upper && s.upper < s.fc);
    if (!s.lora) assert.ok(s.neighbours.length > 0 && s.neighbours.every((n) => secs[n].lora));
  }
});

test("virtual sensors stay unbiased: mean within ±1 point, every section within ±3", () => {
  const perSection = {};
  let total = 0;
  let n = 0;
  for (const season of ["summer", "winter", "spring"]) {
    for (let seed = 1; seed <= 10; seed++) {
      const r = engine.results(engine.runAll(cfg({ season, seed, days: 14 })));
      for (const s of r.sections) {
        if (s.virtualSignedPct == null) continue;
        (perSection[s.id] ||= []).push(s.virtualSignedPct);
        total += s.virtualSignedPct;
        n++;
      }
    }
  }
  const mean = total / n;
  assert.ok(Math.abs(mean) <= 1, `mean signed error ${mean.toFixed(2)} points`);
  for (const [id, v] of Object.entries(perSection)) {
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    assert.ok(Math.abs(m) <= 3, `${id} mean signed error ${m.toFixed(2)} points`);
  }
});

test("virtual sections calibrate only from their own weighted LoRa neighbours", () => {
  const secs = engine.sectionsFor(cfg());
  for (const s of secs.filter((x) => !x.lora)) {
    assert.equal(s.neighbours.length, s.neighbourWeights.length);
    s.neighbours.forEach((n, k) => {
      const o = secs[n];
      const d = Math.hypot(C.SECTION_GRID[o.index].col - C.SECTION_GRID[s.index].col, C.SECTION_GRID[o.index].row - C.SECTION_GRID[s.index].row);
      const expected = (1 / Math.max(0.5, d)) * (o.soil === s.soil ? C.SAME_SOIL_WEIGHT : 1);
      assert.ok(Math.abs(s.neighbourWeights[k] - expected) < 1e-12);
    });
  }
  // Ratios are kept per virtual section, not one global value.
  const st = engine.createSim(cfg({ season: "spring", days: 3 }));
  while (engine.step(st));
  const ratios = st.sections.filter((x) => !x.lora).map((x) => st.calibration.ratio[x.index]);
  assert.ok(new Set(ratios.map((r) => r.toFixed(6))).size > 1);
});

test("the valve stops at the target: mean overshoot under 1% of available water (LoRa)", () => {
  let sum = 0;
  let closes = 0;
  for (const season of ["summer", "winter", "spring"]) {
    for (let seed = 1; seed <= 3; seed++) {
      const s = engine.createSim(cfg({ season, seed, days: 14 }));
      while (s.i < s.total) {
        const open = s.anbit.map((b) => b.valve);
        engine.step(s);
        for (const x of s.sections) {
          if (x.lora && open[x.index] && !s.anbit[x.index].valve) {
            sum += Math.max(0, (s.anbit[x.index].m - x.target) / (x.fc - x.wp));
            closes++;
          }
        }
      }
    }
  }
  assert.ok(closes > 50);
  assert.ok(sum / closes < 0.01, `overshoot ${((sum / closes) * 100).toFixed(2)}%`);
});

test("sensor-only: sections without LoRa follow the fixed schedule exactly; LoRa sections react", () => {
  const s = engine.createSim(cfg({ season: "spring", days: 7, seed: 4 }));
  while (engine.step(s)) {
    for (const x of s.sections) if (!x.lora) assert.equal(s.sensor[x.index].m, s.fixed[x.index].m);
  }
  const r = engine.results(s);
  const lora = r.sections.filter((x) => x.lora);
  assert.ok(lora.some((x) => x.sensor.waterL !== x.fixed.waterL));
  assert.ok(r.sensor.waterL > 0);
  assert.ok(Math.abs(r.savingVsSensor - engine.savingPercent(r.sensor.waterL, r.anbit.waterL)) < 1e-9);
  assert.match(engine.resultsCsv(r), /anbit_water_l,anbit_waste_l.*sensor_water_l.*fixed_water_l.*saving_vs_sensor_pct/);
});

test("city: ET scales by city ÷ Riyadh, and the same seed + city repeats exactly", () => {
  const riyadh = engine.weatherFor(cfg({ city: "riyadh", seed: 9, rain: false }));
  const abha = engine.weatherFor(cfg({ city: "abha", seed: 9, rain: false }));
  const et = (w) => w.reduce((t, x) => t + x.etMm, 0);
  assert.ok(Math.abs(et(abha) / et(riyadh) - 3.8 / 8.5) < 1e-9);
  assert.deepEqual(plain(engine.weatherFor(cfg({ city: "jeddah", seed: 9 }))), plain(engine.weatherFor(cfg({ city: "jeddah", seed: 9 }))));
  assert.notDeepEqual(plain(engine.results(engine.runAll(cfg({ city: "tabuk" })))), plain(engine.results(engine.runAll(cfg({ city: "medina" })))));
  assert.deepEqual(
    plain(Object.fromEntries(Object.entries(C.CITIES).map(([k, v]) => [k, [v.etRefMmDay, v.etSource]]))),
    { riyadh: [8.5, "ENBT"], medina: [8.2, "ENBT"], tabuk: [7.2, "ENBT"], abha: [3.8, "ENBT"], jeddah: [7, "assumption"], dammam: [6.5, "assumption"] },
  );
  assert.equal(engine.defaultConfig().city, "riyadh");
});

test("SMAP reference is hidden without data and never invented", () => {
  assert.equal(smap.smapReference("riyadh", "summer"), null);
  const file = { available: true, years: ["2024"], cities: { Riyadh: { 7: { vwc: 0.031, n: 40 } } } };
  assert.deepEqual(plain(smap.smapReference("riyadh", "summer", file)), { vwc: 0.031, n: 40, month: 7, years: ["2024"] });
  assert.equal(smap.smapReference("riyadh", "winter", file), null);
  assert.equal(smap.smapReference("jeddah", "summer", file), null);
  // The engine never reads it: SMAP is not imported by the simulation.
  assert.doesNotMatch(readFileSync(at("lib/twin/engine.ts"), "utf8"), /smap/i);
});

test("virtual sections act on estimate − k·σ: stress drops, water stays below the fixed schedule", () => {
  const virtualStress = (r) => r.sections.filter((x) => !x.lora).reduce((t, x) => t + x.anbit.stressHours, 0);
  const loraWater = (r) => r.sections.filter((x) => x.lora).reduce((t, x) => t + x.anbit.waterL, 0);
  for (const season of ["winter", "spring"]) {
    let raw = 0;
    let margin = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const without = engine.results(engine.runAll(cfg({ season, seed, days: 14, virtualMarginK: 0 })));
      const withMargin = engine.results(engine.runAll(cfg({ season, seed, days: 14 })));
      raw += virtualStress(without);
      margin += virtualStress(withMargin);
      assert.ok(withMargin.anbit.waterL < withMargin.fixed.waterL, `${season} seed ${seed}: ANBIT must use less than fixed`);
      // LoRa sections read the soil directly: the margin does not touch them.
      assert.equal(loraWater(withMargin), loraWater(without));
    }
    assert.ok(raw > 0, `${season}: baseline has virtual stress`);
    assert.ok(margin <= raw * 0.5, `${season}: virtual stress ${raw.toFixed(1)} → ${margin.toFixed(1)} h`);
  }
  // σ is zero for LoRa, grows with modelled loss and is capped for virtual sections.
  const st = engine.createSim(cfg({ season: "summer", days: 7 }));
  while (engine.step(st));
  for (const x of st.sections) {
    const u = engine.uncertainty(st, x);
    if (x.lora) assert.equal(u, 0);
    else assert.ok(u > 0 && u <= C.VIRTUAL_SIGMA_CAP * (x.fc - x.wp) + 1e-12);
  }
});

const headline = load(at("components/twin/headline.ts"));
const summaryOf = (o) => ({ waterL: 100, wastedL: 0, wastePct: 0, inRangePct: 50, stressHours: 0, wetHours: 0, wetAfterRainHours: 0, overEvents: 0, irrigations: 1, ...o });

test("hero: a saving leads with the saving %", () => {
  const h = headline.heroHeadline({ saving: 32.9, anbit: summaryOf({ stressHours: 500 }), fixed: summaryOf({ stressHours: 40 }) });
  assert.deepEqual(plain(h), { kind: "saving", value: 32.9 });
  assert.equal(headline.heroHeadline({ saving: 0, anbit: summaryOf(), fixed: summaryOf() }).kind, "saving");
});

test("hero: more water but less stress leads with the stress reduction", () => {
  const h = headline.heroHeadline({ saving: -7.2, anbit: summaryOf({ stressHours: 320 }), fixed: summaryOf({ stressHours: 2471 }) });
  assert.equal(h.kind, "stress");
  assert.ok(Math.abs(h.value - ((2471 - 320) / 2471) * 100) < 1e-9);
  assert.ok(Math.abs(h.extraWaterPct - 7.2) < 1e-9);
});

test("hero: more water and no less stress shows the saving honestly", () => {
  assert.deepEqual(plain(headline.heroHeadline({ saving: -4, anbit: summaryOf({ stressHours: 50 }), fixed: summaryOf({ stressHours: 50 }) })), { kind: "honest", value: -4 });
  assert.deepEqual(plain(headline.heroHeadline({ saving: -4, anbit: summaryOf({ stressHours: 10 }), fixed: summaryOf({ stressHours: 0 }) })), { kind: "honest", value: -4 });
  assert.deepEqual(plain(headline.heroHeadline({ saving: null, anbit: summaryOf(), fixed: summaryOf({ waterL: 0 }) })), { kind: "honest", value: null });
  // A real run picks one of the three, and never changes the engine's numbers.
  const r = engine.results(engine.runAll(cfg({ season: "summer", seed: 2030, days: 7 })));
  const before = JSON.stringify(r);
  assert.ok(["saving", "stress", "honest"].includes(headline.heroHeadline(r).kind));
  assert.equal(JSON.stringify(r), before);
});

test("highlight pills appear only when true", () => {
  const all = headline.highlights({ anbit: summaryOf({ wastedL: 0, inRangePct: 96, overEvents: 1 }), fixed: summaryOf({ wastedL: 900, inRangePct: 30, overEvents: 80 }) });
  assert.deepEqual(plain(all.map((p) => p.kind)), ["zeroWaste", "rangeTimes", "fewerOver"]);
  assert.equal(all[1].value, 3.2);
  assert.ok(Math.abs(all[2].value - 98.75) < 1e-9);
  const none = headline.highlights({ anbit: summaryOf({ wastedL: 40, inRangePct: 30, overEvents: 5 }), fixed: summaryOf({ inRangePct: 30, overEvents: 5 }) });
  assert.deepEqual(plain(none), []);
  assert.deepEqual(plain(headline.highlights({ anbit: summaryOf({ wastedL: 0, inRangePct: 50 }), fixed: summaryOf({ inRangePct: 0, overEvents: 0 }) }).map((p) => p.kind)), ["zeroWaste", "noOver"]);
});

test("setup starts on Riyadh, spring, 28 days, actual 2025 weather", () => {
  assert.match(readFileSync(at("components/twin/twin-app.tsx"), "utf8"), /defaultConfig\(\{ city: "riyadh", season: "spring", days: 28, weather: "real2025" \}\)/);
});

test("hero: zero irrigation reads 'rain was enough' with the volume saved, never 100%", () => {
  const h = headline.heroHeadline({ saving: 100, anbit: summaryOf({ waterL: 0 }), fixed: summaryOf({ waterL: 584_600 }) });
  assert.deepEqual(plain(h), { kind: "rainEnough", savedL: 584_600 });
  assert.equal("value" in h, false);
  // Some water applied: back to the normal saving headline.
  assert.equal(headline.heroHeadline({ saving: 99.9, anbit: summaryOf({ waterL: 10 }), fixed: summaryOf({ waterL: 10_000 }) }).kind, "saving");
  // Both zero: nothing to claim.
  assert.equal(headline.heroHeadline({ saving: null, anbit: summaryOf({ waterL: 0 }), fixed: summaryOf({ waterL: 0 }) }).kind, "honest");
  const page = readFileSync(at("components/twin/results.tsx"), "utf8");
  assert.match(page, /المطر كفّى — لم تحتج النباتات ريًا/);
  assert.match(page, /الجدول الثابت أضاف ماءً لم تحتجه النباتات/);
  assert.doesNotMatch(page, /c\.litres\(/);
});

test("too wet is tracked per strategy and attributed to rain only without irrigation in the last 24 h", () => {
  // No rain: nothing can be attributed to rain.
  const dry = engine.results(engine.runAll(cfg({ season: "winter", city: "abha", rain: false, days: 7 })));
  for (const k of ["anbit", "sensor", "fixed"]) assert.equal(dry[k].wetAfterRainHours, 0);
  let rainOnly = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = engine.results(engine.runAll(cfg({ season: "winter", city: "abha", seed, days: 14 })));
    for (const k of ["anbit", "sensor", "fixed"]) {
      assert.ok(r[k].wetAfterRainHours <= r[k].wetHours + 1e-9);
      assert.ok(r[k].wetHours >= 0);
    }
    // The fixed schedule irrigates every day, so its wet time is never "rain only".
    assert.equal(r.fixed.wetAfterRainHours, 0);
    rainOnly += r.anbit.wetAfterRainHours;
  }
  assert.ok(rainOnly > 0, "rain alone pushed some ANBIT beds above the upper limit");
  assert.equal(headline.mostlyRain({ wetHours: 10, wetAfterRainHours: 6 }), true);
  assert.equal(headline.mostlyRain({ wetHours: 10, wetAfterRainHours: 5 }), false);
  assert.equal(headline.mostlyRain({ wetHours: 0, wetAfterRainHours: 0 }), false);
});

test("pills: thresholds on the fixed schedule and 'no over-watering' when ANBIT has none", () => {
  const kinds = (a, f) => plain(headline.highlights({ anbit: summaryOf(a), fixed: summaryOf(f) }).map((p) => p.kind));
  assert.deepEqual(kinds({ overEvents: 0, wastedL: 10 }, { overEvents: 2, inRangePct: 50 }), ["noOver"]);
  assert.deepEqual(kinds({ overEvents: 1, wastedL: 10 }, { overEvents: 4, inRangePct: 50 }), []);
  assert.deepEqual(kinds({ overEvents: 1, wastedL: 10 }, { overEvents: 5, inRangePct: 50 }), ["fewerOver"]);
  assert.deepEqual(kinds({ overEvents: 1, wastedL: 10, inRangePct: 90 }, { overEvents: 1, inRangePct: 9 }), []);
  assert.deepEqual(kinds({ overEvents: 1, wastedL: 10, inRangePct: 90 }, { overEvents: 1, inRangePct: 10 }), ["rangeTimes"]);
});

test("the fixed schedule is seasonal: 8 / 6 / 3 L/m² a day at 05:00", () => {
  assert.deepEqual(plain(C.FIXED_SCHEDULE), { startHour: 5, litresPerM2BySeason: { summer: 8, spring: 6, winter: 3 } });
  const area = C.SECTION_TEMPLATES.reduce((t, s) => t + s.areaM2, 0);
  for (const [season, depth] of [["summer", 8], ["spring", 6], ["winter", 3]]) {
    const r = engine.results(engine.runAll(cfg({ season, days: 3 })));
    assert.equal(r.fixed.waterL, depth * area * 3);
  }
});

test("actual 2025 weather: an optional switch, daily ET0 from the bundled file, default unchanged", () => {
  const real = JSON.parse(readFileSync(at("lib/twin/weather2025.json"), "utf8"));
  assert.deepEqual(Object.keys(real.cities).sort(), ["abha", "medina", "riyadh", "tabuk"]);
  assert.equal(engine.realWeatherAvailable("riyadh"), true);
  assert.equal(engine.realWeatherAvailable("jeddah"), false);
  assert.equal(engine.defaultConfig().weather, "generated");
  const steps = engine.weatherFor(cfg({ weather: "real2025", city: "riyadh", season: "summer", days: 3, rain: false }));
  // Summer starts on 1 July: day of year 181 (0-based) in 2025.
  for (let d = 0; d < 3; d++) {
    const day = steps.slice(d * C.STEPS_PER_DAY, (d + 1) * C.STEPS_PER_DAY);
    assert.ok(Math.abs(day.reduce((t, s) => t + s.etMm, 0) - real.cities.riyadh.et0[181 + d]) < 1e-9);
    assert.equal(day[0].etDayMm, real.cities.riyadh.et0[181 + d]);
  }
  // The generated default is untouched by the new option.
  assert.deepEqual(plain(engine.weatherFor(cfg({ seed: 4 }))), plain(engine.weatherFor(cfg({ seed: 4, weather: "generated" }))));
  const a = engine.results(engine.runAll(cfg({ weather: "real2025", seed: 4 })));
  const b = engine.results(engine.runAll(cfg({ weather: "real2025", seed: 4 })));
  assert.deepEqual(plain(a), plain(b));
});

test("allowed window: the twin, Home and Irrigation share one case table", () => {
  const window = load(at("lib/twin/window.ts"));
  const { cases } = JSON.parse(readFileSync(at("tests/fixtures/irrigation-windows.json"), "utf8"));
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    assert.equal(window.inWindow(c.hour, c.start, c.end), c.inWindow, JSON.stringify(c));
    assert.ok(Math.abs(window.hoursToWindowEnd(c.hour, c.start, c.end) - c.hoursToEnd) < 1e-9, JSON.stringify(c));
    // The engine re-exports the same functions.
    assert.equal(engine.inWindow(c.hour, c.start, c.end), c.inWindow);
  }
  // backend/app/window.py is checked against the same file.
  assert.match(readFileSync(at("../backend/tests/test_windows.py"), "utf8"), /irrigation-windows\.json/);
});

test("hero wording with actual 2025 weather: stress reduction first, honest water line", () => {
  // A real-weather run where ANBIT uses more water but cuts stress hours.
  const r = engine.results(engine.runAll(cfg({ weather: "real2025", season: "spring", seed: 1, days: 28 })));
  assert.ok(r.saving < 0 && r.anbit.stressHours < r.fixed.stressHours);
  assert.equal(headline.heroHeadline(r).kind, "stress");
  const page = readFileSync(at("components/twin/results.tsx"), "utf8");
  assert.match(page, /استهلك أنبت \$\{c\.num\(hero\.extraWaterPct\)\}% مياهًا أكثر من الجدول الثابت المفترض، لأن الجدول لا يغطي احتياج النباتات في طقس 2025 الفعلي\./);
  assert.match(page, /r\.config\.weather === "real2025"/);
});

test("twin setup: 2025 monthly ET0 range per season, actual weather by default, cities with 2025 weather only", () => {
  const real = JSON.parse(readFileSync(at("lib/twin/weather2025.json"), "utf8"));
  const months = { summer: [6, 7, 8, 9], winter: [12, 1, 2], spring: [3, 4, 5] };
  for (const [season, list] of Object.entries(months)) {
    const values = list.map((m) => real.cities.riyadh.et0_monthly[m - 1]);
    assert.deepEqual(plain(engine.seasonEt0Range("riyadh", season)), { min: Math.min(...values), max: Math.max(...values) });
  }
  assert.equal(engine.seasonEt0Range("jeddah", "summer"), null);
  const setup = readFileSync(at("components/twin/setup.tsx"), "utf8");
  assert.match(setup, /shownCities = cities\.filter\(\(x\) => realWeatherAvailable\(x\.id\)\)/);
  assert.match(setup, /طقس 2025 الفعلي/);
  assert.match(setup, /طقس مولّد/);
  assert.match(readFileSync(at("components/twin/twin-app.tsx"), "utf8"), /weather: "real2025"/);
  // The audit always passes its weather mode, so the UI default never changes audit numbers.
  assert.match(readFileSync(at("../research/simulation/audit_twin.mjs"), "utf8"), /defaultConfig\(\{ season, seed, days, city, weather \}\)/);
});

// Sensor-count experiment (research/simulation/audit_sensor_count.mjs).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const repoRoot = resolve(root, "..");
const sensorCount = () => JSON.parse(readFileSync(resolve(repoRoot, "research/simulation/audit_sensor_count.json"), "utf8"));

test("sensor option: omitted keeps today's layout; the existing audits stay byte-identical", async () => {
  const ids = C.SECTION_TEMPLATES.map((t) => t.id);
  const defaults = C.SECTION_TEMPLATES.filter((t) => t.lora).map((t) => t.id);
  const cfg = { season: "summer", seed: 3, days: 3, city: "riyadh", weather: "real2025" };
  const a = engine.runAll(engine.defaultConfig(cfg));
  const b = engine.runAll(engine.defaultConfig({ ...cfg, realSensors: defaults }));
  assert.deepEqual(JSON.parse(JSON.stringify(a.anbit)), JSON.parse(JSON.stringify(b.anbit)));
  assert.equal(engine.defaultConfig().realSensors, undefined);
  const none = engine.sectionsFor(engine.defaultConfig({ realSensors: [] }));
  assert.ok(none.every((s) => !s.lora));
  const all = engine.sectionsFor(engine.defaultConfig({ realSensors: ids }));
  assert.ok(all.every((s) => s.lora && s.neighbours.length === 0));
  // The two existing audits, rerun with the default engine, match their files byte for byte.
  const audits = await Promise.all(
    ["generated", "real2025"].map((w) =>
      run("node", [resolve(repoRoot, "research/simulation/audit_twin.mjs"), "frontend/lib/twin", "5", "28", "riyadh", w], { cwd: repoRoot, maxBuffer: 1 << 24 }),
    ),
  );
  assert.equal(audits[0].stdout, readFileSync(resolve(repoRoot, "research/simulation/audit_weather_generated.json"), "utf8"));
  assert.equal(audits[1].stdout, readFileSync(resolve(repoRoot, "research/simulation/audit_weather_real2025.json"), "utf8"));
});

test("sensor count: same weather, seeds and days as the real2025 audit; the default layout reproduces it", () => {
  const sc = sensorCount();
  const audit = JSON.parse(readFileSync(resolve(repoRoot, "research/simulation/audit_weather_real2025.json"), "utf8"));
  assert.deepEqual([sc.city, sc.weather, sc.seeds, sc.days], [audit.city, audit.weather, audit.seeds, audit.days]);
  assert.deepEqual(sc.counts, [12, 8, 6, 4, 3, 2, 0]);
  // Today's twin has 7 real sensors; that layout gives exactly the audited ANBIT numbers.
  assert.deepEqual(sc.default.ids, [...C.SECTION_TEMPLATES.filter((t) => t.lora).map((t) => t.id)]);
  for (const season of sc.seasons)
    for (const m of ["waterM3", "inRangePct", "stressH", "overEvents"])
      assert.equal(sc.default.bySeason[season][m], audit.bySeason[season].anbit[m], `${season} ${m}`);
  // N = 12: every section real; the change against itself is zero.
  assert.deepEqual(sc.chosen["12"].ids, [...C.SECTION_TEMPLATES.map((t) => t.id)]);
  for (const season of sc.seasons) assert.equal(sc.chosen["12"].vsN12[season].stressH.abs, 0);
  // N = 0 reads no soil sensor at all; N = 12 reads all twelve every step.
  assert.deepEqual(sc.chosen["0"].ids, []);
  assert.equal(sc.chosen["0"].soilReadings, 0);
  assert.equal(sc.chosen["12"].soilReadings, 12 * sc.seeds * sc.days * 96 * sc.seasons.length);
  // The reported smallest N follows from the table.
  const ref = sc.chosen["12"].bySeason;
  const ok = (n) => sc.seasons.every((s) => sc.chosen[n].bySeason[s].stressH <= ref[s].stressH * 1.1 + 1e-9);
  const expected = sc.counts.filter((n) => ok(String(n)));
  assert.equal(sc.smallestChosenNWithin, expected.length ? Math.min(...expected) : null);
});

test("sensor count: greedy placement is deterministic and random placements repeat by seed", async () => {
  const sc = sensorCount();
  const ids = [...C.SECTION_TEMPLATES.map((t) => t.id)];
  const spec = JSON.stringify({ ids, cols: 4, rows: 3 });
  const py = (await Promise.all([1, 2].map(() =>
    run(resolve(repoRoot, ".venv/bin/python"), [resolve(repoRoot, "research/simulation/sensor_placement.py"), spec], { cwd: repoRoot, env: { ...process.env, PYTHONPATH: resolve(repoRoot, "backend") } }),
  ))).map((r) => JSON.parse(r.stdout));
  assert.deepEqual(py[0], py[1]);
  assert.deepEqual(py[0].order, sc.placement.order);
  // Each greedy step never lowers coverage, and the first N of the order is the placement for N.
  for (let k = 1; k < py[0].steps.length; k++) assert.ok(py[0].steps[k].coverage >= py[0].steps[k - 1].coverage);
  for (const n of sc.counts) assert.deepEqual([...sc.chosen[n].ids].sort(), [...sc.placement.order.slice(0, n)].sort(), `N=${n}`);
  // Two quick runs give the same random placements as the full experiment (placement does not depend on runs).
  const quick = (await Promise.all([1, 2].map(() =>
    run("node", [resolve(repoRoot, "research/simulation/audit_sensor_count.mjs"), "--quick"], { cwd: repoRoot, maxBuffer: 1 << 24 }),
  ))).map((r) => JSON.parse(r.stdout));
  for (const n of Object.keys(sc.random)) {
    const full = sc.random[n].runs.map((r) => [r.rngSeed, r.ids]);
    assert.deepEqual(quick[0].random[n].runs.map((r) => [r.rngSeed, r.ids]), full, `N=${n}`);
    assert.deepEqual(quick[1].random[n].runs.map((r) => [r.rngSeed, r.ids]), full, `N=${n}`);
    assert.ok(full.every(([, list]) => list.length === Number(n) && new Set(list).size === Number(n)));
  }
});

test("sensor count: soil and plant placement is deterministic, covers every soil kind from N = 3, and leaves the default engine alone", async () => {
  const { soilPlantOrder } = await import(resolve(repoRoot, "research/simulation/soil_placement.mjs"));
  const templates = C.SECTION_TEMPLATES;
  const byId = Object.fromEntries(templates.map((t) => [t.id, t]));
  const order = soilPlantOrder(templates);
  assert.deepEqual(soilPlantOrder(templates), order);
  assert.deepEqual([...order].sort(), [...templates.map((t) => t.id)].sort());
  const soils = new Set(templates.map((t) => t.soil));
  const plants = new Set(templates.map((t) => t.plant));
  for (let n = 1; n <= order.length; n++) {
    const pick = order.slice(0, n).map((id) => byId[id]);
    const counts = [...soils].map((s) => pick.filter((t) => t.soil === s).length);
    // No soil kind gets a second sensor before every soil kind has one.
    if (Math.min(...counts) === 0) assert.ok(Math.max(...counts) <= 1, `N=${n}`);
    if (n >= soils.size) assert.equal(new Set(pick.map((t) => t.soil)).size, soils.size, `N=${n}`);
  }
  // On this site the soil rule still leaves room to cover every plant kind by N = 6.
  assert.equal(new Set(order.slice(0, plants.size).map((id) => byId[id].plant)).size, plants.size);
  // Ties go to the larger area, then the lower index: the first pick is the largest section.
  assert.equal(order[0], [...templates].sort((a, b) => b.areaM2 - a.areaM2)[0].id);
  // The experiment used exactly this order, through the optional realSensors parameter only.
  const sc = sensorCount();
  assert.deepEqual(sc.placement.soil.order, order);
  assert.deepEqual(sc.placement.soil.counts, [8, 6, 4, 3, 2]);
  for (const n of sc.placement.soil.counts) {
    assert.deepEqual([...sc.soil[n].ids].sort(), order.slice(0, n).sort(), `N=${n}`);
    assert.equal(sc.soil[n].soilReadings, n * sc.seeds * sc.days * 96 * sc.seasons.length, `N=${n}`);
  }
  // Default engine: no realSensors key, and the same seven LoRa sections as before.
  const cfg = engine.defaultConfig();
  assert.equal("realSensors" in cfg, false);
  assert.deepEqual([...engine.sectionsFor(cfg).filter((s) => s.lora).map((s) => s.id)], [...templates.filter((t) => t.lora).map((t) => t.id)]);
});
