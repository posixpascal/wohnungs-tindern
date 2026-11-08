import { describe, expect, test } from "bun:test";
import { validateConfig } from "./config";
import { openDb } from "./db";
import { ingestRecords } from "./ingest";
import { collectReport, localDay, parseGone, renderReport } from "./report";
import { sweepGone } from "./sweep";

const config = validateConfig({
  budget: { warm_max: 1200, nebenkosten_estimate_per_sqm: 3 },
  rooms: { min: 2, ideal: 3 },
  locations: [
    { city: "Idstein", radius_km: 0 },
    { city: "Wiesbaden", radius_km: 0, preferred_districts: ["Igstadt"] },
  ],
  preferences: { garden_or_balcony: true, ground_floor: true },
  portals: ["kleinanzeigen", "immowelt"],
});

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  portal: "kleinanzeigen",
  portal_id: id,
  url: `https://www.kleinanzeigen.de/s-anzeige/x/${id}`,
  title: `Wohnung ${id}`,
  location: "65510 Idstein",
  rent_warm: 1000,
  rooms: 2,
  area: 60,
  ...over,
});

describe("report", () => {
  test("lists today's new listings by score with counts and gone listings", () => {
    const db = openDb(":memory:");
    ingestRecords(db, config, [rec("old")], "2026-10-10T09:00:00.000Z");
    ingestRecords(db, config, [rec("older")], "2026-10-01T09:00:00.000Z");
    const now = "2026-10-14T08:00:00.000Z";
    sweepGone(db, 3, now);
    ingestRecords(
      db,
      config,
      [
        rec("a"),
        rec("b", { rooms: 3, floor: "EG", features: ["Garten"], rent_cold: 900, rent_warm: undefined }),
        rec("c", {
          portal: "immowelt",
          url: "https://www.immowelt.de/expose/c",
          location: "Igstadt, Wiesbaden",
          features: ["Balkon"],
        }),
      ],
      now,
    );

    const data = collectReport(db, now);
    expect(data.fresh.map((l) => l.portal_id)).toEqual(["b", "c", "a"]);
    expect(data.goneCount).toBe(1);
    expect(data.activeCount).toBe(3);

    const md = renderReport(data);
    expect(md).toContain("# Wohnungssuche – 14.10.2026");
    expect(md).toContain("3 neue Wohnungen");
    expect(md).toContain("[Wohnung b](https://www.kleinanzeigen.de/s-anzeige/x/b)");
    expect(md).toContain("(geschätzt)");
    expect(md).toContain("Wiesbaden – Igstadt");
    expect(md).toContain("| kleinanzeigen | 2 |");
    expect(md).toContain("| immowelt | 1 |");
    expect(md).toContain("| Idstein | 2 |");
    expect(md).toContain("Nicht mehr gefunden: 1");
    expect(md.indexOf("Wohnung b")).toBeLessThan(md.indexOf("Wohnung a"));
  });

  test("explicit gone count from sweep wins", () => {
    const db = openDb(":memory:");
    expect(collectReport(db, "2026-10-14T08:00:00.000Z", 7).goneCount).toBe(7);
    expect(parseGone(["--gone", "4"])).toBe(4);
    expect(parseGone([])).toBeUndefined();
    expect(() => parseGone(["--gone", "x"])).toThrow(/--gone/);
  });

  test("encodes link targets", () => {
    const db = openDb(":memory:");
    const now = "2026-10-14T08:00:00.000Z";
    ingestRecords(db, config, [rec("y", { url: "https://www.kleinanzeigen.de/a)(b" })], now);
    expect(renderReport(collectReport(db, now))).toContain("(https://www.kleinanzeigen.de/a%29%28b)");
  });

  test("empty day renders a friendly message", () => {
    const db = openDb(":memory:");
    const md = renderReport(collectReport(db, "2026-10-14T08:00:00.000Z"));
    expect(md).toContain("Heute keine neuen Wohnungen");
  });

  test("escapes markdown in titles", () => {
    const db = openDb(":memory:");
    const now = "2026-10-14T08:00:00.000Z";
    ingestRecords(db, config, [rec("x", { title: "Top [EG] | *Garten*" })], now);
    const md = renderReport(collectReport(db, now));
    expect(md).toContain("Top \\[EG\\] \\| \\*Garten\\*");
  });

  test("localDay formats the local calendar day", () => {
    expect(localDay(new Date(2026, 9, 14, 23, 59))).toBe("2026-10-14");
  });
});
