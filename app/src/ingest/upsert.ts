import type { Database } from "bun:sqlite";
import type { Static } from "elysia";
import type { ListingSchema } from "./schema";

export type IncomingListing = Static<typeof ListingSchema>;

const UPSERT_SQL = `
  INSERT INTO listings (
    id, portal, portal_id, url, title, city, district, address,
    rent_cold, rent_warm, rent_warm_estimated, rooms, area_sqm, floor,
    has_garden, has_balcony, available_from, description, images,
    score, score_notes, status, first_seen_at, last_seen_at
  ) VALUES (
    $id, $portal, $portal_id, $url, $title, $city, $district, $address,
    $rent_cold, $rent_warm, $rent_warm_estimated, $rooms, $area_sqm, $floor,
    $has_garden, $has_balcony, $available_from, $description, $images,
    $score, $score_notes, $status, $first_seen_at, $last_seen_at
  )
  ON CONFLICT (id) DO UPDATE SET
    portal = excluded.portal,
    portal_id = excluded.portal_id,
    url = excluded.url,
    title = excluded.title,
    city = excluded.city,
    district = excluded.district,
    address = excluded.address,
    rent_cold = excluded.rent_cold,
    rent_warm = excluded.rent_warm,
    rent_warm_estimated = excluded.rent_warm_estimated,
    rooms = excluded.rooms,
    area_sqm = excluded.area_sqm,
    floor = excluded.floor,
    has_garden = excluded.has_garden,
    has_balcony = excluded.has_balcony,
    available_from = excluded.available_from,
    -- the scraper sends already-merged values (smaller galleries / shorter texts are intended);
    -- only guard against blanks wiping stored data
    description = CASE WHEN length(TRIM(COALESCE(excluded.description, ''), ' ' || char(9, 10, 13))) > 0
      THEN excluded.description ELSE listings.description END,
    images = CASE WHEN json_array_length(excluded.images) > 0
      THEN excluded.images ELSE listings.images END,
    score = excluded.score,
    score_notes = excluded.score_notes,
    status = excluded.status,
    first_seen_at = MIN(listings.first_seen_at, excluded.first_seen_at),
    last_seen_at = excluded.last_seen_at
`;

export type RejectedListing = { id: string; reason: string };
export type UpsertResult = { upserted: number; rejected: RejectedListing[] };

// `listings.id` must equal `${portal}:${portal_id}` and `(portal, portal_id)`
// is separately UNIQUE in the schema. The upsert below only resolves
// conflicts on `id`, so a listing whose `id` doesn't match its own
// portal/portal_id (bad client, or a stale id reused for a different
// portal_id) would hit the other unique index and throw, aborting the whole
// batch. Reject such items individually instead so one bad row never 500s
// everyone else's listings.
export function upsertListings(db: Database, listings: readonly IncomingListing[]): UpsertResult {
  const stmt = db.query(UPSERT_SQL);
  const rejected: RejectedListing[] = [];
  let upserted = 0;

  const runAll = db.transaction((items: readonly IncomingListing[]) => {
    for (const listing of items) {
      const expectedId = `${listing.portal}:${listing.portal_id}`;
      if (listing.id !== expectedId) {
        rejected.push({ id: listing.id, reason: `id must equal "${expectedId}"` });
        continue;
      }
      try {
        stmt.run({
          $id: listing.id,
          $portal: listing.portal,
          $portal_id: listing.portal_id,
          $url: listing.url,
          $title: listing.title,
          $city: listing.city,
          $district: listing.district ?? null,
          $address: listing.address ?? null,
          $rent_cold: listing.rent_cold ?? null,
          $rent_warm: listing.rent_warm ?? null,
          $rent_warm_estimated: listing.rent_warm_estimated,
          $rooms: listing.rooms ?? null,
          $area_sqm: listing.area_sqm ?? null,
          $floor: listing.floor ?? null,
          $has_garden: listing.has_garden ?? null,
          $has_balcony: listing.has_balcony ?? null,
          $available_from: listing.available_from ?? null,
          $description: listing.description ?? null,
          $images: JSON.stringify(listing.images),
          $score: listing.score,
          $score_notes: listing.score_notes ?? null,
          $status: listing.status,
          $first_seen_at: listing.first_seen_at,
          $last_seen_at: listing.last_seen_at,
        });
        upserted += 1;
      } catch (error) {
        rejected.push({ id: listing.id, reason: error instanceof Error ? error.message : "insert failed" });
      }
    }
  });
  runAll(listings);
  return { upserted, rejected };
}
