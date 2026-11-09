import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { buildApp } from "../src/app";
import { createUser, insertListing, testDb, testEnv } from "./helpers";

const INGEST_TOKEN = "test-ingest-token-32-characters!!";

type WatchlistBody = { data: { listings: { id: string; likes: number; matched: boolean }[] } };

function post(path: string, token = INGEST_TOKEN): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: "{}",
  });
}

function swipe(db: Database, userId: number, listingId: string, decision: "like" | "nope"): void {
  db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, ?)").run(userId, listingId, decision);
}

async function watchlist(db: Database): Promise<WatchlistBody["data"]["listings"]> {
  const res = await buildApp(db, testEnv()).handle(post("/api/ingest/watchlist"));
  expect(res.status).toBe(200);
  return ((await res.json()) as WatchlistBody).data.listings;
}

describe("POST /api/ingest/watchlist", () => {
  test("requires the ingest token", async () => {
    const app = buildApp(testDb(), testEnv());
    expect((await app.handle(post("/api/ingest/watchlist", "wrong-token-but-32-characters!!!"))).status).toBe(401);
    expect((await app.handle(post("/api/ingest/watchlist/", "wrong-token-but-32-characters!!!"))).status).toBe(401);
  });

  test("lists active listings nobody rejected, matches first, then by likes and score", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    const b = await createUser(db, "sam", "pw");
    insertListing(db, { id: "immoscout24:open", score: 90 });
    insertListing(db, { id: "immoscout24:liked", score: 10 });
    insertListing(db, { id: "immoscout24:match", score: 5 });
    insertListing(db, { id: "immoscout24:noped", score: 99 });
    insertListing(db, { id: "immoscout24:gone", status: "gone" });
    swipe(db, a, "immoscout24:liked", "like");
    swipe(db, a, "immoscout24:match", "like");
    swipe(db, b, "immoscout24:match", "like");
    swipe(db, a, "immoscout24:noped", "like");
    swipe(db, b, "immoscout24:noped", "nope");

    expect(await watchlist(db)).toEqual([
      { id: "immoscout24:match", likes: 2, matched: true },
      { id: "immoscout24:liked", likes: 1, matched: false },
      { id: "immoscout24:open", likes: 0, matched: false },
    ]);
  });

  test("skips listings the district settings hide, but keeps matches there", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    const b = await createUser(db, "sam", "pw");
    insertListing(db, { id: "immoscout24:hidden" });
    insertListing(db, { id: "immoscout24:hidden-liked" });
    insertListing(db, { id: "immoscout24:hidden-match" });
    db.query("UPDATE listings SET district = 'Höchst'").run();
    db.query(
      `INSERT INTO district_settings (city, position, excluded_districts, updated_at)
       VALUES ('Frankfurt am Main', 0, '["Höchst"]', 'now')`,
    ).run();
    swipe(db, a, "immoscout24:hidden-liked", "like");
    swipe(db, a, "immoscout24:hidden-match", "like");
    swipe(db, b, "immoscout24:hidden-match", "like");

    expect((await watchlist(db)).map((l) => l.id)).toEqual(["immoscout24:hidden-match"]);
  });

  test("is empty without users", async () => {
    const db = testDb();
    insertListing(db, { id: "immoscout24:1" });
    expect(await watchlist(db)).toEqual([]);
  });
});
