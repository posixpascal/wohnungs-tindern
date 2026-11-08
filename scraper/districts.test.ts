import { describe, expect, test } from "bun:test";
import {
  applySelection,
  canonicalDistrict,
  citySlug,
  districtInText,
  districtReason,
  preferredDistrict,
  validateDistrictFile,
  validateSelection,
} from "./districts";
import type { DistrictInfo, Location } from "./types";

const info = (name: string, aliases: string[] = []): DistrictInfo => ({ name, aliases, summary: null, highlights: {} });

const frankfurt = (over: Partial<Location> = {}): Location => ({
  city: "Frankfurt am Main",
  radius_km: 0,
  preferred_districts: [],
  allowed_districts: [],
  excluded_districts: [],
  districts: [info("Gallus", ["Gallusviertel"]), info("Nordend-West"), info("Nordend-Ost"), info("Bornheim")],
  ...over,
});

const listing = (district: string | null, city = "Frankfurt am Main") => ({ city, district });

describe("citySlug", () => {
  test("lowercase-kebab with umlauts spelled out", () => {
    expect(citySlug("Frankfurt am Main")).toBe("frankfurt-am-main");
    expect(citySlug("Bad Homburg vor der Höhe")).toBe("bad-homburg-vor-der-hoehe");
    expect(citySlug("Neu-Isenburg")).toBe("neu-isenburg");
    expect(citySlug("Gießen")).toBe("giessen");
  });
});

describe("validateDistrictFile", () => {
  const file = {
    city: "Frankfurt am Main",
    districts: [
      {
        name: " Bornheim ",
        aliases: ["Bornheim-Mitte"],
        summary: "Lebendig, Altbau",
        highlights: { shopping: "Berger Straße", transit: "U4, U7", cinema: "Kino im Viertel", pool: "Panoramabad", sights: "Uhrtürmchen" },
      },
      { name: "Gallus" },
    ],
  };

  test("accepts a valid file, trims names and defaults optional fields", () => {
    const { districts, problems } = validateDistrictFile(file, "Frankfurt am Main", "f.json");
    expect(problems).toEqual([]);
    expect(districts).toEqual([
      {
        name: "Bornheim",
        aliases: ["Bornheim-Mitte"],
        summary: "Lebendig, Altbau",
        highlights: { shopping: "Berger Straße", transit: "U4, U7", cinema: "Kino im Viertel", pool: "Panoramabad", sights: "Uhrtürmchen" },
      },
      { name: "Gallus", aliases: [], summary: null, highlights: {} },
    ]);
  });

  test("lists every problem", () => {
    const bad = {
      city: "Frankfurt",
      districts: [
        { name: "", aliases: "x" },
        { name: "Bornheim", highlights: { nightlife: "Bars", culture: 1 }, summary: "x".repeat(201) },
        { name: "Nordend", aliases: ["bornheim"] },
      ],
    };
    const { problems } = validateDistrictFile(bad, "Frankfurt am Main", "f.json");
    expect(problems).toEqual([
      'f.json.city must be "Frankfurt am Main"',
      "f.json.districts[0].name must be a non-empty string",
      "f.json.districts[0].aliases must be an array of strings",
      "f.json.districts[1].summary must be a string of at most 200 characters",
      "f.json.districts[1].highlights.nightlife is unknown (allowed: shopping, culture, leisure, transit, cinema, pool, sights)",
      "f.json.districts[1].highlights.culture must be a string of at most 300 characters",
    ]);
  });

  test("reports the app's size limits", () => {
    const many = { city: "X", districts: Array.from({ length: 201 }, (_, i) => ({ name: `D${i}` })) };
    expect(validateDistrictFile(many, "X", "x.json").problems).toEqual(["x.json.districts must have at most 200 entries"]);
    const big = {
      city: "X",
      districts: [{ name: "n".repeat(201), aliases: Array.from({ length: 31 }, (_, i) => `A${i}`) }],
    };
    expect(validateDistrictFile(big, "X", "x.json").problems).toEqual([
      "x.json.districts[0].name must be at most 200 characters",
      "x.json.districts[0].aliases must have at most 30 entries",
    ]);
  });

  test("rejects a spelling shared by two districts and empty files", () => {
    const clash = { city: "X", districts: [{ name: "A", aliases: ["B"] }, { name: "B" }] };
    expect(validateDistrictFile(clash, "X", "x.json").problems).toEqual(['x.json: "b" is used by more than one district']);
    expect(validateDistrictFile({ city: "X", districts: [] }, "X", "x.json").problems).toEqual([
      "x.json.districts must be a non-empty array",
    ]);
    expect(validateDistrictFile([], "X", "x.json").problems).toEqual(["x.json must be a JSON object"]);
  });
});

describe("canonicalDistrict / districtInText", () => {
  test("maps aliases and contained spellings to the canonical name", () => {
    const loc = frankfurt();
    expect(canonicalDistrict("Gallusviertel", loc)).toBe("Gallus");
    expect(canonicalDistrict("gallus", loc)).toBe("Gallus");
    expect(canonicalDistrict("Frankfurt am Main Gallusviertel", loc)).toBe("Gallus");
    expect(canonicalDistrict("Nordend-West", loc)).toBe("Nordend-West");
    expect(canonicalDistrict("Seckbach", loc)).toBe("Seckbach");
  });

  test("works with the district lists alone (no metadata)", () => {
    const loc = frankfurt({ districts: [], preferred_districts: ["Nordend"] });
    expect(canonicalDistrict("Nordend-West", loc)).toBe("Nordend");
  });

  test("finds the longest known district in a text, ignoring longer words", () => {
    const loc = frankfurt();
    expect(districtInText("Schöne Wohnung im Nordend-Ost, Nähe Bornheim", loc)).toBe("Nordend-Ost");
    expect(districtInText("Bornheimer Landstraße 5", loc)).toBeNull();
    expect(districtInText("", loc)).toBeNull();
  });

  test("a spelling that is just the city name loses to any named district", () => {
    const loc = frankfurt({
      city: "Bad Camberg",
      districts: [info("Kernstadt", ["Bad Camberg", "Camberg", "Bad Camberg (Taunus)"]), info("Erbach", ["Bad Camberg-Erbach"])],
    });
    expect(districtInText("65520 Bad Camberg, Erbach", loc)).toBe("Erbach");
    expect(districtInText("Bad Camberg (Taunus), Erbach", loc)).toBe("Erbach");
    expect(districtInText("65520 Bad Camberg", loc)).toBe("Kernstadt");
    expect(canonicalDistrict("Bad Camberg Erbach", loc)).toBe("Erbach");
    const hofheim = frankfurt({ city: "Hofheim am Taunus", districts: [info("Kernstadt", ["Hofheim"]), info("Wallau")] });
    expect(districtInText("65719 Hofheim, Wallau", hofheim)).toBe("Wallau");
    expect(districtInText("Hofheim, Hauptstraße", hofheim)).toBe("Kernstadt");
  });
});

describe("districtReason", () => {
  test("no lists: everything passes", () => {
    expect(districtReason(listing("Gallus"), [frankfurt()])).toBeNull();
    expect(districtReason(listing(null), [frankfurt()])).toBeNull();
  });

  test("excluded districts are rejected via any spelling", () => {
    const locs = [frankfurt({ excluded_districts: ["Gallus"] })];
    expect(districtReason(listing("Gallusviertel"), locs)).toBe("Stadtteil ausgeschlossen (Gallusviertel)");
    expect(districtReason(listing("Bornheim"), locs)).toBeNull();
    expect(districtReason(listing(null), locs)).toBeNull();
  });

  test("a whitelist allows its districts and the preferred ones, rejects others and unknown", () => {
    const locs = [frankfurt({ allowed_districts: ["Bornheim"], preferred_districts: ["Nordend-West"] })];
    expect(districtReason(listing("Bornheim"), locs)).toBeNull();
    expect(districtReason(listing("Nordend-West"), locs)).toBeNull();
    expect(districtReason(listing("Gallus"), locs)).toBe("Stadtteil nicht im Suchgebiet (Gallus)");
    expect(districtReason(listing(null), locs)).toBe("Stadtteil unbekannt");
    expect(districtReason(listing(null), locs, true)).toBeNull();
  });

  test("preferred districts alone do not restrict; other cities are unaffected", () => {
    expect(districtReason(listing("Gallus"), [frankfurt({ preferred_districts: ["Bornheim"] })])).toBeNull();
    expect(districtReason(listing(null, "Idstein"), [frankfurt({ allowed_districts: ["Bornheim"] })])).toBeNull();
  });
});

describe("preferredDistrict", () => {
  test("matches via canonical names", () => {
    const locs = [frankfurt({ preferred_districts: ["Gallusviertel"] })];
    expect(preferredDistrict(listing("Gallus"), locs)).toBe("Gallus");
    expect(preferredDistrict(listing("Bornheim"), locs)).toBeNull();
    expect(preferredDistrict(listing(null), locs)).toBeNull();
  });
});

describe("selection", () => {
  test("validates the app's selection", () => {
    expect(validateSelection({ cities: [{ city: "Frankfurt am Main", allowed_districts: [" Bornheim "], updated_at: "x" }] })).toEqual([
      { city: "Frankfurt am Main", allowed_districts: ["Bornheim"], excluded_districts: [], preferred_districts: [] },
    ]);
    expect(() => validateSelection({ cities: [{ city: "" }, { city: "X", excluded_districts: "Gallus" }] })).toThrow(
      /cities\[0\]\.city must be a non-empty string\n- cities\[1\]\.excluded_districts must be an array of strings/,
    );
    expect(() => validateSelection([])).toThrow(/cities array/);
  });

  test("the app's selection replaces a city's lists; other cities keep the config", () => {
    const idstein = { ...frankfurt({ preferred_districts: ["Wörsdorf"] }), city: "Idstein", districts: [] };
    const [ffm, ids] = applySelection(
      [frankfurt({ preferred_districts: ["Bornheim"], excluded_districts: ["Gallus"] }), idstein],
      [{ city: "Frankfurt am Main", allowed_districts: ["Bornheim"], excluded_districts: [], preferred_districts: [] }],
    );
    expect([ffm?.allowed_districts, ffm?.excluded_districts, ffm?.preferred_districts]).toEqual([["Bornheim"], [], []]);
    expect(ffm?.districts).toEqual(frankfurt().districts);
    expect(ids).toBe(idstein);
  });
});
