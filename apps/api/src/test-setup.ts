/** Vitest runs before each test file — avoid blocking on Redis/DB for pure unit tests */
process.env.HOSTPANEL_SKIP_REDIS_PING ??= "true";
