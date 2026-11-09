import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { ok, fail } from "../http/envelope";
import { verifyIngestToken } from "../ingest/token";
import { INGEST_PATH, isIngestPath } from "../ingest/routes";
import { getMatches } from "../listings/matches";
import { PROFILE_LIMITS, getProfile, saveProfile } from "./profile";

export const MATCHES_INGEST_PATH = `${INGEST_PATH}/matches`;
export const PROFILE_INGEST_PATH = `${INGEST_PATH}/inquiry-profile`;

// Agent side (bearer INGEST_TOKEN, scraper/ansprache.ts): read the matches
// with the group profile to write inquiries, and store the profile after the
// agent's interview. POST only, like every other ingest route.
export function inquiryAgentRoutes(db: Database, ingestToken: string) {
  return new Elysia()
    // Same reasoning as ingest/routes.ts: authenticate before the body is
    // parsed or validated; onRequest is global, so filter by path.
    .onRequest(({ request, set }) => {
      if (!isIngestPath(new URL(request.url).pathname)) return undefined;
      if (!verifyIngestToken(request.headers.get("authorization"), ingestToken)) {
        return fail(set, 401, "Unauthorized");
      }
      return undefined;
    })
    .post(MATCHES_INGEST_PATH, () => ok({ profile: getProfile(db), matches: getMatches(db) }))
    .post(PROFILE_INGEST_PATH, ({ body }) => ok(saveProfile(db, body)), {
      body: t.Object({
        about: t.String({ maxLength: PROFILE_LIMITS.about }),
        signature: t.String({ maxLength: PROFILE_LIMITS.signature }),
      }),
    });
}
