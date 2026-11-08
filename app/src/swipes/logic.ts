import type { Database } from "bun:sqlite";

export class ListingNotFoundError extends Error {
  constructor(listingId: string) {
    super(`Listing not found: ${listingId}`);
  }
}

export type Decision = "like" | "nope";

const UPSERT_SWIPE_SQL = `
  INSERT INTO swipes (user_id, listing_id, decision) VALUES (?, ?, ?)
  ON CONFLICT (user_id, listing_id) DO UPDATE SET
    decision = excluded.decision,
    created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`;

function countLikes(db: Database, listingId: string): number {
  const row = db
    .query<{ likes: number }, [string]>(
      "SELECT COUNT(DISTINCT user_id) AS likes FROM swipes WHERE listing_id = ? AND decision = 'like'",
    )
    .get(listingId);
  return row?.likes ?? 0;
}

// Records (or overwrites) a swipe and reports whether it just completed a
// match: every user in the system has now liked this listing. Reports
// `match: true` only on the transition into a full match — re-liking a
// listing that was already matched (e.g. a duplicate/retried request) does
// not report a match again.
export function recordSwipe(db: Database, userId: number, listingId: string, decision: Decision): { match: boolean } {
  const listingExists = db.query("SELECT 1 FROM listings WHERE id = ?").get(listingId);
  if (!listingExists) throw new ListingNotFoundError(listingId);

  if (decision !== "like") {
    db.query(UPSERT_SWIPE_SQL).run(userId, listingId, decision);
    return { match: false };
  }

  const totalRow = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM users").get();
  const total = totalRow?.total ?? 0;
  const wasAlreadyMatch = total > 0 && countLikes(db, listingId) === total;

  db.query(UPSERT_SWIPE_SQL).run(userId, listingId, decision);

  const isMatchNow = total > 0 && countLikes(db, listingId) === total;
  return { match: isMatchNow && !wasAlreadyMatch };
}

export function deleteSwipe(db: Database, userId: number, listingId: string): boolean {
  const result = db.query("DELETE FROM swipes WHERE user_id = ? AND listing_id = ?").run(userId, listingId);
  return result.changes > 0;
}
