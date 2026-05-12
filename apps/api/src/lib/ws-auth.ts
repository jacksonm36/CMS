import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Role } from "@hostpanel/types";

/** HttpOnly auth cookie name — mirrors web localStorage key for API Bearer flows. */
export const HP_TOKEN_COOKIE = "hp_token";

const PROTO_PREFIX = "hp.jwt.";

export interface WsJwtPayload {
  sub: string;
  role: Role;
}

function decodeProtoJwt(header: string | undefined): string | null {
  if (!header) return null;
  for (const raw of header.split(",")) {
    const p = raw.trim();
    if (p.startsWith(PROTO_PREFIX)) {
      const b64url = p.slice(PROTO_PREFIX.length);
      const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
      const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
      try {
        return Buffer.from(b64, "base64").toString("utf8");
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * WebSocket upgrade auth: HttpOnly cookie (same-origin), Sec-WebSocket-Protocol (`hp.jwt.<base64url>`),
 * then deprecated `?token=` for rollout compatibility.
 */
export async function verifyWsJwt(
  app: FastifyInstance,
  request: FastifyRequest
): Promise<WsJwtPayload | null> {
  const cookieTok = request.cookies?.[HP_TOKEN_COOKIE];
  const proto = request.headers["sec-websocket-protocol"];
  const protoJoined = Array.isArray(proto) ? proto.join(",") : proto;
  const fromProto = decodeProtoJwt(protoJoined);
  const queryTok = (request.query as { token?: string }).token;

  const ordered = [cookieTok, fromProto, queryTok].filter((x): x is string => Boolean(x));

  for (const raw of ordered) {
    try {
      const payload = await app.jwt.verify<WsJwtPayload>(raw);
      if (payload?.sub && payload?.role) return payload;
    } catch {
      continue;
    }
  }
  return null;
}
