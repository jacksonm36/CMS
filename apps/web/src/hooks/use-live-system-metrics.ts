"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SystemMetrics } from "@hostpanel/types";
import { getBrowserApiWebSocketBase } from "@/lib/browser-api-origin";
import { jwtToWebSocketProtocol } from "@/lib/ws-jwt-protocol";

const STREAM_HISTORY_CAP = 180;

function isSystemMetrics(v: unknown): v is SystemMetrics {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.cpu === "number" && o.memory !== null && typeof o.memory === "object";
}

/**
 * Live host metrics via `/api/monitoring/metrics/stream` (staff JWT in Sec-WebSocket-Protocol).
 * Merges rolling points for charts; reconnects with backoff on failure.
 */
export function useLiveSystemMetrics(enabled: boolean, token: string | null) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [streamHistory, setStreamHistory] = useState<SystemMetrics[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const visibleRef = useRef(true);

  const pushHistory = useCallback((m: SystemMetrics) => {
    setStreamHistory((prev) => {
      const next = [...prev, m];
      if (next.length > STREAM_HISTORY_CAP) next.splice(0, next.length - STREAM_HISTORY_CAP);
      return next;
    });
  }, []);

  useEffect(() => {
    const onVis = () => {
      visibleRef.current = document.visibilityState === "visible";
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!enabled || !token) {
      setConnected(false);
      return;
    }

    let cancelled = false;

    const clearReconnect = () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      clearReconnect();
      const n = Math.min(30_000, 800 * Math.pow(2, attemptRef.current));
      attemptRef.current += 1;
      reconnectTimer.current = setTimeout(connect, n);
    };

    function connect() {
      if (cancelled || !token) return;
      wsRef.current?.close();
      const base = getBrowserApiWebSocketBase();
      const path = `${base}/api/monitoring/metrics/stream`;
      const proto = jwtToWebSocketProtocol(token);
      const ws = new WebSocket(path, [proto]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        attemptRef.current = 0;
        setConnected(true);
        setLastError(null);
      };

      ws.onmessage = (ev) => {
        if (cancelled || !visibleRef.current) return;
        try {
          const data = JSON.parse(String(ev.data)) as unknown;
          if (!isSystemMetrics(data)) return;
          setMetrics(data);
          pushHistory(data);
        } catch {
          /* ignore malformed */
        }
      };

      ws.onerror = () => {
        if (!cancelled) setLastError("WebSocket error");
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
      clearReconnect();
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [enabled, token, pushHistory]);

  return { metrics, streamHistory, connected, lastError };
}
