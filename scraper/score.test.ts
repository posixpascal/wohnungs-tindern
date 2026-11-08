import { describe, expect, test } from "bun:test";
import { validateConfig } from "./config";
import { scoreListing } from "./score";
import type { Listing } from "./types";

const config = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  area_sqm: { min: 50, ideal_min: 90, ideal_max: 100 },
  preferences: { amenities: ["garden", "balcony", "bathtub"], ground_floor: true },
  locations: [{ city: "Wiesbaden", radius_km: 0, preferred_districts: ["Igstadt", "Nordenstadt"] }],
  portals: ["immoscout24"],
});

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: "immoscout24:1",
  portal: "immoscout24",
  portal_id: "1",
  url: "https://www.immobilienscout24.de/expose/1",
  title: "Wohnung",
  city: "Wiesbaden",
  district: null,
  address: null,
  rent_cold: null,
  rent_warm: 1200,
  rent_warm_estimated: 0,
  rooms: null,
  area_sqm: null,
  floor: null,
  has_garden: null,
  has_balcony: null,
  has_bathtub: null,
  available_from: null,
  description: null,
  images: [],
  score: 0,
  score_notes: null,
  status: "active",
  first_seen_at: "2026-10-14T10:00:00.000Z",
  last_seen_at: "2026-10-14T10:00:00.000Z",
  synced_at: null,
  ...over,
});

describe("scoreListing", () => {
  test("perfect listing scores 100", () => {
    const { score } = scoreListing(
      listing({
        rooms: 3,
        has_garden: 1,
        has_balcony: 1,
        has_bathtub: 1,
        floor: 0,
        rent_warm: 800,
        district: "Igstadt",
        area_sqm: 95,
      }),
      config,
    );
    expect(score).toBe(100);
  });

  test("bare listing at the budget limit scores low", () => {
    const { score } = scoreListing(listing({ rooms: 2, area_sqm: 50 }), config);
    expect(score).toBeLessThanOrEqual(15);
  });

  test("score is always within 0..100 and an integer", () => {
    const { score } = scoreListing(listing({ rent_warm: 50, rooms: 9, area_sqm: 500 }), config);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test("ideal rooms beat more rooms beat min rooms", () => {
    const s = (rooms: number) => scoreListing(listing({ rooms }), config).score;
    expect(s(3)).toBeGreaterThan(s(4));
    expect(s(4)).toBeGreaterThan(s(2.5));
    expect(s(2.5)).toBeGreaterThan(s(2));
  });

  test("garden, balcony and bathtub add up, garden counts most", () => {
    const s = (over: Partial<Listing>) => scoreListing(listing(over), config).score;
    expect(s({ has_garden: 1 })).toBeGreaterThan(s({ has_balcony: 1 }));
    expect(s({ has_balcony: 1 })).toBeGreaterThan(s({}));
    expect(s({ has_bathtub: 1 })).toBeGreaterThan(s({}));
    const all = s({ has_garden: 1, has_balcony: 1, has_bathtub: 1 });
    expect(all - s({})).toBe(s({ has_garden: 1 }) + s({ has_balcony: 1 }) + s({ has_bathtub: 1 }) - 3 * s({}));
    expect(all).toBeGreaterThan(s({ has_garden: 1, has_balcony: 1 }));
  });

  test("only configured amenities count", () => {
    const gardenOnly = validateConfig({ ...structuredClone(config), preferences: { amenities: ["garden"], ground_floor: true } });
    const s = (over: Partial<Listing>) => scoreListing(listing(over), gardenOnly).score;
    expect(s({ has_garden: 1 })).toBeGreaterThan(s({}));
    expect(s({ has_balcony: 1, has_bathtub: 1 })).toBe(s({}));
  });

  test("legacy garden_or_balcony still scores garden and balcony, not bathtub", () => {
    const legacy = validateConfig({ ...structuredClone(config), preferences: { garden_or_balcony: true, ground_floor: true } });
    const s = (over: Partial<Listing>) => scoreListing(listing(over), legacy).score;
    expect(s({ has_garden: 1, has_balcony: 1 })).toBe(scoreListing(listing({ has_garden: 1, has_balcony: 1 }), config).score);
    expect(s({ has_bathtub: 1 })).toBe(s({}));
  });

  describe("size", () => {
    const base = scoreListing(listing({ rooms: 3 }), config).score;
    const pts = (area_sqm: number | null) => scoreListing(listing({ rooms: 3, area_sqm }), config).score - base;

    test("full points inside the ideal range", () => {
      expect(pts(90)).toBe(20);
      expect(pts(95)).toBe(20);
      expect(pts(100)).toBe(20);
    });

    test("rises from min up to ideal_min", () => {
      expect(pts(50)).toBe(0);
      expect(pts(89)).toBeGreaterThanOrEqual(19);
      expect(pts(80)).toBeLessThan(pts(90));
      expect(pts(70)).toBeGreaterThan(pts(55));
    });

    test("drops gently above ideal_max, big flats still get some points", () => {
      expect(pts(101)).toBeGreaterThanOrEqual(19);
      expect(pts(120)).toBeGreaterThanOrEqual(13);
      expect(pts(120)).toBeLessThan(pts(101));
      expect(pts(140)).toBeLessThanOrEqual(10);
      expect(pts(150)).toBeGreaterThan(0);
      expect(pts(150)).toBeLessThan(pts(140));
    });

    test("unknown area scores nothing", () => {
      expect(pts(null)).toBe(0);
      expect(scoreListing(listing({ area_sqm: null }), config).notes).not.toContain("m²");
    });

    test("without an ideal range every size above min is full points", () => {
      const plain = validateConfig({ ...structuredClone(config), area_sqm: { min: 50 } });
      const s = (area_sqm: number) => scoreListing(listing({ area_sqm }), plain).score;
      expect(s(50)).toBe(s(140));
      expect(scoreListing(listing({ area_sqm: 50 }), plain).notes).toContain(", 50 m² ✓");
    });

    test("notes say inside, below or above the ideal range", () => {
      const note = (area_sqm: number) => scoreListing(listing({ rooms: 3, area_sqm, rent_warm: null }), config).notes.replace("3 Zi ✓, ", "");
      expect(note(95)).toBe("95 m² ✓");
      expect(note(78)).toBe("78 m² (< 90)");
      expect(note(120.5)).toBe("120,5 m² (> 100)");
    });
  });

  test("ranks a big 3-room flat with garden and bathtub far above a small bare one", () => {
    const good = scoreListing(listing({ rooms: 3, area_sqm: 95, has_garden: 1, has_bathtub: 1, rent_warm: 1000 }), config).score;
    const bare = scoreListing(listing({ rooms: 2, area_sqm: 55, rent_warm: 1000 }), config).score;
    expect(good).toBeGreaterThanOrEqual(60);
    expect(bare).toBeLessThanOrEqual(20);
  });

  test("ground floor is preferred over upper floors and Souterrain", () => {
    const s = (floor: number | null) => scoreListing(listing({ floor }), config).score;
    expect(s(0)).toBeGreaterThan(s(1));
    expect(s(1)).toBeGreaterThan(s(-1));
  });

  test("cheaper is better", () => {
    const s = (rent_warm: number) => scoreListing(listing({ rent_warm }), config).score;
    expect(s(900)).toBeGreaterThan(s(1100));
  });

  test("preferences can be switched off in config", () => {
    const off = validateConfig({ ...structuredClone(config), preferences: { amenities: [], ground_floor: false } });
    const a = scoreListing(listing({ has_garden: 1, has_bathtub: 1, floor: 0 }), off).score;
    const b = scoreListing(listing({}), off).score;
    expect(a).toBe(b);
  });

  test("writes German notes", () => {
    const { notes } = scoreListing(
      listing({
        rooms: 3,
        floor: 0,
        has_garden: 1,
        has_balcony: 1,
        has_bathtub: 1,
        rent_warm: 1130,
        rent_warm_estimated: 1,
        district: "Nordenstadt",
        area_sqm: 78,
      }),
      config,
    );
    expect(notes).toBe("3 Zi ✓, EG ✓, Garten ✓, Balkon ✓, Wanne ✓, warm 1.130 € (geschätzt), Nordenstadt ✓, 78 m² (< 90)");
  });

  test("notes mention unknowns and upper floors", () => {
    const { notes } = scoreListing(listing({ rooms: 2, floor: 2, has_balcony: 1, rent_warm: 990 }), config);
    expect(notes).toBe("2 Zi, 2. OG, Balkon ✓, warm 990 €");
    expect(scoreListing(listing({ floor: -1 }), config).notes).toContain("Souterrain");
  });

  test("warns when the warm rent is below the cold rent", () => {
    expect(scoreListing(listing({ rent_cold: 1100, rent_warm: 1000 }), config).notes).toContain("⚠ warm < kalt");
    expect(scoreListing(listing({ rent_cold: 900, rent_warm: 1000 }), config).notes).not.toContain("⚠");
    expect(scoreListing(listing({ rent_cold: 1100, rent_warm: 1000 }), config).score).toBe(
      scoreListing(listing({ rent_cold: 900, rent_warm: 1000 }), config).score,
    );
  });
});
