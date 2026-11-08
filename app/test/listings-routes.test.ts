import { describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { createUser, insertListing, jsonRequest, testDb, testEnv } from "./helpers";

async function login(app: ReturnType<typeof buildApp>, username: string, password: string): Promise<string> {
  const res = await app.handle(
    jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  );
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`login failed for ${username}: ${res.status}`);
  return cookie;
}

describe("listings HTTP routes", () => {
  test("GET /api/queue requires authentication", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(jsonRequest("/api/queue"));
    expect(res.status).toBe(401);
  });

  test("GET /api/queue respects a custom limit", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    for (let i = 0; i < 5; i++) insertListing(db, { id: `a:${i}` });
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    const res = await app.handle(jsonRequest("/api/queue?limit=2", { cookie }));
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  test("GET /api/matches requires authentication", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(jsonRequest("/api/matches"));
    expect(res.status).toBe(401);
  });

  test("GET /api/likes requires authentication", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(jsonRequest("/api/likes"));
    expect(res.status).toBe(401);
  });

  test("GET /api/matches returns matches for the logged-in user", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    insertListing(db, { id: "a:1" });
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (1, 'a:1', 'like')").run();

    const res = await app.handle(jsonRequest("/api/matches", { cookie }));
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((l) => l.id)).toEqual(["a:1"]);
  });

  test("GET /healthz is public", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(jsonRequest("/healthz"));
    expect(res.status).toBe(200);
  });

  test("unknown route returns a 404 envelope", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(jsonRequest("/api/does-not-exist"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });
});
