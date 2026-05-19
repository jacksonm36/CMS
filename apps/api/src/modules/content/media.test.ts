import { describe, it, expect } from "vitest";
import { assertAllowedUploadMime } from "./media.js";

describe("media upload policy", () => {
  it("allows image/jpeg", () => {
    expect(() => assertAllowedUploadMime("image/jpeg")).not.toThrow();
  });

  it("rejects exe mime", () => {
    expect(() => assertAllowedUploadMime("application/x-msdownload")).toThrow(/not allowed/i);
  });
});
