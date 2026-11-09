import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyResults,
  checkTargets,
  fetchWatchlist,
  parseArgs,
  parseResult,
  readResults,
  seenIds,
  validateWatchlist,
  type WatchlistEntry,
} from "./availability";
import { validateConfig } from "./config";
import { getListing, openDb } from "./db";
import { ingestRecords } from "./ingest";
import { pendingListings, type FetchFn } from "./push";
import { sweepGone } from "./sweep";

const config = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  locations: [{ city: "Idstein", radius_km: 0 }],
  preferences: { garden_or_balcony: true, ground_floor: true },
  portals: ["kleinanzeigen"],
});

const NOW = "2026-11-01T10:00:00.000Z";
const LATER = "2026-11-09T10:00:00.000Z";

const record = (id: string) => ({
  portal: "kleinanzeigen",
  portal_id: id,
  url: `https://www.kleinanzeigen.de/s-anzeige/x/${id}`,
  title: "3 Zimmer",
  location: "Idstein",
  rent_warm: 900,
  rooms: 3,
});

const entry = (id: string, likes = 0, matched = false): WatchlistEntry => ({ id: `kleinanzeigen:${id}`, likes, matched });

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
  ingestRecords(db, config, ["1", "2", "3"].map(record), NOW);
  db.query("UPDATE listings SET synced_at = ?").run(NOW);
});

describe("validateWatchlist", () => {
  test("accepts the app's envelope data", () => {
    expect(validateWatchlist({ listings: [entry("1", 2, true)] })).toEqual([entry("1", 2, true)]);
  });

  test("rejects unexpected shapes", () => {
    expect(() => validateWatchlist({})).toThrow("unexpected watchlist response");
    expect(() => validateWatchlist({ listings: [{ id: "x", likes: "1", matched: false }] })).toThrow("#0");
  });
});

describe("fetchWatchlist", () => {
  test("posts to the watchlist path with the bearer token", async () => {
    const calls: { url: string; auth: string }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization ?? "" });
      return new Response(JSON.stringify({ success: true, data: { listings: [entry("1")] }, error: null }));
    };
    const list = await fetchWatchlist({ baseUrl: "https://w.example", token: "t" }, fetchFn);
    expect(list).toEqual([entry("1")]);
    expect(calls).toEqual([{ url: "https://w.example/api/ingest/watchlist", auth: "Bearer t" }]);
  });
});

describe("checkTargets", () => {
  test("keeps the app's order, skips listings seen today, gone or unknown locally, and uses the local URL", () => {
    db.query("UPDATE listings SET status = 'gone' WHERE id = 'kleinanzeigen:3'").run();
    const watchlist = [entry("2", 2, true), entry("1", 1), entry("3"), entry("99")];
    expect(checkTargets(db, watchlist, new Set())).toEqual([
      { id: "kleinanzeigen:2", url: "https://www.kleinanzeigen.de/s-anzeige/x/2", matched: true, likes: 2 },
      { id: "kleinanzeigen:1", url: "https://www.kleinanzeigen.de/s-anzeige/x/1", matched: false, likes: 1 },
    ]);
    expect(checkTargets(db, watchlist, seenIds([record("2")])).map((t) => t.id)).toEqual(["kleinanzeigen:1"]);
  });

  test("caps the result at the limit", () => {
    expect(checkTargets(db, [entry("1"), entry("2"), entry("3")], new Set(), 2)).toHaveLength(2);
  });
});

describe("parseResult", () => {
  test("takes the id from the file name and accepts an object or a one-element array", () => {
    const path = "data/raw/2026-11-09-avail-kleinanzeigen-1.json";
    expect(parseResult(path, '{"status":"gone","signal":"redirect"}'))
      .toEqual({ id: "kleinanzeigen:1", status: "gone", signal: "redirect" });
    expect(parseResult(path, '[{"status":"active"}]')).toEqual({ id: "kleinanzeigen:1", status: "active", signal: "" });
  });

  test("keeps unknown results and defaults a missing signal to empty", () => {
    expect(parseResult("2026-11-09-avail-wg-gesucht-7.json", '{"status":"unknown"}'))
      .toEqual({ id: "wg-gesucht:7", status: "unknown", signal: "" });
  });

  test("rejects bad file names, unknown portals, statuses, broken JSON and other days", () => {
    const path = "data/raw/2026-11-09-avail-kleinanzeigen-1.json";
    expect(() => parseResult("data/raw/2026-11-09-detail-kleinanzeigen-1.json", '{"status":"gone"}')).toThrow("file name");
    expect(() => parseResult("data/raw/2026-11-09-avail-foo-1.json", '{"status":"gone"}')).toThrow("file name");
    expect(() => parseResult(path, '{"status":"deleted"}')).toThrow("status");
    expect(() => parseResult(path, "{")).toThrow();
    expect(() => parseResult(path, '{"status":"active"}', "2026-11-10")).toThrow("not today");
    expect(parseResult(path, '{"status":"active"}', "2026-11-09").status).toBe("active");
  });
});

describe("readResults", () => {
  test("reports bad and stale files as invalid and keeps the rest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avail-"));
    const file = async (name: string, text: string): Promise<string> => {
      const path = join(dir, name);
      await Bun.write(path, text);
      return path;
    };
    const files = await Promise.all([
      file("2026-11-09-avail-kleinanzeigen-1.json", '{"status":"gone","signal":"x"}'),
      file("2026-11-09-avail-kleinanzeigen-2.json", "not json"),
      file("2026-11-08-avail-kleinanzeigen-3.json", '{"status":"active"}'),
    ]);
    expect(await readResults(files, "2026-11-09")).toEqual({
      results: [{ id: "kleinanzeigen:1", status: "gone", signal: "x" }],
      invalid: 2,
    });
  });
});

describe("applyResults", () => {
  test("marks gone listings gone and pending for push, refreshes active ones, ignores unknown", () => {
    const summary = applyResults(db, [
      { id: "kleinanzeigen:1", status: "gone", signal: "x" },
      { id: "kleinanzeigen:2", status: "active", signal: "y" },
      { id: "kleinanzeigen:3", status: "unknown", signal: "z" },
    ], LATER);
    expect(summary).toEqual({ checked: 3, gone: 1, active: 1, unknown: 1 });
    expect(getListing(db, "kleinanzeigen:1")?.status).toBe("gone");
    expect(getListing(db, "kleinanzeigen:2")?.last_seen_at).toBe(LATER);
    expect(getListing(db, "kleinanzeigen:3")?.last_seen_at).toBe(NOW);
    expect(pendingListings(db).map((l) => l.id).sort()).toEqual(["kleinanzeigen:1", "kleinanzeigen:2"]);
  });

  test("a confirmed active listing survives the sweep", () => {
    applyResults(db, [{ id: "kleinanzeigen:2", status: "active", signal: "" }], LATER);
    expect(sweepGone(db, 3, LATER)).toBe(2);
    expect(getListing(db, "kleinanzeigen:2")?.status).toBe("active");
  });

  test("never revives a gone listing and counts results for unknown ids as unknown", () => {
    db.query("UPDATE listings SET status = 'gone' WHERE id = 'kleinanzeigen:1'").run();
    const summary = applyResults(db, [
      { id: "kleinanzeigen:1", status: "active", signal: "" },
      { id: "kleinanzeigen:99", status: "gone", signal: "" },
    ], LATER);
    expect(summary).toEqual({ checked: 2, gone: 0, active: 0, unknown: 2 });
    expect(getListing(db, "kleinanzeigen:1")?.status).toBe("gone");
  });
});

describe("parseArgs", () => {
  test("list with limit and files, apply with files", () => {
    expect(parseArgs(["list", "--limit", "5", "a.json"])).toEqual({ kind: "list", limit: 5, files: ["a.json"] });
    expect(parseArgs(["list"])).toEqual({ kind: "list", limit: 40, files: [] });
    expect(parseArgs(["apply", "b.json"])).toEqual({ kind: "apply", files: ["b.json"] });
  });

  test("rejects bad input", () => {
    expect(() => parseArgs([])).toThrow("unknown command");
    expect(() => parseArgs(["apply"])).toThrow("apply needs");
    expect(() => parseArgs(["list", "--limit", "0"])).toThrow("--limit");
    expect(() => parseArgs(["list", "--all"])).toThrow("unknown option");
  });
});
