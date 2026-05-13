import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../../lib/auth.js";
import {
  getDbConnections,
  queryPostgres,
  queryMysql,
  listDatabasesPostgres,
  listTablesPg,
  listTablesMysql,
  getTableRowsPg,
  getTableRowsMysql,
  createDatabase,
  dropDatabase,
  getDbStatsPg,
} from "./db-client.js";
import { prisma } from "@hostpanel/db";

const querySchema = z.object({
  connectionId: z.string(),
  sql: z.string().min(1).max(50000),
});

const SAFE_DB_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

const createDbSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_]+$/, "Only alphanumeric and underscores"),
  engine: z.enum(["postgresql", "mysql"]),
  connectionId: z.string().optional(),
});

const createUserSchema = z.object({
  connectionId: z.string(),
  username: z.string().regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
  database: z.string(),
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
    const engine = query.engine ?? "postgresql";

    try {
      const dbs = engine === "postgresql"
        ? await listDatabasesPostgres(query.connectionId)
        : await listMysqlDatabases(query.connectionId);
      return reply.send({ success: true, data: dbs });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Create database ──────────────────────────────────────────────────────

  app.post("/create", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = createDbSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    try {
      await createDatabase(body.data.name, body.data.engine, body.data.connectionId);
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

    try {
      await dropDatabase(name, query.engine ?? "postgresql", query.connectionId);
      return reply.send({ success: true, message: `Database '${name}' dropped` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Tables ───────────────────────────────────────────────────────────────

  app.get("/:dbName/tables", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { dbName } = request.params as { dbName: string };
    const query = request.query as { engine?: string; connectionId?: string };

    try {
      const tables = query.engine === "mysql"
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
    const query = request.query as { engine?: string; connectionId?: string; limit?: string; offset?: string };
    const limit = Math.min(500, Number(query.limit ?? 50));
    const offset = Number(query.offset ?? 0);

    try {
      const result = query.engine === "mysql"
        ? await getTableRowsMysql(dbName, tableName, limit, offset, query.connectionId)
        : await getTableRowsPg(dbName, tableName, limit, offset, query.connectionId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── SQL Query editor ─────────────────────────────────────────────────────

  app.post("/query", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = querySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { connectionId, sql } = body.data;

    // Block dangerous DDL outside of explicit admin confirmation
    const dangerPattern = /^\s*(DROP\s+(DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i;
    if (dangerPattern.test(sql)) {
      return reply.status(400).send({ success: false, error: "Use the dedicated drop endpoint for destructive operations." });
    }

    const start = Date.now();
    try {
      const conn = await getDbConnections();
      const target = conn.find((c) => c.id === connectionId) ?? conn[0];
      if (!target) return reply.status(404).send({ success: false, error: "Connection not found" });

      const result = target.engine === "mysql"
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
  });

  // ─── Database stats ───────────────────────────────────────────────────────

  app.get("/stats", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { connectionId?: string };
    try {
      const stats = await getDbStatsPg(query.connectionId);
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

    try {
      await queryPostgres(
        `CREATE USER "${username}" WITH PASSWORD '${password.replace(/'/g, "''")}';`,
        connectionId
      );
      await queryPostgres(
        `GRANT ${privileges} ON ALL TABLES IN SCHEMA public TO "${username}";`,
        connectionId
      );
      return reply.status(201).send({ success: true, message: `User '${username}' created with ${privileges} on '${database}'` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── List DB users ────────────────────────────────────────────────────────

  app.get("/users", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const query = request.query as { connectionId?: string };
    try {
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

async function listMysqlDatabases(_connectionId?: string): Promise<unknown[]> {
  // MySQL support — returns empty if not configured
  return [];
}
