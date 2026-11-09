import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { buildApp } from "../src/app";
import { getProfile } from "../src/inquiry/profile";
import { createUser, insertListing, jsonRequest, testDb, testEnv } from "./helpers";

const INGEST_TOKEN = "test-ingest-token-32-characters!!";

type MatchesBody = {
  data: { profile: { about: string; signature: string }; matches: { id: string; matched_at: string; description: string | null }[] };
};

function post(path: string, body: unknown = {}, token = INGEST_TOKEN): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function like(db: Database, userId: number, listingId: string, at: string): void {
  db.query("INSERT INTO swipes (user_id, listing_id, decision, created_at) VALUES (?, ?, 'like', ?)").run(userId, listingId, at);
}

describe("POST /api/ingest/matches", () => {
  test("requires the ingest token", async () => {
    const app = buildApp(testDb(), testEnv());
    const res = await app.handle(post("/api/ingest/matches", {}, "wrong-token-but-32-characters!!!"));
    expect(res.status).toBe(401);
  });

  test("a trailing slash does not skip the token check", async () => {
    const app = buildApp(testDb(), testEnv());
    const res = await app.handle(post("/api/ingest/matches/", {}, "wrong-token-but-32-characters!!!"));
    expect(res.status).toBe(401);
  });

  test("returns matches with matched_at (the last like) and the profile", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    const b = await createUser(db, "sam", "pw");
    insertListing(db, { id: "immoscout24:1" });
    insertListing(db, { id: "immoscout24:2" });
    like(db, a, "immoscout24:1", "2026-11-01T10:00:00.000Z");
    like(db, b, "immoscout24:1", "2026-11-02T09:00:00.000Z");
    like(db, a, "immoscout24:2", "2026-11-03T09:00:00.000Z");
    db.query("INSERT INTO inquiry_profile (id, about, signature, updated_at) VALUES (1, 'Wir', 'Alex', 'now')").run();

    const res = await buildApp(db, testEnv()).handle(post("/api/ingest/matches"));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as MatchesBody;
    expect(data.profile).toEqual({ about: "Wir", signature: "Alex" });
    expect(data.matches.map((m) => [m.id, m.matched_at])).toEqual([["immoscout24:1", "2026-11-02T09:00:00.000Z"]]);
    expect("description" in data.matches[0]!).toBe(true);
  });

  test("GET /api/matches carries matched_at too", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "s3cret-password!");
    insertListing(db, { id: "immoscout24:1" });
    like(db, a, "immoscout24:1", "2026-11-01T10:00:00.000Z");
    const app = buildApp(db, testEnv());
    const login = await app.handle(
      jsonRequest("/api/login", { method: "POST", body: JSON.stringify({ username: "alex", password: "s3cret-password!" }) }),
    );
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const res = await app.handle(jsonRequest("/api/matches", { cookie }));
    const { data } = (await res.json()) as { data: { matched_at: string }[] };
    expect(data.map((m) => m.matched_at)).toEqual(["2026-11-01T10:00:00.000Z"]);
  });
});

describe("POST /api/ingest/inquiry-profile", () => {
  test("requires the ingest token", async () => {
    const db = testDb();
    const res = await buildApp(db, testEnv()).handle(
      post("/api/ingest/inquiry-profile", { about: "x", signature: "y" }, "wrong-token-but-32-characters!!!"),
    );
    expect(res.status).toBe(401);
    expect(getProfile(db)).toEqual({ about: "", signature: "" });
  });

  test("stores the trimmed profile", async () => {
    const db = testDb();
    const res = await buildApp(db, testEnv()).handle(
      post("/api/ingest/inquiry-profile", { about: "  Wir sind zwei.  ", signature: "Alex Muster\n0151 1" }),
    );
    expect(res.status).toBe(200);
    expect(getProfile(db)).toEqual({ about: "Wir sind zwei.", signature: "Alex Muster\n0151 1" });
  });

  test("rejects an oversized profile", async () => {
    const res = await buildApp(testDb(), testEnv()).handle(
      post("/api/ingest/inquiry-profile", { about: "x".repeat(2001), signature: "" }),
    );
    expect(res.status).toBe(400);
  });
});
