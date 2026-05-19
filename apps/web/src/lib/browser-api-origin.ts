/**
 * Browser-visible origin for WebSocket URLs that hit `/api/...` on the same host as the UI.
 *
 * Uses the **loaded page** host (including port), not `NEXT_PUBLIC_API_PORT`. Reverse proxies
 * (nginx, Pangolin, etc.) terminate TLS on :443 and forward `/api` to Fastify on loopback; port
 * 4000 is often not reachable from the browser, so `wss://panel.example.com:4000` would hang or
 * fail while `wss://panel.example.com` works.
 */
export function getBrowserApiOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return `${window.location.protocol}//${window.location.host}`;
}

export function getBrowserApiWebSocketBase(): string {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:4000";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}
