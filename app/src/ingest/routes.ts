import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { IngestBodySchema } from "./schema";
import { upsertListings } from "./upsert";
import { verifyIngestToken } from "./token";
import { ok, fail } from "../http/envelope";
import { getWatchlist } from "../listings/watchlist";

export const INGEST_PATH = "/api/ingest";
export const WATCHLIST_PATH = `${INGEST_PATH}/watchlist`;

// Everything under the ingest prefix is token-protected (and CSRF-exempt, see
// auth/request.ts). A prefix match, not an exact one: Elysia also routes
// "/api/ingest/" to "/api/ingest", so an exact comparison would let a
// trailing slash skip the token check.
export function isIngestPath(pathname: string): boolean {
  return pathname === INGEST_PATH || pathname.startsWith(`${INGEST_PATH}/`);
}

export function ingestRoutes(db: Database, ingestToken: string) {
  return new Elysia()
    // `onRequest` hooks are global across the merged app (not scoped to this
    // plugin), so this filters by path itself. Running the bearer check here
    // — before Elysia parses/validates the body — means an unauthenticated
    // caller never gets the (potentially large) body parsed or sees a schema
    // validation error, only a plain 401.
    .onRequest(({ request, set }) => {
      if (!isIngestPath(new URL(request.url).pathname)) return undefined;
      if (!verifyIngestToken(request.headers.get("authorization"), ingestToken)) {
        return fail(set, 401, "Unauthorized");
      }
      return undefined;
    })
    .post(
      INGEST_PATH,
      ({ body, set }) => {
        try {
          const result = upsertListings(db, body.listings);
          return ok(result);
        } catch (error) {
          console.error("[ingest] upsert failed:", error);
          return fail(set, 500, "Internal server error");
        }
      },
      { body: IngestBodySchema },
    )
    // Listings the scraper's end-of-run availability check revisits (scraper/availability.ts).
    .post(WATCHLIST_PATH, () => ok({ listings: getWatchlist(db) }));
}
