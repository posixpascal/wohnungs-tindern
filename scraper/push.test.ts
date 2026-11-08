import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { validateConfig } from "./config";
import { getListing, openDb } from "./db";
import { ingestRecords } from "./ingest";
import { pendingListings, pushListings, readPushEnv, toPayload, type FetchFn } from "./push";

const config = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  locations: [{ city: "Idstein", radius_km: 0 }],
  preferences: { garden_or_balcony: true, ground_floor: true },
  portals: ["kleinanzeigen"],
});

const NOW = "2026-10-14T10:00:00.000Z";
const LATER = "2026-10-14T11:00:00.000Z";

const records = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    portal: "kleinanzeigen",
    portal_id: String(i + 1),
    url: `https://www.kleinanzeigen.de/s-anzeige/x/${i + 1}`,
    title: "3 Zimmer",
    location: "Idstein",
    rent_warm: 900,
    rooms: 3,
    images: ["https://img/a.jpg"],
  }));

type Call = { url: string; headers: Record<string, string>; body: { listings: Record<string, unknown>[] } };

const fakeFetch = (calls: Call[], response: unknown = null, status = 200): FetchFn =>
  async (url, init) => {
    const body = JSON.parse(String(init.body)) as Call["body"];
    calls.push({ url, headers: init.headers, body });
    const payload = response ?? { success: true, data: { upserted: body.listings.length }, error: null };
    return new Response(JSON.stringify(payload), { status });
  };

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("toPayload", () => {
  test("drops synced_at and keeps images as an array", () => {
    ingestRecords(db, config, records(1), NOW);
    const p = toPayload(getListing(db, "kleinanzeigen:1")!);
    expect("synced_at" in p).toBe(false);
    expect(p.images).toEqual(["https://img/a.jpg"]);
    expect(p.id).toBe("kleinanzeigen:1");
    expect(p.rent_warm_estimated).toBe(0);
  });

  test("does not send has_bathtub (local only, the server shows it via score_notes)", () => {
    ingestRecords(db, config, [{ ...records(1)[0], features: ["Badewanne"] }], NOW);
    const l = getListing(db, "kleinanzeigen:1")!;
    expect(l.has_bathtub).toBe(1);
    expect("has_bathtub" in toPayload(l)).toBe(false);
  });
});

describe("pushListings", () => {
  test("pushes pending rows in chunks of 200 and marks them synced", async () => {
    ingestRecords(db, config, records(201), NOW);
    const calls: Call[] = [];
    const res = await pushListings(db, { baseUrl: "https://w.example/", token: "t0k" }, fakeFetch(calls), LATER);
    expect(res).toEqual({ pushed: 201, batches: 2 });
    expect(calls.map((c) => c.body.listings.length)).toEqual([200, 1]);
    expect(calls[0]?.url).toBe("https://w.example/api/ingest");
    expect(calls[0]?.headers.Authorization).toBe("Bearer t0k");
    expect(pendingListings(db)).toHaveLength(0);
    expect(getListing(db, "kleinanzeigen:1")?.synced_at).toBe(LATER);
  });

  test("re-pushes rows seen again after the last sync", async () => {
    ingestRecords(db, config, records(2), NOW);
    await pushListings(db, { baseUrl: "https://w.example", token: "t" }, fakeFetch([]), NOW);
    ingestRecords(db, config, records(1), LATER);
    expect(pendingListings(db).map((l) => l.id)).toEqual(["kleinanzeigen:1"]);
  });

  test("fails on an error envelope and leaves rows unsynced", async () => {
    ingestRecords(db, config, records(1), NOW);
    const fetchFn = fakeFetch([], { success: false, data: null, error: "kaputt" });
    await expect(pushListings(db, { baseUrl: "https://w.example", token: "t" }, fetchFn, LATER)).rejects.toThrow(
      /kaputt/,
    );
    expect(pendingListings(db)).toHaveLength(1);
  });

  test("fails on HTTP errors and malformed responses", async () => {
    ingestRecords(db, config, records(1), NOW);
    const env = { baseUrl: "https://w.example", token: "t" };
    await expect(pushListings(db, env, fakeFetch([], { error: "nope" }, 401), LATER)).rejects.toThrow(/401/);
    await expect(pushListings(db, env, fakeFetch([], { foo: 1 }), LATER)).rejects.toThrow(/unexpected response/);
  });

  test("nothing to push makes no request", async () => {
    const calls: Call[] = [];
    expect(await pushListings(db, { baseUrl: "https://w.example", token: "t" }, fakeFetch(calls), NOW)).toEqual({
      pushed: 0,
      batches: 0,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("readPushEnv", () => {
  test("returns null when not configured", () => {
    expect(readPushEnv({})).toBeNull();
  });

  test("rejects partial or invalid configuration", () => {
    expect(() => readPushEnv({ WOHNUNG_URL: "https://x" })).toThrow(/INGEST_TOKEN/);
    expect(() => readPushEnv({ WOHNUNG_URL: "ftp://x", INGEST_TOKEN: "t" })).toThrow(/WOHNUNG_URL/);
    expect(() => readPushEnv({ WOHNUNG_URL: "http://wohnung.example", INGEST_TOKEN: "t" })).toThrow(/https/);
    expect(readPushEnv({ WOHNUNG_URL: "http://localhost:3000", INGEST_TOKEN: "t" })?.baseUrl).toBe("http://localhost:3000");
  });

  test("accepts a valid configuration", () => {
    expect(readPushEnv({ WOHNUNG_URL: "https://x.example", INGEST_TOKEN: "t" })).toEqual({
      baseUrl: "https://x.example",
      token: "t",
    });
  });
});
