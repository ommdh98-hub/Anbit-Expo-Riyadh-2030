import test from "node:test";
import assert from "node:assert/strict";
import { waterRisk } from "../lib/water-risk.mjs";
test("proposal comparison has cautious exact labels and equality boundary", () => {
  assert.equal(
    waterRisk(101, 100),
    "قد تتجاوز الكمية المقترحة الاحتياج المحسوب",
  );
  for (const n of [0, 99, 100])
    assert.equal(
      waterRisk(n, 100),
      "لا يظهر تجاوز للكمية الحسابية وفق الافتراضات",
    );
});
test("missing or invalid proposal or estimate cannot assess excess", () => {
  for (const v of [null, undefined, NaN, Infinity, -1, ""]) {
    assert.equal(
      waterRisk(v, 100),
      "لا يمكن تقييم خطر الإفراط بالبيانات الحالية",
    );
    assert.equal(
      waterRisk(100, v),
      "لا يمكن تقييم خطر الإفراط بالبيانات الحالية",
    );
  }
});
