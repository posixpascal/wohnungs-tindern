import { describe, expect, test } from "bun:test";
import { buildServedApp } from "../src/server";
import { jsonRequest, testDb, testEnv } from "./helpers";

describe("SPA fallback vs. API 404", () => {
  test("an unknown /api/* path returns a JSON 404, not the SPA index.html", async () => {
    const db = testDb();
    const app = buildServedApp(db, testEnv());
    const res = await app.handle(jsonRequest("/api/does-not-exist"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  test("an unknown non-api path falls back to the SPA index.html", async () => {
    const db = testDb();
    const app = buildServedApp(db, testEnv());
    const res = await app.handle(jsonRequest("/some/client/route"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
