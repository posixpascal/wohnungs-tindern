import { describe, expect, test } from "bun:test";
import { getMatches } from "../src/listings/matches";
import { getMyLikes } from "../src/listings/likes";
import { createUser, insertListing, testDb } from "./helpers";

describe("matches", () => {
  test("only includes listings liked by every user", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    const b = await createUser(db, "partner", "pw");
    insertListing(db, { id: "a:1" });
    insertListing(db, { id: "a:2" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(a, "a:1");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(b, "a:1");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(a, "a:2");

    const matches = getMatches(db);
    expect(matches.map((l) => l.id)).toEqual(["a:1"]);
  });

  test("includes gone listings but keeps the status flag", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    insertListing(db, { id: "a:1", status: "gone" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(a, "a:1");

    const matches = getMatches(db);
    expect(matches[0]?.status).toBe("gone");
  });

  test("returns an empty list when there are no users", () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    expect(getMatches(db)).toEqual([]);
  });
});

describe("likes", () => {
  test("reports pending, liked and noped for the other user", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    const b = await createUser(db, "partner", "pw");
    insertListing(db, { id: "a:1" });
    insertListing(db, { id: "a:2" });
    insertListing(db, { id: "a:3" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(a, "a:1");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(a, "a:2");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(a, "a:3");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(b, "a:1");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'nope')").run(b, "a:2");
    // a:3 left untouched by partner -> pending

    const likes = getMyLikes(db, a);
    const byId = Object.fromEntries(likes.map((l) => [l.id, l.others[0]?.decision]));
    expect(byId["a:1"]).toBe("liked");
    expect(byId["a:2"]).toBe("noped");
    expect(byId["a:3"]).toBe("pending");
  });

  test("only returns listings the requesting user liked", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    insertListing(db, { id: "a:1" });
    insertListing(db, { id: "a:2" });
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'nope')").run(a, "a:1");
    db.query("INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, 'like')").run(a, "a:2");

    const likes = getMyLikes(db, a);
    expect(likes.map((l) => l.id)).toEqual(["a:2"]);
  });

  test("sorts the shortlist by score descending, newest like first on ties", async () => {
    const db = testDb();
    const a = await createUser(db, "alex", "pw");
    insertListing(db, { id: "a:1", score: 40 });
    insertListing(db, { id: "a:2", score: 90 });
    insertListing(db, { id: "a:3", score: 90 });
    db.query(
      "INSERT INTO swipes (user_id, listing_id, decision, created_at) VALUES (?, ?, 'like', ?)",
    ).run(a, "a:1", "2026-01-01T10:00:00.000Z");
    db.query(
      "INSERT INTO swipes (user_id, listing_id, decision, created_at) VALUES (?, ?, 'like', ?)",
    ).run(a, "a:2", "2026-01-01T10:00:01.000Z");
    db.query(
      "INSERT INTO swipes (user_id, listing_id, decision, created_at) VALUES (?, ?, 'like', ?)",
    ).run(a, "a:3", "2026-01-01T10:00:02.000Z");

    const likes = getMyLikes(db, a);
    expect(likes.map((l) => l.id)).toEqual(["a:3", "a:2", "a:1"]);
  });
});
