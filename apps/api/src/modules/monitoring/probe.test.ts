import { describe, expect, it } from "vitest";
import { normalizeProbeTarget } from "./probe.js";

describe("normalizeProbeTarget", () => {
  it("rejects non-http schemes", () => {
    expect(() => normalizeProbeTarget("file:///etc/passwd")).toThrow();
    expect(() => normalizeProbeTarget("ftp://example.com")).toThrow();
  });

  it("rejects credentials in URL", () => {
    expect(() => normalizeProbeTarget("https://user:pass@example.com")).toThrow();
  });

  it("normalizes bare hostnames to https", () => {
    expect(normalizeProbeTarget("cloud.gamedns.hu")).toMatch(/^https:\/\/cloud\.gamedns\.hu/);
  });

  it("rejects oversized URLs", () => {
    expect(() => normalizeProbeTarget("https://x.com/" + "a".repeat(3000))).toThrow();
  });

  it("rejects non-http schemes before https normalization", () => {
    expect(() => normalizeProbeTarget("file:///etc/passwd")).toThrow(/http and https/i);
    expect(() => normalizeProbeTarget("javascript:alert(1)")).toThrow(/http and https/i);
  });
});
