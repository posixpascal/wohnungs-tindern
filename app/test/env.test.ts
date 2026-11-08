import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { dbBaseDir, loadEnv } from "../src/env";

const VALID_TOKEN = "x".repeat(32);

describe("loadEnv", () => {
  test("throws when INGEST_TOKEN is missing", () => {
    expect(() => loadEnv({})).toThrow(/INGEST_TOKEN/);
  });

  test("throws when INGEST_TOKEN is too short", () => {
    expect(() => loadEnv({ INGEST_TOKEN: "short" })).toThrow(/INGEST_TOKEN/);
  });

  test("throws on an invalid PORT", () => {
    expect(() => loadEnv({ INGEST_TOKEN: VALID_TOKEN, PORT: "not-a-number" })).toThrow(/PORT/);
  });

  test("applies sane defaults", () => {
    const env = loadEnv({ INGEST_TOKEN: VALID_TOKEN });
    expect(env.port).toBe(3000);
    expect(env.host).toBe("127.0.0.1");
    expect(env.cookieSecure).toBe(true);
    expect(env.trustProxy).toBe(false);
  });

  test("COOKIE_SECURE=false disables the secure flag", () => {
    const env = loadEnv({ INGEST_TOKEN: VALID_TOKEN, COOKIE_SECURE: "false" });
    expect(env.cookieSecure).toBe(false);
  });

  test("TRUST_PROXY=true enables trusting X-Forwarded-For", () => {
    const env = loadEnv({ INGEST_TOKEN: VALID_TOKEN, TRUST_PROXY: "true" });
    expect(env.trustProxy).toBe(true);
  });

  test("relative DB_PATH resolves against the repo root, absolute and :memory: stay as-is", () => {
    const repoRoot = resolve(import.meta.dir, "..", "..");
    expect(loadEnv({ INGEST_TOKEN: VALID_TOKEN }).dbPath).toBe(resolve(repoRoot, "data/wohnung.sqlite"));
    expect(loadEnv({ INGEST_TOKEN: VALID_TOKEN, DB_PATH: "/var/lib/w.sqlite" }).dbPath).toBe("/var/lib/w.sqlite");
    expect(loadEnv({ INGEST_TOKEN: VALID_TOKEN, DB_PATH: ":memory:" }).dbPath).toBe(":memory:");
  });
});

describe("dbBaseDir", () => {
  test("from source: two levels above app/src", () => {
    expect(dbBaseDir("/repo/app/src", "/elsewhere")).toBe("/repo");
  });

  test("compiled binary: falls back to the cwd instead of the virtual bunfs root", () => {
    expect(dbBaseDir("/$bunfs/root", "/opt/wohnung")).toBe("/opt/wohnung");
    expect(dbBaseDir("B:\\~BUN\\root", "C:\\wohnung")).toBe("C:\\wohnung");
  });
});
