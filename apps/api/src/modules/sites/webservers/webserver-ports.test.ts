import { describe, expect, it, afterEach } from "vitest";
import {
  backendListenPort,
  backendUpstreamUrl,
  EDGE_PUBLIC_PORT,
  getReservedWebServerBackendPorts,
  isEdgeNativeWebServer,
  needsEdgeProxy,
} from "./webserver-ports.js";

describe("webserver-ports", () => {
  const envBackup: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("assigns distinct default backend ports", () => {
    expect(backendListenPort("nginx")).toBe(80);
    expect(backendListenPort("apache2")).toBe(8081);
    expect(backendListenPort("traefik")).toBe(8086);
    expect(new Set(getReservedWebServerBackendPorts()).size).toBeGreaterThan(3);
  });

  it("treats nginx as edge-native", () => {
    expect(isEdgeNativeWebServer("nginx")).toBe(true);
    expect(needsEdgeProxy("nginx")).toBe(false);
    expect(needsEdgeProxy("apache2")).toBe(true);
  });

  it("respects HOSTPANEL_WS_PORT_APACHE2 override", () => {
    envBackup.HOSTPANEL_WS_PORT_APACHE2 = process.env.HOSTPANEL_WS_PORT_APACHE2;
    process.env.HOSTPANEL_WS_PORT_APACHE2 = "9091";
    expect(backendListenPort("apache2")).toBe(9091);
    expect(backendUpstreamUrl("apache2")).toBe("http://127.0.0.1:9091");
  });

  it("ignores invalid env port overrides", () => {
    envBackup.HOSTPANEL_WS_PORT_CADDY = process.env.HOSTPANEL_WS_PORT_CADDY;
    process.env.HOSTPANEL_WS_PORT_CADDY = "not-a-port";
    expect(backendListenPort("caddy")).toBe(8084);
  });

  it("exposes public edge port", () => {
    expect(EDGE_PUBLIC_PORT).toBe(80);
  });
});
