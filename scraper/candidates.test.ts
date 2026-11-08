import { describe, expect, test } from "bun:test";
import { detailCandidates, parseArgs } from "./candidates";
import { validateConfig } from "./config";
import { openDb } from "./db";
import { ingestRecords } from "./ingest";

const config = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  locations: [{ city: "Idstein", radius_km: 0 }],
  preferences: { garden_or_balcony: true, ground_floor: true },
  portals: ["kleinanzeigen"],
});

const NOW = "2026-10-14T10:00:00.000Z";
const full = { description: "Text", images: ["https://x/1.jpg", "https://x/2.jpg"] };

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  portal: "kleinanzeigen",
  portal_id: id,
  url: `https://www.kleinanzeigen.de/s-anzeige/x/${id}`,
  title: "Wohnung",
  location: "Idstein",
  rent_cold: 800,
  rooms: 3,
  area: 70,
  ...over,
});

describe("detailCandidates", () => {
  test("lists every new matching listing, best first, capped", () => {
    const db = openDb(":memory:");
    const input = [
      rec("a", { rooms: 2 }),
      rec("b"),
      rec("c", { rent_warm: 900, rent_cold: undefined, floor: "EG", features: ["Garten"], description: "Text", images: ["https://x/1.jpg", "https://x/2.jpg"] }),
      rec("d", { title: "Tauschwohnung" }),
      rec("e", { rent_cold: 1250 }),
      rec("f", { rent_cold: 1150, rooms: 2 }),
      { junk: true },
    ];
    const [top, ...rest] = detailCandidates(db, config, input, { limit: 1 });
    expect(rest).toEqual([]);
    expect(top?.id).toBe("kleinanzeigen:c");
    expect(top?.kind).toBe("new");
    expect(top?.missing).toEqual([]);
    const all = detailCandidates(db, config, input);
    expect(all.map((c) => c.id)).toEqual(["kleinanzeigen:c", "kleinanzeigen:b", "kleinanzeigen:a", "kleinanzeigen:f"]);
    expect(all[1]?.url).toBe("https://www.kleinanzeigen.de/s-anzeige/x/b");
    expect(all[1]?.missing).toEqual(["warm", "etage", "garten/balkon", "bilder", "beschreibung"]);
  });

  test("skips new listings that already got a detail visit (e.g. filtered out after it)", () => {
    const db = openDb(":memory:");
    const visits = new Map([["kleinanzeigen:b", "2026-10-13"]]);
    expect(detailCandidates(db, config, [rec("b")], { visits })).toEqual([]);
  });

  test("ground_floor_or_balcony: unknown floor/balcony still gets a detail visit, a known miss does not", () => {
    const db = openDb(":memory:");
    const strict = { ...config, requirements: { ground_floor_or_balcony: true } };
    const input = [rec("u"), rec("x", { floor: "2", has_balcony: false }), rec("s", { floor: "2" })];
    expect(detailCandidates(db, strict, input).map((c) => c.id).sort()).toEqual([
      "kleinanzeigen:s",
      "kleinanzeigen:u",
    ]);
  });

  test("listings without any price are candidates", () => {
    const db = openDb(":memory:");
    expect(detailCandidates(db, config, [rec("p", { rent_cold: undefined })])[0]?.missing).toContain("warm");
  });

  test("known listings come back only as backfill while images or description are missing", () => {
    const db = openDb(":memory:");
    ingestRecords(db, config, [rec("b"), rec("g", full), rec("h", { ...full, images: ["https://x/1.jpg"] })]);
    ingestRecords(db, config, [rec("gone", { description: "x" })], "2026-01-01T00:00:00.000Z");
    db.query("UPDATE listings SET status = 'gone' WHERE id = 'kleinanzeigen:gone'").run();
    const res = detailCandidates(db, config, [rec("b"), rec("g", full)]).filter((c) => c.kind === "backfill");
    expect(res.map((c) => c.id)).toEqual(["kleinanzeigen:b", "kleinanzeigen:h"]);
    expect(res[1]?.missing).toEqual(["warm", "etage", "garten/balkon", "bilder"]);
    const visits = new Map([["kleinanzeigen:b", "2026-10-13"]]);
    expect(detailCandidates(db, config, [], { visits, now: NOW }).filter((c) => c.kind === "backfill").map((c) => c.id)).toEqual([
      "kleinanzeigen:h",
    ]);
  });

  test("new listings come before backfill regardless of score", () => {
    const db = openDb(":memory:");
    ingestRecords(db, config, [rec("old", { floor: "EG", features: ["Garten"] })]);
    const res = detailCandidates(db, config, [rec("new", { rent_cold: 1100 })], { limit: 1 });
    expect(res.map((c) => c.id)).toEqual(["kleinanzeigen:new"]);
  });

  test("refresh: active listings whose latest detail visit is >= 7 days old, never visited first, then oldest", () => {
    const db = openDb(":memory:");
    ingestRecords(db, config, ["fresh", "week", "old", "never", "gone"].map((id) => rec(id, full)), NOW);
    db.query("UPDATE listings SET status = 'gone' WHERE id = 'kleinanzeigen:gone'").run();
    const visits = new Map([
      ["kleinanzeigen:fresh", "2026-10-08"],
      ["kleinanzeigen:week", "2026-10-07"],
      ["kleinanzeigen:old", "2026-09-01"],
      ["kleinanzeigen:gone", "2026-09-01"],
    ]);
    const res = detailCandidates(db, config, [], { visits, now: NOW });
    expect(res.map((c) => [c.id, c.kind])).toEqual([
      ["kleinanzeigen:never", "refresh"],
      ["kleinanzeigen:old", "refresh"],
      ["kleinanzeigen:week", "refresh"],
    ]);
    expect(detailCandidates(db, config, [], { visits, now: NOW, refreshDays: 30 }).map((c) => c.id)).toEqual([
      "kleinanzeigen:never",
      "kleinanzeigen:old",
    ]);
  });

  test("a visited listing still lacking photos is not backfilled daily but refreshed weekly", () => {
    const db = openDb(":memory:");
    ingestRecords(db, config, [rec("nopics", { description: "Text" })], NOW);
    const recent = new Map([["kleinanzeigen:nopics", "2026-10-13"]]);
    expect(detailCandidates(db, config, [], { visits: recent, now: NOW })).toEqual([]);
    const stale = new Map([["kleinanzeigen:nopics", "2026-10-01"]]);
    expect(detailCandidates(db, config, [], { visits: stale, now: NOW }).map((c) => c.kind)).toEqual(["refresh"]);
  });

  test("new and backfill fill the limit first, refresh gets the rest", () => {
    const db = openDb(":memory:");
    ingestRecords(db, config, [rec("bf"), rec("r1", full), rec("r2", full)], NOW);
    const visits = new Map([["kleinanzeigen:r1", "2026-09-01"]]);
    const kinds = (limit: number) =>
      detailCandidates(db, config, [rec("n1"), rec("n2")], { visits, now: NOW, limit }).map((c) => [c.id, c.kind]);
    expect(kinds(3)).toEqual([
      ["kleinanzeigen:n1", "new"],
      ["kleinanzeigen:n2", "new"],
      ["kleinanzeigen:bf", "backfill"],
    ]);
    expect(kinds(10)).toEqual([
      ["kleinanzeigen:n1", "new"],
      ["kleinanzeigen:n2", "new"],
      ["kleinanzeigen:bf", "backfill"],
      ["kleinanzeigen:r2", "refresh"],
      ["kleinanzeigen:r1", "refresh"],
    ]);
  });
});

describe("parseArgs", () => {
  test("reads --limit and --refresh-days, the rest are files", () => {
    expect(parseArgs(["a.json"])).toEqual({ limit: 80, refreshDays: 7, files: ["a.json"] });
    expect(parseArgs(["--limit", "5", "a.json", "--refresh-days", "14", "b.json"])).toEqual({
      limit: 5,
      refreshDays: 14,
      files: ["a.json", "b.json"],
    });
  });

  test("rejects non-positive or missing values", () => {
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--refresh-days", "x"])).toThrow(/--refresh-days/);
    expect(() => parseArgs(["--refresh-days"])).toThrow(/--refresh-days/);
    expect(() => parseArgs(["--limit=5"])).toThrow(/unknown option --limit=5/);
  });
});
