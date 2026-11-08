// Shape of a `listings` row as returned by bun:sqlite (images still a JSON
// string) and the API-facing shape (images parsed into an array).

export type RawListingRow = {
  id: string;
  portal: string;
  portal_id: string;
  url: string;
  title: string;
  city: string;
  district: string | null;
  address: string | null;
  rent_cold: number | null;
  rent_warm: number | null;
  rent_warm_estimated: number;
  rooms: number | null;
  area_sqm: number | null;
  floor: number | null;
  has_garden: number | null;
  has_balcony: number | null;
  available_from: string | null;
  description: string | null;
  images: string;
  score: number;
  score_notes: string | null;
  status: "active" | "gone";
  first_seen_at: string;
  last_seen_at: string;
};

export type ApiListing = Omit<RawListingRow, "images"> & { images: string[] };

export const LISTING_COLUMNS = `
  id, portal, portal_id, url, title, city, district, address,
  rent_cold, rent_warm, rent_warm_estimated, rooms, area_sqm, floor,
  has_garden, has_balcony, available_from, description, images,
  score, score_notes, status, first_seen_at, last_seen_at
`;

// Defense in depth: the ingest schema already rejects non-http(s) URLs, but
// only the server ever decides what reaches the browser as an href/src, so
// re-check here too in case a row was ever written by another path.
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function rowToListing(row: RawListingRow): ApiListing {
  let images: string[] = [];
  try {
    const parsed = JSON.parse(row.images);
    if (Array.isArray(parsed)) images = parsed.filter((value): value is string => typeof value === "string" && isHttpUrl(value));
  } catch {
    images = [];
  }
  return { ...row, images, url: isHttpUrl(row.url) ? row.url : "" };
}
