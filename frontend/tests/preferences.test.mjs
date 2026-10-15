import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parsePreferences, preferenceBootstrap } from "../lib/preferences.mjs";
const dictionary = JSON.parse(
  readFileSync(new URL("../lib/translations.json", import.meta.url), "utf8"),
);
const source = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports,
  require: () => dictionary,
  document: { documentElement: { lang: "en" } },
});
test("language and theme settings validate missing, corrupt and unsupported preferences", () => {
  assert.equal(parsePreferences('{"language":"en","theme":"dark"}'), "en:dark");
  for (const p of [
    null,
    "null",
    "not json",
    '{"language":"fr","theme":"neon"}',
  ])
    assert.equal(parsePreferences(p), "ar:light");
});
test("startup applies stored theme and direction before app rendering", () => {
  const root = { dataset: {} };
  vm.runInNewContext(preferenceBootstrap, {
    document: { documentElement: root },
    localStorage: { getItem: () => '{"language":"en","theme":"dark"}' },
  });
  assert.equal(root.lang, "en");
  assert.equal(root.dir, "ltr");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.dataset.localizing, "true");
  vm.runInNewContext(preferenceBootstrap, {
    document: { documentElement: root },
    localStorage: { getItem: () => "null" },
  });
  assert.equal(root.lang, "ar");
  assert.equal(root.dir, "rtl");
  assert.equal(root.dataset.theme, "light");
});
test("scientific caveats and role permissions translate without changing numerical values", () => {
  assert.equal(
    exports.translate("رطوبة أقل من الحد المحدد", "en"),
    "Moisture below the configured threshold",
  );
  assert.equal(
    exports.translate("تقدير حسابي مشروط، وليس كمية ري معتمدة ميدانيًا.", "en"),
    "Conditional mathematical estimate, not a field-approved irrigation quantity.",
  );
  assert.equal(
    exports.translate("هذه العملية غير متاحة لهذا الدور", "en"),
    "This action is not available to your role",
  );
  assert.equal(exports.translate("13000 لتر", "en"), "13000 L");
  assert.equal(
    exports.translate("VWC = 0.16; 0.8 efficiency", "en"),
    "VWC = 0.16; 0.8 efficiency",
  );
  assert.equal(exports.translate("رطوبة التربة", "ar"), "رطوبة التربة");
  assert.equal(exports.display(0.16), 0.16);
  const original = { zone_id: "z3", value: 16, unit: "vwc_percent" };
  assert.equal(exports.display(original), original);
});
