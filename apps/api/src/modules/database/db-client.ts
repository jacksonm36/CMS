import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { Client as PgClient } from "pg";
import { discoverSiteDbConnections, resolveSiteDbCredentials, isSiteConnectionId } from "./site-db-connections.js";

/** HostPanel panel DB ids: `default`, `conn_N`, or `site_<SiteDatabase.id>`. */
const PANEL_DB_CONN_ID_RE = /^(?:default|conn_[1-9][0-9]*|site_[a-z0-9]+)$/i;

/** Postgres identifier for CREATE / unqualified table browse (no quoting tricks). */
export const PANEL_PG_IDENTIFIER_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

/** MySQL/MariaDB identifier (unquoted). */
export const PANEL_MYSQL_IDENTIFIER_RE = /^[a-zA-Z0-9_]{1,64}$/;

function assertConnectionId(connectionId: string | undefined): void {
  if (connectionId == null || connectionId === "") return;
  if (!PANEL_DB_CONN_ID_RE.test(connectionId)) {
    throw new Error("Invalid connection id");
  }
}

function assertMysqlIdentifier(label: string, name: string): void {
  if (!PANEL_MYSQL_IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertPgIdentifier(label: string, name: string): void {
  if (!PANEL_PG_IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid ${label}`);
  }
}

export interface DbConnection {
  id: string;
  name: string;
  engine: "postgresql" | "mysql" | "mariadb";
  host: string;
  port: number;
  database: string;
  username: string;
  isDefault: boolean;
  /** Present for per-site Docker sidecar databases. */
  siteId?: string;
  siteDomain?: string;
  managed?: boolean;
}

export type ResolvedDbEngine = "postgresql" | "mysql";

export async function getConnectionById(connectionId: string): Promise<DbConnection | null> {
  const connections = await getDbConnections();
  return connections.find((c) => c.id === connectionId) ?? null;
}

export async function connectionEngine(connectionId?: string): Promise<ResolvedDbEngine> {
  const id = connectionId ?? "default";
  const conn = await getConnectionById(id);
  if (!conn) throw new Error("Unknown connection id");
  return conn.engine === "postgresql" ? "postgresql" : "mysql";
}

export function isManagedSiteConnection(connectionId?: string): boolean {
  return connectionId != null && isSiteConnectionId(connectionId);
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID?: number }[];
  rowCount: number;
}

export interface TableInfo {
  name: string;
  schema: string;
  rowEstimate: number;
  sizePretty: string;
  sizeBytes: number;
}

// ─── Connection registry ──────────────────────────────────────────────────────

export async function getDbConnections(): Promise<DbConnection[]> {
  const connStr = process.env.DATABASE_URL ?? "";
  const parsed = parsePgConnectionString(connStr);

  const connections: DbConnection[] = [
    {
      id: "default",
      name: "HostPanel (default)",
      engine: "postgresql",
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      username: parsed.user,
      isDefault: true,
    },
  ];

  // Add any additional connections from env
  let i = 1;
  while (process.env[`DB_CONNECTION_${i}_URL`]) {
    const extra = parsePgConnectionString(process.env[`DB_CONNECTION_${i}_URL`]!);
    connections.push({
      id: `conn_${i}`,
      name: process.env[`DB_CONNECTION_${i}_NAME`] ?? `Connection ${i}`,
      engine: "postgresql",
      host: extra.host,
      port: extra.port,
      database: extra.database,
      username: extra.user,
      isDefault: false,
    });
    i++;
  }

  const siteConns = await discoverSiteDbConnections();
  return [...connections, ...siteConns];
}

function parsePgConnectionString(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "localhost",
      port: Number(u.port) || 5432,
      database: u.pathname.replace("/", "") || "postgres",
      user: u.username || "postgres",
      password: u.password || "",
    };
  } catch {
    return { host: "localhost", port: 5432, database: "postgres", user: "postgres", password: "" };
  }
}

function getConnectionUrl(connectionId?: string): string {
  assertConnectionId(connectionId);
  if (!connectionId || connectionId === "default") {
    return process.env.DATABASE_URL ?? "postgresql://localhost:5432/postgres";
  }
  if (isSiteConnectionId(connectionId)) {
    throw new Error("Site connections use dedicated credentials, not DATABASE_URL");
  }
  const idx = connectionId.replace("conn_", "");
  return process.env[`DB_CONNECTION_${idx}_URL`] ?? process.env.DATABASE_URL ?? "postgresql://localhost:5432/postgres";
}

const mysqlPoolCache = new Map<string, Pool>();

async function getMysqlPool(connectionId?: string): Promise<Pool> {
  assertConnectionId(connectionId);
  const id = connectionId ?? "default";
  const cached = mysqlPoolCache.get(id);
  if (cached) return cached;

  let config: {
    host: string;
    port: number;
    user: string;
    password: string;
    database?: string;
  };

  if (isSiteConnectionId(id)) {
    const creds = await resolveSiteDbCredentials(id);
    if (!creds || creds.engine === "postgresql") {
      throw new Error("Site connection credentials unavailable");
    }
    config = {
      host: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password,
      database: creds.database,
    };
  } else {
    throw new Error("MySQL is only configured for site sidecar connections");
  }

  const pool = createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 4,
    connectTimeout: 10_000,
    multipleStatements: false,
  });
  mysqlPoolCache.set(id, pool);
  return pool;
}

// ─── PostgreSQL client ────────────────────────────────────────────────────────

async function withPgClient<T>(connectionId: string | undefined, fn: (client: PgClient) => Promise<T>): Promise<T> {
  if (connectionId && isSiteConnectionId(connectionId)) {
    const creds = await resolveSiteDbCredentials(connectionId);
    if (!creds || creds.engine !== "postgresql") {
      throw new Error("Site PostgreSQL credentials unavailable");
    }
    const client = new PgClient({
      host: creds.host,
      port: creds.port,
      database: creds.database,
      user: creds.username,
      password: creds.password,
      connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }
  const url = getConnectionUrl(connectionId);
  const client = new PgClient({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function queryPostgres(sql: string, connectionId?: string): Promise<QueryResult> {
  return withPgClient(connectionId, async (client) => {
    const result = await client.query(sql);
    return {
      rows: result.rows,
      fields: result.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) ?? [],
      rowCount: result.rowCount ?? result.rows.length,
    };
  });
}

export async function listDatabasesPostgres(connectionId?: string): Promise<{ name: string; owner: string; size: string; encoding: string }[]> {
  return withPgClient(connectionId, async (client) => {
    const result = await client.query(`
      SELECT d.datname AS name,
             pg_catalog.pg_get_userbyid(d.datdba) AS owner,
             pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
             pg_catalog.pg_size_pretty(pg_catalog.pg_database_size(d.datname)) AS size
      FROM pg_catalog.pg_database d
      WHERE d.datname NOT IN ('template0','template1','postgres')
      ORDER BY d.datname
    `);
    return result.rows;
  });
}

export async function listTablesPg(dbName: string, connectionId?: string): Promise<TableInfo[]> {
  assertPgIdentifier("database name", dbName);
  return withPgClient(connectionId, async (client) => {
    const result = await client.query(
      `
      SELECT
        t.table_name AS name,
        t.table_schema AS schema,
        COALESCE(s.n_live_tup, 0) AS row_estimate,
        pg_size_pretty(pg_total_relation_size('"' || t.table_schema || '"."' || t.table_name || '"')) AS size_pretty,
        pg_total_relation_size('"' || t.table_schema || '"."' || t.table_name || '"') AS size_bytes
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema
      WHERE lower(t.table_catalog) = lower($1)
        AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name
    `,
      [dbName],
    );
    return result.rows.map((r) => ({
      name: r.name,
      schema: r.schema,
      rowEstimate: Number(r.row_estimate),
      sizePretty: r.size_pretty,
      sizeBytes: Number(r.size_bytes),
    }));
  });
}

export async function getTableRowsPg(
  _dbName: string,
  tableName: string,
  limit: number,
  offset: number,
  connectionId?: string
): Promise<{ rows: Record<string, unknown>[]; columns: string[]; total: number }> {
  assertPgIdentifier("table name", tableName);
  const safeLimit = Math.min(500, Math.max(0, Math.floor(Number(limit)) || 0));
  const safeOffset = Math.max(0, Math.floor(Number(offset)) || 0);
  const quotedTable = `"${tableName}"`;
  return withPgClient(connectionId, async (client) => {
    const [dataResult, countResult] = await Promise.all([
      client.query(`SELECT * FROM ${quotedTable} LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]),
      client.query(`SELECT COUNT(*) AS total FROM ${quotedTable}`),
    ]);
    return {
      rows: dataResult.rows,
      columns: dataResult.fields.map((f) => f.name),
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  });
}

export async function getDbStatsPg(connectionId?: string): Promise<{
  version: string;
  totalDatabases: number;
  totalConnections: number;
  maxConnections: number;
  cacheHitRatio: number;
  transactionsPerSec: number;
  uptime: string;
  databases: { name: string; size: string; connections: number; cacheHit: number }[];
}> {
  return withPgClient(connectionId, async (client) => {
    const [verRes, connRes, maxConnRes, dbStatsRes, cacheRes] = await Promise.all([
      client.query("SELECT version()"),
      client.query("SELECT count(*) AS total FROM pg_stat_activity WHERE state = 'active'"),
      client.query("SHOW max_connections"),
      client.query(`
        SELECT d.datname AS name,
               pg_size_pretty(pg_database_size(d.datname)) AS size,
               COALESCE(a.count, 0) AS connections,
               ROUND(
                 100.0 * s.blks_hit / NULLIF(s.blks_hit + s.blks_read, 0), 2
               ) AS cache_hit
        FROM pg_database d
        LEFT JOIN (SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname) a ON a.datname = d.datname
        LEFT JOIN pg_stat_database s ON s.datname = d.datname
        WHERE d.datname NOT IN ('template0','template1')
        ORDER BY d.datname
      `),
      client.query(`
        SELECT ROUND(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit) + sum(blks_read), 0), 2) AS ratio
        FROM pg_stat_database
      `),
    ]);

    return {
      version: (verRes.rows[0]?.version as string ?? "").split(" ").slice(0, 2).join(" "),
      totalDatabases: dbStatsRes.rows.length,
      totalConnections: Number(connRes.rows[0]?.total ?? 0),
      maxConnections: Number(maxConnRes.rows[0]?.max_connections ?? 100),
      cacheHitRatio: Number(cacheRes.rows[0]?.ratio ?? 0),
      transactionsPerSec: 0,
      uptime: "unknown",
      databases: dbStatsRes.rows.map((r) => ({
        name: r.name,
        size: r.size,
        connections: Number(r.connections),
        cacheHit: Number(r.cache_hit ?? 0),
      })),
    };
  });
}

export async function createDatabase(name: string, engine: string, connectionId?: string): Promise<void> {
  if (engine === "postgresql") {
    assertPgIdentifier("database name", name);
    await withPgClient(connectionId, async (client) => {
      await client.query(`CREATE DATABASE "${name}"`);
    });
  }
}

export async function dropDatabase(name: string, engine: string, connectionId?: string): Promise<void> {
  if (engine === "postgresql") {
    assertPgIdentifier("database name", name);
    await withPgClient(connectionId, async (client) => {
      // Terminate active connections first
      await client.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [name]);
      await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    });
  }
}

// ─── MySQL / MariaDB (site sidecars) ─────────────────────────────────────────

export async function queryMysql(sql: string, connectionId?: string): Promise<QueryResult> {
  if (!connectionId || !isSiteConnectionId(connectionId)) {
    throw new Error("MySQL queries require a site sidecar connection");
  }
  const pool = await getMysqlPool(connectionId);
  const [rows, fields] = await pool.query(sql);
  const rowArr = Array.isArray(rows) ? (rows as RowDataPacket[]) : [];
  return {
    rows: rowArr as Record<string, unknown>[],
    fields: (fields ?? []).map((f) => ({
      name: f.name,
      dataTypeID: f.columnType,
    })),
    rowCount: rowArr.length,
  };
}

export async function listDatabasesMysql(connectionId?: string): Promise<
  { name: string; owner: string; size: string; encoding: string }[]
> {
  const pool = await getMysqlPool(connectionId);
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      s.SCHEMA_NAME AS name,
      COALESCE(s.DEFAULT_CHARACTER_SET_NAME, 'utf8mb4') AS encoding,
      COALESCE(t.size_pretty, '0 B') AS size,
      '—' AS owner
    FROM information_schema.SCHEMATA s
    LEFT JOIN (
      SELECT
        table_schema,
        CONCAT(ROUND(SUM(data_length + index_length) / 1024 / 1024, 2), ' MB') AS size_pretty
      FROM information_schema.tables
      GROUP BY table_schema
    ) t ON t.table_schema = s.SCHEMA_NAME
    WHERE s.SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
    ORDER BY s.SCHEMA_NAME
  `);
  return rows.map((r) => ({
    name: String(r.name),
    owner: String(r.owner),
    encoding: String(r.encoding),
    size: String(r.size),
  }));
}

export async function listTablesMysql(dbName: string, connectionId?: string): Promise<TableInfo[]> {
  assertMysqlIdentifier("database name", dbName);
  const pool = await getMysqlPool(connectionId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      TABLE_NAME AS name,
      TABLE_SCHEMA AS schema,
      COALESCE(TABLE_ROWS, 0) AS row_estimate,
      CONCAT(ROUND((data_length + index_length) / 1024 / 1024, 2), ' MB') AS size_pretty,
      COALESCE(data_length + index_length, 0) AS size_bytes
    FROM information_schema.tables
    WHERE TABLE_SCHEMA = ?
      AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `,
    [dbName],
  );
  return rows.map((r) => ({
    name: String(r.name),
    schema: String(r.schema),
    rowEstimate: Number(r.row_estimate),
    sizePretty: String(r.size_pretty),
    sizeBytes: Number(r.size_bytes),
  }));
}

export async function getTableRowsMysql(
  dbName: string,
  tableName: string,
  limit: number,
  offset: number,
  connectionId?: string,
): Promise<{ rows: Record<string, unknown>[]; columns: string[]; total: number }> {
  assertMysqlIdentifier("database name", dbName);
  assertMysqlIdentifier("table name", tableName);
  const safeLimit = Math.min(500, Math.max(0, Math.floor(Number(limit)) || 0));
  const safeOffset = Math.max(0, Math.floor(Number(offset)) || 0);
  const pool = await getMysqlPool(connectionId);
  const quotedDb = `\`${dbName.replace(/`/g, "")}\``;
  const quotedTable = `\`${tableName.replace(/`/g, "")}\``;
  const [dataRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${quotedDb}.${quotedTable} LIMIT ? OFFSET ?`,
    [safeLimit, safeOffset],
  );
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ${quotedDb}.${quotedTable}`,
  );
  const columns = dataRows.length > 0 ? Object.keys(dataRows[0] as object) : [];
  return {
    rows: dataRows as Record<string, unknown>[],
    columns,
    total: Number((countRows[0] as RowDataPacket)?.total ?? 0),
  };
}

export async function getDbStatsMysql(connectionId?: string): Promise<{
  version: string;
  totalDatabases: number;
  totalConnections: number;
  maxConnections: number;
  cacheHitRatio: number;
  transactionsPerSec: number;
  uptime: string;
  databases: { name: string; size: string; connections: number; cacheHit: number }[];
}> {
  const pool = await getMysqlPool(connectionId);
  const [verRows] = await pool.query<RowDataPacket[]>("SELECT VERSION() AS version");
  const [statusRows] = await pool.query<RowDataPacket[]>(`
    SHOW GLOBAL STATUS
    WHERE Variable_name IN (
      'Threads_connected', 'Max_used_connections', 'Uptime',
      'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads'
    )
  `);
  const status = Object.fromEntries(
    statusRows.map((r) => [String(r.Variable_name), String(r.Value)]),
  );
  const readReq = Number(status.Innodb_buffer_pool_read_requests ?? 0);
  const reads = Number(status.Innodb_buffer_pool_reads ?? 0);
  const cacheHitRatio =
    readReq > 0 ? Math.round(1000 * (1 - reads / readReq)) / 10 : 0;

  const dbs = await listDatabasesMysql(connectionId);
  const [maxConnRows] = await pool.query<RowDataPacket[]>("SHOW VARIABLES LIKE 'max_connections'");
  const maxConnections = Number(maxConnRows[0]?.Value ?? 100);

  return {
    version: `MySQL/MariaDB ${String(verRows[0]?.version ?? "").split("-")[0]}`,
    totalDatabases: dbs.length,
    totalConnections: Number(status.Threads_connected ?? 0),
    maxConnections,
    cacheHitRatio,
    transactionsPerSec: 0,
    uptime: status.Uptime ? `${status.Uptime}s` : "unknown",
    databases: dbs.map((d) => ({
      name: d.name,
      size: d.size,
      connections: 0,
      cacheHit: cacheHitRatio,
    })),
  };
}
