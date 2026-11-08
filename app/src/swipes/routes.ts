import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { sessionPlugin } from "../auth/plugin";
import { csrfGuard } from "../auth/request";
import { ok, fail } from "../http/envelope";
import { recordSwipe, deleteSwipe, ListingNotFoundError } from "./logic";

export function swipesRoutes(db: Database) {
  return new Elysia()
    .use(sessionPlugin(db))
    .onRequest(csrfGuard)
    .post(
      "/api/swipes",
      ({ user, body, set }) => {
        if (!user) return fail(set, 401, "Unauthorized");

        try {
          const result = recordSwipe(db, user.id, body.listing_id, body.decision);
          return ok(result);
        } catch (error) {
          if (error instanceof ListingNotFoundError) return fail(set, 404, "Listing not found");
          console.error("[swipes] record failed:", error);
          return fail(set, 500, "Internal server error");
        }
      },
      {
        body: t.Object({
          listing_id: t.String({ minLength: 1, maxLength: 300 }),
          decision: t.Union([t.Literal("like"), t.Literal("nope")]),
        }),
      },
    )
    .delete(
      "/api/swipes/:listingId",
      ({ user, params, set }) => {
        if (!user) return fail(set, 401, "Unauthorized");

        const deleted = deleteSwipe(db, user.id, params.listingId);
        return ok({ deleted });
      },
      { params: t.Object({ listingId: t.String({ minLength: 1, maxLength: 300 }) }) },
    );
}
