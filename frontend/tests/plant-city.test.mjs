import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessmentLabels,
  cityResults,
  plantNames,
  cityNames,
} from "../lib/plant-city.mjs";
const data = JSON.parse(
  readFileSync(new URL("../data/plant-city.json", import.meta.url), "utf8"),
);
test("exact counts, unique ids and all 238 pairs", () => {
  assert.equal(data.plants.length, 17);
  assert.equal(data.cities.length, 14);
  assert.equal(data.assessments.length, 238);
  for (const rows of [data.plants, data.cities, data.assessments])
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(
    new Set(data.assessments.map((r) => `${r.plant_id}/${r.city_id}`)).size,
    238,
  );
});
test("references, Arabic names and derived criteria agree with stored score", () => {
  for (const r of data.assessments) {
    assert.ok(data.plants.some((p) => p.id === r.plant_id));
    assert.ok(data.cities.some((c) => c.id === r.city_id));
    assert.equal(
      r.score,
      50 * (Number(r.temperature_match) + Number(r.air_humidity_match)),
    );
    assert.ok(plantNames[r.plant_id]);
    assert.ok(cityNames[r.city_id]);
  }
});
test("labels do not represent probabilities", () => {
  assert.equal(assessmentLabels[100], "يطابق معياري الحرارة والرطوبة الجوية");
  assert.equal(assessmentLabels[50], "يطابق معيارًا واحدًا");
  assert.equal(assessmentLabels[0], "لا يطابق المعيارين وفق البيانات المتاحة");
});
test("every city filters 17 plants and sorts descending without mutation", () => {
  const before = JSON.stringify(data);
  for (const city of data.cities) {
    const rows = cityResults(data, city.id);
    assert.equal(rows.length, 17);
    assert.ok(rows.every((r) => r.city_id === city.id));
    assert.ok(rows.every((r, i) => !i || rows[i - 1].score >= r.score));
  }
  assert.deepEqual(cityResults(data, 999), []);
  assert.equal(JSON.stringify(data), before);
});
test("minimal static payload excludes operational and ambiguous fields", () => {
  assert.deepEqual(Object.keys(data.plants[0]).sort(), ["id", "name"]);
  assert.deepEqual(Object.keys(data.cities[0]).sort(), ["id", "name"]);
  assert.deepEqual(Object.keys(data.assessments[0]).sort(), [
    "air_humidity_match",
    "city_id",
    "id",
    "plant_id",
    "score",
    "temperature_match",
  ]);
  assert.ok(!JSON.stringify(data).includes("/Users/"));
  const component = readFileSync(
    new URL("../components/plant-city-explorer.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(component.includes("../data/plant-city.json"));
  assert.ok(!/fetch\(|\/Users\/|sqlite|\.\/api/.test(component));
});
