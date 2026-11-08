import { describe, expect, test } from "bun:test";
import { validateConfig } from "./config";
import { criteriaReason, normalize, resolveCity } from "./normalize";
import type { Listing, RawRecord } from "./types";

const config = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  area_sqm: { min: 50 },
  preferences: { garden_or_balcony: true, ground_floor: true },
  locations: [
    { city: "Frankfurt am Main", radius_km: 0 },
    { city: "Neu-Isenburg", radius_km: 0 },
    { city: "Hofheim am Taunus", radius_km: 0 },
    { city: "Idstein", radius_km: 0 },
    { city: "Wiesbaden", radius_km: 0, preferred_districts: ["Igstadt", "Nordenstadt"] },
  ],
  portals: ["immoscout24", "immowelt", "kleinanzeigen", "wg-gesucht"],
});

const NOW = "2026-10-14T10:00:00.000Z";

const raw = (over: Partial<RawRecord> = {}): RawRecord => ({
  portal: "kleinanzeigen",
  portal_id: "1",
  url: "https://www.kleinanzeigen.de/s-anzeige/x/1-203-4808",
  title: "Schöne 3-Zimmer-Wohnung",
  location: "65510 Idstein",
  features: [],
  images: [],
  ...over,
});

const ok = (r: RawRecord): Listing => {
  const res = normalize(r, config, NOW);
  if ("reason" in res) throw new Error(`unexpected filter: ${res.reason}`);
  return res.listing;
};

describe("resolveCity", () => {
  test.each([
    ["65510 Hessen - Idstein", "Idstein"],
    ["Annabergstraße 67, Zeilsheim, Frankfurt am Main (65931)", "Frankfurt am Main"],
    ["Frankfurt Sachsenhausen", "Frankfurt am Main"],
    ["Frankfurter Straße 5, Neu-Isenburg", "Neu-Isenburg"],
    ["Hofheim, Main-Taunus-Kreis", "Hofheim am Taunus"],
    ["Nordenstadt, Wiesbaden (65205)", "Wiesbaden"],
  ] as const)("%p -> %p", (text, city) => {
    expect(resolveCity([text], config)?.city).toBe(city);
  });

  test("prefers the explicit city field", () => {
    expect(resolveCity(["Idstein", "Wiesbaden Straße"], config)?.city).toBe("Idstein");
  });

  test("ignores same-named towns with another qualifier", () => {
    expect(resolveCity(["15230 Frankfurt (Oder)"], config)).toBeNull();
    expect(resolveCity(["Hofheim in Unterfranken"], config)).toBeNull();
    expect(resolveCity(["Frankfurt (60316)"], config)?.city).toBe("Frankfurt am Main");
  });

  test("returns null outside the search area", () => {
    expect(resolveCity(["65232 Taunusstein"], config)).toBeNull();
    expect(resolveCity([], config)).toBeNull();
  });
});

describe("normalize", () => {
  test("builds id, url and basic fields", () => {
    const l = ok(raw({ rent_warm: "970 €", rooms: "3", area: "78 m²", images: ["https://img/a.jpg"] }));
    expect(l.id).toBe("kleinanzeigen:1");
    expect(l.city).toBe("Idstein");
    expect(l.rent_warm).toBe(970);
    expect(l.rent_warm_estimated).toBe(0);
    expect(l.rooms).toBe(3);
    expect(l.area_sqm).toBe(78);
    expect(l.images).toEqual(["https://img/a.jpg"]);
    expect(l.status).toBe("active");
    expect(l.first_seen_at).toBe(NOW);
    expect(l.last_seen_at).toBe(NOW);
    expect(l.synced_at).toBeNull();
  });

  test("kalt + Nebenkosten -> estimated warm", () => {
    const l = ok(raw({ rent_cold: 690, nebenkosten: "280 €", area: 78 }));
    expect(l.rent_warm).toBe(970);
    expect(l.rent_warm_estimated).toBe(1);
  });

  test("kalt + Nebenkosten + Heizkosten -> exact warm", () => {
    const l = ok(raw({ rent_cold: "759,20 €", nebenkosten: "124 €", heizkosten: "153 €" }));
    expect(l.rent_warm).toBe(1036.2);
    expect(l.rent_warm_estimated).toBe(0);
  });

  test("Heizkosten text like 'in Nebenkosten enthalten' is ignored", () => {
    const l = ok(raw({ rent_cold: 850, nebenkosten: "+ 250 €", heizkosten: "in Nebenkosten enthalten" }));
    expect(l.rent_warm).toBe(1100);
  });

  test("kalt + area -> estimated with per-sqm Nebenkosten", () => {
    const l = ok(raw({ rent_cold: 800, area: 70 }));
    expect(l.rent_warm).toBe(1010);
    expect(l.rent_warm_estimated).toBe(1);
  });

  test("kalt only -> kalt + 150 buffer, estimated", () => {
    const l = ok(raw({ rent_cold: 900 }));
    expect(l.rent_warm).toBe(1050);
    expect(l.rent_warm_estimated).toBe(1);
  });

  test("Nebenkosten and Warmmiete are read from the description as fallback", () => {
    const l = ok(raw({ rent_cold: 690, description: "Kaltmiete: 690 Euro\nNebenkosten: 280 Euro" }));
    expect(l.rent_warm).toBe(970);
    const w = ok(raw({ rent_cold: 690, description: "Die Warmmiete beträgt 900 €." }));
    expect(w.rent_warm).toBe(900);
    expect(w.rent_warm_estimated).toBe(0);
  });

  test("explicit Kaltmiete/Warmmiete lines win over a single card price used for both fields", () => {
    const description = "Mietkosten:\nKaltmiete: 845 €\nNebenkosten: 250 €\nWarmmiete: 1.095 €";
    const l = ok(raw({ rent_cold: "1.095 €", rent_warm: "1.095 €", nebenkosten: "250 €", description }));
    expect(l.rent_cold).toBe(845);
    expect(l.rent_warm).toBe(1095);
    expect(l.rent_warm_estimated).toBe(0);
  });

  test("a separate card Kaltmiete is not overridden by the description", () => {
    const l = ok(raw({ rent_cold: 700, rent_warm: 950, description: "Kaltmiete: 650 €" }));
    expect(l.rent_cold).toBe(700);
    expect(l.rent_warm).toBe(950);
  });

  test("an IS24 warm rent equal to the cold rent is treated as unknown and estimated", () => {
    const is24 = { portal: "immoscout24" as const, portal_id: "172010366", url: "https://www.immobilienscout24.de/expose/172010366" };
    const l = ok(raw({ ...is24, rent_cold: 850, rent_warm: "850 € (zzgl. Nebenkosten)", area: 60 }));
    expect(l.rent_cold).toBe(850);
    expect(l.rent_warm).toBe(1030);
    expect(l.rent_warm_estimated).toBe(1);
    expect(ok(raw({ ...is24, rent_cold: 850, rent_warm: 850 })).rent_warm_estimated).toBe(1);
  });

  test("equal cold and warm rents stay actual with inclusive wording or a labelled Warmmiete", () => {
    const is24 = { portal: "immoscout24" as const };
    const inkl = ok(raw({ ...is24, rent_cold: 900, rent_warm: 900, description: "Miete inkl. Nebenkosten" }));
    expect([inkl.rent_warm, inkl.rent_warm_estimated]).toEqual([900, 0]);
    const text = ok(raw({ ...is24, rent_cold: 900, rent_warm: 900, description: "Warmmiete: 900 €" }));
    expect([text.rent_warm, text.rent_warm_estimated]).toEqual([900, 0]);
    // Kleinanzeigen/immowelt/WG-Gesucht take rent_warm from a field the advertiser labelled "Warmmiete"/Gesamtmiete
    const ka = ok(raw({ rent_cold: "1.095 €", rent_warm: "1.095 €", nebenkosten: "250 €" }));
    expect([ka.rent_warm, ka.rent_warm_estimated]).toEqual([1095, 0]);
  });

  test("description amounts far off the single card price are ignored", () => {
    const stellplatz = ok(raw({ rent_cold: 1100, rent_warm: 1100, description: "Kaltmiete für den Stellplatz: 120 €" }));
    expect([stellplatz.rent_cold, stellplatz.rent_warm]).toEqual([1100, 1100]);
  });

  test("unrelated Warmmiete/inkl. wording in the description does not confirm an IS24 copy", () => {
    const is24 = { portal: "immoscout24" as const, rent_cold: 900, rent_warm: 900, area: 60 };
    expect(ok(raw({ ...is24, description: "Warmmiete auf Anfrage." })).rent_warm_estimated).toBe(1);
    expect(ok(raw({ ...is24, description: "Stellplatz inkl. Nebenkosten 60 €" })).rent_warm_estimated).toBe(1);
  });

  test("warm-only listings keep their warm rent", () => {
    const l = ok(raw({ portal: "immoscout24", rent_warm: 900 }));
    expect([l.rent_cold, l.rent_warm, l.rent_warm_estimated]).toEqual([null, 900, 0]);
  });

  test("placeholder rents are ignored", () => {
    expect(ok(raw({ rent_warm: "0 €" })).rent_warm).toBeNull();
    expect(ok(raw({ rent_cold: "1 €", rent_warm: undefined })).rent_warm).toBeNull();
  });

  test("floor from value, then features, then title/description", () => {
    expect(ok(raw({ features: ["4 Etagen"] })).floor).toBeNull();
    expect(ok(raw({ description: "Fahrradkeller im Erdgeschoss" })).floor).toBeNull();
    expect(ok(raw({ floor: "Geschoss EG/2" })).floor).toBe(0);
    expect(ok(raw({ features: ["Erdgeschosswohnung"] })).floor).toBe(0);
    expect(ok(raw({ description: "gemütliche Souterrainwohnung" })).floor).toBe(-1);
    expect(ok(raw({})).floor).toBeNull();
  });

  test("garden/balcony: explicit booleans win, then text detection, else unknown", () => {
    expect(ok(raw({ has_garden: false, description: "Garten" })).has_garden).toBe(0);
    expect(ok(raw({ features: ["Garten/-mitnutzung", "Terrasse"] })).has_garden).toBe(1);
    expect(ok(raw({ features: ["Terrasse"] })).has_balcony).toBe(1);
    expect(ok(raw({ title: "3 Zimmer Küche Bad Balkon" })).has_balcony).toBe(1);
    expect(ok(raw({})).has_garden).toBeNull();
  });

  test("bathtub: detected from title, features and description, else unknown", () => {
    expect(ok(raw({ features: ["Badewanne"] })).has_bathtub).toBe(1);
    expect(ok(raw({ title: "3 ZKB, Bad mit Wanne" })).has_bathtub).toBe(1);
    expect(ok(raw({ description: "Bad mit ebenerdiger Dusche statt Wanne" })).has_bathtub).toBeNull();
    expect(ok(raw({})).has_bathtub).toBeNull();
  });

  test("district: explicit, preferred district in text, or segment before city", () => {
    expect(ok(raw({ district: "Bornheim", location: "Frankfurt am Main" })).district).toBe("Bornheim");
    expect(ok(raw({ location: "Am Hang 3, Igstadt, Wiesbaden" })).district).toBe("Igstadt");
    expect(ok(raw({ location: "Annabergstraße 67, Zeilsheim, Frankfurt am Main (65931)" })).district).toBe(
      "Zeilsheim",
    );
    expect(ok(raw({ location: "Frankfurt am Main Griesheim, Am Wingertsgrund" })).district).toBe("Griesheim");
    expect(ok(raw({ location: "65510 Idstein" })).district).toBeNull();
    expect(ok(raw({ location: "Frankfurt-Höchst" })).district).toBe("Höchst");
    expect(ok(raw({ location: "Frankfurt am Main (Bornheim)" })).district).toBe("Bornheim");
  });

  test("rooms fall back to the title", () => {
    expect(ok(raw({ title: "Helle 2,5-Zimmer-Wohnung" })).rooms).toBe(2.5);
    expect(ok(raw({ title: "3 ZKB mit Balkon" })).rooms).toBe(3);
  });

  test("truncates long text and caps images", () => {
    const images = Array.from({ length: 40 }, (_, i) => `https://img/${i}.jpg`);
    const l = ok(raw({ title: "x".repeat(500), description: "y".repeat(20000), images }));
    expect(l.title.length).toBeLessThanOrEqual(200);
    expect(l.description!.length).toBeLessThanOrEqual(8000);
    expect(l.images.length).toBe(30);
  });

  test("filters listings outside the configured cities", () => {
    expect(normalize(raw({ location: "65232 Taunusstein" }), config, NOW)).toEqual({
      reason: "Ort nicht im Suchgebiet",
    });
  });

  test("filters exclusion keywords incl. features, but not 'Kein Tausch'", () => {
    expect(normalize(raw({ title: "TAUSCHWOHNUNG 3 Zi" }), config, NOW)).toEqual({ reason: "Tauschwohnung" });
    expect(normalize(raw({ features: ["Wohnung zur Miete · Tauschwohnung"] }), config, NOW)).toEqual({
      reason: "Tauschwohnung",
    });
    expect("listing" in normalize(raw({ features: ["Kein Tausch"] }), config, NOW)).toBe(true);
  });

  test("filters short fixed-term rentals", () => {
    const res = normalize(raw({ available_from: "01.11.2026", available_to: "31.03.2027" }), config, NOW);
    expect(res).toEqual({ reason: "Zeitwohnen" });
  });

  test("does not mutate the raw record", () => {
    const r = raw({ features: ["Balkon"], images: ["https://img/a.jpg"] });
    const snapshot = structuredClone(r);
    normalize(r, config, NOW);
    expect(r).toEqual(snapshot);
  });
});

describe("criteriaReason", () => {
  test("passes a matching listing", () => {
    expect(criteriaReason(ok(raw({ rent_warm: 1100, rooms: 3, area: 70 })), config)).toBeNull();
  });

  test("rejects too expensive, too few rooms, too small, or no rent", () => {
    expect(criteriaReason(ok(raw({ rent_warm: 1250, rooms: 3 })), config)).toBe("Warmmiete > 1200 €");
    expect(criteriaReason(ok(raw({ rent_warm: 900, rooms: 1, title: "Loft" })), config)).toBe("weniger als 2 Zimmer");
    expect(criteriaReason(ok(raw({ rent_warm: 900, rooms: 2, area: 44 })), config)).toBe("kleiner als 50 m²");
    expect(criteriaReason(ok(raw({})), config)).toBe("Miete unbekannt");
  });

  test("kalt-only listings must leave 150 € headroom", () => {
    expect(criteriaReason(ok(raw({ rent_cold: 1050, rooms: 3 })), config)).toBeNull();
    expect(criteriaReason(ok(raw({ rent_cold: 1100, rooms: 3 })), config)).toBe("Warmmiete > 1200 €");
  });

  describe("ground_floor_or_balcony", () => {
    const strict = { ...config, requirements: { ground_floor_or_balcony: true } };
    const base = { rent_warm: 900, rooms: 3, area: 70 };
    const reason = "kein EG, Balkon oder Garten";
    const check = (over: Partial<RawRecord>) => criteriaReason(ok(raw({ ...base, ...over })), strict);

    test("passes EG, a confirmed balcony/terrace, or a garden at ground level", () => {
      expect(check({ floor: "EG" })).toBeNull();
      expect(check({ floor: "2", has_balcony: true })).toBeNull();
      expect(check({ floor: "3", features: ["Terrasse"] })).toBeNull();
      expect(check({ has_balcony: true })).toBeNull();
      expect(check({ floor: "Souterrain", has_garden: true })).toBeNull();
      expect(check({ has_garden: true })).toBeNull();
    });

    test("rejects anything without confirmed outdoor space", () => {
      expect(check({ floor: "2", has_balcony: false })).toBe(reason);
      expect(check({ floor: "2" })).toBe(reason);
      expect(check({})).toBe(reason);
      expect(check({ floor: "Souterrain" })).toBe(reason);
      expect(check({ floor: "3", has_garden: true })).toBe(reason);
    });

    test("is off by default", () => {
      expect(criteriaReason(ok(raw({ ...base, floor: "2", has_balcony: false })), config)).toBeNull();
    });
  });

  test("rejects implausible room counts and rents per m²", () => {
    expect(criteriaReason(ok(raw({ rent_warm: 630, rooms: 15, area: 66 })), config)).toBe("Zimmerzahl unplausibel (> 8)");
    expect(criteriaReason(ok(raw({ rent_warm: 180, rooms: 3, area: 120 })), config)).toBe(
      "Warmmiete unplausibel (< 5 €/m²)",
    );
    expect(criteriaReason(ok(raw({ rent_warm: 600, rooms: 8, area: 120 })), config)).toBeNull();
    expect(criteriaReason(ok(raw({ rent_warm: 180, rooms: 3 })), config)).toBeNull();
  });

  test("unknown rooms or area are not rejected", () => {
    expect(criteriaReason(ok(raw({ rent_warm: 900, title: "Wohnung" })), config)).toBeNull();
  });
});

describe("districts", () => {
  const withDistricts = (lists: object = {}) =>
    validateConfig(
      {
        budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
        rooms: { min: 2, ideal: 3 },
        area_sqm: { min: 50 },
        preferences: { amenities: [], ground_floor: false },
        locations: [{ city: "Frankfurt am Main", radius_km: 0, ...lists }],
        portals: ["kleinanzeigen"],
      },
      new Map([
        [
          "Frankfurt am Main",
          {
            city: "Frankfurt am Main",
            districts: [
              { name: "Gallus", aliases: ["Gallusviertel"] },
              { name: "Nordend-West" },
              { name: "Bornheim" },
              { name: "Höchst" },
              { name: "Nied" },
              { name: "Dornbusch" },
            ],
          },
        ],
      ]),
    );
  const ffm = (over: Partial<RawRecord>, cfg = withDistricts()): Listing => {
    const res = normalize(raw({ location: "Frankfurt am Main", ...over }), cfg, NOW);
    if ("reason" in res) throw new Error(res.reason);
    return res.listing;
  };

  test("Kleinanzeigen's 'PLZ Stadtteil' location yields the district, the city itself does not", () => {
    expect(ok(raw({ city: "Frankfurt am Main", location: "60316 Nordend" })).district).toBe("Nordend");
    expect(ok(raw({ city: "Frankfurt am Main", location: "60329 Frankfurt am Main" })).district).toBeNull();
    expect(ok(raw({ location: "65510 Idstein" })).district).toBeNull();
  });

  test("every portal spelling is stored under the canonical name from config/districts", () => {
    expect(ffm({ district: "Gallusviertel" }).district).toBe("Gallus");
    expect(ffm({ location: "Knorrstraße, Gallus, Frankfurt am Main (60326)" }).district).toBe("Gallus");
    expect(ffm({ location: "Frankfurt am Main Gallusviertel, Schönstrasse 20" }).district).toBe("Gallus");
    expect(ffm({ city: "Frankfurt am Main", location: "60486 Gallus" }).district).toBe("Gallus");
    expect(ffm({ location: "Seckbach, Frankfurt am Main (60388)" }).district).toBe("Seckbach");
  });

  test("the location wins over a district only mentioned in the title", () => {
    expect(ffm({ title: "3 Zimmer, Nähe Bornheim", location: "Seckbach, Frankfurt am Main (60388)" }).district).toBe(
      "Seckbach",
    );
    expect(ffm({ title: "3 Zimmer in Bornheim", location: "Frankfurt am Main" }).district).toBe("Bornheim");
    // real titles whose location field carried no district
    expect(ffm({ title: "3 Zimmerwohnung in Nied", location: "Frankfurt am Main" }).district).toBe("Nied");
    expect(ffm({ title: "Wohnung in bester Lage von Frankfurt (Dornbusch)", location: "Frankfurt am Main" }).district).toBe(
      "Dornbusch",
    );
  });

  test("criteriaReason applies excluded districts and whitelists", () => {
    const base = { rent_warm: 1000, rooms: 3, area: 70 };
    const excluded = withDistricts({ excluded_districts: ["Höchst"] });
    expect(criteriaReason(ffm({ ...base, district: "Höchst" }, excluded), excluded)).toBe("Stadtteil ausgeschlossen (Höchst)");
    const whitelist = withDistricts({ allowed_districts: ["Bornheim"], preferred_districts: ["Gallus"] });
    expect(criteriaReason(ffm({ ...base, district: "Bornheim" }, whitelist), whitelist)).toBeNull();
    expect(criteriaReason(ffm({ ...base, district: "Gallusviertel" }, whitelist), whitelist)).toBeNull();
    expect(criteriaReason(ffm({ ...base, district: "Nordend-West" }, whitelist), whitelist)).toBe(
      "Stadtteil nicht im Suchgebiet (Nordend-West)",
    );
    const unknown = ffm(base, whitelist);
    expect(criteriaReason(unknown, whitelist)).toBe("Stadtteil unbekannt");
    expect(criteriaReason(unknown, whitelist, { unknownDistrictPasses: true })).toBeNull();
  });
});
