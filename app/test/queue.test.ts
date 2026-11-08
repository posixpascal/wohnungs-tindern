import { describe, expect, test } from "bun:test";
import { getQueue } from "../src/listings/queue";
import { createUser, insertListing, testDb } from "./helpers";

describe("queue ordering", () => {
  test("excludes listings the user already swiped and inactive listings", async () => {
    const db = testDb();
    const userId = await createUser(db, "alex", "pw");
    insertListing(db, { id: "a:1" });
    insertListing(db, { id: "a:2", status: "gone" });
    insertListing(db, { id: "a:3" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'nope')").run(userId, "a:3");

    const queue = getQueue(db, userId, 20);
    expect(queue.map((l) => l.id)).toEqual(["a:1"]);
  });

  test("orders listings the other user already liked first", async () => {
    const db = testDb();
    const me = await createUser(db, "alex", "pw");
    const partner = await createUser(db, "partner", "pw");
    insertListing(db, { id: "a:1", score: 90 });
    insertListing(db, { id: "a:2", score: 10 });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(partner, "a:2");

    const queue = getQueue(db, me, 20);
    expect(queue[0]?.id).toBe("a:2");
    expect(queue[1]?.id).toBe("a:1");
  });

  test("names the other users who already liked a listing", async () => {
    const db = testDb();
    const me = await createUser(db, "alex", "pw");
    const paula = await createUser(db, "paula", "pw");
    insertListing(db, { id: "a:1" });
    insertListing(db, { id: "a:2" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(paula, "a:1");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'nope')").run(paula, "a:2");

    const byId = Object.fromEntries(getQueue(db, me, 20).map((l) => [l.id, l.liked_by]));
    expect(byId).toEqual({ "a:1": ["paula"], "a:2": [] });
  });

  test("falls back to score descending, then newest first", async () => {
    const db = testDb();
    const userId = await createUser(db, "alex", "pw");
    insertListing(db, { id: "a:1", score: 10, firstSeenAt: "2026-01-01T00:00:00.000Z" });
    insertListing(db, { id: "a:2", score: 50, firstSeenAt: "2026-01-02T00:00:00.000Z" });
    insertListing(db, { id: "a:3", score: 50, firstSeenAt: "2026-01-03T00:00:00.000Z" });

    const queue = getQueue(db, userId, 20);
    expect(queue.map((l) => l.id)).toEqual(["a:3", "a:2", "a:1"]);
  });

  test("respects the limit", async () => {
    const db = testDb();
    const userId = await createUser(db, "alex", "pw");
    for (let i = 0; i < 5; i++) insertListing(db, { id: `a:${i}` });

    const queue = getQueue(db, userId, 2);
    expect(queue).toHaveLength(2);
  });

  test("parses images as an array", async () => {
    const db = testDb();
    const userId = await createUser(db, "alex", "pw");
    insertListing(db, { id: "a:1" });
    const queue = getQueue(db, userId, 20);
    expect(queue[0]?.images).toEqual([]);
  });
});
