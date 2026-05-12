/** Prefix for JWT embedded in Sec-WebSocket-Protocol (base64url of UTF-8 JWT — avoids `.` in token name). */
export const HP_WS_JWT_PROTOCOL_PREFIX = "hp.jwt.";

/** Encode JWT for WebSocket subprotocol (must stay within typical header size limits). */
export function jwtToWebSocketProtocol(token: string): string {
  const bytes = new TextEncoder().encode(token);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${HP_WS_JWT_PROTOCOL_PREFIX}${b64}`;
}
