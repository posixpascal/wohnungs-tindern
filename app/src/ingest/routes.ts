import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { IngestBodySchema } from "./schema";
import { upsertListings } from "./upsert";
import { verifyIngestToken } from "./token";
import { ok, fail } from "../http/envelope";

export const INGEST_PATH = "/api/ingest";

export function ingestRoutes(db: Database, ingestToken: string) {
  return new Elysia()
    // `onRequest` hooks are global across the merged app (not scoped to this
    // plugin), so this filters by path itself. Running the bearer check here
    // — before Elysia parses/validates the body — means an unauthenticated
    // caller never gets the (potentially large) body parsed or sees a schema
    // validation error, only a plain 401.
    .onRequest(({ request, set }) => {
      if (new URL(request.url).pathname !== INGEST_PATH) return undefined;
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
    );
}
