import type { Database } from "bun:sqlite";
import { DISTRICT_VISIBLE_SQL } from "../districts/store";
import { LISTING_COLUMNS, rowToListing, type ApiListing, type RawListingRow } from "./types";

type QueueRow = RawListingRow & { liked_by: string };

export type QueueListing = ApiListing & { liked_by: string[] };

const parseNames = (json: string): string[] => {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
};

// Active listings the user hasn't swiped yet and the district settings don't
// rule out (excluded / outside a whitelist), ordered so listings any other
// user already liked surface first (to encourage matching), then by score,
// then newest first. `liked_by` names those other users for the card hint.
export function getQueue(db: Database, userId: number, limit: number): QueueListing[] {
  const rows = db
    .query<QueueRow, [number, number, number]>(
      `SELECT ${LISTING_COLUMNS},
         (SELECT json_group_array(u.username) FROM swipes s2 JOIN users u ON u.id = s2.user_id
          WHERE s2.listing_id = l.id AND s2.user_id != ? AND s2.decision = 'like') AS liked_by
       FROM listings l
       WHERE l.status = 'active'
         AND ${DISTRICT_VISIBLE_SQL}
         AND NOT EXISTS (
           SELECT 1 FROM swipes s WHERE s.listing_id = l.id AND s.user_id = ?
         )
       ORDER BY json_array_length(liked_by) DESC, l.score DESC, l.first_seen_at DESC
       LIMIT ?`,
    )
    .all(userId, userId, limit);

  return rows.map((row) => ({ ...rowToListing(row), liked_by: parseNames(row.liked_by) }));
}
