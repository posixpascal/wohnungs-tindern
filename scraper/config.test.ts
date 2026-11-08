import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, repoRoot, selectionNote, validateConfig } from "./config";

const valid = {
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  area_sqm: { min: 50 },
  preferences: { garden_or_balcony: true, ground_floor: true },
  locations: [
    { city: "Idstein", radius_km: 0 },
    { city: "Wiesbaden", radius_km: 0, preferred_districts: ["Igstadt"] },
  ],
  portals: ["immoscout24", "kleinanzeigen"],
};

describe("validateConfig", () => {
  test("accepts a valid config and defaults preferred_districts", () => {
    const cfg = validateConfig(valid);
    expect(cfg.budget.warm_max).toBe(1200);
    expect(cfg.locations[0]?.preferred_districts).toEqual([]);
    expect(cfg.locations[1]?.preferred_districts).toEqual(["Igstadt"]);
    expect(cfg.portals).toEqual(["immoscout24", "kleinanzeigen"]);
  });

  test("does not mutate its input", () => {
    const input = structuredClone(valid);
    validateConfig(input);
    expect(input).toEqual(valid);
  });

  test("defaults area_sqm.min to 0 when missing", () => {
    const { area_sqm: _ignored, ...rest } = valid;
    expect(validateConfig(rest).area_sqm.min).toBe(0);
  });

  test("accepts an optional ideal area range", () => {
    expect(validateConfig({ ...valid, area_sqm: { min: 50, ideal_min: 90, ideal_max: 100 } }).area_sqm).toEqual({
      min: 50,
      ideal_min: 90,
      ideal_max: 100,
    });
  });

  test("without an ideal range every size from min on is ideal", () => {
    expect(validateConfig(valid).area_sqm).toEqual({ min: 50, ideal_min: 50, ideal_max: Infinity });
    expect(validateConfig({ ...valid, area_sqm: { min: 50, ideal_max: 100 } }).area_sqm.ideal_min).toBe(50);
    expect(validateConfig({ ...valid, area_sqm: { min: 50, ideal_min: 90 } }).area_sqm.ideal_max).toBe(Infinity);
  });

  test("rejects an ideal range outside min <= ideal_min <= ideal_max", () => {
    const area = (a: object) => () => validateConfig({ ...valid, area_sqm: a });
    expect(area({ min: 50, ideal_min: 40 })).toThrow(/area_sqm.ideal_min must be >= area_sqm.min \(50\)/);
    expect(area({ min: 50, ideal_min: 100, ideal_max: 90 })).toThrow(
      /area_sqm.ideal_max must be >= area_sqm.ideal_min \(100\)/,
    );
    expect(area({ min: 50, ideal_max: 40 })).toThrow(/area_sqm.ideal_max must be >= area_sqm.ideal_min \(50\)/);
    expect(area({ min: 50, ideal_min: "90" })).toThrow(/area_sqm.ideal_min must be a number/);
  });

  test("reads preferences.amenities", () => {
    const cfg = validateConfig({ ...valid, preferences: { amenities: ["bathtub", "garden"], ground_floor: true } });
    expect(cfg.preferences).toEqual({ amenities: ["bathtub", "garden"], ground_floor: true });
  });

  test("maps the legacy garden_or_balcony flag to amenities", () => {
    expect(validateConfig(valid).preferences.amenities).toEqual(["garden", "balcony"]);
    const off = validateConfig({ ...valid, preferences: { garden_or_balcony: false, ground_floor: true } });
    expect(off.preferences.amenities).toEqual([]);
    const both = validateConfig({
      ...valid,
      preferences: { garden_or_balcony: true, amenities: ["bathtub"], ground_floor: true },
    });
    expect(both.preferences.amenities).toEqual(["bathtub"]);
    expect(validateConfig({ ...valid, preferences: { ground_floor: true } }).preferences.amenities).toEqual([]);
  });

  test("rejects unknown or malformed amenities", () => {
    const prefs = (amenities: unknown) => () =>
      validateConfig({ ...valid, preferences: { amenities, ground_floor: true } });
    expect(prefs(["garden", "pool"])).toThrow(/preferences.amenities\[1\] must be one of garden, balcony, bathtub/);
    expect(prefs("garden")).toThrow(/preferences.amenities must be an array/);
  });

  test("reads requirements and defaults them to off", () => {
    expect(validateConfig(valid).requirements).toEqual({ ground_floor_or_balcony: false });
    const cfg = validateConfig({ ...valid, requirements: { ground_floor_or_balcony: true } });
    expect(cfg.requirements).toEqual({ ground_floor_or_balcony: true });
    expect(() => validateConfig({ ...valid, requirements: { ground_floor_or_balcony: "yes" } })).toThrow(
      /requirements.ground_floor_or_balcony must be a boolean/,
    );
  });

  test("accepts fractional room counts", () => {
    expect(validateConfig({ ...valid, rooms: { min: 2.5, ideal: 3 } }).rooms.min).toBe(2.5);
  });

  test("rejects non-objects", () => {
    expect(() => validateConfig(null)).toThrow(/config/);
    expect(() => validateConfig([])).toThrow(/config/);
  });

  test("collects all problems in one error", () => {
    const bad = {
      ...valid,
      budget: { warm_max: -1, nebenkosten_estimate_per_sqm: "x" },
      rooms: { min: 3, ideal: 2 },
      portals: ["immoscout24", "ebay"],
    };
    let message = "";
    try {
      validateConfig(bad);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("budget.warm_max");
    expect(message).toContain("budget.nebenkosten_estimate_per_sqm");
    expect(message).toContain("rooms.ideal");
    expect(message).toContain("portals[1]");
  });

  test("rejects empty locations and blank city names", () => {
    expect(() => validateConfig({ ...valid, locations: [] })).toThrow(/locations/);
    expect(() => validateConfig({ ...valid, locations: [{ city: " ", radius_km: 0 }] })).toThrow(
      /locations\[0\]\.city/,
    );
  });

  test("rejects non-boolean preferences and bad district lists", () => {
    const bad = {
      ...valid,
      preferences: { garden_or_balcony: "yes", ground_floor: true },
      locations: [{ city: "Idstein", radius_km: 0, preferred_districts: [1] }],
    };
    expect(() => validateConfig(bad)).toThrow(/preferences.garden_or_balcony/);
    expect(() => validateConfig(bad)).toThrow(/preferred_districts/);
  });
});

describe("loadConfig", () => {
  test("loads the repository config", async () => {
    const cfg = await loadConfig();
    expect(cfg.locations.length).toBeGreaterThan(0);
    expect(cfg.rooms.min).toBeGreaterThanOrEqual(1);
  });

  test("fails with a clear message for a missing file", async () => {
    await expect(loadConfig("/nonexistent/search.json")).rejects.toThrow(/cannot read config/);
  });
});

describe("repoRoot", () => {
  test("strips the scraper directory on POSIX and Windows paths", () => {
    expect(repoRoot("/home/a/wohnung/scraper")).toBe("/home/a/wohnung");
    expect(repoRoot("C:\\Users\\a\\wohnung\\scraper")).toBe("C:\\Users\\a\\wohnung");
  });

  test("leaves other directories alone", () => {
    expect(repoRoot("/home/a/scraper-tools")).toBe("/home/a/scraper-tools");
  });
});

describe("district lists and files", () => {
  const ffm = (over: object = {}) => ({ ...valid, locations: [{ city: "Frankfurt am Main", radius_km: 0, ...over }] });
  const file = {
    city: "Frankfurt am Main",
    districts: [{ name: "Gallus", aliases: ["Gallusviertel"] }, { name: "Bornheim" }, { name: "Höchst" }],
  };
  const files = new Map([["Frankfurt am Main", file]]);

  test("reads allowed/excluded/preferred lists and defaults them to []", () => {
    const loc = validateConfig(ffm({ allowed_districts: ["Bornheim"], excluded_districts: [" Höchst "] })).locations[0];
    expect([loc?.allowed_districts, loc?.excluded_districts, loc?.preferred_districts, loc?.districts]).toEqual([
      ["Bornheim"],
      ["Höchst"],
      [],
      [],
    ]);
  });

  test("reports list and location limits of the app", () => {
    const long = "x".repeat(201);
    const many = Array.from({ length: 201 }, (_, i) => `D${i}`);
    expect(() => validateConfig(ffm({ excluded_districts: many, preferred_districts: [long] }))).toThrow(
      /excluded_districts must have at most 200 entries\n- locations\[0\]\.preferred_districts: "x{40}…" is longer than 200 characters/,
    );
    const cities = Array.from({ length: 51 }, (_, i) => ({ city: `Stadt ${i}`, radius_km: 0 }));
    expect(() => validateConfig({ ...valid, locations: cities })).toThrow(/locations must have at most 50 entries/);
  });

  test("rejects malformed lists", () => {
    expect(() => validateConfig(ffm({ allowed_districts: "Bornheim", excluded_districts: [""] }))).toThrow(
      /locations\[0\]\.allowed_districts must be an array of strings\n- locations\[0\]\.excluded_districts must be an array of strings/,
    );
  });

  test("attaches the city's districts file and accepts names and aliases from it", () => {
    const loc = validateConfig(ffm({ excluded_districts: ["Gallusviertel"], preferred_districts: ["Bornheim"] }), files)
      .locations[0];
    expect(loc?.districts.map((d) => d.name)).toEqual(["Gallus", "Bornheim", "Höchst"]);
  });

  test("with a districts file, every listed district must be in it", () => {
    expect(() => validateConfig(ffm({ allowed_districts: ["Bornheim", "Atlantis"] }), files)).toThrow(
      /locations\[0\]\.allowed_districts: "Atlantis" is not in config\/districts\/frankfurt-am-main\.json/,
    );
  });

  test("reports invalid or unreadable districts files together with other problems", () => {
    const bad = new Map<string, unknown>([["Frankfurt am Main", { city: "Frankfurt", districts: [] }]]);
    let message = "";
    try {
      validateConfig({ ...ffm(), portals: ["ebay"] }, bad);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('config/districts/frankfurt-am-main.json.city must be "Frankfurt am Main"');
    expect(message).toContain("portals[0]");
    const broken = new Map([["Frankfurt am Main", new Error("is not valid JSON")]]);
    expect(() => validateConfig(ffm(), broken)).toThrow(/frankfurt-am-main\.json: is not valid JSON/);
  });
});

describe("loadConfig with districts and the app's selection", () => {
  const setup = async (): Promise<string> => {
    const dir = mkdtempSync(join(tmpdir(), "wohnung-config-"));
    const location = { city: "Frankfurt am Main", radius_km: 0, excluded_districts: ["Höchst"] };
    await Bun.write(join(dir, "config", "search.json"), JSON.stringify({ ...valid, locations: [location] }));
    await Bun.write(
      join(dir, "config", "districts", "frankfurt-am-main.json"),
      JSON.stringify({ city: "Frankfurt am Main", districts: [{ name: "Höchst" }, { name: "Bornheim" }] }),
    );
    return dir;
  };

  test("loads config/districts/<slug>.json next to the config", async () => {
    const dir = await setup();
    try {
      const cfg = await loadConfig(join(dir, "config", "search.json"));
      expect(cfg.locations[0]?.districts.map((d) => d.name)).toEqual(["Höchst", "Bornheim"]);
      expect(cfg.locations[0]?.excluded_districts).toEqual(["Höchst"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("data/district-selection.json overrides the city's lists unless disabled", async () => {
    const dir = await setup();
    try {
      const selection = { cities: [{ city: "Frankfurt am Main", allowed_districts: ["Bornheim"], excluded_districts: [], preferred_districts: [] }] };
      await Bun.write(join(dir, "data", "district-selection.json"), JSON.stringify(selection));
      const path = join(dir, "config", "search.json");
      const cfg = await loadConfig(path);
      expect([cfg.locations[0]?.allowed_districts, cfg.locations[0]?.excluded_districts]).toEqual([["Bornheim"], []]);
      const configOnly = await loadConfig(path, { selectionPath: null });
      expect(configOnly.locations[0]?.excluded_districts).toEqual(["Höchst"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("selectionNote", () => {
  const sel = (city: string) => ({ city, allowed_districts: [], excluded_districts: [], preferred_districts: [] });

  test("names the configured cities that use the app's selection", () => {
    expect(selectionNote([sel("Frankfurt am Main"), sel("Mainz")], ["Frankfurt am Main", "Idstein"])).toBe(
      "Stadtteil-Auswahl aus der App: Frankfurt am Main",
    );
    expect(selectionNote([sel("Mainz")])).toBe("Stadtteil-Auswahl aus der App: Mainz");
  });

  test("says when config/search.json applies", () => {
    expect(selectionNote(null)).toBe("Stadtteil-Auswahl aus config/search.json (keine App-Auswahl gespeichert)");
    expect(selectionNote([sel("Mainz")], ["Idstein"])).toContain("config/search.json");
  });
});
