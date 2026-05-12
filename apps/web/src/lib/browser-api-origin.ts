/**
 * Browser-visible API origin (hostname + API port) for WebSocket and direct fetches
 * that cannot use same-origin /api rewrites. Uses the current page hostname so LAN access works.
 */
export function getBrowserApiOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const port = process.env.NEXT_PUBLIC_API_PORT ?? "4000";
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export function getBrowserApiWebSocketBase(): string {
  const o = getBrowserApiOrigin();
  if (!o) return "ws://127.0.0.1:4000";
  return o.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}
