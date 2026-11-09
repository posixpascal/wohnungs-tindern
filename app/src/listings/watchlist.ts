import type { Database } from "bun:sqlite";
import { DISTRICT_VISIBLE_SQL } from "../districts/store";

// One entry per listing the end-of-run availability check (scraper/availability.ts) should revisit.
// No URL on purpose: the scraper navigates only to URLs from its own DB.
export type WatchlistEntry = { id: string; likes: number; matched: boolean };

// Active listings nobody rejected that are still on the website: unswiped or
// partly liked ones the district settings show in the queue, and every match
// (matches ignore the district settings). Matches first, then the most liked,
// then by score, so a capped check covers what matters most.
export function getWatchlist(db: Database): WatchlistEntry[] {
  const totalRow = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM users").get();
  const total = totalRow?.total ?? 0;
  if (total < 1) return [];

  const rows = db
    .query<{ id: string; likes: number }, [number]>(
      `SELECT id, likes FROM (
         SELECT l.id, l.score, l.city, l.district,
           (SELECT COUNT(*) FROM swipes s WHERE s.listing_id = l.id AND s.decision = 'like') AS likes,
           ${DISTRICT_VISIBLE_SQL} AS visible
         FROM listings l
         WHERE l.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.listing_id = l.id AND s.decision = 'nope')
       ) w
       WHERE w.likes = ?1 OR w.visible
       ORDER BY w.likes DESC, w.score DESC, w.id`,
    )
    .all(total);

  return rows.map((row) => ({ ...row, matched: row.likes === total }));
}
