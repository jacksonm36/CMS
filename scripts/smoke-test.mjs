#!/usr/bin/env node
/**
 * Smoke test: API /health must return JSON with status ok.
 * Uses API_PORT / API_HOST from env, defaults 127.0.0.1:4000.
 */
const host = process.env.API_HOST ?? "127.0.0.1";
const port = process.env.API_PORT ?? "4000";
const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/health`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`FAIL: ${url} -> HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json();
if (body?.status !== "ok") {
  console.error("FAIL: unexpected body", body);
  process.exit(1);
}
console.log(`OK: ${url}`, body);
