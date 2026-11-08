import type { Database } from "bun:sqlite";
import { LISTING_COLUMNS, rowToListing, type ApiListing, type RawListingRow } from "./types";

export type OtherDecision = { username: string; decision: "liked" | "noped" | "pending" };
export type LikedListing = ApiListing & { others: OtherDecision[] };

type OtherSwipeRow = { user_id: number; listing_id: string; decision: "like" | "nope" };

// My likes, each annotated with what every other user decided on it.
export function getMyLikes(db: Database, userId: number): LikedListing[] {
  const myLikedRows = db
    .query<RawListingRow, [number]>(
      `SELECT ${LISTING_COLUMNS} FROM listings l
       JOIN swipes s ON s.listing_id = l.id
       WHERE s.user_id = ? AND s.decision = 'like'
       ORDER BY l.score DESC, s.created_at DESC`,
    )
    .all(userId);

  if (myLikedRows.length === 0) return [];

  const others = db
    .query<{ id: number; username: string }, [number]>("SELECT id, username FROM users WHERE id != ?")
    .all(userId);

  const listingIds = myLikedRows.map((row) => row.id);
  const otherSwipes =
    others.length > 0
      ? db
          .query<OtherSwipeRow, [number, ...string[]]>(
            `SELECT user_id, listing_id, decision FROM swipes
             WHERE user_id != ? AND listing_id IN (${listingIds.map(() => "?").join(",")})`,
          )
          .all(userId, ...listingIds)
      : [];

  return myLikedRows.map((row) => {
    const others_: OtherDecision[] = others.map((other) => {
      const swipe = otherSwipes.find((s) => s.user_id === other.id && s.listing_id === row.id);
      const decision: OtherDecision["decision"] = !swipe
        ? "pending"
        : swipe.decision === "like"
          ? "liked"
          : "noped";
      return { username: other.username, decision };
    });
    return { ...rowToListing(row), others: others_ };
  });
}
