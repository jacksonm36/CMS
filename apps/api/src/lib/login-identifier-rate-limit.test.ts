import { describe, it, expect, vi, beforeEach } from "vitest";

const incrMock = vi.fn();
const expireMock = vi.fn().mockResolvedValue(undefined);

vi.mock("./redis.js", () => ({
  getRedis: () => ({
    incr: incrMock,
    expire: expireMock,
  }),
}));

import { consumeLoginIdentifierBudget } from "./login-identifier-rate-limit.js";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  incrMock.mockReset();
  expireMock.mockClear();
});

describe("consumeLoginIdentifierBudget", () => {
  it("allows the default budget then returns ok: false", async () => {
    let n = 0;
    incrMock.mockImplementation(async () => ++n);

    for (let i = 0; i < 5; i++) {
      expect(await consumeLoginIdentifierBudget("User@Example.com")).toEqual({ ok: true });
    }
    expect(await consumeLoginIdentifierBudget("user@example.com")).toEqual({ ok: false });
    expect(incrMock).toHaveBeenCalled();
    expect(expireMock).toHaveBeenCalled();
  });

  it("fails open when Redis errors", async () => {
    incrMock.mockRejectedValue(new Error("redis down"));
    expect(await consumeLoginIdentifierBudget("a@b.c")).toEqual({ ok: true });
  });
});
