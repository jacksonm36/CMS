import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWafScanString } from "./waf.js";

/** Same as middleware SQLI heuristic — duplicated so tests track intent without exporting regex list */
const SQLI_HEURISTIC = /(\bUNION\b.*\bSELECT\b|\bSELECT\b.*\bFROM\b.*\bWHERE\b)/i;

test("WAF fold: block-style comments between UNION and SELECT still match heuristics", () => {
  const scan = buildWafScanString("/", { x: "UNION/**/SELECT * FROM t WHERE 1" });
  assert.equal(SQLI_HEURISTIC.test(scan), true);
});

test("WAF decode: percent-encoded query is normalized before matching", () => {
  const scan = buildWafScanString(
    "/search?q=%55%4e%49%4f%4e%20%53%45%4c%45%43%54%20%2a%20%46%52%4f%4d%20%74%20%57%48%45%52%45",
    {},
  );
  assert.equal(SQLI_HEURISTIC.test(scan), true);
});
