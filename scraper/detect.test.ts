import { describe, expect, test } from "bun:test";
import {
  costFromText,
  exclusionReason,
  floorFromText,
  hasBalcony,
  hasBathtub,
  hasGarden,
  shortTermRental,
} from "./detect";

describe("hasGarden", () => {
  test.each([
    "Garten",
    "Garten/-mitnutzung",
    "mit Gartenanteil",
    "Gartennutzung möglich",
    "schöne Gartenwohnung",
    "Gartenmitbenutzung",
    "Hausgarten",
    "eigener Mietergarten",
  ])("detects %p", (text) => {
    expect(hasGarden(text)).toBe(true);
  });

  test.each([
    "Kindergarten um die Ecke",
    "Biergarten",
    "kein Garten",
    "ohne eigenen Garten",
    "weder Balkon noch Garten",
    "kein Balkon oder Garten",
    "Garten: nein",
    "Gartenstraße 5",
    "",
  ])(
    "ignores %p",
    (text) => {
      expect(hasGarden(text)).toBe(false);
    },
  );
});

describe("hasBalcony", () => {
  test.each(["Balkon", "Balkon/Terrasse", "große Terrasse", "Loggia", "Dachterrasse", "Terrassenwohnung", "2 Balkone", "Südbalkon", "Sonnenterrasse"])(
    "detects %p",
    (text) => {
      expect(hasBalcony(text)).toBe(true);
    },
  );

  test.each(["kein Balkon", "ohne Balkon", "Balkonien-Urlaub", "Balkon nicht vorhanden", "weder Balkon noch Garten", ""])("ignores %p", (text) => {
    expect(hasBalcony(text)).toBe(false);
  });
});

describe("hasBathtub", () => {
  test.each(["Badewanne", "Wanne", "Bad mit Wanne", "Wannenbad", "Eckbadewanne", "Tageslichtbad mit Badewanne und Dusche"])(
    "detects %p",
    (text) => {
      expect(hasBathtub(text)).toBe(true);
    },
  );

  test.each([
    "keine Badewanne",
    "nur Dusche",
    "ebenerdige Dusche statt Wanne",
    "Dusche anstatt Badewanne",
    "Duschwanne",
    "Badewanne: nein",
    "Dusche anstelle der Badewanne",
    "Badewanne wurde durch Dusche ersetzt",
    "Dusch-Wanne",
    "keine Großbadewanne",
    "",
  ])("ignores %p", (text) => {
    expect(hasBathtub(text)).toBe(false);
  });

  test("a negated bathtub does not hide a balcony or garden, and vice versa", () => {
    expect(hasBalcony("Keine Badewanne, Balkon vorhanden")).toBe(true);
    expect(hasBalcony("Bad ohne Wanne und Balkon zum Hof")).toBe(true);
    expect(hasGarden("keine Wanne, Garten")).toBe(true);
    expect(hasBathtub("Kein Balkon, Badewanne, EBK")).toBe(true);
    expect(hasBathtub("Kein Balkon und Badewanne")).toBe(true);
    expect(hasBathtub("keine Duschwanne, sondern Badewanne")).toBe(true);
  });
});

describe("floorFromText", () => {
  test.each([
    ["Erdgeschosswohnung mit Garten", 0],
    ["schöne EG-Wohnung", 0],
    ["Die Wohnung liegt im Erdgeschoss", 0],
    ["Hochparterre", 0],
    ["gemütliche Souterrainwohnung", -1],
    ["Wohnung im 2. OG", null],
    ["", null],
  ] as const)("%p -> %p", (text, expected) => {
    expect(floorFromText(text)).toBe(expected);
  });
});

describe("floorFromText strict", () => {
  test("ignores weak phrases in descriptions", () => {
    expect(floorFromText("Fahrradkeller im Erdgeschoss", true)).toBeNull();
    expect(floorFromText("schöne Erdgeschosswohnung", true)).toBe(0);
  });
});

describe("exclusionReason", () => {
  test.each([
    ["18 m2 Zimmer mit Balkon in 3-Zimmer-Wohnung zu vermieten", "WG-Zimmer"],
    ["WG-Zimmer in Sachsenhausen", "WG-Zimmer"],
    ["Suche Mitbewohnerin für 3er WG", "WG-Zimmer"],
    ["WG-Neugründung im Frankfurter Ostend", "WG-Zimmer"],
    ["5er-WG im Altbau", "WG-Zimmer"],
    ["Wohnungsswap - 3 Zimmer, 63 m²", "Tauschwohnung"],
    ["TAUSCHWOHNUNG 3-Zimmer-Wohnung in Idstein", "Tauschwohnung"],
    ["Es handelt es sich hierbei um ein Tauschangebot.", "Tauschwohnung"],
    ["Biete Wohnungstausch", "Tauschwohnung"],
    ["Zeitwohnen: möbliertes Apartment", "Zeitwohnen"],
    ["Möbliertes Apartment, befristet bis 03/2027", "Zeitwohnen"],
    ["Wohnen auf Zeit in Frankfurt", "Zeitwohnen"],
    ["Seniorenwohnung ab 60 Jahren", "Seniorenwohnen/WBS"],
    ["Betreutes Wohnen in Hofheim", "Seniorenwohnen/WBS"],
    ["Nur mit WBS!", "Seniorenwohnen/WBS"],
    ["Wohnberechtigungsschein erforderlich", "Seniorenwohnen/WBS"],
  ] as const)("%p -> %p", (text, reason) => {
    expect(exclusionReason(text)).toBe(reason);
  });

  test.each([
    "Kein Tausch WG-geeignet Terrasse",
    "WG geeignet, Keller",
    "WG-Auflösung: Wir suchen Nachmieter für unsere Wohnung",
    "Vermietung nicht an WGs",
    "3-Zimmer-Wohnung, auch als WG",
    "Ideal für Paare oder WG",
    "Schöne 3-Zimmer-Wohnung mit Balkon",
    "unbefristeter Mietvertrag, möbliert",
    "kein WBS erforderlich",
    "ideal für Paare oder Senioren",
    "3 Zimmer in ruhiger Wohnlage",
  ])("keeps %p", (text) => {
    expect(exclusionReason(text)).toBeNull();
  });

  test("a bare 'WG' only excludes when it is in the title", () => {
    expect(exclusionReason("Helle 3 Zimmer", "ideal für Paar, 2er-WG oder Familie")).toBeNull();
    expect(exclusionReason("Helle 3 Zimmer", "Auch für eine 2er-WG geeignet. Nette Mitbewohner im Haus.")).toBeNull();
    expect(exclusionReason("Helle 3 Zimmer", "Nicht geeignet für eine WG")).toBeNull();
    expect(exclusionReason("Zimmer frei", "Wir suchen Verstärkung für unsere WG")).toBe("WG-Zimmer");
    expect(exclusionReason("Wohnung", "Tauschangebot")).toBe("Tauschwohnung");
  });
});

describe("exclusionReason: Monteurwohnung", () => {
  test.each([
    ["Mounteur Wohnung 3 Zimmer Möbliert Mit Balkon bis 8 Pers Möglich", ""],
    ["Monteurwohnung in Frankfurt", ""],
    ["Wohnung", "Wir bieten: Monteurzimmer, Monteurwohnung, möbliertes Zimmer"],
    ["Wohnung", "Wohnung für Monteure bis 8 Personen"],
    ["Wohnung", "Der Preis ist 30€ pro Person und Nacht"],
    ["Wohnung", "Übernachtung 25 Euro p.P."],
    ["Wohnung", "Preis: 45 € pro Nacht"],
    ["Wohnung", "ab 20 €/Nacht, bis 6 Personen"],
    ["Wohnung", "Arbeiterunterkunft mit Küche"],
    ["Handwerkerwohnung für 4 Personen", ""],
  ] as const)("%p / %p -> Monteurwohnung", (title, body) => {
    expect(exclusionReason(title, body)).toBe("Monteurwohnung");
  });

  test.each([
    "ideal für einen 2-Personen-Haushalt",
    "geeignet für 1-2 Personen",
    "geeignet für bis zu 4 Personen",
    "Wasserpauschale je Person, Strom separat",
    "renovierungsbedürftig, ideal für Handwerker",
    "Die Handwerker sind im Dezember fertig",
    "Nebenkosten inkl. Wasser für 2 Personen",
    "Keine Vermietung an Monteure.",
    "Nichtraucher, keine Haustiere, keine Monteure!",
    "Müllgebühren werden mit 15 € pro Person abgerechnet.",
    "Wasser: 30 €/Person monatlich",
    "Nebenkostenpauschale 50 € p.P.",
  ])("keeps %p", (body) => {
    expect(exclusionReason("3-Zimmer-Wohnung", body)).toBeNull();
  });
});

describe("exclusionReason: WG-Zimmer variants", () => {
  test.each([
    ["Ein wunderschönes Zimmer mit Balkon in Sindlingen", "Ein wunderschönes Zimmer mit Balkon in 2-3er WG, neu renoviert"],
    ["Zimmer frei", "Zimmer in 3er WG ab Januar"],
    ["Zimmer frei", "Zimmer in WG zu vermieten"],
    ["Zimmer frei", "Biete Zimmer in 'ner WG in Bockenheim"],
    ["Helles Zimmer", "schönes WG-Zimmer mit Balkon"],
    ["Zimmer in 2-3er WG", ""],
  ] as const)("%p / %p -> WG-Zimmer", (title, body) => {
    expect(exclusionReason(title, body)).toBe("WG-Zimmer");
  });

  test.each([
    "Die Wohnung ist WG geeignet",
    "WG-tauglich: alle Zimmer separat begehbar",
    "Zimmer in WG-tauglichem Schnitt",
    "Auch für eine 2-3er WG geeignet",
  ])("keeps %p", (body) => {
    expect(exclusionReason("3-Zimmer-Wohnung", body)).toBeNull();
  });
});

describe("exclusionReason: Einzelperson", () => {
  test.each([
    "Dieses Mietangebot richtet sich ausschließlich an eine ruhige Einzelperson ohne Haustiere",
    "Vermietung nur an eine Einzelperson",
    "Die Wohnung ist nur für 1 Person geeignet",
    "nur für eine Person",
    "Nur für Singles!",
  ])("%p -> Einzelperson", (body) => {
    expect(exclusionReason("3-Zimmer-Wohnung", body)).toBe("Einzelperson");
  });

  test.each([
    "ideal für 1-2 Personen",
    "geeignet für Einzelperson oder Paar",
    "ideal für Singles oder Paare",
    "nicht nur für eine Person geeignet",
    "Vermietung nur an Einzelperson oder Paar.",
    "Nur an eine Person oder ein Paar zu vermieten.",
    "nicht nur für Singles geeignet",
  ])("keeps %p", (body) => {
    expect(exclusionReason("3-Zimmer-Wohnung", body)).toBeNull();
  });
});

describe("shortTermRental", () => {
  test("flags rentals shorter than 12 months", () => {
    expect(shortTermRental("01.11.2026", "31.03.2027")).toBe(true);
  });

  test("keeps long or open-ended rentals", () => {
    expect(shortTermRental("01.11.2026", "01.12.2027")).toBe(false);
    expect(shortTermRental("01.11.2026", undefined)).toBe(false);
    expect(shortTermRental(undefined, "garbage")).toBe(false);
  });
});

describe("costFromText", () => {
  test("extracts Nebenkosten and Warmmiete amounts", () => {
    const text = "Kaltmiete: 690 Euro\nNebenkosten: 280 Euro\nDie Warmmiete beträgt aktuell 826€ exkl. Gas";
    expect(costFromText(text, "nebenkosten")).toBe(280);
    expect(costFromText(text, "warmmiete")).toBe(826);
  });

  test("extracts the Kaltmiete line", () => {
    const text = "Mietkosten:\nKaltmiete: 845 €\nNebenkosten: 250 €\nWarmmiete: 1.095 €";
    expect(costFromText(text, "kaltmiete")).toBe(845);
    expect(costFromText(text, "warmmiete")).toBe(1095);
  });

  test("ignores years", () => {
    expect(costFromText("Warmmiete steigt ab 2027 auf 1.300 €", "warmmiete")).toBeNull();
    expect(costFromText("Warmmiete: 2000 €", "warmmiete")).toBe(2000);
  });

  test("ignores mentions without a plausible amount", () => {
    expect(costFromText("Die Warmmiete ist inklusive aller Nebenkosten.", "warmmiete")).toBeNull();
    expect(costFromText("Nebenkosten: 5 Euro", "nebenkosten")).toBeNull();
    expect(costFromText("", "warmmiete")).toBeNull();
  });
});
