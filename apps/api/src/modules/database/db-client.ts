import { Client as PgClient } from "pg";

/** Matches HostPanel `getDbConnections()` ids: `default` or `conn_N` (N ≥ 1). */
const PANEL_DB_CONN_ID_RE = /^(?:default|conn_[1-9][0-9]*)$/;

/** Postgres identifier for CREATE / unqualified table browse (no quoting tricks). */
export const PANEL_PG_IDENTIFIER_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

function assertPanelConnectionId(connectionId: string | undefined): void {
  if (connectionId == null || connectionId === "") return;
  if (!PANEL_DB_CONN_ID_RE.test(connectionId)) {
    throw new Error("Invalid connection id");
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
  engine: "postgresql" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  isDefault: boolean;
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

  return connections;
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
  assertPanelConnectionId(connectionId);
  if (!connectionId || connectionId === "default") {
    return process.env.DATABASE_URL ?? "postgresql://localhost:5432/postgres";
  }
  const idx = connectionId.replace("conn_", "");
  return process.env[`DB_CONNECTION_${idx}_URL`] ?? process.env.DATABASE_URL ?? "postgresql://localhost:5432/postgres";
}

// ─── PostgreSQL client ────────────────────────────────────────────────────────

async function withPgClient<T>(connectionId: string | undefined, fn: (client: PgClient) => Promise<T>): Promise<T> {
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

// ─── MySQL stub ───────────────────────────────────────────────────────────────

/**
 * Placeholder until MySQL is wired — **must** use parameterized execution only, e.g.
 * `pool.execute("SELECT * FROM t WHERE id = ?", [id])` — never concatenate user input into SQL text.
 */
export async function queryMysql(_sql: string, _connectionId?: string): Promise<QueryResult> {
  throw new Error(
    "MySQL support is not enabled. When implemented, use mysql2 (or equivalent) with bound parameters only — never string-concatenate untrusted input into SQL.",
  );
}

export async function listTablesMysql(_dbName: string, _connectionId?: string): Promise<TableInfo[]> {
  return [];
}

export async function getTableRowsMysql(
  _dbName: string, _tableName: string, _limit: number, _offset: number, _connectionId?: string
): Promise<{ rows: Record<string, unknown>[]; columns: string[]; total: number }> {
  return { rows: [], columns: [], total: 0 };
}
