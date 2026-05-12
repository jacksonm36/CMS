// ─── Roles ───────────────────────────────────────────────────────────────────
export type Role = "superadmin" | "admin" | "editor" | "viewer";

// ─── User ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  twoFactorEnabled: boolean;
  /** Non-staff: allows Docker panel when true. Admins/superadmins always have Docker UI access. */
  dockerAccess?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  user: User;
  token: string;
  expiresAt: string;
}

// ─── Sites ────────────────────────────────────────────────────────────────────
export type WebServerType =
  | "nginx"
  | "apache2"
  | "lighttpd"
  | "litespeed"
  | "caddy"
  | "openresty"
  | "traefik";

export type SiteStatus = "active" | "suspended" | "pending" | "error";
export type PhpVersion = "8.0" | "8.1" | "8.2" | "8.3" | "8.4";
export type SiteType = "php" | "static" | "nodejs" | "python";

export interface Site {
  id: string;
  name: string;
  domain: string;
  ownerId: string;
  status: SiteStatus;
  type: SiteType;
  webServer?: WebServerType;
  phpVersion: PhpVersion | null;
  nodeVersion: string | null;
  pythonVersion: string | null;
  dbStackVersion: string | null;
  appProxyPort: number | null;
  webConfigPath?: string | null;
  dockerContainerId: string | null;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteDatabase {
  id: string;
  siteId: string;
  name: string;
  engine: "postgresql" | "mysql";
  host: string;
  port: number;
  username: string;
  createdAt: string;
}

export interface CronJob {
  id: string;
  siteId: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastExitCode: number | null;
}

// ─── SSL ──────────────────────────────────────────────────────────────────────
export type CertStatus = "valid" | "expiring" | "expired" | "pending" | "error";

export interface SslCert {
  id: string;
  siteId: string;
  domain: string;
  status: CertStatus;
  issuedAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  provider: "letsencrypt" | "custom";
}

// ─── Security ─────────────────────────────────────────────────────────────────
export interface FirewallRule {
  id: string;
  direction: "inbound" | "outbound";
  protocol: "tcp" | "udp" | "icmp" | "all";
  port: string | null;
  sourceIp: string | null;
  action: "allow" | "deny";
  priority: number;
  description: string;
  enabled: boolean;
}

export interface BlockedIp {
  id: string;
  ip: string;
  reason: string;
  blockedAt: string;
  expiresAt: string | null;
  permanent: boolean;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string;
  userAgent: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

// ─── Integrations ─────────────────────────────────────────────────────────────
export type WebhookEvent =
  | "site.created"
  | "site.deleted"
  | "site.deployed"
  | "ssl.issued"
  | "ssl.renewed"
  | "ssl.expiring"
  | "alert.triggered"
  | "backup.completed";

export interface Webhook {
  id: string;
  siteId: string | null;
  name: string;
  url: string;
  events: WebhookEvent[];
  secret: string | null;
  enabled: boolean;
  lastCalledAt: string | null;
  lastStatusCode: number | null;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ─── Content ──────────────────────────────────────────────────────────────────
export interface ContentType {
  id: string;
  name: string;
  slug: string;
  schema: ContentField[];
  createdAt: string;
}

export interface ContentField {
  name: string;
  label: string;
  type: "text" | "textarea" | "richtext" | "number" | "boolean" | "date" | "image" | "relation";
  required: boolean;
  defaultValue?: unknown;
}

export interface ContentEntry {
  id: string;
  typeId: string;
  typeName: string;
  data: Record<string, unknown>;
  published: boolean;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl: string | null;
  uploadedBy: string;
  createdAt: string;
}

// ─── Monitoring ───────────────────────────────────────────────────────────────
export interface SystemMetrics {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  network: { rx: number; tx: number };
  uptime: number;
  loadAvg: [number, number, number];
  timestamp: string;
}

export interface UptimeCheck {
  id: string;
  name: string;
  url: string;
  interval: number;
  timeout: number;
  enabled: boolean;
  lastStatus: "up" | "down" | "unknown";
  lastCheckedAt: string | null;
  lastResponseMs: number | null;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: "cpu" | "memory" | "disk" | "uptime";
  threshold: number;
  operator: "gt" | "lt" | "gte" | "lte";
  windowMinutes: number;
  notifyVia: ("webhook" | "slack" | "email")[];
  enabled: boolean;
  lastTriggeredAt?: string | null;
}

// ─── Web Servers ──────────────────────────────────────────────────────────────

export type WebServerStatus = "running" | "stopped" | "not_installed";

export interface WebServerInfo {
  id: WebServerType;
  name: string;
  description: string;
  defaultPort: number;
  configDir: string;
  serviceName: string;
  supportsPhp: boolean;
  supportsProxy: boolean;
  status: WebServerStatus;
  version: string;
}

// ─── Database Management ──────────────────────────────────────────────────────

export interface DbConnection {
  id: string;
  name: string;
  engine: "postgresql" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  isDefault: boolean;
}

export interface DbDatabase {
  name: string;
  owner: string;
  size: string;
  encoding: string;
}

export interface DbTable {
  name: string;
  schema: string;
  rowEstimate: number;
  sizePretty: string;
  sizeBytes: number;
}

export interface DbTableRows {
  rows: Record<string, unknown>[];
  columns: string[];
  total: number;
}

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID?: number }[];
  rowCount: number;
  durationMs: number;
}

export interface DbStats {
  version: string;
  totalDatabases: number;
  totalConnections: number;
  maxConnections: number;
  cacheHitRatio: number;
  transactionsPerSec: number;
  uptime: string;
  databases: { name: string; size: string; connections: number; cacheHit: number }[];
}

export interface DbUser {
  username: string;
  can_create_db: boolean;
  is_superuser: boolean;
  expires_at: string | null;
}

// ─── Redis Management ─────────────────────────────────────────────────────────

export interface RedisInfo {
  server?: Record<string, string>;
  clients?: Record<string, string>;
  memory?: Record<string, string>;
  stats?: Record<string, string>;
  replication?: Record<string, string>;
  cpu?: Record<string, string>;
  keyspace?: Record<string, string>;
}

export interface RedisKeyEntry {
  key: string;
  type: "string" | "hash" | "list" | "set" | "zset" | "none";
  ttl: number;
}

export interface RedisKeyValue {
  key: string;
  type: string;
  ttl: number;
  value: unknown;
  size: number;
}

export interface RedisKeyspaceStat {
  db: string;
  keys: number;
  expires: number;
  avgTtl: number;
}

export interface RedisCommandResult {
  result: unknown;
  durationMs: number;
}

// ─── Pagination ────────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── API response wrapper ──────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/** One line from `docker ps --format '{{json .}}'` (keys depend on Docker version). */
export type DockerContainerRow = Record<string, string>;
