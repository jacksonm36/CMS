import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import qrcode from "qrcode";
import { prisma } from "@hostpanel/db";
import { recordFailedLogin, clearFailedLogins } from "../../middleware/ipBlock.js";
import { requireAuth } from "../../lib/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

const verifyTotpSchema = z.object({ code: z.string().length(6) });

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post("/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { email, password, totpCode } = body.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      await recordFailedLogin(request.ip);
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await recordFailedLogin(request.ip);
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }

    if (user.twoFactorEnabled && user.totpSecret) {
      if (!totpCode) {
        return reply.status(200).send({ success: true, requires2FA: true });
      }
      const isValid = authenticator.verify({ token: totpCode, secret: user.totpSecret });
      if (!isValid) {
        await recordFailedLogin(request.ip);
        return reply.status(401).send({ success: false, error: "Invalid 2FA code" });
      }
    }

    await clearFailedLogins(request.ip);

    const token = app.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      twoFactorPassed: true,
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
        },
      },
    });
  });

  // POST /api/auth/register (superadmin only via invite in production)
  app.post("/register", async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { email, name, password } = body.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ success: false, error: "Email already registered" });
    }

    const count = await prisma.user.count();
    const role = count === 0 ? ("superadmin" as const) : ("viewer" as const);
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, name, passwordHash, role },
    });

    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, twoFactorPassed: true });

    return reply.status(201).send({
      success: true,
      data: { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    });
  });

  // GET /api/auth/me
  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const { sub } = request.user;
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, email: true, name: true, role: true, twoFactorEnabled: true, avatarUrl: true, createdAt: true },
    });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    return reply.send({ success: true, data: user });
  });

  // POST /api/auth/2fa/setup
  app.post("/2fa/setup", { preHandler: requireAuth }, async (request, reply) => {
    const { sub, email } = request.user;
    const secret = authenticator.generateSecret();
    const otpAuthUrl = authenticator.keyuri(email, "HostPanel", secret);
    const qrDataUrl = await qrcode.toDataURL(otpAuthUrl);

    await prisma.user.update({ where: { id: sub }, data: { totpSecret: secret } });

    return reply.send({ success: true, data: { qrDataUrl, secret } });
  });

  // POST /api/auth/2fa/verify
  app.post("/2fa/verify", { preHandler: requireAuth }, async (request, reply) => {
    const body = verifyTotpSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid code format" });

    const { sub } = request.user;
    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user?.totpSecret) return reply.status(400).send({ success: false, error: "2FA not initialized" });

    const isValid = authenticator.verify({ token: body.data.code, secret: user.totpSecret });
    if (!isValid) return reply.status(400).send({ success: false, error: "Invalid code" });

    await prisma.user.update({ where: { id: sub }, data: { twoFactorEnabled: true } });

    return reply.send({ success: true, message: "2FA enabled successfully" });
  });

  // DELETE /api/auth/2fa
  app.delete("/2fa", { preHandler: requireAuth }, async (request, reply) => {
    const { sub } = request.user;
    await prisma.user.update({ where: { id: sub }, data: { twoFactorEnabled: false, totpSecret: null } });
    return reply.send({ success: true, message: "2FA disabled" });
  });

  // POST /api/auth/change-password
  app.post("/change-password", { preHandler: requireAuth }, async (request, reply) => {
    const body = changePasswordSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { sub } = request.user;
    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user?.passwordHash) return reply.status(400).send({ success: false, error: "No password set" });

    const valid = await bcrypt.compare(body.data.currentPassword, user.passwordHash);
    if (!valid) return reply.status(401).send({ success: false, error: "Current password incorrect" });

    const newHash = await bcrypt.hash(body.data.newPassword, 12);
    await prisma.user.update({ where: { id: sub }, data: { passwordHash: newHash } });

    return reply.send({ success: true, message: "Password changed successfully" });
  });
}
