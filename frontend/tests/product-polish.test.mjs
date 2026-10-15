import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { formatReportVolume } from "../lib/report-format.mjs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const care = JSON.parse(read("../data/growing-guides.json"));

test("care sources cover the dataset without importing legacy watering prescriptions", () => {
  assert.equal(Object.keys(care.explorer).length, 17);
  assert.equal(Object.keys(care.guides).length, 21); // one shared general citrus guide
  for (const key of [
    ...Object.values(care.explorer),
    "rosemary",
    "basil",
    "mint",
    "thyme",
    "parsley",
  ]) {
    const guide = care.guides[key];
    assert.ok(guide);
    for (const field of ["description", "season", "place", "care", "tips"])
      for (const lang of ["ar", "en"])
        assert.ok(guide[field][lang].length > 15);
    assert.ok(guide.steps.length);
    assert.ok(
      guide.source_ids.every(
        (id) => care.sources[id]?.verified_on === "2026-10-15",
      ),
    );
  }
  for (const source of Object.values(care.sources)) {
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.context);
  }
  assert.match(care.guides.onion.steps[0].en, /2 cm/);
  assert.match(care.guides.parsley.steps[0].en, /1 cm/);
  assert.match(care.guides.citrus.tips.en, /general citrus guide/);
  assert.doesNotMatch(
    JSON.stringify(care),
    /times a week|VWC|water_needs|humidity_min|root_depth/,
  );
});
test("report formatting keeps 1250 L equal to 1.25 cubic metres in both languages", () => {
  assert.deepEqual(formatReportVolume(1250, "en"), {
    litres: "1,250",
    cubicMetres: "1.25",
  });
  assert.deepEqual(formatReportVolume(1250, "ar"), {
    litres: "١٬٢٥٠",
    cubicMetres: "١٫٢٥",
  });
  assert.equal(formatReportVolume(0, "en").cubicMetres, "0");
  assert.equal(formatReportVolume(1, "en").cubicMetres, "0.001");
  assert.equal(formatReportVolume(0.125, "en").cubicMetres, "0.000125");
});
test("active frontend and presentation-facing documents carry only the current project brand", () => {
  const obsolete = /grow[ _-]?right/i;
  for (const folder of ["../components/", "../app/", "../lib/"]) {
    for (const name of readdirSync(new URL(folder, import.meta.url))) {
      if (/\.(tsx?|mjs|css|json)$/.test(name))
        assert.doesNotMatch(read(folder + name), obsolete, name);
    }
  }
  for (const name of readdirSync(
    new URL("../../docs/", import.meta.url),
  ).filter((n) => n.endsWith(".md")))
    assert.doesNotMatch(read("../../docs/" + name), obsolete, name);
  assert.doesNotMatch(read("../../README.md"), obsolete);
});
test("print separates research and personal guidance stays out of professional routes", () => {
  const css = read("../app/report-print.css");
  assert.match(
    css,
    /\.report-technical-appendix\s*\{\s*display: none !important/,
  );
  assert.match(css, /data-print-scope="technical"/);
  assert.match(css, /thead\s*\{\s*display: table-header-group/);
  assert.match(css, /break-inside: avoid/);
  const report = read("../components/executive-report.tsx");
  assert.match(report, /data-print-expand="main"/);
  assert.doesNotMatch(report, /details:not\(\[open\]\)/);
  assert.match(report, /plantCity\.plants\.length/);
  assert.match(report, /plant_catalog_count/);
  const workspace = read("../components/workspace.tsx");
  assert.match(
    workspace,
    /!canOperate && view === "map"[\s\S]*?<BeginnerSoilGuide/,
  );
  assert.match(workspace, /canOperate && <PlantCityExplorer/);
  assert.match(read("../app/growing-guide.css"), /var\(--surface\)/);
  assert.match(read("../app/growing-guide.css"), /max-width: 700px/);
});

test("printing the main report never opens research; the appendix and disclosure state restore after cancel", async () => {
  const { printExecutiveReport } = await import("../lib/report-print.mjs");
  const sources = { open: false },
    research = { open: false },
    comparison = { open: false };
  const root = {
    dataset: {},
    querySelectorAll: (selector) =>
      selector.startsWith("[data-print-expand")
        ? sources.open
          ? []
          : [sources]
        : research.open
          ? []
          : [research],
  };
  let afterPrint;
  const win = {
    addEventListener: (_, fn) => {
      afterPrint = fn;
    },
    removeEventListener: () => {},
    print: () => {
      assert.equal(root.dataset.printScope, "executive");
      assert.equal(sources.open, true);
      assert.equal(research.open, false);
      assert.equal(comparison.open, false);
    },
  };
  printExecutiveReport(root, "executive", win);
  afterPrint();
  assert.equal(sources.open, false);
  assert.equal(root.dataset.printScope, undefined);
  win.print = () => {
    assert.equal(root.dataset.printScope, "technical");
    assert.equal(research.open, true);
    assert.equal(sources.open, false);
  };
  printExecutiveReport(root, "technical", win);
  afterPrint();
  assert.equal(research.open, false);
  assert.equal(root.dataset.printScope, undefined);
  win.print = () => {
    throw new Error("test print failure");
  };
  assert.throws(
    () => printExecutiveReport(root, "executive", win),
    /test print failure/,
  );
  assert.equal(sources.open, false);
  assert.equal(root.dataset.printScope, undefined);
});
