import { describe, expect, test } from "bun:test";
import { buildApp } from "../src/app";
import { testDb, testEnv } from "./helpers";

const INGEST_TOKEN = "test-ingest-token-32-characters!!";

function ingestRequest(body: unknown, token = INGEST_TOKEN): Request {
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function validListing(overrides: Record<string, unknown> = {}) {
  return {
    id: "immoscout24:1",
    portal: "immoscout24",
    portal_id: "1",
    url: "https://www.immoscout24.de/expose/1",
    title: "Schöne Wohnung",
    city: "Frankfurt am Main",
    rent_warm_estimated: 0,
    images: ["https://img.example.com/1.jpg"],
    score: 80,
    status: "active",
    first_seen_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ingest auth", () => {
  // Elysia routes "/api/ingest/" like "/api/ingest": the token check must too.
  for (const [path, body] of [
    ["/api/ingest/", { listings: [] }],
    ["/api/ingest/districts/", { overwrite: true, cities: [] }],
  ] as const) {
    test(`rejects an unauthenticated POST to ${path} (trailing slash)`, async () => {
      const app = buildApp(testDb(), testEnv());
      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(401);
    });
  }

  test("rejects requests without an Authorization header", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listings: [] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("rejects requests with the wrong token", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(ingestRequest({ listings: [] }, "wrong-token-but-32-characters!!!"));
    expect(res.status).toBe(401);
  });

  test("accepts requests with the correct token", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(ingestRequest({ listings: [] }));
    expect(res.status).toBe(200);
  });

  test("is exempt from the cookie-based CSRF guard (bearer-authed, not cookie-authed)", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A mismatched Origin would 403 a cookie-authenticated route.
          origin: "https://evil.example",
          authorization: `Bearer ${INGEST_TOKEN}`,
        },
        body: JSON.stringify({ listings: [] }),
      }),
    );
    expect(res.status).toBe(200);
  });

  test("rejects an unauthenticated request before validating the body (no schema error leaks)", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ this: "is not a valid ingest body" }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });
});

describe("ingest validation", () => {
  test("rejects a non-http(s) URL", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(ingestRequest({ listings: [validListing({ url: "javascript:alert(1)" })] }));
    expect(res.status).toBe(400);
  });

  test("rejects more than 30 images", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const images = Array.from({ length: 31 }, (_, i) => `https://img.example.com/${i}.jpg`);
    const res = await app.handle(ingestRequest({ listings: [validListing({ images })] }));
    expect(res.status).toBe(400);
  });

  test("rejects more than 200 listings per request", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const listings = Array.from({ length: 201 }, (_, i) => validListing({ id: `immoscout24:${i}`, portal_id: String(i) }));
    const res = await app.handle(ingestRequest({ listings }));
    expect(res.status).toBe(400);
  });

  test("rejects an invalid portal enum value", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(ingestRequest({ listings: [validListing({ portal: "not-a-real-portal" })] }));
    expect(res.status).toBe(400);
  });
});

describe("ingest id/portal consistency", () => {
  test("rejects an item whose id doesn't match portal:portal_id, without failing the rest of the batch", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(
      ingestRequest({
        listings: [
          validListing({ id: "wrong-id", portal: "immoscout24", portal_id: "1" }),
          validListing({ id: "immoscout24:2", portal: "immoscout24", portal_id: "2" }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { upserted: number; rejected: { id: string; reason: string }[] } };
    expect(body.data.upserted).toBe(1);
    expect(body.data.rejected).toHaveLength(1);
    expect(body.data.rejected[0]?.id).toBe("wrong-id");

    const rows = db.query("SELECT id FROM listings").all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["immoscout24:2"]);
  });
});

describe("ingest upsert", () => {
  test("inserts a new listing", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const res = await app.handle(ingestRequest({ listings: [validListing()] }));
    expect(res.status).toBe(200);
    const row = db.query("SELECT * FROM listings WHERE id = ?").get("immoscout24:1") as { title: string };
    expect(row.title).toBe("Schöne Wohnung");
  });

  test("upserts by id and keeps the earliest first_seen_at", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());

    await app.handle(
      ingestRequest({
        listings: [validListing({ first_seen_at: "2026-01-05T00:00:00.000Z", last_seen_at: "2026-01-05T00:00:00.000Z" })],
      }),
    );
    await app.handle(
      ingestRequest({
        listings: [
          validListing({
            title: "Aktualisierter Titel",
            first_seen_at: "2026-01-10T00:00:00.000Z",
            last_seen_at: "2026-01-10T00:00:00.000Z",
          }),
        ],
      }),
    );

    const row = db
      .query("SELECT title, first_seen_at, last_seen_at FROM listings WHERE id = ?")
      .get("immoscout24:1") as { title: string; first_seen_at: string; last_seen_at: string };

    expect(row.title).toBe("Aktualisierter Titel");
    expect(row.first_seen_at).toBe("2026-01-05T00:00:00.000Z");
    expect(row.last_seen_at).toBe("2026-01-10T00:00:00.000Z");

    const count = db.query("SELECT COUNT(*) AS n FROM listings").get() as { n: number };
    expect(count.n).toBe(1);
  });

  test("stores images as a JSON array", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    await app.handle(ingestRequest({ listings: [validListing({ images: ["https://img.example.com/a.jpg", "https://img.example.com/b.jpg"] })] }));

    const row = db.query("SELECT images FROM listings WHERE id = ?").get("immoscout24:1") as { images: string };
    expect(JSON.parse(row.images)).toEqual(["https://img.example.com/a.jpg", "https://img.example.com/b.jpg"]);
  });

  test("blank or empty images/description never overwrite; non-empty values always replace", async () => {
    const db = testDb();
    const app = buildApp(db, testEnv());
    const gallery = ["a", "b", "c"].map((x) => `https://img.example.com/${x}.jpg`);
    const read = () =>
      db.query("SELECT images, description FROM listings WHERE id = ?").get("immoscout24:1") as {
        images: string;
        description: string | null;
      };

    await app.handle(ingestRequest({ listings: [validListing({ images: gallery, description: "Volltext" })] }));
    await app.handle(ingestRequest({ listings: [validListing({ images: [], description: null })] }));
    await app.handle(ingestRequest({ listings: [validListing({ images: [], description: "  " })] }));
    await app.handle(ingestRequest({ listings: [validListing({ images: [] })] }));
    await app.handle(ingestRequest({ listings: [validListing({ images: [], description: "\n\t \r\n" })] }));
    expect(JSON.parse(read().images)).toEqual(gallery);
    expect(read().description).toBe("Volltext");

    // the scraper sends already-merged data: a smaller gallery or a shorter text is the newer truth
    await app.handle(ingestRequest({ listings: [validListing({ images: [gallery[2]], description: "Kurz" })] }));
    expect(JSON.parse(read().images)).toEqual([gallery[2]]);
    expect(read().description).toBe("Kurz");

    const larger = ["https://img.example.com/large-a.jpg", ...gallery];
    await app.handle(ingestRequest({ listings: [validListing({ images: larger, description: "Volltext, länger" })] }));
    expect(JSON.parse(read().images)).toEqual(larger);
    expect(read().description).toBe("Volltext, länger");
  });
});
