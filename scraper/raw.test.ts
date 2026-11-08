import { describe, expect, test } from "bun:test";
import { fromDetail, fromList, mergeRecords, parseRawRecord } from "./raw";
import type { RawRecord } from "./types";

const base = {
  portal: "kleinanzeigen",
  portal_id: "3538928144",
  url: "https://www.kleinanzeigen.de/s-anzeige/x/3538928144-203-4808",
  title: "2 ZKB + Garten",
};

describe("parseRawRecord", () => {
  test("accepts a minimal record and fills defaults", () => {
    const res = parseRawRecord(base);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.features).toEqual([]);
    expect(res.record.images).toEqual([]);
  });

  test("coerces numeric ids and drops unknown keys", () => {
    const res = parseRawRecord({ ...base, portal_id: 123, extra: "x", published_at: "y" });
    expect(res.ok && res.record.portal_id).toBe("123");
    expect(res.ok && "extra" in res.record).toBe(false);
  });

  test.each([
    [null, "not an object"],
    [{ ...base, portal: "ebay" }, "portal"],
    [{ ...base, portal_id: "" }, "portal_id"],
    [{ ...base, portal_id: "../../etc" }, "portal_id"],
    [{ ...base, url: "javascript:alert(1)" }, "url"],
    [{ ...base, url: "https://evil.example/s-anzeige/1" }, "url"],
    [{ ...base, title: "  " }, "title"],
    [{ ...base, rent_cold: { v: 1 } }, "rent_cold"],
    [{ ...base, features: "Balkon" }, "features"],
    [{ ...base, has_garden: "yes" }, "has_garden"],
  ] as const)("rejects %p (%s)", (input, field) => {
    const res = parseRawRecord(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain(field);
  });

  test("keeps only http(s) image urls and string features", () => {
    const res = parseRawRecord({
      ...base,
      images: ["https://img.kleinanzeigen.de/a.jpg", "data:image/png;base64,xx", 5, "http://x/y.jpg"],
      features: ["Balkon", 3, " ", "Garten"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.images).toEqual(["https://img.kleinanzeigen.de/a.jpg", "http://x/y.jpg"]);
    expect(res.record.features).toEqual(["Balkon", "Garten"]);
  });

  test("stores the normalized url", () => {
    const res = parseRawRecord({ ...base, url: "https://www.kleinanzeigen.de/a b" });
    expect(res.ok && res.record.url).toBe("https://www.kleinanzeigen.de/a%20b");
  });

  test("accepts subdomains of the portal host", () => {
    const res = parseRawRecord({
      ...base,
      portal: "immoscout24",
      url: "https://www.immobilienscout24.de/expose/171687683",
    });
    expect(res.ok).toBe(true);
  });

  test("treats null optional fields as absent", () => {
    const res = parseRawRecord({ ...base, rent_warm: null, floor: null, has_garden: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.rent_warm).toBeUndefined();
    expect(res.record.has_garden).toBeUndefined();
  });
});

describe("mergeRecords", () => {
  const list: RawRecord = {
    ...(base as Pick<RawRecord, "portal_id" | "url" | "title">),
    portal: "kleinanzeigen",
    rent_cold: "870 €",
    features: ["Von Privat"],
    images: ["https://img/a.jpg"],
  };
  const detail: RawRecord = {
    ...list,
    title: "2 ZKB + Garten Wohnung in Bestlage",
    rent_warm: "970 €",
    floor: "0",
    features: ["Terrasse", "Garten/-mitnutzung"],
    images: ["https://img/a.jpg", "https://img/b.jpg"],
  };

  test("merges records with the same id, later values win", () => {
    const merged = mergeRecords([fromList(list), fromList(detail)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.detail).toEqual({ images: false, description: false });
    const m = merged[0]!.record;
    expect(m.title).toBe("2 ZKB + Garten Wohnung in Bestlage");
    expect(m.rent_cold).toBe("870 €");
    expect(m.rent_warm).toBe("970 €");
    expect(m.features).toEqual(["Von Privat", "Terrasse", "Garten/-mitnutzung"]);
    expect(m.images).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
  });

  test("keeps the longer description regardless of order", () => {
    const teaser = { ...list, description: "Kurz..." };
    const full = { ...list, description: "Kurz und ausführlich beschrieben" };
    expect(mergeRecords([fromList(full), fromList(teaser)])[0]?.record.description).toBe("Kurz und ausführlich beschrieben");
  });

  test("a detail record wins over a list record of the same batch, also with fewer images or a shorter text", () => {
    const teaser = { ...detail, description: "Langer Teaser aus der Ergebnisliste" };
    const page = { ...list, description: "Kurz", images: ["https://img/c.jpg"] };
    const [m] = mergeRecords([fromList(teaser), fromDetail(page)]);
    expect(m?.detail).toEqual({ images: true, description: true });
    expect(m?.record.description).toBe("Kurz");
    expect(m?.record.images).toEqual(["https://img/c.jpg"]);
    const [empty] = mergeRecords([fromList(teaser), fromDetail({ ...list, images: [] })]);
    expect(empty?.record.images).toEqual(teaser.images);
    expect(empty?.record.description).toBe(teaser.description);
    // the list values standing in keep their list provenance
    expect(empty?.detail).toEqual({ images: false, description: false });
  });

  test("does not mutate inputs and keeps distinct ids", () => {
    const other = { ...list, portal_id: "999" };
    const inputs = [fromList(list), fromList(other), fromDetail(detail)];
    const snapshot = structuredClone(inputs);
    expect(mergeRecords(inputs)).toHaveLength(2);
    expect(inputs).toEqual(snapshot);
  });
});
