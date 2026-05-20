import { describe, expect, it } from "vitest";
import { parseHostpanelDbEnv, isSiteConnectionId } from "./site-db-connections.js";

describe("site-db-connections", () => {
  it("parses env and normalizes localhost to 127.0.0.1", () => {
    const env = parseHostpanelDbEnv(
      "HP_DB_HOST=localhost\nHP_DB_PORT=10000\nDB_USER=u\nDB_PASSWORD=p\nDB_NAME=db\n",
    );
    expect(env.HP_DB_HOST).toBe("127.0.0.1");
    expect(env.DB_NAME).toBe("db");
  });

  it("rejects invalid connection ids", () => {
    expect(isSiteConnectionId("site_cmpe3mkof00032idgaqu4xhag")).toBe(true);
    expect(isSiteConnectionId("../etc/passwd")).toBe(false);
    expect(isSiteConnectionId("default")).toBe(false);
  });
});
