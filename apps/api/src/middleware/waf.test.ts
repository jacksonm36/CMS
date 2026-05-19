import { describe, it, expect } from "vitest";
import { buildWafScanString } from "./waf.js";

const SQLI_HEURISTIC = /(\bUNION\b.*\bSELECT\b|\bSELECT\b.*\bFROM\b.*\bWHERE\b)/i;

describe("WAF scan helpers", () => {
  it("folds block-style comments between UNION and SELECT", () => {
    const scan = buildWafScanString("/", { x: "UNION/**/SELECT * FROM t WHERE 1" });
    expect(SQLI_HEURISTIC.test(scan)).toBe(true);
  });

  it("normalizes percent-encoded query before matching", () => {
    const scan = buildWafScanString(
      "/search?q=%55%4e%49%4f%4e%20%53%45%4c%45%43%54%20%2a%20%46%52%4f%4d%20%74%20%57%48%45%52%45",
      {},
    );
    expect(SQLI_HEURISTIC.test(scan)).toBe(true);
  });
});
