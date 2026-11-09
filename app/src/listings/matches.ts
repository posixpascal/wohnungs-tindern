import type { Database } from "bun:sqlite";
import { LISTING_COLUMNS, rowToListing, type ApiListing, type RawListingRow } from "./types";

// `matched_at`: when the last of all users liked it, i.e. when it became a match.
export type MatchListing = ApiListing & { matched_at: string };

// Listings liked by every user (not hardcoded to 2 people). Gone listings
// stay in the list; `status` already tells the frontend to grey them out.
export function getMatches(db: Database): MatchListing[] {
  const totalRow = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM users").get();
  const total = totalRow?.total ?? 0;
  if (total < 1) return [];

  const rows = db
    .query<RawListingRow & { matched_at: string }, [number]>(
      `SELECT ${LISTING_COLUMNS}, liked.matched_at FROM listings l
       JOIN (
         SELECT s.listing_id, COUNT(*) AS like_count, MAX(s.created_at) AS matched_at
         FROM swipes s WHERE s.decision = 'like' GROUP BY s.listing_id
       ) liked ON liked.listing_id = l.id
       WHERE liked.like_count = ?
       ORDER BY l.last_seen_at DESC`,
    )
    .all(total);

  return rows.map((row) => ({ ...rowToListing(row), matched_at: row.matched_at }));
}
