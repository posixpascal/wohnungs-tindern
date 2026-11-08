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

describe("swipes", () => {
  test("requires authentication", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    const app = buildApp(db, testEnv());

    const res = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    expect(res.status).toBe(401);
  });

  test("requires JSON content-type (CSRF defense)", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    const res = await app.handle(
      new Request("http://localhost/api/swipes", {
        method: "POST",
        headers: { "content-type": "text/plain", cookie },
        body: JSON.stringify({ listing_id: "a:1", decision: "like" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("404s on a non-existent listing", async () => {
    const db = testDb();
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    const res = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie, body: JSON.stringify({ listing_id: "nope", decision: "like" }) }),
    );
    expect(res.status).toBe(404);
  });

  test("no match when only one of two users likes a listing", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    await createUser(db, "partner", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    const res = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { match: boolean } };
    expect(body.data.match).toBe(false);
  });

  test("is a match once every user has liked the listing", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    await createUser(db, "partner", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookieA = await login(app, "alex", "s3cret!");
    const cookieB = await login(app, "partner", "s3cret!");

    await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieA, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    const res = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieB, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    const body = (await res.json()) as { data: { match: boolean } };
    expect(body.data.match).toBe(true);
  });

  test("re-liking an already-matched listing does not report match again", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    await createUser(db, "partner", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookieA = await login(app, "alex", "s3cret!");
    const cookieB = await login(app, "partner", "s3cret!");

    await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieA, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    const matchRes = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieB, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    expect(((await matchRes.json()) as { data: { match: boolean } }).data.match).toBe(true);

    // The same user "re-likes" (e.g. a retried/duplicate request) after the
    // match already happened — it's still liked by everyone, but this isn't
    // a new transition into a match.
    const repeatRes = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieA, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    const repeatBody = (await repeatRes.json()) as { data: { match: boolean } };
    expect(repeatBody.data.match).toBe(false);
  });

  test("a nope is never a match", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    const res = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie, body: JSON.stringify({ listing_id: "a:1", decision: "nope" }) }),
    );
    const body = (await res.json()) as { data: { match: boolean } };
    expect(body.data.match).toBe(false);
  });

  test("undo removes the swipe", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    const undoRes = await app.handle(jsonRequest("/api/swipes/a:1", { method: "DELETE", cookie }));
    expect(undoRes.status).toBe(200);
    const body = (await undoRes.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);

    // Listing should be back in the queue after undo.
    const queueRes = await app.handle(jsonRequest("/api/queue", { cookie }));
    const queueBody = (await queueRes.json()) as { data: { id: string }[] };
    expect(queueBody.data.map((l) => l.id)).toContain("a:1");
  });

  test("undoing a swipe that was never made reports deleted: false", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookie = await login(app, "alex", "s3cret!");

    const res = await app.handle(jsonRequest("/api/swipes/a:1", { method: "DELETE", cookie }));
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(false);
  });

  test("re-swiping the same listing overwrites the previous decision", async () => {
    const db = testDb();
    insertListing(db, { id: "a:1" });
    await createUser(db, "alex", "s3cret!");
    await createUser(db, "partner", "s3cret!");
    const app = buildApp(db, testEnv());
    const cookieA = await login(app, "alex", "s3cret!");
    const cookieB = await login(app, "partner", "s3cret!");

    await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieA, body: JSON.stringify({ listing_id: "a:1", decision: "nope" }) }),
    );
    await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieA, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    const res = await app.handle(
      jsonRequest("/api/swipes", { method: "POST", cookie: cookieB, body: JSON.stringify({ listing_id: "a:1", decision: "like" }) }),
    );
    const body = (await res.json()) as { data: { match: boolean } };
    expect(body.data.match).toBe(true);
  });
});
