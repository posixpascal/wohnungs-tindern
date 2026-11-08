import type { Database } from "bun:sqlite";
import { LISTING_COLUMNS, rowToListing, type ApiListing, type RawListingRow } from "./types";

// Listings liked by every user (not hardcoded to 2 people). Gone listings
// stay in the list; `status` already tells the frontend to grey them out.
export function getMatches(db: Database): ApiListing[] {
  const totalRow = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM users").get();
  const total = totalRow?.total ?? 0;
  if (total < 1) return [];

  const rows = db
    .query<RawListingRow, [number]>(
      `SELECT ${LISTING_COLUMNS} FROM listings l
       WHERE (
         SELECT COUNT(DISTINCT s.user_id) FROM swipes s
         WHERE s.listing_id = l.id AND s.decision = 'like'
       ) = ?
       ORDER BY l.last_seen_at DESC`,
    )
    .all(total);

  return rows.map(rowToListing);
}
