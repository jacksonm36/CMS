import { test } from "node:test";
import assert from "node:assert/strict";
import { hostnameMatchesRpId, checkRpIdOriginAlignment } from "./webauthn-rp.js";

test("hostnameMatchesRpId subdomain and exact", () => {
  assert.equal(hostnameMatchesRpId("panel.example.com", "example.com"), true);
  assert.equal(hostnameMatchesRpId("example.com", "example.com"), true);
  assert.equal(hostnameMatchesRpId("evil.com", "example.com"), false);
});

test("checkRpIdOriginAlignment accepts consistent nip.io style", () => {
  const r = checkRpIdOriginAlignment("192-168-1-10.nip.io", ["http://192-168-1-10.nip.io:3000"]);
  assert.equal(r.ok, true);
});

test("checkRpIdOriginAlignment rejects rpID vs origin mismatch", () => {
  const r = checkRpIdOriginAlignment("wrong.example.com", ["https://panel.example.com"]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /does not match/);
});
