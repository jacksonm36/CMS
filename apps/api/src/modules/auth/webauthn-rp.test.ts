import { describe, it, expect } from "vitest";
import { hostnameMatchesRpId, checkRpIdOriginAlignment } from "./webauthn-rp.js";

describe("WebAuthn RP ID alignment", () => {
  it("hostnameMatchesRpId subdomain and exact", () => {
    expect(hostnameMatchesRpId("panel.example.com", "example.com")).toBe(true);
    expect(hostnameMatchesRpId("example.com", "example.com")).toBe(true);
    expect(hostnameMatchesRpId("evil.com", "example.com")).toBe(false);
  });

  it("accepts consistent nip.io style", () => {
    const r = checkRpIdOriginAlignment("192-168-1-10.nip.io", ["http://192-168-1-10.nip.io:3000"]);
    expect(r.ok).toBe(true);
  });

  it("rejects rpID vs origin mismatch", () => {
    const r = checkRpIdOriginAlignment("wrong.example.com", ["https://panel.example.com"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/does not match/);
  });
});
