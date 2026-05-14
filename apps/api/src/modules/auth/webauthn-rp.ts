/**
 * WebAuthn RP ID vs browser origin — spec requires the authenticator `origin` host to match the RP ID
 * (exact match or a subdomain suffix of rpID). Misconfigured WEBAUTHN_* / NEXTAUTH_URL breaks registration/login.
 *
 * Operational note: nip.io / sslip.io / xip.io encode an IP in DNS; clients trust the WebAuthn ceremony to the RP ID.
 * If public DNS for that hostname is spoofed or wrong, passkey behaviour is undefined — prefer a real registered
 * domain + HTTPS in production when possible.
 */

/** True if `hostname` is the RP ID or a subdomain of it (e.g. rpID=example.com, host=panel.example.com). */
export function hostnameMatchesRpId(hostname: string, rpID: string): boolean {
  const h = hostname.toLowerCase();
  const r = rpID.toLowerCase();
  if (h === r) return true;
  return h.endsWith("." + r);
}

export function checkRpIdOriginAlignment(
  rpID: string,
  origins: string[],
): { ok: true } | { ok: false; detail: string } {
  const r = rpID.trim();
  if (!r) return { ok: false, detail: "WEBAUTHN_RP_ID is empty" };

  for (const o of origins) {
    if (!o) continue;
    try {
      const { hostname } = new URL(o);
      const h = hostname.toLowerCase();
      if (h === "localhost" || h.endsWith(".localhost")) {
        if (r === "localhost") continue;
      }
      if (!hostnameMatchesRpId(h, r)) {
        return {
          ok: false,
          detail: `Origin ${o} hostname "${h}" does not match RP ID "${rpID}" (set WEBAUTHN_RP_ID to the registrable domain or full host you use in the browser).`,
        };
      }
    } catch {
      return { ok: false, detail: `Invalid origin URL: ${o}` };
    }
  }
  return { ok: true };
}

/** Origins configured without a live request (startup checks). */
export function collectStaticWebAuthnOrigins(): string[] {
  const fallback = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const wo = process.env.WEBAUTHN_ORIGIN?.trim();
  const extra = (process.env.WEBAUTHN_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = [wo, fallback, ...extra].filter((o): o is string => Boolean(o));
  return [...new Set(list)];
}

let warnedMagicDns = false;
let warnedMisaligned = false;

export function warnWebAuthnDeploymentIssues(): void {
  const rp = process.env.WEBAUTHN_RP_ID?.trim();
  if (!rp) return;

  if (!warnedMagicDns && /\.(nip\.io|sslip\.io|xip\.io)$/i.test(rp)) {
    warnedMagicDns = true;
    console.warn(
      "[HostPanel] WebAuthn RP ID uses a magic-DNS hostname (nip.io / sslip.io / xip.io). " +
        "Passkeys depend on DNS resolving that name to the correct host — prefer a dedicated FQDN and HTTPS in production when possible.",
    );
  }

  const origins = collectStaticWebAuthnOrigins();
  const align = checkRpIdOriginAlignment(rp, origins);
  if (!align.ok && !warnedMisaligned) {
    warnedMisaligned = true;
    console.warn(`[HostPanel] WebAuthn RP/origin configuration: ${align.detail}`);
  }
}
