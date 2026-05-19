"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserApiWebSocketBase } from "@/lib/browser-api-origin";
import { jwtToWebSocketProtocol } from "@/lib/ws-jwt-protocol";
import type { WebServerType } from "@hostpanel/types";
import type { WebserverAnalyticsPayload } from "@/types/webserver-analytics";

export type WebserverLiveMessage = {
  type: "webserver-live";
  server: WebServerType;
  scope: string;
  at: string;
  analytics: WebserverAnalyticsPayload;
  accessTail: string[];
  errorTail: string[];
};

const LIVE_SERVER_IDS = new Set<WebServerType>(["nginx", "openresty", "apache2", "lighttpd", "litespeed", "caddy", "traefik"]);

function isWebserverLiveMessage(x: unknown): x is WebserverLiveMessage {
  if (!x || typeof x !== "object") return false;
  const o = x as { type?: string; analytics?: unknown };
  return o.type === "webserver-live" && o.analytics !== null && typeof o.analytics === "object";
}

export function useWebserverLiveStream(opts: {
  enabled: boolean;
  token: string | null;
  serverId: WebServerType;
  /** Web server log scope (nginx: panel vs daemon) */
  scope: "daemon" | "panel";
}) {
  const { enabled, token, serverId, scope } = opts;
  const [payload, setPayload] = useState<WebserverLiveMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled || !token || !LIVE_SERVER_IDS.has(serverId)) {
      setConnected(false);
      setPayload(null);
      return;
    }

    let cancelled = false;

    const clearRt = () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      clearRt();
      const n = Math.min(25_000, 700 * Math.pow(2, attemptRef.current));
      attemptRef.current += 1;
      reconnectRef.current = setTimeout(connect, n);
    };

    function connect() {
      if (cancelled || !token) return;
      wsRef.current?.close();
      const base = getBrowserApiWebSocketBase();
      const qs = new URLSearchParams({ server: serverId, scope });
      const path = `${base}/api/webservers/live-stream?${qs.toString()}`;
      const ws = new WebSocket(path, [jwtToWebSocketProtocol(token)]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        attemptRef.current = 0;
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(String(ev.data)) as WebserverLiveMessage | { type: string; message?: string };
          if (msg.type === "error") {
            setError((msg as { message?: string }).message ?? "Stream error");
            return;
          }
          if (isWebserverLiveMessage(msg)) {
            setPayload(msg);
            setError(null);
          }
        } catch {
          setError("Invalid stream payload");
        }
      };

      ws.onerror = () => {
        if (!cancelled) setError("WebSocket error");
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearRt();
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [enabled, token, serverId, scope]);

  return { payload, connected, error };
}
