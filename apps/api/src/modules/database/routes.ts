import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, requireSuperadminSqlEditorStepUp } from "../../lib/auth.js";
import { isSqlEditorReadOnly } from "../../lib/security-env.js";
import {
  getDbConnections,
  connectionEngine,
  isManagedSiteConnection,
  queryPostgres,
  queryMysql,
  listDatabasesPostgres,
  listDatabasesMysql,
  listTablesPg,
  listTablesMysql,
  getTableRowsPg,
  getTableRowsMysql,
  createDatabase,
  dropDatabase,
  getDbStatsPg,
  getDbStatsMysql,
} from "./db-client.js";

const querySchema = z.object({
  connectionId: z.string().min(1),
  sql: z.string().min(1).max(50000),
});

const SAFE_DB_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

/** Refuse high-risk patterns in the web SQL editor (heuristic — not a full parser; use psql for complex SQL). */
function blockedSqlEditorReason(sql: string): string | null {
  const s = sql.trim();
  const noTrailingSemi = s.endsWith(";") ? s.slice(0, -1).trim() : s;
  if (noTrailingSemi.includes(";")) {
    return "Only one SQL statement per request (PL/pgSQL and multi-statement scripts must be run via psql).";
  }

  const lead = s
    .replace(/^\s*\(\s*/, "")
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/m, "")
    .trim();
  if (isSqlEditorReadOnly()) {
    if (!/^(SELECT|WITH|EXPLAIN|TABLE|VALUES|SHOW)\b/i.test(lead)) {
      return "Read-only SQL editor (HOSTPANEL_SQL_EDITOR_READ_ONLY): only SELECT, WITH, EXPLAIN, TABLE, VALUES, or SHOW are allowed.";
    }
  }

  const lower = s.toLowerCase();
  if (/^\s*(DROP\s+(DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i.test(s)) {
    return "Use the dedicated endpoints for DROP DATABASE / SCHEMA or TRUNCATE.";
  }
  if (/\bALTER\s+SYSTEM\b/i.test(s)) return "ALTER SYSTEM is blocked.";
  if (/\bCOPY\s+[^\s]+\s+FROM\s+PROGRAM\b/i.test(s)) return "COPY … PROGRAM is blocked.";
  if (/\bPG_(READ|WRITE)_FILE\b/i.test(s)) return "Server-side file read/write functions are blocked.";
  if (/\bLO_IMPORT\b/i.test(s)) return "Large-object import is blocked.";
  if (/\bEXECUTE\s+PROGRAM\b/i.test(s)) return "EXECUTE PROGRAM is blocked.";
  if (/\bDblink[_\w]*\s*\(/i.test(s)) return "dblink-style calls are blocked in the query editor.";
  if (/\bCREATE\s+EXTENSION\b/i.test(s)) return "CREATE EXTENSION is blocked — install extensions as the database superuser.";
  if (/\bDROP\s+TABLE\b/i.test(s)) return "DROP TABLE is blocked here — use a dedicated migration or psql.";
  if (/\b(GRANT|REVOKE)\b/.test(lower)) {
    return "GRANT and REVOKE are blocked here — use psql or a migration tool.";
  }

  /* Naive WHERE check: a WHERE in a subquery still satisfies this. Prefer read-only mode for strict safety. */
  if (/\bDELETE\s+FROM\b/.test(lower) && !/\bWHERE\b/.test(lower)) {
    return "DELETE must include a WHERE clause. Use psql for unscoped deletes.";
  }
  if (/\bUPDATE\b/.test(lower) && /\bSET\b/.test(lower) && !/\bWHERE\b/.test(lower)) {
    return "UPDATE must include a WHERE clause. Use psql for table-wide updates.";
  }

  return null;
}

const createDbSchema = z.object({
  name: z.string().regex(SAFE_DB_IDENTIFIER, "Invalid database name"),
  engine: z.enum(["postgresql", "mysql", "mariadb"]),
  connectionId: z.string().optional(),
});

const createUserSchema = z.object({
  connectionId: z.string().min(1),
  username: z.string().regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
  database: z.string().regex(SAFE_DB_IDENTIFIER, "Invalid database name"),
  privileges: z.enum(["ALL", "SELECT", "SELECT,INSERT,UPDATE,DELETE"]).default("ALL"),
});

export async function databaseRoutes(app: FastifyInstance) {
  // ─── Connections (registered site databases + built-in) ───────────────────

  app.get("/connections", { preHandler: requireRole("superadmin", "admin") }, async (_request, reply) => {
    const connections = await getDbConnections();
    return reply.send({ success: true, data: connections });
  });

  // ─── Databases list ───────────────────────────────────────────────────────

  app.get("/list", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { connectionId?: string; engine?: string };

    try {
      const engine = query.engine ?? (await connectionEngine(query.connectionId));
      const dbs =
        engine === "postgresql"
          ? await listDatabasesPostgres(query.connectionId)
          : await listDatabasesMysql(query.connectionId);
      return reply.send({ success: true, data: dbs });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Create database ──────────────────────────────────────────────────────

  app.post("/create", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = createDbSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    if (isManagedSiteConnection(body.data.connectionId)) {
      return reply.status(400).send({
        success: false,
        error: "Cannot create databases on a managed site sidecar connection.",
      });
    }

    try {
      await createDatabase(body.data.name, body.data.engine === "postgresql" ? "postgresql" : "mysql", body.data.connectionId);
      return reply.status(201).send({ success: true, message: `Database '${body.data.name}' created` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Drop database ────────────────────────────────────────────────────────

  app.delete("/:name", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!SAFE_DB_IDENTIFIER.test(name)) {
      return reply.status(400).send({ success: false, error: "Invalid database name" });
    }
    const query = request.query as { engine?: string; connectionId?: string };

    if (isManagedSiteConnection(query.connectionId)) {
      return reply.status(400).send({
        success: false,
        error: "Cannot drop databases on a managed site sidecar connection.",
      });
    }

    try {
      const engine = query.engine ?? (await connectionEngine(query.connectionId));
      await dropDatabase(name, engine, query.connectionId);
      return reply.send({ success: true, message: `Database '${name}' dropped` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Tables ───────────────────────────────────────────────────────────────

  app.get("/:dbName/tables", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { dbName } = request.params as { dbName: string };
    if (!SAFE_DB_IDENTIFIER.test(dbName)) {
      return reply.status(400).send({ success: false, error: "Invalid database name" });
    }
    const query = request.query as { engine?: string; connectionId?: string };

    try {
      const engine = query.engine ?? (await connectionEngine(query.connectionId));
      const tables =
        engine === "mysql"
          ? await listTablesMysql(dbName, query.connectionId)
          : await listTablesPg(dbName, query.connectionId);
      return reply.send({ success: true, data: tables });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Table rows (first 200) ────────────────────────────────────────────────

  app.get("/:dbName/tables/:tableName/rows", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { dbName, tableName } = request.params as { dbName: string; tableName: string };
    if (!SAFE_DB_IDENTIFIER.test(dbName) || !SAFE_DB_IDENTIFIER.test(tableName)) {
      return reply.status(400).send({ success: false, error: "Invalid database or table name" });
    }
    const query = request.query as { engine?: string; connectionId?: string; limit?: string; offset?: string };
    const limit = Math.min(500, Math.max(0, Math.floor(Number(query.limit ?? 50)) || 50));
    const offset = Math.max(0, Math.floor(Number(query.offset ?? 0)) || 0);

    try {
      const engine = query.engine ?? (await connectionEngine(query.connectionId));
      const result =
        engine === "mysql"
          ? await getTableRowsMysql(dbName, tableName, limit, offset, query.connectionId)
          : await getTableRowsPg(dbName, tableName, limit, offset, query.connectionId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── SQL Query editor ─────────────────────────────────────────────────────

  app.post(
    "/query",
    {
      preHandler: requireSuperadminSqlEditorStepUp(),
      config: { rateLimit: { max: 45, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
    const body = querySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { connectionId, sql } = body.data;

    const blocked = blockedSqlEditorReason(sql);
    if (blocked) {
      return reply.status(400).send({ success: false, error: blocked });
    }

    const start = Date.now();
    try {
      const conn = await getDbConnections();
      const target = conn.find((c) => c.id === connectionId);
      if (!target) {
        return reply.status(404).send({ success: false, error: "Unknown connection id" });
      }

      const result =
        target.engine === "mysql" || target.engine === "mariadb"
          ? await queryMysql(sql, connectionId)
          : await queryPostgres(sql, connectionId);

      return reply.send({
        success: true,
        data: {
          rows: result.rows,
          fields: result.fields,
          rowCount: result.rowCount,
          durationMs: Date.now() - start,
        },
      });
    } catch (err) {
      return reply.status(400).send({ success: false, error: (err as Error).message, durationMs: Date.now() - start });
    }
  },
);

  // ─── Database stats ───────────────────────────────────────────────────────

  app.get("/stats", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { connectionId?: string };
    try {
      const engine = await connectionEngine(query.connectionId);
      const stats =
        engine === "mysql" ? await getDbStatsMysql(query.connectionId) : await getDbStatsPg(query.connectionId);
      return reply.send({ success: true, data: stats });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Create DB user ───────────────────────────────────────────────────────

  app.post("/users", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = createUserSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { connectionId, username, password, database, privileges } = body.data;

    if (isManagedSiteConnection(connectionId) || (await connectionEngine(connectionId)) !== "postgresql") {
      return reply.status(400).send({
        success: false,
        error: "User management is only supported on the HostPanel PostgreSQL connection.",
      });
    }

    try {
      const escapedPw = password.replace(/'/g, "''");
      await queryPostgres(`CREATE USER "${username}" WITH PASSWORD '${escapedPw}';`, connectionId);
      await queryPostgres(`GRANT CONNECT ON DATABASE "${database}" TO "${username}";`, connectionId);
      await queryPostgres(`GRANT ${privileges} ON ALL TABLES IN SCHEMA public TO "${username}";`, connectionId);
      await queryPostgres(`GRANT ${privileges} ON ALL SEQUENCES IN SCHEMA public TO "${username}";`, connectionId);
      return reply.status(201).send({
        success: true,
        message: `User '${username}' created with ${privileges} (CONNECT on '${database}', tables/sequences in public)`,
      });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── List DB users ────────────────────────────────────────────────────────

  app.get("/users", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { connectionId?: string };
    try {
      if (isManagedSiteConnection(query.connectionId) || (await connectionEngine(query.connectionId)) !== "postgresql") {
        return reply.send({ success: true, data: [] });
      }
      const result = await queryPostgres(
        `SELECT usename as username, usecreatedb as can_create_db, usesuper as is_superuser,
                valuntil as expires_at
         FROM pg_user ORDER BY usename`,
        query.connectionId
      );
      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Drop user ────────────────────────────────────────────────────────────

  app.delete("/users/:username", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    if (!SAFE_DB_IDENTIFIER.test(username)) {
      return reply.status(400).send({ success: false, error: "Invalid username" });
    }
    const query = request.query as { connectionId?: string };
    try {
      await queryPostgres(`DROP USER IF EXISTS "${username}";`, query.connectionId);
      return reply.send({ success: true, message: `User '${username}' dropped` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });
}
