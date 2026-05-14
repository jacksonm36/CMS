import acme from "acme-client";
import { writeFile, readFile, mkdir, access } from "fs/promises";
import { join } from "path";
import { prisma } from "@hostpanel/db";
import { execFile } from "child_process";
import type { ExecFileOptions } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** `execFile` supports stdin `input` at runtime; typings omit it on some overloads (Node 22+ @types/node). */
function execOpenssl(args: readonly string[], stdinPem: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("openssl", args, {
    input: stdinPem,
    encoding: "utf8",
  } as ExecFileOptions & { input: string }) as Promise<{ stdout: string; stderr: string }>;
}
const CERTS_DIR = process.env.CERTS_DIR ?? "./certs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function parseCertExpiry(certPem: string): Promise<Date | null> {
  try {
    const { stdout } = await execOpenssl(["x509", "-noout", "-enddate"], certPem);
    const match = stdout.match(/notAfter=(.*)/);
    if (match?.[1]) return new Date(match[1]);
  } catch {}
  // Fallback: assume 90 days
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
}

async function parseCertSANs(certPem: string): Promise<string[]> {
  try {
    const { stdout } = await execOpenssl(["x509", "-noout", "-ext", "subjectAltName"], certPem);
    return (stdout.match(/DNS:([^,\s]+)/g) ?? []).map((s) => s.replace("DNS:", ""));
  } catch {}
  return [];
}

// ─── Auto (Let's Encrypt / ACME) ─────────────────────────────────────────────

export async function issueCertificate(domain: string, certId: string): Promise<void> {
  try {
    await prisma.sslCert.update({ where: { id: certId }, data: { status: "pending" } });

    const isStaging = process.env.ACME_STAGING !== "false";
    const email = process.env.ACME_EMAIL ?? "admin@localhost";

    const client = new acme.Client({
      directoryUrl: isStaging
        ? acme.directory.letsencrypt.staging
        : acme.directory.letsencrypt.production,
      accountKey: await acme.crypto.createPrivateKey(),
    });

    const [privateKey, csr] = await acme.crypto.createCsr({
      commonName: domain,
      altNames: [`www.${domain}`],
    });

    const webroot = process.env.ACME_WEBROOT ?? `/var/www/${domain}/.well-known/acme-challenge`;
    await mkdir(webroot, { recursive: true });

    const cert = await client.auto({
      csr,
      email,
      termsOfServiceAgreed: true,
      challengeCreateFn: async (_authz, _challenge, keyAuthorization) => {
        const token = (_challenge as unknown as { token: string }).token;
        await writeFile(join(webroot, token), keyAuthorization, "utf-8");
      },
      challengeRemoveFn: async (_authz, _challenge) => {
        try {
          const token = (_challenge as unknown as { token: string }).token;
          const { unlink } = await import("fs/promises");
          await unlink(join(webroot, token));
        } catch {}
      },
    });

    const certDir = join(CERTS_DIR, domain);
    await mkdir(certDir, { recursive: true });
    const certPath = join(certDir, "cert.pem");
    const keyPath = join(certDir, "key.pem");
    await writeFile(certPath, cert, "utf-8");
    await writeFile(keyPath, privateKey.toString(), "utf-8");

    const expiresAt = await parseCertExpiry(cert);

    await prisma.sslCert.update({
      where: { id: certId },
      data: {
        status: "valid",
        provider: "letsencrypt",
        issuedAt: new Date(),
        expiresAt: expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        certPath,
        keyPath,
      },
    });

    console.log(`[SSL] Certificate issued for ${domain}`);
  } catch (err) {
    console.error(`[SSL] Failed to issue certificate for ${domain}:`, err);
    await prisma.sslCert.update({ where: { id: certId }, data: { status: "error" } }).catch(() => {});
    throw err;
  }
}

export async function renewCertificate(domain: string, certId: string): Promise<void> {
  return issueCertificate(domain, certId);
}

export async function autoRenewExpiring(): Promise<void> {
  const expiringSoon = await prisma.sslCert.findMany({
    where: {
      autoRenew: true,
      provider: "letsencrypt",
      status: { in: ["valid", "expiring"] },
      expiresAt: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    },
  });

  for (const cert of expiringSoon) {
    console.log(`[SSL] Auto-renewing certificate for ${cert.domain}`);
    await renewCertificate(cert.domain, cert.id).catch(console.error);
  }
}

// ─── Manual import ────────────────────────────────────────────────────────────

export interface ManualCertImport {
  certPem: string;
  keyPem: string;
  chainPem?: string;
  siteId?: string;
  domain: string;
}

export async function importCertificate(params: ManualCertImport): Promise<string> {
  const { certPem, keyPem, chainPem, siteId, domain } = params;

  // Validate cert/key pair match via openssl
  try {
    const certModulus = await execOpenssl(["x509", "-noout", "-modulus"], certPem);
    const keyModulus = await execOpenssl(["rsa", "-noout", "-modulus"], keyPem);

    if (certModulus.stdout.trim() !== keyModulus.stdout.trim()) {
      throw new Error("Certificate and private key do not match");
    }
  } catch (err) {
    if ((err as Error).message.includes("do not match")) throw err;
    // openssl not available — skip validation, proceed with import
    console.warn("[SSL] openssl not available, skipping key/cert match validation");
  }

  const certDir = join(CERTS_DIR, domain);
  await mkdir(certDir, { recursive: true });

  const fullChain = chainPem ? `${certPem}\n${chainPem}` : certPem;
  const certPath = join(certDir, "cert.pem");
  const keyPath = join(certDir, "key.pem");

  await writeFile(certPath, fullChain, "utf-8");
  await writeFile(keyPath, keyPem, "utf-8");

  const expiresAt = await parseCertExpiry(certPem);

  // Upsert the SSL record
  const existing = siteId
    ? await prisma.sslCert.findUnique({ where: { siteId } })
    : await prisma.sslCert.findFirst({ where: { domain } });

  if (existing) {
    await prisma.sslCert.update({
      where: { id: existing.id },
      data: {
        status: "valid",
        provider: "manual",
        issuedAt: new Date(),
        expiresAt: expiresAt ?? undefined,
        certPath,
        keyPath,
      },
    });
    return existing.id;
  } else {
    const cert = await prisma.sslCert.create({
      data: {
        domain,
        siteId: siteId ?? "",
        status: "valid",
        provider: "manual",
        issuedAt: new Date(),
        expiresAt: expiresAt ?? undefined,
        certPath,
        keyPath,
        autoRenew: false,
      },
    });
    return cert.id;
  }
}

// ─── Read cert details ────────────────────────────────────────────────────────

export async function readCertDetails(certPath: string): Promise<{
  subject: string;
  issuer: string;
  sans: string[];
  notBefore: Date | null;
  notAfter: Date | null;
  serial: string;
}> {
  try {
    const pem = await readFile(certPath, "utf-8");
    const { stdout } = await execOpenssl(
      ["x509", "-noout", "-subject", "-issuer", "-dates", "-serial"],
      pem,
    );

    const get = (key: string) => stdout.match(new RegExp(`${key}=([^\n]+)`))?.[1]?.trim() ?? "";

    return {
      subject: get("subject"),
      issuer: get("issuer"),
      serial: get("serial"),
      notBefore: stdout.match(/notBefore=(.+)/)?.[1] ? new Date(stdout.match(/notBefore=(.+)/)![1]!) : null,
      notAfter: stdout.match(/notAfter=(.+)/)?.[1] ? new Date(stdout.match(/notAfter=(.+)/)![1]!) : null,
      sans: await parseCertSANs(pem),
    };
  } catch {
    return { subject: "", issuer: "", sans: [], notBefore: null, notAfter: null, serial: "" };
  }
}

// ─── Revoke / delete ─────────────────────────────────────────────────────────

export async function revokeCertificate(certId: string): Promise<void> {
  const cert = await prisma.sslCert.findUnique({ where: { id: certId } });
  if (!cert) throw new Error("Certificate not found");

  await prisma.sslCert.update({ where: { id: certId }, data: { status: "expired" } });
  // Optionally remove cert files
  try {
    const { unlink } = await import("fs/promises");
    if (cert.certPath) await unlink(cert.certPath).catch(() => {});
    if (cert.keyPath) await unlink(cert.keyPath).catch(() => {});
  } catch {}
}
