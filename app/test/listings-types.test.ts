import { describe, expect, test } from "bun:test";
import { rowToListing, type RawListingRow } from "../src/listings/types";

function baseRow(overrides: Partial<RawListingRow> = {}): RawListingRow {
  return {
    id: "immoscout24:1",
    portal: "immoscout24",
    portal_id: "1",
    url: "https://example.com/1",
    title: "Listing",
    city: "Frankfurt am Main",
    district: null,
    address: null,
    rent_cold: null,
    rent_warm: null,
    rent_warm_estimated: 0,
    rooms: null,
    area_sqm: null,
    floor: null,
    has_garden: null,
    has_balcony: null,
    available_from: null,
    description: null,
    images: "[]",
    score: 50,
    score_notes: null,
    status: "active",
    first_seen_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rowToListing URL filtering (defense in depth)", () => {
  test("passes through valid http(s) urls", () => {
    const listing = rowToListing(baseRow({ url: "https://example.com/1", images: JSON.stringify(["https://img.example.com/a.jpg"]) }));
    expect(listing.url).toBe("https://example.com/1");
    expect(listing.images).toEqual(["https://img.example.com/a.jpg"]);
  });

  test("blanks out a non-http(s) url", () => {
    const listing = rowToListing(baseRow({ url: "javascript:alert(1)" }));
    expect(listing.url).toBe("");
  });

  test("filters out non-http(s) image urls, keeping the rest", () => {
    const listing = rowToListing(
      baseRow({ images: JSON.stringify(["javascript:alert(1)", "https://img.example.com/ok.jpg", "not a url"]) }),
    );
    expect(listing.images).toEqual(["https://img.example.com/ok.jpg"]);
  });
});
