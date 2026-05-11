# HostPanel

A security-first web hosting control panel inspired by aaPanel — featuring a live code/visual editor, per-site web server selection, CrowdSec threat intelligence, SSL management, database/Redis management, and a full integrations hub.

**Bare metal only** — runs directly on your Linux server, no Docker required.

---

## One-Line Install

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

### Install Options

| Variable | Default | Description |
|---|---|---|
| `HP_ADMIN_EMAIL` | `admin@localhost` | Initial admin email |
| `HP_ADMIN_PASSWORD` | *(auto-generated)* | Initial admin password |
| `HP_DOMAIN` | *(server IP)* | Domain for the panel vhost |
| `HP_PORT` | `3000` | Web UI port |
| `HP_API_PORT` | `4000` | API port |
| `HP_WEBSERVER` | `nginx` | `nginx` \| `apache2` \| `lighttpd` \| `litespeed` |
| `HP_CROWDSEC` | `true` | Install CrowdSec security engine |
| `HP_INSTALL_DIR` | `/opt/hostpanel` | Installation directory |
| `HP_NODE_VERSION` | `20` | Node.js major version |
| `HP_STAGING_ACME` | `true` | Use Let's Encrypt staging (set `false` for production) |

### Supported Operating Systems

| OS | Versions |
|---|---|
| Ubuntu | 22.04, 24.04 |
| Debian | 11, 12 |

### What Gets Installed

- **Node.js 20 LTS** — via NodeSource
- **PostgreSQL 16** — application database
- **Redis 7** — sessions and caching
- **Web server** — your choice of Nginx, Apache2, Lighttpd, or LiteSpeed Community
- **PHP 8.2 FPM** — for PHP site support (ondrej/sury PPA)
- **CrowdSec** — collaborative threat intelligence + iptables bouncer
- **HostPanel** — systemd services `hostpanel-api` + `hostpanel-web`

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

---

## Features

### Web Server Management
- Install, start, stop, restart, reload Nginx / Apache2 / Lighttpd / LiteSpeed Community
- Each site independently selectable — switch web server per-site at any time
- Auto-generated config files for each server type (PHP-FPM, Node.js proxy, security headers)
- Config test runner and live log viewer per server

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
- WebSocket terminal per site

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
│   ├── web/          # Next.js 15 dashboard (port 3000)
│   └── api/          # Fastify REST API (port 4000)
├── packages/
│   ├── db/           # Prisma schema + migrations + seed
│   ├── ui/           # Shared shadcn/ui components
│   └── types/        # Shared TypeScript interfaces
├── install.sh        # Bare metal one-line installer
└── turbo.json
```

---

## Local Development

### Prerequisites

- Node.js ≥ 20
- PostgreSQL 16 running locally
- Redis 7 running locally

```bash
git clone https://github.com/jacksonm36/CMS.git
cd CMS
cp .env.example .env
# Edit .env — set DATABASE_URL and REDIS_URL

npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Starts both `apps/web` (port 3000) and `apps/api` (port 4000) in watch mode via Turborepo.

---

## Service Management

```bash
# Status
systemctl status hostpanel-api hostpanel-web

# Restart
systemctl restart hostpanel-api hostpanel-web

# Logs
journalctl -u hostpanel-api -f
journalctl -u hostpanel-web -f

# Edit config
nano /opt/hostpanel/.env
systemctl restart hostpanel-api hostpanel-web
```

---

## API Reference

| Endpoint | Description |
|---|---|
| `POST /api/auth/login` | Email/password + optional TOTP |
| `GET /api/sites` | List all sites |
| `POST /api/sites` | Create site |
| `PATCH /api/sites/:id/webserver` | Switch web server |
| `GET /api/sites/:id/files` | Browse file tree |
| `WS /api/sites/:id/terminal` | WebSocket shell |
| `GET /api/security/ssl` | List SSL certificates |
| `POST /api/security/ssl/issue` | Auto Let's Encrypt |
| `POST /api/security/ssl/import` | Manual PEM import |
| `GET /api/webservers` | Web server status |
| `POST /api/webservers/:id/install` | Install a web server |
| `GET /api/databases/list` | List databases |
| `POST /api/databases/query` | Run SQL query |
| `GET /api/redis/keys` | Browse Redis keys |
| `POST /api/redis/command` | Run Redis command |
| `GET /api/crowdsec/status` | CrowdSec status |
| `GET /api/crowdsec/decisions` | Active bans |
| `POST /api/crowdsec/decisions` | Manually ban IP |
| `GET /api/monitoring/metrics` | System metrics |
| `WS /api/monitoring/metrics/stream` | Real-time metrics |
| `GET /api/content/public/:slug` | Public CMS endpoint |

---

## License

MIT
