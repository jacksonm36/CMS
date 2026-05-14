# HostPanel security

## Reporting

Report sensitive issues privately to the repository maintainer (do not open a public issue for undisclosed vulnerabilities).

## Secrets and configuration

- **Never commit** `.env` or production credentials. The installer writes `/opt/hostpanel/.env` as root-only (`chmod 600`) and injects strong random values for JWT, session, NextAuth-style, and refresh-related secrets.
- **Production** requires `NODE_ENV=production` on the API (systemd sets this) with a `JWT_SECRET` of at least 32 characters. The installer satisfies this automatically.
- **CORS**: `CORS_ORIGIN` should list every browser origin that calls the API with credentials (the installer sets this to match the panel URL).
- **Let's Encrypt**: Default installer setting uses **production** ACME (`HP_STAGING_ACME=false`). Use `HP_STAGING_ACME=true` only when testing certificate issuance.
- **CrowdSec**: When enabled, a dedicated bouncer key is created and stored in `.env` as `CROWDSEC_API_KEY`.

## Webhooks

- **GitHub** `POST /api/integrations/github/deploy` verifies `X-Hub-Signature-256` with HMAC-SHA256 over the **raw JSON body** when `webhookSecret` is configured on the GitHub integration. Missing or invalid signatures are rejected with `401`.

## Dependency hygiene

- CI and the installer CI and the installer run **`npm audit --audit-level=critical`** (blocking). A follow-up step prints **high**-severity findings (often transitive from Next.js / GrapesJS) for awareness — track upstream updates and `npm audit fix` when safe.
- Prefer **`npm ci`** on locked installs for reproducible builds.

## Host hardening (installer)

- **ufw** — SSH, HTTP, HTTPS, and panel ports; default deny inbound.
- **fail2ban** — optional SSH jail (enabled by default; `HP_FAIL2BAN=false` to skip).
- **CrowdSec** — optional collaborative IDS when `HP_CROWDSEC=true` (default).

## Updates

After `git pull`, re-run `npm ci` and `npm run build` as appropriate, restart `hostpanel-api` and `hostpanel-web`, and review `npm audit` output.
