import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { SCHEMA_PATH, validateConfig } from "./config";
import { getListing, migrate, openDb } from "./db";
import { ingestRecords } from "./ingest";
import { rescoreListings } from "./rescore";

const OLD = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  area_sqm: { min: 50 },
  preferences: { garden_or_balcony: true, ground_floor: true },
  locations: [{ city: "Idstein", radius_km: 0 }],
  portals: ["kleinanzeigen"],
});
const NEW = validateConfig({
  ...structuredClone(OLD),
  area_sqm: { min: 50, ideal_min: 90, ideal_max: 100 },
  preferences: { amenities: ["garden", "balcony", "bathtub"], ground_floor: true },
});

const DAY1 = "2026-10-14T10:00:00.000Z";

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  portal: "kleinanzeigen",
  portal_id: id,
  url: `https://www.kleinanzeigen.de/s-anzeige/x/${id}-203-4808`,
  title: "Schöne 3-Zimmer-Wohnung",
  location: "65510 Idstein",
  rent_warm: 1000,
  rooms: 3,
  area: 95,
  ...over,
});

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("rescoreListings", () => {
  test("recomputes score and notes of active listings and marks only changed ones for push", () => {
    ingestRecords(db, OLD, [rec("1"), rec("2", { area: 55 })], DAY1);
    db.run("UPDATE listings SET synced_at = ?", [DAY1]);
    const before = getListing(db, "kleinanzeigen:2")!;

    expect(rescoreListings(db, NEW)).toEqual({ rescored: 2, changed: 1, removed: 0 });
    const after = getListing(db, "kleinanzeigen:2")!;
    expect(after.score).toBeLessThan(before.score);
    expect(after.score_notes).toContain("55 m² (< 90)");
    expect(after.synced_at).toBeNull();
    expect(getListing(db, "kleinanzeigen:1")?.synced_at).toBe(DAY1);
  });

  test("leaves unchanged and gone listings alone", () => {
    ingestRecords(db, NEW, [rec("1"), rec("2")], DAY1);
    db.run("UPDATE listings SET synced_at = ?", [DAY1]);
    db.run("UPDATE listings SET status = 'gone', score = 1 WHERE id = 'kleinanzeigen:2'");

    expect(rescoreListings(db, NEW)).toEqual({ rescored: 1, changed: 0, removed: 0 });
    expect(getListing(db, "kleinanzeigen:1")?.synced_at).toBe(DAY1);
    expect(getListing(db, "kleinanzeigen:2")?.score).toBe(1);
  });

  test("derives has_bathtub from the stored title and description", () => {
    ingestRecords(db, NEW, [rec("1", { description: "Bad mit Wanne" }), rec("2", { description: "nur Dusche" })], DAY1);
    db.run("UPDATE listings SET has_bathtub = NULL");

    rescoreListings(db, NEW);
    expect(getListing(db, "kleinanzeigen:1")?.has_bathtub).toBe(1);
    expect(getListing(db, "kleinanzeigen:1")?.score_notes).toContain("Wanne ✓");
    expect(getListing(db, "kleinanzeigen:2")?.has_bathtub).toBeNull();
  });

  test("marks stored listings that the current exclusion rules or criteria reject as gone", () => {
    ingestRecords(db, NEW, [rec("1"), rec("2"), rec("3")], DAY1);
    db.run("UPDATE listings SET synced_at = ?", [DAY1]);
    db.run("UPDATE listings SET title = 'Mounteur Wohnung 3 Zimmer' WHERE id = 'kleinanzeigen:2'");
    db.run("UPDATE listings SET rent_warm = 180 WHERE id = 'kleinanzeigen:3'");

    expect(rescoreListings(db, NEW)).toEqual({ rescored: 1, changed: 0, removed: 2 });
    const state = (id: string) => {
      const l = getListing(db, `kleinanzeigen:${id}`)!;
      return [l.status, l.synced_at];
    };
    expect(state("1")).toEqual(["active", DAY1]);
    expect(state("2")).toEqual(["gone", null]);
    expect(state("3")).toEqual(["gone", null]);
  });

  test("keeps a bathtub detected at ingest from features that are not stored", () => {
    ingestRecords(db, NEW, [rec("1", { features: ["Badewanne"] })], DAY1);
    rescoreListings(db, NEW);
    expect(getListing(db, "kleinanzeigen:1")?.has_bathtub).toBe(1);
  });
});

describe("migrate", () => {
  test("adds has_bathtub to a DB created before the column existed", () => {
    const old = new Database(":memory:");
    old.exec(`CREATE TABLE listings (id TEXT PRIMARY KEY, portal TEXT NOT NULL, portal_id TEXT NOT NULL,
      url TEXT NOT NULL, title TEXT NOT NULL, city TEXT NOT NULL, district TEXT, address TEXT, rent_cold REAL,
      rent_warm REAL, rent_warm_estimated INTEGER NOT NULL DEFAULT 0, rooms REAL, area_sqm REAL, floor INTEGER,
      has_garden INTEGER, has_balcony INTEGER, available_from TEXT, description TEXT, images TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0, score_notes TEXT, status TEXT NOT NULL DEFAULT 'active',
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, synced_at TEXT)`);
    old.exec(readFileSync(SCHEMA_PATH, "utf8")); // what openDb runs first: a no-op for the existing table
    migrate(old);
    migrate(old); // idempotent

    ingestRecords(old, NEW, [rec("1", { features: ["Badewanne"] })], DAY1);
    expect(getListing(old, "kleinanzeigen:1")?.has_bathtub).toBe(1);
  });
});
