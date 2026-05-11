import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { getRedis } from "../../lib/redis.js";

const setKeySchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  type: z.enum(["string", "json"]).default("string"),
  ttl: z.number().int().min(-1).optional(),
});

export async function redisRoutes(app: FastifyInstance) {
  // ─── Server info ──────────────────────────────────────────────────────────

  app.get("/info", { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const redis = getRedis();
      const raw = await redis.info();
      const info = parseRedisInfo(raw);
      return reply.send({ success: true, data: info });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Memory stats ─────────────────────────────────────────────────────────

  app.get("/memory", { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const redis = getRedis();
      const raw = await redis.info("memory");
      const mem = parseRedisInfo(raw).memory;
      return reply.send({ success: true, data: mem });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Keyspace stats ───────────────────────────────────────────────────────

  app.get("/keyspace", { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const redis = getRedis();
      const raw = await redis.info("keyspace");
      const lines = raw.split("\r\n").filter((l) => l.startsWith("db"));
      const keyspace = lines.map((line) => {
        const [db, stats] = line.split(":");
        const match = stats?.match(/keys=(\d+),expires=(\d+),avg_ttl=(\d+)/);
        return {
          db,
          keys: Number(match?.[1] ?? 0),
          expires: Number(match?.[2] ?? 0),
          avgTtl: Number(match?.[3] ?? 0),
        };
      });
      return reply.send({ success: true, data: keyspace });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Key browser (SCAN-based, cursor paginated) ────────────────────────────

  app.get("/keys", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { pattern?: string; cursor?: string; count?: string; db?: string };
    const pattern = query.pattern || "*";
    const cursor = query.cursor ?? "0";
    const count = Math.min(200, Number(query.count ?? 100));

    try {
      const redis = getRedis();
      if (query.db && query.db !== "0") await redis.select(Number(query.db));

      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", count);

      // Get type + TTL for each key in parallel (capped at 100 for performance)
      const details = await Promise.all(
        keys.slice(0, 100).map(async (key) => {
          const [type, ttl] = await Promise.all([redis.type(key), redis.ttl(key)]);
          return { key, type, ttl };
        })
      );

      return reply.send({ success: true, data: { keys: details, nextCursor, pattern, db: query.db ?? "0" } });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Get key value ────────────────────────────────────────────────────────

  app.get("/keys/:key", { preHandler: requireAuth }, async (request, reply) => {
    const { key } = request.params as { key: string };

    try {
      const redis = getRedis();
      const [type, ttl] = await Promise.all([redis.type(key), redis.ttl(key)]);

      let value: unknown = null;
      let size = 0;

      switch (type) {
        case "string": {
          const v = await redis.get(key);
          value = v;
          size = v?.length ?? 0;
          break;
        }
        case "hash": {
          value = await redis.hgetall(key);
          size = Object.keys(value as object).length;
          break;
        }
        case "list": {
          const len = await redis.llen(key);
          value = await redis.lrange(key, 0, Math.min(len - 1, 199));
          size = len;
          break;
        }
        case "set": {
          const members = await redis.smembers(key);
          value = members;
          size = members.length;
          break;
        }
        case "zset": {
          const members = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES", "LIMIT", "0", "200");
          const pairs: { member: string; score: number }[] = [];
          for (let i = 0; i < members.length; i += 2) {
            pairs.push({ member: members[i]!, score: Number(members[i + 1]) });
          }
          value = pairs;
          size = await redis.zcard(key);
          break;
        }
        default:
          value = null;
      }

      return reply.send({ success: true, data: { key, type, ttl, value, size } });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Set / upsert key ─────────────────────────────────────────────────────

  app.post("/keys", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = setKeySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: body.error.message });

    const { key, value, ttl } = body.data;

    try {
      const redis = getRedis();
      if (ttl && ttl > 0) {
        await redis.set(key, value, "EX", ttl);
      } else {
        await redis.set(key, value);
      }
      return reply.status(201).send({ success: true, message: `Key '${key}' set` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Update TTL ───────────────────────────────────────────────────────────

  app.patch("/keys/:key/ttl", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = z.object({ ttl: z.number().int().min(-1) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Invalid TTL" });

    try {
      const redis = getRedis();
      if (body.data.ttl === -1) {
        await redis.persist(key);
      } else {
        await redis.expire(key, body.data.ttl);
      }
      return reply.send({ success: true, message: "TTL updated" });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Delete key ───────────────────────────────────────────────────────────

  app.delete("/keys/:key", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const { key } = request.params as { key: string };
    try {
      const redis = getRedis();
      await redis.del(key);
      return reply.send({ success: true, message: `Key '${key}' deleted` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Delete keys by pattern ───────────────────────────────────────────────

  app.delete("/keys", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const query = request.query as { pattern?: string };
    if (!query.pattern) return reply.status(400).send({ success: false, error: "Pattern required" });

    try {
      const redis = getRedis();
      let cursor = "0";
      let deleted = 0;
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", query.pattern, "COUNT", 100);
        if (keys.length) {
          await redis.del(...keys);
          deleted += keys.length;
        }
        cursor = next;
      } while (cursor !== "0");

      return reply.send({ success: true, data: { deleted }, message: `Deleted ${deleted} keys matching '${query.pattern}'` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Flush DB ─────────────────────────────────────────────────────────────

  app.post("/flush", { preHandler: requireRole("superadmin") }, async (request, reply) => {
    const body = z.object({ db: z.number().int().min(0).default(0), confirm: z.literal(true) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Must confirm flush with { confirm: true }" });

    try {
      const redis = getRedis();
      await redis.select(body.data.db);
      await redis.flushdb();
      await redis.select(0); // back to default db
      return reply.send({ success: true, message: `DB ${body.data.db} flushed` });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ─── Run raw command ──────────────────────────────────────────────────────

  app.post("/command", { preHandler: requireRole("superadmin", "admin") }, async (request, reply) => {
    const body = z.object({ command: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: "Command required" });

    const BLOCKED = ["config set", "config rewrite", "debug", "shutdown", "slaveof", "replicaof", "cluster"];
    const lower = body.data.command.toLowerCase().trim();
    if (BLOCKED.some((b) => lower.startsWith(b))) {
      return reply.status(403).send({ success: false, error: "This command is blocked for safety" });
    }

    const start = Date.now();
    try {
      const redis = getRedis();
      const args = body.data.command.trim().split(/\s+/);
      const cmd = args[0]!.toLowerCase();
      const rest = args.slice(1);

      // ioredis callArgs approach
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (redis as any)[cmd](...rest);

      return reply.send({
        success: true,
        data: { result, durationMs: Date.now() - start },
      });
    } catch (err) {
      return reply.status(400).send({ success: false, error: (err as Error).message, durationMs: Date.now() - start });
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseRedisInfo(raw: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = "general";

  for (const line of raw.split("\r\n")) {
    if (line.startsWith("#")) {
      currentSection = line.replace("# ", "").toLowerCase().replace(/\s+/g, "_");
      sections[currentSection] = {};
    } else if (line.includes(":")) {
      const [key, val] = line.split(":");
      if (key && val !== undefined) {
        if (!sections[currentSection]) sections[currentSection] = {};
        sections[currentSection]![key.trim()] = val.trim();
      }
    }
  }

  return sections;
}
