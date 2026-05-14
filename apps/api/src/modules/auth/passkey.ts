import type { FastifyInstance } from "fastify";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifyRegistrationResponseOpts,
  type VerifyAuthenticationResponseOpts,
} from "@simplewebauthn/server";
import { z } from "zod";
import { prisma } from "@hostpanel/db";
import { requireAuth } from "../../lib/auth.js";
import { getRedis } from "../../lib/redis.js";
import { recordFailedLogin } from "../../middleware/ipBlock.js";
import { HP_TOKEN_COOKIE } from "../../lib/ws-auth.js";
import { checkRpIdOriginAlignment } from "./webauthn-rp.js";

const CHALLENGE_TTL = 300; // 5 minutes

let warnedRpOriginMisaligned = false;

/**
 * Derive rpID and allowed origins for a given request.
 *
 * Priority:
 *  1. Explicit WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN env vars (production with a known domain)
 *  2. Auto-detected from the request's Origin header (dev / LAN / any URL the user is actually on)
 *  3. Fall back to NEXTAUTH_URL hostname
 *
 * RP ID must be a **domain** (not a bare IP). LAN installs often use **nip.io**-style hostnames; those depend on
 * DNS resolving correctly — set explicit WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN to match the URL users type. For
 * production, prefer a real FQDN and HTTPS. See also HOSTPANEL_WEBAUTHN_REQUIRE_EXPLICIT in .env.example.
 */
export function getRpConfig(requestOrigin?: string) {
  const fallbackOrigin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  // Use the actual request origin when no explicit env override is set
  const effectiveOrigin = process.env.WEBAUTHN_ORIGIN ?? requestOrigin ?? fallbackOrigin;

  let rpID: string;
  if (process.env.WEBAUTHN_RP_ID) {
    rpID = process.env.WEBAUTHN_RP_ID;
  } else {
    try {
      rpID = new URL(effectiveOrigin).hostname;
    } catch {
      rpID = new URL(fallbackOrigin).hostname;
    }
  }

  // Build the full list of allowed origins so verification accepts whichever
  // URL the user registers from.
  const extraOrigins = (process.env.WEBAUTHN_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const allowedOrigins = [effectiveOrigin, fallbackOrigin, ...extraOrigins].filter(
    (o, i, a) => o && a.indexOf(o) === i, // deduplicate + remove empty
  );

  const align = checkRpIdOriginAlignment(rpID, allowedOrigins);
  if (!align.ok && !warnedRpOriginMisaligned) {
    warnedRpOriginMisaligned = true;
    console.warn(`[HostPanel] WebAuthn RP/origin: ${align.detail}`);
  }

  return { rpName: process.env.WEBAUTHN_RP_NAME ?? "HostPanel", rpID, allowedOrigins };
}

const renameSchema = z.object({ name: z.string().min(1).max(80).trim() });

export async function passkeyRoutes(app: FastifyInstance) {
  const redis = getRedis();

  // ── Registration ─────────────────────────────────────────────────────────

  // GET /api/auth/passkey/register/options
  app.get("/register/options", { preHandler: requireAuth }, async (request, reply) => {
    const { sub, email } = request.user;
    const { rpName, rpID } = getRpConfig(request.headers.origin);

    const existing = await prisma.webAuthnCredential.findMany({
      where: { userId: sub },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(sub),
      userName: email,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as any,
      })),
      authenticatorSelection: {
        // No authenticatorAttachment restriction — allows platform (Touch ID, Windows Hello)
        // AND roaming authenticators (Bitwarden, 1Password, hardware keys, etc.)
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    // Store both challenge and the rpID used so verify uses the exact same one
    await redis.set(`webauthn:reg:${sub}`, JSON.stringify({ challenge: options.challenge, rpID }), "EX", CHALLENGE_TTL);

    return reply.send({ success: true, data: options });
  });

  // POST /api/auth/passkey/register/verify
  app.post("/register/verify", { preHandler: requireAuth }, async (request, reply) => {
    const { sub } = request.user;
    const { rpID, allowedOrigins } = getRpConfig(request.headers.origin);

    const stored = await redis.get(`webauthn:reg:${sub}`);
    if (!stored) {
      return reply.status(400).send({ success: false, error: "Challenge expired or not found. Start registration again." });
    }
    const { challenge, rpID: storedRpID } = JSON.parse(stored) as { challenge: string; rpID: string };

    const body = request.body as any;
    const nameRaw = (body as { passkeyName?: string }).passkeyName;
    const passkeyName = nameRaw && typeof nameRaw === "string" ? nameRaw.trim().slice(0, 80) || "Passkey" : "Passkey";

    let verification;
    try {
      const opts: VerifyRegistrationResponseOpts = {
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: allowedOrigins,
        expectedRPID: storedRpID,
        requireUserVerification: false,
      };
      verification = await verifyRegistrationResponse(opts);
    } catch {
      return reply.status(400).send({ success: false, error: "Passkey registration could not be verified" });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return reply.status(400).send({ success: false, error: "Passkey registration could not be verified" });
    }

    await redis.del(`webauthn:reg:${sub}`);

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await prisma.webAuthnCredential.create({
      data: {
        userId: sub,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.transports ?? [],
        name: passkeyName,
      },
    });

    return reply.send({ success: true, message: "Passkey registered successfully" });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  // GET /api/auth/passkey/login/options  (no auth required)
  app.get(
    "/login/options",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const { rpID } = getRpConfig(request.headers.origin);
    const challengeId = crypto.randomUUID();

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials: [],
    });

    await redis.set(`webauthn:auth:${challengeId}`, JSON.stringify({ challenge: options.challenge, rpID }), "EX", CHALLENGE_TTL);

    return reply.send({ success: true, data: { ...options, challengeId } });
  });

  // POST /api/auth/passkey/login/verify  (no auth required)
  app.post(
    "/login/verify",
    { config: { rateLimit: { max: 25, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const { rpID, allowedOrigins } = getRpConfig(request.headers.origin);
    const body = request.body as any;
    const { challengeId, ...authResponse } = body as { challengeId: string; [k: string]: unknown };

    if (!challengeId) {
      return reply.status(400).send({ success: false, error: "Missing challengeId" });
    }

    const storedAuth = await redis.get(`webauthn:auth:${challengeId}`);
    if (!storedAuth) {
      return reply.status(400).send({ success: false, error: "Challenge expired. Please try again." });
    }
    const { challenge, rpID: storedRpID } = JSON.parse(storedAuth) as { challenge: string; rpID: string };

    const credentialId = authResponse.id as string;
    const cred = await prisma.webAuthnCredential.findUnique({
      where: { credentialId },
      include: { user: true },
    });

    if (!cred) {
      await recordFailedLogin(request.ip);
      return reply.status(401).send({ success: false, error: "Passkey verification failed" });
    }

    let verification;
    try {
      const opts: VerifyAuthenticationResponseOpts = {
        response: authResponse as any,
        expectedChallenge: challenge,
        expectedOrigin: allowedOrigins,
        expectedRPID: storedRpID,
        requireUserVerification: false,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(cred.publicKey),
          counter: Number(cred.counter),
          transports: cred.transports as any,
        },
      };
      verification = await verifyAuthenticationResponse(opts);
    } catch {
      return reply.status(401).send({ success: false, error: "Passkey verification failed" });
    }

    if (!verification.verified) {
      return reply.status(401).send({ success: false, error: "Passkey verification failed" });
    }

    await redis.del(`webauthn:auth:${challengeId}`);

    await prisma.webAuthnCredential.update({
      where: { credentialId },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    const { user } = cred;

    const token = app.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      twoFactorPassed: true,
    });

    reply.setCookie(HP_TOKEN_COOKIE, token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          twoFactorEnabled: user.twoFactorEnabled,
          dockerAccess: user.dockerAccess,
        },
      },
    });
  });

  // ── Credential management ─────────────────────────────────────────────────

  // GET /api/auth/passkey/credentials
  app.get("/credentials", { preHandler: requireAuth }, async (request, reply) => {
    const { sub } = request.user;
    const credentials = await prisma.webAuthnCredential.findMany({
      where: { userId: sub },
      select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ success: true, data: credentials });
  });

  // PATCH /api/auth/passkey/credentials/:id  — rename
  app.patch("/credentials/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { sub } = request.user;
    const { id } = request.params as { id: string };
    const body = renameSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid name" });

    const cred = await prisma.webAuthnCredential.findUnique({ where: { id } });
    if (!cred || cred.userId !== sub) {
      return reply.status(404).send({ success: false, error: "Credential not found" });
    }

    await prisma.webAuthnCredential.update({ where: { id }, data: { name: body.data.name } });
    return reply.send({ success: true, message: "Passkey renamed" });
  });

  // DELETE /api/auth/passkey/credentials/:id
  app.delete("/credentials/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { sub } = request.user;
    const { id } = request.params as { id: string };

    const cred = await prisma.webAuthnCredential.findUnique({ where: { id } });
    if (!cred || cred.userId !== sub) {
      return reply.status(404).send({ success: false, error: "Credential not found" });
    }

    await prisma.webAuthnCredential.delete({ where: { id } });
    return reply.send({ success: true, message: "Passkey removed" });
  });
}
