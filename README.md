# HostPanel

A security-first web hosting control panel inspired by aaPanel — featuring a live code/visual editor, per-site web server selection, Docker management, CrowdSec threat intelligence, SSL management, database/Redis management, site templates, and a full integrations hub.

**Bare metal only** — runs directly on your Linux server, no Docker required (Docker is optional for isolated site containers).

---

## Table of Contents

- [Quick Install](#quick-install)
- [Install Options](#install-options)
- [Supported Operating Systems](#supported-operating-systems)
- [What Gets Installed](#what-gets-installed)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Service Management](#service-management)
- [Docker Support](#docker-support)
- [Nginx Site Config](#nginx-site-config)
- [API Reference](#api-reference)
- [Security policy](SECURITY.md)
- [License](#license)

---

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/jacksonm36/CMS/main/install.sh | sudo bash
```

Or with custom options:

```bash
HP_ADMIN_EMAIL=you@example.com \
HP_DOMAIN=panel.example.com \
HP_WEBSERVER=nginx \
HP_CROWDSEC=true \
curl -fsSL https://raw.githubusercontent.com/jacksonm36/CMS/main/install.sh | sudo bash
```

The installer asks for the **panel hostname or LAN IP** when run interactively (TTY), so NextAuth, CORS, and the optional Nginx vhost match how you open the UI. When you use a **raw IPv4** without a domain, the installer uses **nip.io** (e.g. `192-168-0-1.nip.io`) for WebAuthn/passkeys — open the panel with that hostname, not the IP. Piped installs (`curl … | bash`) skip that prompt unless you set `HP_DOMAIN`. The installer prints your admin credentials and panel URL at the end. Save them — the password is auto-generated and not stored in plain text after install.

---

## Install Options


### Production installer behaviour

The bare-metal script performs a **locked install** when `package-lock.json` is present (`npm ci`), runs **`npm audit`** at **critical** severity (set `HP_NPM_AUDIT_FAIL=true` to abort the install on any critical finding), prints high-severity advisories for awareness, generates cryptographically strong secrets (JWT, session, **NEXTAUTH_SECRET**, **JWT_REFRESH_SECRET**), configures **WebAuthn** `rpID` automatically (using **nip.io** when you access the panel by IPv4), enables **ufw** and (by default) **fail2ban**, and sets **`HOSTPANEL_AUTO_MIGRATE=true`** so the API runs Prisma migrations at startup.

See [SECURITY.md](SECURITY.md) for secrets handling, webhooks, and hardening overview).

| Variable | Default | Description |
|---|---|---|
| `HP_ADMIN_EMAIL` | `admin@localhost` | Initial admin email |
| `HP_ADMIN_PASSWORD` | *(auto-generated)* | Initial admin password |
| `HP_DOMAIN` | *(auto LAN IP)* | FQDN or IP for panel URLs + optional Nginx `server_name`; empty on an interactive TTY prompts |
| `HP_SKIP_PANEL_HOST_PROMPT` | `false` | Set `true` to skip the hostname prompt (keep empty domain → LAN IP) |
| `HP_PORT` | `3000` | Web UI port |
| `HP_API_PORT` | `4000` | API port |
| `HP_WEBSERVER` | `nginx` | `nginx` \| `apache2` \| `lighttpd` \| `litespeed` \| `caddy` \| `openresty` \| `traefik` |
| `HP_CROWDSEC` | `true` | Install CrowdSec security engine |
| `HP_INSTALL_DIR` | `/opt/hostpanel` | Installation directory |
| `HP_NODE_VERSION` | `20` | Node.js major version |
| `HP_STAGING_ACME` | `false` | Let's Encrypt **production** by default; set `true` for staging only |
| `HP_FAIL2BAN` | `true` | Install **fail2ban** for SSH (set `false` to skip) |
| `HP_NPM_AUDIT_FAIL` | `false` | If `true`, abort install when `npm audit` reports **critical** issues |
| `HP_REPO_URL` / `HP_REPO_BRANCH` | GitHub defaults | Clone source for `install.sh` when not copying from a local tree |
| `HP_DOCKER_ROOTFUL_ONLY` | `false` | Skip rootless Docker attempt (useful for LXC containers) |
| `HP_DOCKER_FALLBACK_ROOTFUL` | `true` | Fall back to rootful Docker if rootless setup fails |

---

## Supported Operating Systems

| OS | Versions |
|---|---|
| Ubuntu | 22.04, 24.04 |
| Debian | 11, 12, 13 (trixie) |

---

## What Gets Installed

- **Node.js 20 LTS** — via NodeSource
- **PostgreSQL 16** — application database
- **Redis 7** — sessions and caching
- **Web server** — your choice of Nginx, Apache2, Lighttpd, LiteSpeed Community, Caddy, OpenResty, or Traefik
- **PHP 8.2 FPM** — for PHP site support (ondrej/sury PPA)
- **CrowdSec** — collaborative threat intelligence + iptables bouncer *(optional)*
- **Docker** — rootless (preferred) or rootful, for isolated site containers *(optional)*
- **fail2ban** — SSH brute-force mitigation *(optional; installer default on)*
- **HostPanel** — systemd services `hostpanel-api` + `hostpanel-web` *(reproducible `npm ci` + audit when lockfile present)*

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo |
| Frontend | Next.js 15 + TypeScript + TailwindCSS + shadcn/ui |
| Backend | Fastify (Node.js) + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Cache | Redis |
| Code Editor | Monaco Editor |
| Visual Builder | GrapesJS |
| Terminal | xterm.js |
| Charts | Recharts |
| Container Runtime | Docker (rootless or rootful) |

---

## Features

### Web Server Management
- Install, start, stop, restart, reload Nginx / Apache2 / Lighttpd / LiteSpeed Community / Caddy / OpenResty / Traefik
- Each site independently selectable — switch web server per-site at any time
- Auto-generated config files for each server type (PHP-FPM, Node.js proxy, security headers)
- Config test runner and live log viewer per server
- Streaming install progress in the UI

### SSL Management
- **Let's Encrypt** — ACME HTTP-01 auto-issue + auto-renewal (30-day pre-expiry)
- **Manual import** — paste Certificate + Private Key + CA Bundle PEM directly in the UI
- Certificate details: subject, issuer, SANs, serial, validity
- Per-cert auto-renew toggle and revoke/delete

### Security Center
- WAF middleware — SQL injection, XSS, path traversal detection
- Fail2ban-style IP auto-blocking after repeated login failures
- iptables-based firewall rule management
- Full audit log for all mutations
- TOTP 2FA with QR code setup

### CrowdSec Integration
- One-click install and start from the panel
- Live alert feed — IP, country, ASN, scenario, event count
- Active decisions table — ban/captcha with manual add/remove
- Bouncer management (API key registration)
- Hub management — collections, parsers, scenarios, postoverflows
- Live log viewer

### Site Management
- Create/suspend/delete sites (static, PHP, Node.js, Python)
- Per-site web server selection with live switching
- Database provisioning (PostgreSQL / MySQL)
- Cron job manager
- PHP version switcher (8.0 – 8.3)
- In-browser file manager + Monaco editor + GrapesJS visual builder
- WebSocket terminal per site (Docker-isolated when Docker is enabled)

### Site Templates
- Pre-defined templates for common stacks (PHP, static, Node.js, Python)
- Per-template web server, runtime version, and database stack selection
- Traefik templates restricted to Node.js / Python (reverse-proxy only)
- Admin-managed via the Templates section in the dashboard

### Docker Management
- Container list with status, image, ports, and uptime
- Start / stop / restart containers from the UI
- Rootless Docker preferred (uses `XDG_RUNTIME_DIR` socket); rootful fallback available
- Per-user `DOCKER_HOST` env var written to `.env` automatically
- Docker-isolated WebSocket terminals: each site terminal runs inside its own container

### Host Node Management
- View active Node.js and npm versions on the host
- Switch Node.js version via the UI (distro package, NodeSource 18/20/22/24)
- Streaming install progress — watch `apt` and `npm` output in real time

### Database Management
- Browse all databases, tables, and rows
- SQL query editor with Monaco (Ctrl+Enter to run)
- Create/drop databases and users
- Server stats: version, connections, cache hit ratio

### Redis Management
- Key browser with SCAN-based pagination and pattern filter
- Value inspector: string (raw + JSON), hash, list, set, sorted set
- TTL editor, key creation, bulk delete by pattern, flush
- Built-in CLI with command history (↑/↓)
- Memory stats, keyspace info, server info

### CMS Layer
- Custom content types with JSON schema fields
- Content entries with draft/publish workflow
- Media library with file upload
- Public REST API (`/api/content/public/:slug`)

### Monitoring
- Real-time system metrics (CPU, memory, disk, network)
- Historical charts with Recharts
- Uptime monitors with configurable intervals
- Alert rules with webhook/Slack notifications

### Integrations Hub
- Outgoing webhooks with HMAC signatures
- Scoped API keys
- Cloudflare, Slack, GitHub, S3 connectors

---

## Project Structure

```
/
├── apps/
│   ├── web/                  # Next.js 15 dashboard (port 3000)
│   └── api/                  # Fastify REST API (port 4000)
│       └── src/modules/
│           ├── auth/         # Login, 2FA, sessions
│           ├── content/      # CMS content types & entries
│           ├── crowdsec/     # CrowdSec integration
│           ├── database/     # PostgreSQL management
│           ├── docker/       # Docker container management
│           ├── host-node/    # Host Node.js version management
│           ├── integrations/ # Webhooks, API keys, connectors
│           ├── monitoring/   # Metrics, uptime monitors
│           ├── redis/        # Redis key browser & CLI
│           ├── security/     # SSL, WAF, firewall, audit log
│           ├── site-templates/ # Site template CRUD
│           ├── sites/        # Site CRUD, file manager, terminal
│           └── webservers/   # Web server management
├── packages/
│   ├── db/                   # Prisma schema + migrations + seed
│   ├── ui/                   # Shared shadcn/ui components
│   └── types/                # Shared TypeScript interfaces
├── deploy/                   # Helper deployment scripts
│   ├── hostpanel-docker-rootless.sh
│   ├── hostpanel-install-node.sh
│   └── hostpanel.sudoers
├── scripts/                  # Maintenance scripts
│   ├── ensure-hostpanel-nginx-writable-sites.sh
│   ├── refresh-systemd-units.sh
│   └── smoke-test.mjs
├── install.sh                # Bare metal one-line installer
└── turbo.json
```

---

## Local Development

### Prerequisites

- Node.js ≥ 20
- PostgreSQL 16 running locally
- Redis 7 running locally
- *(Optional)* Docker, if you want to test container features

### Steps

```bash
git clone https://github.com/jacksonm36/CMS.git
cd CMS

# Copy and configure environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and REDIS_URL

# Install dependencies (root workspace + all packages)
npm install

# Set up the database
npm run db:generate   # generate Prisma client
npm run db:migrate    # run all migrations
npm run db:seed       # create the default admin user

# Start in watch mode (web on :3000, API on :4000)
npm run dev
```

> **Tip:** `npm run dev` uses Turborepo to start both `apps/web` and `apps/api` concurrently in watch mode.

### Useful Scripts

```bash
npm run build          # production build for all apps
npm run db:studio      # open Prisma Studio (database GUI)
npm run db:reset       # drop + recreate schema + re-seed (dev only)
node scripts/smoke-test.mjs   # basic API health check
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values. Never commit `.env`.

On production installs (`install.sh`), `/opt/hostpanel/.env` is **root:root** mode **600**: only root can read it; **systemd** reads `EnvironmentFile=` as root and passes variables into `hostpanel-api` / `hostpanel-web`, so the `hostpanel` user does not need file access to secrets.

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `HOSTPANEL_AUTO_MIGRATE` | — | When `true`, or unset with `NODE_ENV=production`, API runs `prisma migrate deploy` at startup (uses env from systemd; process never reads `.env`). Set `false` to disable. |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_SECRET` | ✅ | At least 32 random characters |
| `JWT_REFRESH_SECRET` | ✅ | At least 32 random characters |
| `SESSION_SECRET` | ✅ | At least 32 random characters |
| `NEXTAUTH_SECRET` | ✅ | At least 32 random characters |
| `NEXTAUTH_URL` | ✅ | Full URL of the web UI (e.g. `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | ✅ | Full URL of the API (e.g. `http://localhost:4000`) |
| `ADMIN_EMAIL` | ✅ | Initial admin account email |
| `ADMIN_PASSWORD` | ✅ | Initial admin account password |
| `API_PORT` | — | API port (default `4000`) |
| `PORT` | — | Web UI port (default `3000`) |
| `CORS_ORIGIN` | — | Allowed CORS origins, comma-separated. Unset = allow all (dev only) |
| `ACME_EMAIL` | — | Email for Let's Encrypt registration |
| `ACME_STAGING` | — | `true` = Let's Encrypt staging; `false` = production |
| `CROWDSEC_API_URL` | — | CrowdSec Local API URL (default `http://127.0.0.1:8080`) |
| `CROWDSEC_API_KEY` | — | CrowdSec bouncer API key (`sudo cscli bouncers add hostpanel-api`) |
| `NGINX_SITES_DIR` | — | Writable directory for Nginx vhost files |
| `CERTS_DIR` | — | Directory for ACME certificates |
| `MEDIA_DIR` | — | Directory for uploaded media files |
| `DOCKER_HOST` | — | Docker socket path. Set automatically by `hostpanel-docker-rootless.sh` |
| `HOSTPANEL_TERMINAL_DOCKER` | — | `true` to run site terminals inside Docker containers |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth app client secret |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `CLOUDFLARE_API_TOKEN` | — | Cloudflare integration API token |
| `SLACK_WEBHOOK_URL` | — | Slack incoming webhook URL |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | — | S3-compatible storage |

> **Generate secrets quickly:**
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

---

## Service Management

```bash
# Status
systemctl status hostpanel-api hostpanel-web

# Restart
systemctl restart hostpanel-api hostpanel-web

# Logs (live)
journalctl -u hostpanel-api -f
journalctl -u hostpanel-web -f

# Edit config and apply
nano /opt/hostpanel/.env
systemctl restart hostpanel-api hostpanel-web

# Refresh systemd unit files after an update
sudo bash /opt/hostpanel/scripts/refresh-systemd-units.sh
```

---

## Docker Support

HostPanel can manage Docker containers from the UI and optionally run each site's terminal inside an isolated container.

### How it works

- **Rootless Docker** (preferred) — runs under the `hostpanel` system user. Uses the user-level socket at `XDG_RUNTIME_DIR/docker.sock`. No root access to the Docker daemon.
- **Rootful fallback** — if rootless setup fails (e.g. unprivileged LXC), `hostpanel` is added to the `docker` group and uses `/var/run/docker.sock`.

### Setup (already handled by the installer)

If you need to set up Docker manually after installation:

```bash
sudo bash /opt/hostpanel/deploy/hostpanel-docker-rootless.sh /opt/hostpanel bookworm debian
```

Replace `bookworm` and `debian` with your OS codename and ID (`lsb_release -cs` / `lsb_release -is`).

### LXC / VPS containers

Rootless Docker requires user namespace support. If you're on an unprivileged LXC container or a VPS that blocks `newuidmap`, set:

```bash
HP_DOCKER_ROOTFUL_ONLY=true
```

before running the installer, or pass it to the deploy script.

### Isolated site terminals

Set `HOSTPANEL_TERMINAL_DOCKER=true` in `.env` and restart the API. Each site's WebSocket terminal will then launch inside a fresh `alpine` container scoped to that site's working directory.

---

## Nginx Site Config

The API runs as the `hostpanel` user (non-root) and cannot write to `/etc/nginx/sites-enabled/`. Site vhosts are written to `NGINX_SITES_DIR` (default `/var/lib/hostpanel/nginx-sites`) and pulled in via:

```
/etc/nginx/conf.d/00-hostpanel-managed-sites.conf  →  include /var/lib/hostpanel/nginx-sites/*.conf;
```

### Fix missing site configs on existing installs

```bash
sudo bash /opt/hostpanel/scripts/ensure-hostpanel-nginx-writable-sites.sh
sudo systemctl restart hostpanel-api
```

Then open each site in the panel and save (or switch web server) to regenerate its `.conf`, followed by:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## API Reference

All endpoints require a `Bearer <token>` header unless noted otherwise. Obtain a token via `POST /api/auth/login`.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Email + password + optional TOTP code |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET` | `/api/auth/me` | Current user info |

### Sites
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/sites` | List all sites |
| `POST` | `/api/sites` | Create site |
| `GET` | `/api/sites/:id` | Get site details |
| `PATCH` | `/api/sites/:id` | Update site |
| `DELETE` | `/api/sites/:id` | Delete site |
| `PATCH` | `/api/sites/:id/webserver` | Switch web server |
| `GET` | `/api/sites/:id/files` | Browse file tree |
| `WS` | `/api/sites/:id/terminal` | WebSocket shell (Docker-isolated if enabled) |

### Web Servers
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/webservers` | Status of all web servers |
| `POST` | `/api/webservers/:id/install` | Install a web server (streaming) |
| `POST` | `/api/webservers/:id/action` | Start / stop / restart / reload |

### SSL
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/security/ssl` | List SSL certificates |
| `POST` | `/api/security/ssl/issue` | Auto Let's Encrypt |
| `POST` | `/api/security/ssl/import` | Manual PEM import |
| `DELETE` | `/api/security/ssl/:id` | Revoke and delete |

### Databases
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/databases/list` | List databases |
| `POST` | `/api/databases/query` | Run SQL query |
| `POST` | `/api/databases/create` | Create database + user |
| `DELETE` | `/api/databases/:name` | Drop database |

### Redis
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/redis/keys` | Browse keys (SCAN) |
| `GET` | `/api/redis/key/:key` | Get key value + TTL |
| `POST` | `/api/redis/command` | Run Redis command |
| `DELETE` | `/api/redis/key/:key` | Delete key |

### Docker
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/docker/ping` | Check Docker daemon reachability |
| `GET` | `/api/docker/containers` | List all containers |
| `POST` | `/api/docker/containers/:id/action` | Start / stop / restart container |

### Host Node
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/host-node` | Active Node.js + npm versions and paths |
| `POST` | `/api/host-node/install` | Install Node.js version (streaming SSE) |

### Site Templates
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/site-templates` | List all templates |
| `POST` | `/api/site-templates` | Create template |
| `PATCH` | `/api/site-templates/:id` | Update template |
| `DELETE` | `/api/site-templates/:id` | Delete template |

### CrowdSec
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/crowdsec/status` | CrowdSec daemon status |
| `GET` | `/api/crowdsec/alerts` | Recent alert feed |
| `GET` | `/api/crowdsec/decisions` | Active bans/captchas |
| `POST` | `/api/crowdsec/decisions` | Manually ban IP |
| `DELETE` | `/api/crowdsec/decisions/:id` | Remove ban |

### Monitoring
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/monitoring/metrics` | Current system metrics snapshot |
| `WS` | `/api/monitoring/metrics/stream` | Real-time metrics stream |
| `GET` | `/api/monitoring/uptime` | Uptime monitor list |
| `POST` | `/api/monitoring/uptime` | Create uptime monitor |

### CMS (Public)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/content/public/:slug` | Fetch published content entry (no auth) |

### Integrations
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/integrations/webhooks` | List webhooks |
| `POST` | `/api/integrations/webhooks` | Create webhook |
| `GET` | `/api/integrations/api-keys` | List scoped API keys |
| `POST` | `/api/integrations/api-keys` | Create API key |

---

## License

MIT
