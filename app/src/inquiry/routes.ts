import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { sessionPlugin } from "../auth/plugin";
import { csrfGuard } from "../auth/request";
import { ok, fail } from "../http/envelope";
import { LISTING_COLUMNS, rowToListing, type RawListingRow } from "../listings/types";
import { generateInquiry } from "./generate";
import type { InquiryGenerator } from "./llm";
import { PROFILE_LIMITS, getProfile, saveProfile } from "./profile";

// LLM calls cost money: cap them per user, in memory (fine for a handful of
// users on one process).
const LIMITS = [
  { max: 10, windowMs: 60_000 },
  { max: 100, windowMs: 24 * 60 * 60_000 },
] as const;
const LONGEST_WINDOW_MS = Math.max(...LIMITS.map((limit) => limit.windowMs));

function createGenerationLimiter(now: () => number = Date.now) {
  let recent: ReadonlyMap<number, readonly number[]> = new Map();
  return (userId: number): boolean => {
    const at = now();
    const stamps = (recent.get(userId) ?? []).filter((stamp) => stamp > at - LONGEST_WINDOW_MS);
    const blocked = LIMITS.some(({ max, windowMs }) => stamps.filter((stamp) => stamp > at - windowMs).length >= max);
    if (blocked) return false;
    recent = new Map(recent).set(userId, [...stamps, at]);
    return true;
  };
}

export function inquiryRoutes(db: Database, generator: InquiryGenerator | null) {
  const allowGeneration = createGenerationLimiter();

  return new Elysia()
    .use(sessionPlugin(db))
    .onRequest(csrfGuard)
    .get("/api/inquiry/profile", ({ user, set }) => {
      if (!user) return fail(set, 401, "Unauthorized");
      return ok({ ...getProfile(db), llm: generator ? generator.model : null });
    })
    .put(
      "/api/inquiry/profile",
      ({ user, body, set }) => {
        if (!user) return fail(set, 401, "Unauthorized");
        return ok(saveProfile(db, body));
      },
      {
        body: t.Object({
          about: t.String({ maxLength: PROFILE_LIMITS.about }),
          signature: t.String({ maxLength: PROFILE_LIMITS.signature }),
        }),
      },
    )
    .post(
      "/api/listings/:id/inquiry",
      async ({ user, params, set }) => {
        if (!user) return fail(set, 401, "Unauthorized");
        const row = db
          .query<RawListingRow, [string]>(`SELECT ${LISTING_COLUMNS} FROM listings WHERE id = ?`)
          .get(params.id);
        if (!row) return fail(set, 404, "Listing not found");
        if (generator && !allowGeneration(user.id)) return fail(set, 429, "Zu viele Anfragen, bitte kurz warten.");
        return ok(await generateInquiry(rowToListing(row), getProfile(db), generator));
      },
      { params: t.Object({ id: t.String({ minLength: 1, maxLength: 300 }) }) },
    );
}
