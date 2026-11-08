import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { validateConfig } from "./config";
import { getListing, openDb } from "./db";
import { ingestRecords, parseInput } from "./ingest";
import { parseDays, sweepGone } from "./sweep";

const config = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  area_sqm: { min: 50 },
  preferences: { garden_or_balcony: true, ground_floor: true },
  locations: [{ city: "Idstein", radius_km: 0 }],
  portals: ["kleinanzeigen", "immoscout24"],
});

const DAY1 = "2026-10-14T10:00:00.000Z";
const DAY2 = "2026-10-15T10:00:00.000Z";

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  portal: "kleinanzeigen",
  portal_id: id,
  url: `https://www.kleinanzeigen.de/s-anzeige/x/${id}-203-4808`,
  title: "Schöne 3-Zimmer-Wohnung",
  location: "65510 Idstein",
  rent_warm: "1.000 €",
  rooms: 3,
  area: 70,
  ...over,
});

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("ingestRecords", () => {
  test("counts new, filtered and invalid records without crashing", () => {
    const input = [
      rec("1"),
      rec("2", { title: "TAUSCHWOHNUNG" }),
      rec("3", { rent_warm: 1500 }),
      rec("4", { location: "Taunusstein" }),
      { portal: "kleinanzeigen" },
      "garbage",
      rec("5", { url: "https://evil.example/x" }),
    ];
    const { summary, problems } = ingestRecords(db, config, input, DAY1);
    expect(summary).toEqual({ received: 7, new: 1, updated: 0, filtered: 3, invalid: 3 });
    expect(problems.filter((p) => p.kind === "invalid")).toHaveLength(3);
    expect(problems.find((p) => p.id === "kleinanzeigen:2")?.reason).toBe("Tauschwohnung");
  });

  test("stores a scored listing", () => {
    ingestRecords(db, config, [rec("1", { floor: "EG", features: ["Garten"] })], DAY1);
    const row = getListing(db, "kleinanzeigen:1");
    expect(row?.floor).toBe(0);
    expect(row?.has_garden).toBe(1);
    expect(row?.score).toBeGreaterThan(50);
    expect(row?.score_notes).toContain("EG ✓");
    expect(row?.images).toEqual([]);
  });

  test("updates keep first_seen_at, bump last_seen_at and reactivate gone listings", () => {
    ingestRecords(db, config, [rec("1")], DAY1);
    sweepGone(db, 0, DAY2);
    expect(getListing(db, "kleinanzeigen:1")?.status).toBe("gone");

    const { summary } = ingestRecords(db, config, [rec("1", { title: "Neu" })], DAY2);
    expect(summary.updated).toBe(1);
    const row = getListing(db, "kleinanzeigen:1");
    expect(row?.first_seen_at).toBe(DAY1);
    expect(row?.last_seen_at).toBe(DAY2);
    expect(row?.status).toBe("active");
    expect(row?.title).toBe("Neu");
  });

  test("details from an earlier run survive a later list-only record", () => {
    ingestRecords(db, config, [rec("1", { floor: "0", features: ["Garten"], description: "Toll" })], DAY1);
    ingestRecords(db, config, [rec("1", { rent_warm: undefined, rent_cold: 800 })], DAY2);
    const row = getListing(db, "kleinanzeigen:1");
    expect(row?.floor).toBe(0);
    expect(row?.has_garden).toBe(1);
    expect(row?.description).toBe("Toll");
    expect(row?.rent_warm).toBe(1000);
    expect(row?.rent_warm_estimated).toBe(0);
  });

  test("a bathtub from the feature list survives a later list-only record", () => {
    ingestRecords(db, config, [rec("1", { features: ["Badewanne"] })], DAY1);
    ingestRecords(db, config, [rec("1")], DAY2);
    expect(getListing(db, "kleinanzeigen:1")?.has_bathtub).toBe(1);
  });

  test("a detail gallery and full text survive later list records with a thumbnail, teaser or nothing", () => {
    const gallery = ["a", "b", "c"].map((x) => `https://img.wg-gesucht.de/media/up/${x}.large.jpg`);
    ingestRecords(db, config, [rec("1", { description: "Lange Beschreibung mit allen Details", images: gallery })], DAY1);
    ingestRecords(db, config, [rec("1", { description: "Lange…", images: [gallery[0]] })], DAY2);
    ingestRecords(db, config, [rec("1", { images: [] })], DAY2);
    const row = getListing(db, "kleinanzeigen:1");
    expect(row?.images).toEqual(gallery);
    expect(row?.description).toBe("Lange Beschreibung mit allen Details");
  });

  describe("a detail visit is authoritative for images and description", () => {
    const gallery = ["a", "b", "c"].map((x) => `https://img.example.de/${x}.jpg`);
    const visits = new Map([["kleinanzeigen:1", "2026-10-14"]]);
    const read = () => getListing(db, "kleinanzeigen:1");
    const seed = () =>
      ingestRecords(db, config, [], DAY1, { detail: [rec("1", { description: "Lange Beschreibung mit Details", images: gallery })] });

    test("a detail record with fewer images and a shorter text replaces the stored ones", () => {
      seed();
      ingestRecords(db, config, [], DAY2, { detail: [rec("1", { description: "Kurz", images: [gallery[2]] })], visits });
      expect(read()?.images).toEqual([gallery[2]!]);
      expect(read()?.description).toBe("Kurz");
    });

    test("a detail record without images or text keeps the stored ones", () => {
      seed();
      ingestRecords(db, config, [], DAY2, { detail: [rec("1", { description: " ", images: [] })], visits });
      expect(read()?.images).toEqual(gallery);
      expect(read()?.description).toBe("Lange Beschreibung mit Details");
    });

    test("a list record after a detail visit only fills empty values", () => {
      ingestRecords(db, config, [], DAY1, { detail: [rec("1", { images: [gallery[0]] })] });
      const bigger = [...gallery, "https://img.example.de/d.jpg"];
      ingestRecords(db, config, [rec("1", { description: "Teaser aus der Liste", images: bigger })], DAY2, { visits });
      expect(read()?.images).toEqual([gallery[0]!]);
      expect(read()?.description).toBe("Teaser aus der Liste");
    });

    test("a list record without a detail visit still grows the gallery and text", () => {
      ingestRecords(db, config, [rec("1", { description: "Kurz", images: [gallery[0]] })], DAY1);
      ingestRecords(db, config, [rec("1", { description: "Kurz, aber länger", images: gallery })], DAY2);
      expect(read()?.images).toEqual(gallery);
      expect(read()?.description).toBe("Kurz, aber länger");
    });

    test("list and detail of the same id in one batch: the detail values win", () => {
      const { summary } = ingestRecords(
        db,
        config,
        [rec("1", { description: "Längerer Teaser aus der Liste", images: gallery })],
        DAY1,
        { detail: [rec("1", { description: "Detail", images: [gallery[1]] })], visits },
      );
      expect(summary).toEqual({ received: 2, new: 1, updated: 0, filtered: 0, invalid: 0 });
      expect(read()?.images).toEqual([gallery[1]!]);
      expect(read()?.description).toBe("Detail");
    });

    test("a list thumbnail never stands in for an empty detail extraction of the same batch", () => {
      seed();
      ingestRecords(db, config, [rec("1", { description: "Teaser", images: ["https://img.example.de/thumb.jpg"] })], DAY2, {
        detail: [rec("1", { images: [] })],
        visits,
      });
      expect(read()?.images).toEqual(gallery);
      expect(read()?.description).toBe("Lange Beschreibung mit Details");
    });

    test("invalid detail records are counted with their batch index", () => {
      const { summary, problems } = ingestRecords(db, config, [rec("1")], DAY1, { detail: [{ junk: true }] });
      expect(summary.invalid).toBe(1);
      expect(problems[0]?.id).toBe("#1");
    });
  });

  test("a later record without price keeps the stored rent (no false 'gone')", () => {
    ingestRecords(db, config, [rec("1")], DAY1);
    const { summary } = ingestRecords(db, config, [rec("1", { rent_warm: "VB" })], DAY2);
    expect(summary.updated).toBe(1);
    expect(getListing(db, "kleinanzeigen:1")?.last_seen_at).toBe(DAY2);
    expect(getListing(db, "kleinanzeigen:1")?.rent_warm).toBe(1000);
  });

  test("list and detail records in one batch are merged", () => {
    const { summary } = ingestRecords(
      db,
      config,
      [rec("1", { rent_warm: undefined, rent_cold: 870 }), rec("1", { rent_warm: "970 €", floor: "0" })],
      DAY1,
    );
    expect(summary).toEqual({ received: 2, new: 1, updated: 0, filtered: 0, invalid: 0 });
    const row = getListing(db, "kleinanzeigen:1");
    expect(row?.rent_warm).toBe(970);
    expect(row?.rent_cold).toBe(870);
  });

  test("portals not enabled in config are filtered", () => {
    const { summary } = ingestRecords(
      db,
      config,
      [rec("1", { portal: "wg-gesucht", url: "https://www.wg-gesucht.de/wohnungen-in-Idstein.1.html" })],
      DAY1,
    );
    expect(summary.filtered).toBe(1);
  });
});

describe("parseInput", () => {
  test("accepts a JSON array", () => {
    expect(parseInput("[1,2]")).toEqual([1, 2]);
  });

  test("rejects invalid JSON and non-arrays with clear errors", () => {
    expect(() => parseInput("{")).toThrow(/not valid JSON/);
    expect(() => parseInput("{}")).toThrow(/JSON array/);
  });
});

describe("sweepGone", () => {
  test("marks only stale active listings and clears synced_at", () => {
    ingestRecords(db, config, [rec("1"), rec("2")], DAY1);
    db.run("UPDATE listings SET synced_at = ? ", [DAY1]);
    ingestRecords(db, config, [rec("2")], "2026-10-18T10:00:00.000Z");
    const gone = sweepGone(db, 3, "2026-10-18T10:00:00.000Z");
    expect(gone).toBe(1);
    expect(getListing(db, "kleinanzeigen:1")?.status).toBe("gone");
    expect(getListing(db, "kleinanzeigen:1")?.synced_at).toBeNull();
    expect(getListing(db, "kleinanzeigen:2")?.status).toBe("active");
  });
});

describe("parseDays", () => {
  test("defaults to 3 and validates input", () => {
    expect(parseDays(undefined)).toBe(3);
    expect(parseDays("7")).toBe(7);
    expect(() => parseDays("0")).toThrow(/days/);
    expect(() => parseDays("abc")).toThrow(/days/);
  });
});
