import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, extname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the actual components, with deterministic unit fixtures only.
function components(language = "ar") {
  const cache = new Map(),
    document = { documentElement: { lang: language } };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const loaded = { exports: {} };
    cache.set(path, loaded);
    const native = createRequire(path);
    const require = (name) => {
      if (!name.startsWith(".")) return native(name);
      const base = resolve(dirname(path), name);
      const file = [
        base,
        base + ".ts",
        base + ".tsx",
        base + ".mjs",
        base + ".json",
      ].find(existsSync);
      if (!file) throw new Error(`Missing import ${name}`);
      if (extname(file) === ".json")
        return JSON.parse(readFileSync(file, "utf8"));
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
    vm.runInNewContext(compiled, {
      module: loaded,
      exports: loaded.exports,
      require,
      document,
      Intl,
      Date,
      Number,
      console,
    });
    return loaded.exports;
  }
  return {
    Landscape: load(resolve("frontend/components/landscape-home.tsx")).default,
    HomeCards: load(resolve("frontend/components/landscape-home.tsx"))
      .HomeCards,
    Survey: load(resolve("frontend/components/survey-home.tsx")).default,
    User: load(resolve("frontend/components/quick-decision.tsx")).default,
    Individual: load(resolve("frontend/components/individual-home.tsx"))
      .default,
    Matches: load(resolve("frontend/components/plant-city-explorer.tsx"))
      .PlantMatches,
    Map: load(resolve("frontend/components/site-map.tsx")).default,
    Info: load(resolve("frontend/components/plant-city-explorer.tsx"))
      .PlantDataInfo,
    Planner: load(resolve("frontend/components/predictive-planner.tsx"))
      .default,
    Forecast: load(resolve("frontend/components/predictive-planner.tsx"))
      .ForecastChart,
    Executive: load(resolve("frontend/components/executive-report.tsx"))
      .ExecutiveBody,
    Twin: load(resolve("frontend/components/digital-twin.tsx")).default,
    BrandLogo: load(resolve("frontend/components/brand-logo.tsx")).default,
    GrowingGuide: load(resolve("frontend/components/growing-guide.tsx"))
      .default,
    Beginner: load(resolve("frontend/components/growing-guide.tsx"))
      .BeginnerSoilGuide,
    OriginalGuide: load(resolve("frontend/components/plant-guide.tsx")).default,
    ForecastCrossing: load(
      resolve("frontend/components/predictive-planner.tsx"),
    ).ForecastCrossing,
    ...load(resolve("frontend/lib/planning.ts")),
    ...load(resolve("frontend/lib/role-home.ts")),
  };
}
function fixture(code = "measure") {
  return {
    id: "test-zone",
    name: "منطقة الاختبار",
    x: 0,
    y: 0,
    width: 24,
    height: 20,
    area_m2: 480,
    points: [
      { id: "read-point", name: "stored test point", x: 2, y: 3 },
      { id: "empty-point", name: "empty test point", x: 4, y: 5 },
    ],
    measurements: [
      {
        id: "reading",
        point_id: "read-point",
        value: 15,
        unit: "vwc_percent",
        measured_at: "2026-10-14T10:00:00Z",
      },
    ],
    decision: {
      code,
      label: code,
      mean_vwc: 0.15,
      readings_used: ["reading"],
      rejected: [],
      reason: "test API reason",
      missing: ["test API missing requirement"],
      validity: "test API validity",
      evaluated_at: "2026-10-14T11:00:00Z",
      coverage: {
        active_points: 1,
        total_points: 2,
        fraction: 0.2,
        required_fraction: 0.6,
        uncovered_cells: [],
        caveat: "test geometric coverage caveat",
        next_point: { x: 18, y: 12, reason: "test API suggested reason" },
      },
      estimate: null,
    },
  };
}
const handlers = {
  onSelect: () => {},
  onReading: () => {},
  onDetails: () => {},
  onMap: () => {},
  busy: false,
  feedback: "",
  canMeasure: false,
};
function html(Component, zone, zones = [zone], extra = {}) {
  return renderToStaticMarkup(
    React.createElement(Component, { ...handlers, zone, zones, ...extra }),
  );
}
for (const language of ["ar", "en"]) {
  test(`survey homepage renders five selectable zones, primary action and only API location (${language})`, () => {
    const { Survey } = components(language),
      zone = fixture();
    const zones = Array.from({ length: 5 }, (_, i) => ({
      ...zone,
      id: `z${i}`,
      name: `zone-${i}`,
    }));
    const out = html(Survey, zones[0], zones);
    assert.equal((out.match(/class="quick-zone-choice/g) || []).length, 5);
    assert.match(out, /aria-pressed="true"/);
    assert.match(
      out,
      new RegExp(language === "ar" ? "تسجيل قراءة" : "Record a reading"),
    );
    assert.match(out, /test API suggested reason/);
    assert.match(out, /cx="18" cy="12"/);
    assert.match(out, /cx="2" cy="3"/);
    assert.doesNotMatch(out, /cx="4" cy="5"/); // A point with no reading is not presented as a stored reading.
    assert.doesNotMatch(
      out,
      /اعتماد|تسجيل تنفيذ|الاحتياج المائي المحسوب|Approve|Record execution|Calculated water requirement/,
    );
  });
  test(`survey does not invent missing or out-of-zone suggested coordinates (${language})`, () => {
    const { Survey } = components(language),
      zone = fixture();
    for (const point of [
      null,
      { x: 999, y: 12, reason: "invalid suggestion" },
      { x: NaN, y: 12, reason: "invalid suggestion" },
    ]) {
      zone.decision.coverage.next_point = point;
      const out = html(Survey, zone);
      assert.match(
        out,
        new RegExp(
          language === "ar"
            ? "لا يوجد موقع قياس مقترح صالح"
            : "no valid suggested measurement location",
        ),
      );
      assert.doesNotMatch(out, /invalid suggestion|cx="999"|cx="NaN"/);
    }
  });
  test(`survey shows optional location for sufficient readings and saves feedback (${language})`, () => {
    const { Survey } = components(language),
      zone = fixture("review");
    const out = html(Survey, zone, [zone], {
      feedback: "test saved reading feedback",
      busy: true,
    });
    assert.match(
      out,
      new RegExp(
        language === "ar"
          ? "موقع قياس اختياري"
          : "Optional measurement location",
      ),
    );
    assert.match(out, /cx="18" cy="12"/);
    assert.match(out, /role="status">test saved reading feedback/);
    assert.match(out, /class="primary" disabled=""/);
  });
  test(`user shows conditional volume only for an API irrigation-review decision (${language})`, () => {
    const { User } = components(language),
      zone = fixture("review");
    zone.decision.estimate = { gross_l: 1234 };
    const volume = language === "ar" ? /١٬٢٣٤/ : /1,234/;
    assert.match(html(User, zone), volume);
    for (const code of [
      "insufficient",
      "measure",
      "conflict",
      "high",
      "defer",
    ]) {
      zone.decision.code = code;
      const out = html(User, zone);
      assert.doesNotMatch(out, volume);
      assert.doesNotMatch(out, /تسجيل قراءة|Record a reading/);
    }
  });
}
test("survey distinguishes stale and post-irrigation readings from missing coverage", () => {
  const { Survey } = components(),
    zone = fixture("insufficient");
  zone.decision.readings_used = [];
  zone.decision.rejected = [{ id: "reading", reason: "قراءة قديمة" }];
  assert.match(html(Survey, zone), /القراءات الموجودة قديمة/);
  zone.decision.rejected = [{ id: "reading", reason: "قراءة سابقة لآخر ري" }];
  assert.match(html(Survey, zone), /أضف قراءة جديدة/);
  zone.decision.code = "conflict";
  assert.match(html(Survey, zone), /القراءات تحتاج إلى التحقق/);
});
test("audience navigation gives landscape every site feature and shared plant access", () => {
  const { navigationFor } = components();
  assert.deepEqual(
    Array.from(navigationFor("survey"), (n) => n.id),
    ["overview", "plants", "map", "decisions", "water"],
  );
  assert.equal(navigationFor("survey")[0].label, "إدارة المسطحات الخضراء");
  assert.deepEqual(
    Array.from(navigationFor("user"), (n) => n.id),
    ["overview", "plants", "map"],
  );
});
for (const language of ["ar", "en"]) {
  test(`individual homepage starts with city selection and no professional actions (${language})`, () => {
    const { Individual } = components(language);
    const out = renderToStaticMarkup(React.createElement(Individual));
    assert.equal((out.match(/<option/g) || []).length, 15);
    assert.match(
      out,
      new RegExp(language === "ar" ? "اختر مدينتك" : "Choose your city"),
    );
    assert.doesNotMatch(
      out,
      /تسجيل قراءة|اعتماد الري|Record a reading|Approve irrigation/,
    );
    assert.match(
      out,
      new RegExp(language === "ar" ? "كيف تزرعه؟" : "How do I grow it?"),
    );
  });
  test(`plant details use existing assessments and disclose missing care evidence (${language})`, () => {
    const { Matches, Info } = components(language);
    const out = renderToStaticMarkup(
      React.createElement(Matches, { cityId: 1 }),
    );
    assert.equal((out.match(/<article/g) || []).length, 17);
    assert.match(
      out,
      new RegExp(language === "ar" ? "كيفية الزراعة" : "How to grow"),
    );
    assert.match(
      renderToStaticMarkup(React.createElement(Info)),
      new RegExp(
        language === "ar"
          ? "ليست نسبة نجاح أو دقة"
          : "not a success rate or accuracy",
      ),
    );
    assert.match(
      renderToStaticMarkup(React.createElement(Info)),
      new RegExp(
        language === "ar" ? "مراجع زراعية مرتبطة" : "horticultural references",
      ),
    );
  });
  test(`landscape homepage provides measurement and recommendation actions (${language})`, () => {
    const { User: Team } = components(language),
      zone = fixture("review");
    zone.decision.estimate = { gross_l: 1234 };
    const out = html(Team, zone, [zone], { canMeasure: true });
    assert.match(
      out,
      new RegExp(language === "ar" ? "تسجيل قراءة" : "Record a reading"),
    );
    assert.match(
      out,
      new RegExp(
        language === "ar" ? "مراجعة التوصية" : "Review recommendation",
      ),
    );
    assert.match(
      out,
      new RegExp(
        language === "ar"
          ? "موقع قياس اختياري"
          : "Optional measurement location",
      ),
    );
  });
}

for (const language of ["ar", "en"]) {
  test(`map legend and markers explain actual readings and proposal access (${language})`, () => {
    const { Map } = components(language),
      zone = fixture();
    const out = html(Map, zone, [zone], {
      selected: zone.id,
      focusSuggested: true,
      onReading: () => {},
    });
    assert.match(
      out,
      new RegExp(language === "ar" ? "مفتاح الخريطة" : "Map legend"),
    );
    assert.match(
      out,
      new RegExp(
        language === "ar"
          ? "قراءة قديمة أو مستبعدة"
          : "Stale or excluded reading",
      ),
    );
    assert.match(out, /data-kind="reading" role="button" tabindex="0"/);
    assert.match(
      out,
      /data-kind="suggested" data-zone="test-zone" data-x="18" data-y="12"/,
    );
    assert.match(out, /test API suggested reason/);
    assert.match(
      out,
      new RegExp(
        language === "ar"
          ? "تسجيل قراءة في هذا الموقع"
          : "Record a reading at this location",
      ),
    );
    assert.doesNotMatch(out, /cx="4" cy="5"/);
    assert.doesNotMatch(out, /fill="url\(#/);
  });
  test(`map never fabricates a suggested location and respects read-only actions (${language})`, () => {
    const { Map } = components(language),
      zone = fixture();
    let out = html(Map, zone, [zone], {
      selected: zone.id,
      focusSuggested: true,
      onReading: undefined,
    });
    assert.doesNotMatch(
      out,
      /تسجيل قراءة في هذا الموقع|Record a reading at this location/,
    );
    zone.decision.coverage.next_point = null;
    out = html(Map, zone, [zone], { selected: zone.id, focusSuggested: true });
    assert.doesNotMatch(out, /data-kind="suggested"/);
    assert.match(
      out,
      new RegExp(
        language === "ar"
          ? "لا يوجد موقع قياس مقترح صالح"
          : "no valid suggested measurement location",
      ),
    );
  });
  test(`next action follows measurement validity and existing approval (${language})`, () => {
    const { User: Dashboard } = components(language),
      zone = fixture("insufficient");
    zone.decision.estimate = { gross_l: 5678 };
    let out = html(Dashboard, zone, [zone], { canMeasure: true });
    const primary = out.match(
      /data-testid="zone-next-action">(.*?)<\/button>/s,
    )[1];
    assert.match(
      primary,
      new RegExp(language === "ar" ? "تسجيل قراءة" : "Record a reading"),
    );
    assert.match(
      out,
      new RegExp(language === "ar" ? "أين أقيس؟" : "Where should I measure"),
    );
    assert.doesNotMatch(out, /5,678|٥٬٦٧٨/);
    zone.decision.code = "review";
    out = html(Dashboard, zone, [zone], {
      canMeasure: true,
      recommendation: { status: "approved" },
      onExecute: () => {},
    });
    assert.match(out, /5,678|٥٬٦٧٨/);
    assert.match(
      out.match(/data-testid="zone-next-action">(.*?)<\/button>/s)[1],
      new RegExp(
        language === "ar" ? "تسجيل تنفيذ الري" : "Record irrigation execution",
      ),
    );
    out = html(Dashboard, zone, [zone], {
      canMeasure: false,
      recommendation: { status: "approved" },
      onExecute: () => {},
    });
    assert.doesNotMatch(out, /تسجيل تنفيذ الري|Record irrigation execution/);
  });
}

test("compact zone picker retains every API zone for mobile selection", () => {
  const { User: Dashboard } = components();
  const zones = Array.from({ length: 5 }, (_, index) => ({
    ...fixture(),
    id: `api-zone-${index}`,
    name: `API zone ${index}`,
  }));
  const out = html(Dashboard, zones[2], zones, { canMeasure: true });
  assert.equal((out.match(/<option /g) || []).length, 5);
  assert.match(
    out,
    /<option value="api-zone-2" selected="">API zone 2<\/option>/,
  );
  assert.match(out, /aria-pressed="true"/);
});

for (const language of ["ar", "en"]) {
  test(`advanced planner keeps configuration without dashboard headings and preserves Individuals (${language})`, () => {
    const { Planner, Individual } = components(language);
    const zone = {
      ...fixture(),
      plant: { name: "test plant" },
      soil: { name: "test soil" },
      root_depth_m: 0.2,
      efficiency: 0.8,
      irrigated_area_m2: 300,
    };
    const out = html(Planner, zone, [zone], {
      report: { total_l: 100 },
      onDecisions: () => {},
    });
    assert.doesNotMatch(
      out,
      /التوقع التشغيلي غير متاح|Operational forecast unavailable|planning-title|planning-cards/,
    );
    assert.match(
      out,
      new RegExp(
        language === "ar"
          ? "تلقائي \\(محاكاة\\)"
          : "Automatic \\(simulation\\)",
      ),
    );
    assert.doesNotMatch(out, /undefined|NaN/);
    assert.match(out, /name="fc"/);
    assert.match(out, /name="flow"/);
    const individual = html(Individual, zone, [zone]);
    assert.doesNotMatch(
      individual,
      /name="fc"|Operational forecast|التخطيط التنبؤي/,
    );
  });
  test(`forecast renders actual input series, uncertainty band and supported threshold (${language})`, () => {
    const { Forecast } = components(language);
    const rows = Array.from({ length: 25 }, (_, h) => ({
      hour: h,
      vwc: 0.2 - h * 0.001,
      low: 0.18 - h * 0.001,
      high: 0.22 - h * 0.001,
    }));
    const out = renderToStaticMarkup(
      React.createElement(Forecast, { points: rows, threshold: 0.15 }),
    );
    assert.match(out, /class="forecast-band"/);
    assert.match(out, /class="threshold-line"/);
    assert.match(out, /role="img"/);
    assert.doesNotMatch(out, /NaN|undefined/);
  });
  test(`executive report separates origins, has print/export actions and no fabricated savings (${language})`, () => {
    const { Executive } = components(language);
    const data = {
      start: "2026-10-01T00:00:00Z",
      end: "2026-10-14T00:00:00Z",
      generated_at: "2026-10-14T00:00:00Z",
      days: 7,
      groups: [
        {
          origin: "field",
          total_l: 0,
          total_m3: 0,
          events_count: 0,
          measured_l: 0,
          estimated_l: 0,
        },
        {
          origin: "simulation",
          total_l: 500,
          total_m3: 0.5,
          events_count: 1,
          measured_l: 0,
          estimated_l: 500,
        },
      ],
      zones: [],
      events: [],
      daily: [],
      proposals: [],
      decisions: [],
      forecast_quality: { evaluation: [] },
      limitations: [],
      sources: [],
    };
    const out = renderToStaticMarkup(React.createElement(Executive, { data }));
    assert.match(
      out,
      new RegExp(language === "ar" ? "طباعة التقرير" : "Print report"),
    );
    assert.match(out, /CSV/);
    assert.match(
      out,
      new RegExp(language === "ar" ? "سجلات ميدانية" : "Field logs"),
    );
    assert.match(
      out,
      new RegExp(language === "ar" ? "سجلات محاكاة" : "Simulation logs"),
    );
    assert.doesNotMatch(out, /undefined|NaN/);
    if (language === "en") assert.doesNotMatch(out, /[\u0621-\u064a]/);
  });
  test(`What-if leads with the scenario and keeps scientific details expandable (${language})`, () => {
    const { Twin } = components(language),
      zone = {
        ...fixture(),
        plant: { name: "test" },
        soil: { name: "test", calibration: "demo_assumption" },
        origin: "simulation",
      };
    const out = html(Twin, zone);
    assert.ok(out.indexOf("twin-scenario") < out.indexOf("twin-advanced"));
    assert.match(out, /name="flow"/);
    assert.match(out, /<details class="twin-advanced"/);
    assert.match(
      out,
      new RegExp(
        language === "ar"
          ? "ماذا يحدث إذا روينا"
          : "What happens if we irrigate",
      ),
    );
  });
}
test("comparison guards missing/zero baselines and preserves negative savings; duration requires flow", () => {
  const { hypotheticalSavings, theoreticalDuration, csvText } = components();
  assert.equal(hypotheticalSavings(120, 100), -20);
  for (const value of [null, 0, -1, NaN])
    assert.equal(hypotheticalSavings(10, value), null);
  assert.equal(theoreticalDuration(800, 400), 2);
  assert.equal(theoreticalDuration(800, null), null);
  const csv = csvText([["=HYPERLINK(1)", "أنبت, test", '"quoted"', 100]]);
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"أنبت, test"/);
  assert.match(csv, /""quoted""/);
});

test("professional Home puts four cards and the only primary action before collapsed details", () => {
  const { Landscape } = components("en"),
    zone = fixture();
  const out = html(Landscape, zone, [zone], {
    onReview: () => {},
    onDecisions: () => {},
    children: React.createElement("p", null, "optional details"),
  });
  assert.equal((out.match(/data-home-card=/g) || []).length, 4);
  assert.equal((out.match(/class="primary"/g) || []).length, 1);
  assert.ok(
    out.indexOf('id="home-zone"') < out.indexOf('data-home-card="moisture"'),
  );
  assert.ok(
    out.indexOf('data-home-card="next"') <
      out.indexOf('class="home-primary-actions"'),
  );
  assert.ok(
    out.indexOf('class="home-primary-actions"') <
      out.indexOf('class="home-advanced"'),
  );
  assert.doesNotMatch(
    out,
    /optional details|Unavailable|غير متاح|Logged simulation consumption/,
  );
  assert.match(out, /Record a reading/);
  assert.match(out, /Where should I measure/);
  assert.match(out, /<details class="home-advanced"/);
  assert.doesNotMatch(out, /<details[^>]+open/);
});

test("login, navigation, dashboards and reports share the exact official brand asset", () => {
  const { BrandLogo } = components();
  for (const variant of ["login", "sidebar", "navigation", "report"]) {
    const out = renderToStaticMarkup(
      React.createElement(BrandLogo, { variant, eager: true }),
    );
    assert.match(out, /src="\/brand\/anbit-official.png"/);
    assert.match(out, /width="356" height="168"/);
    assert.match(out, /alt="ANBIT"/);
    assert.doesNotMatch(out, /anbit-logo.jpg|_next\/image/);
  }
});

for (const language of ["ar", "en"]) {
  test(`missing weather is unavailable rather than a no-irrigation forecast (${language})`, () => {
    const { ForecastCrossing } = components(language);
    const empty = renderToStaticMarkup(
      React.createElement(ForecastCrossing, {
        result: { forecast: [], crossing_hour: null },
      }),
    );
    assert.match(
      empty,
      new RegExp(language === "ar" ? "أكمل الإعدادات" : "Complete settings"),
    );
    assert.doesNotMatch(empty, /24/);
    const known = renderToStaticMarkup(
      React.createElement(ForecastCrossing, {
        result: { forecast: [{ hour: 0 }], crossing_hour: null },
      }),
    );
    assert.match(known, /24/);
  });
}

for (const language of ["ar", "en"]) {
  test(`practical guides cover all explorer plants and original herbs (${language})`, () => {
    const { GrowingGuide, OriginalGuide, Beginner } = components(language);
    for (const id of [
      ...Array.from({ length: 17 }, (_, i) => i + 1),
      "rosemary",
      "basil",
      "mint",
      "thyme",
      "parsley",
    ]) {
      const out = renderToStaticMarkup(
        React.createElement(GrowingGuide, { plantId: id, name: "test plant" }),
      );
      assert.equal((out.match(/class="care-section"/g) || []).length, 5);
      assert.match(
        out,
        /https:\/\/(www\.rhs\.org\.uk|www\.fao\.org|edis\.ifas\.ufl\.edu|fieldreport\.caes\.uga\.edu)/,
      );
      assert.match(
        out,
        new RegExp(language === "ar" ? "غير المحدد" : "Not specified"),
      );
      assert.match(
        out,
        new RegExp(
          language === "ar" ? "لا تضمن النجاح" : "does not guarantee success",
        ),
      );
      assert.doesNotMatch(out, /undefined|NaN|Grow[ _-]?Right/i);
      if (language === "en") assert.doesNotMatch(out, /[\u0621-\u064a]/);
    }
    const missing = renderToStaticMarkup(
      React.createElement(GrowingGuide, { plantId: 999, name: "unknown" }),
    );
    assert.doesNotMatch(missing, /care-section|<ol/);
    assert.match(
      missing,
      new RegExp(language === "ar" ? "لا تتوفر إرشادات" : "not available"),
    );
    const original = renderToStaticMarkup(
      React.createElement(OriginalGuide, {
        plants: [
          {
            id: "rosemary",
            name: "test",
            notes: "internal",
            source: { title: "internal", description: "unverified" },
          },
        ],
      }),
    );
    assert.match(original, /rosemary\/grow-your-own/);
    const beginner = renderToStaticMarkup(React.createElement(Beginner));
    assert.doesNotMatch(beginner, /VWC|Digital Twin|توأم|coverage|تغطية|ML/);
    if (language === "en") assert.doesNotMatch(beginner, /[\u0621-\u064a]/);
  });
  test(`individual journey exposes exactly three primary headings and immediate care controls (${language})`, () => {
    const { Individual, Matches } = components(language);
    const home = renderToStaticMarkup(React.createElement(Individual));
    assert.equal((home.match(/<h2/g) || []).length, 3);
    assert.equal((home.match(/<option/g) || []).length, 15);
    assert.doesNotMatch(home, /Digital Twin|ML|حساس|اعتماد|جدولة/);
    const cards = renderToStaticMarkup(
      React.createElement(Matches, {
        cityId: 1,
        onChoose: () => {},
        selectedId: 6,
        guideId: "care-target",
      }),
    );
    assert.equal(
      (cards.match(/aria-controls="care-target"/g) || []).length,
      17,
    );
    assert.equal((cards.match(/data-selected="true"/g) || []).length, 1);
    assert.equal((cards.match(/class="plant-description"/g) || []).length, 17);
    const missing = renderToStaticMarkup(
      React.createElement(Matches, { cityId: 999 }),
    );
    assert.match(missing, /role="status"/);
    assert.doesNotMatch(missing, /<article/);
  });
}

for (const language of ["ar", "en"]) {
  test(`Home cards distinguish fresh, stale, missing data and flow assumptions (${language})`, () => {
    const { HomeCards } = components(language);
    const data = {
      current_vwc: 0.12,
      source: "measured",
      origin: "field",
      stale: false,
      age_hours: 2,
      target_vwc: 0.14,
      demo_profile: true,
      gross_l: 1500,
      area_m2: 300,
      duration_hours: 3.75,
      default_flow: true,
      next_at: "2026-10-16T04:00:00+03:00",
    };
    const render = (summary) =>
      renderToStaticMarkup(
        React.createElement(HomeCards, { summary, onTarget: () => {} }),
      );
    const fresh = render(data);
    assert.equal((fresh.match(/data-home-card=/g) || []).length, 4);
    assert.match(fresh, language === "ar" ? /١٢%/ : /12%/);
    assert.match(fresh, language === "ar" ? /١٤%/ : /14%/);
    assert.match(fresh, new RegExp(language === "ar" ? "مقاسة" : "Measured"));
    assert.match(
      fresh,
      new RegExp(language === "ar" ? "تدفق افتراضي" : "Default flow"),
    );
    const stale = render({
      ...data,
      source: "estimated",
      stale: true,
      age_hours: 72,
    });
    assert.match(
      stale,
      new RegExp(language === "ar" ? "تقدير سيناريو" : "Scenario estimate"),
    );
    assert.match(stale, new RegExp(language === "ar" ? "أيام" : "days"));
    const missing = render(null);
    assert.equal((missing.match(/data-home-card=/g) || []).length, 4);
    assert.match(
      missing,
      new RegExp(language === "ar" ? "أدخل قراءة" : "Add a reading"),
    );
    assert.match(
      missing,
      new RegExp(language === "ar" ? "حدد الهدف" : "Set target"),
    );
    for (const output of [fresh, stale, missing])
      assert.doesNotMatch(
        output,
        /Unavailable|غير متاح|undefined|NaN|التوقع التشغيلي/,
      );
    if (language === "en")
      assert.doesNotMatch(fresh + stale + missing, /[\u0621-\u064a]/);
  });
}
