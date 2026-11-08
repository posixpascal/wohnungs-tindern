import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { sessionPlugin } from "../auth/plugin";
import { ok, fail } from "../http/envelope";
import { verifyIngestToken } from "../ingest/token";
import { INGEST_PATH, isIngestPath } from "../ingest/routes";
import { DistrictPushSchema, DistrictSettingsUpdateSchema } from "./schema";
import { DistrictSettingsError, getDistrictSettings, pushDistricts, updateDistrictSettings } from "./store";

export const DISTRICTS_INGEST_PATH = `${INGEST_PATH}/districts`;
export const DISTRICTS_SETTINGS_PATH = "/api/settings/districts";

// Scraper side (bearer INGEST_TOKEN): push metadata, receive the selection.
export function districtIngestRoutes(db: Database, ingestToken: string) {
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
    .post(
      DISTRICTS_INGEST_PATH,
      ({ body, set }) => {
        try {
          return ok({ cities: pushDistricts(db, body, new Date().toISOString()) });
        } catch (error) {
          console.error("[districts] push failed:", error);
          return fail(set, 500, "Internal server error");
        }
      },
      { body: DistrictPushSchema },
    );
}

// Settings page: anyone may read the shared selection (who changed it is
// only shown to members); changing it needs a session.
export function districtSettingsRoutes(db: Database) {
  return new Elysia()
    .use(sessionPlugin(db))
    .get(DISTRICTS_SETTINGS_PATH, ({ user }) => {
      const cities = getDistrictSettings(db);
      return ok(user ? cities : cities.map((city) => ({ ...city, updated_by: null })));
    })
    .put(
      DISTRICTS_SETTINGS_PATH,
      ({ user, body, set }) => {
        if (!user) return fail(set, 401, "Unauthorized");
        try {
          return ok(updateDistrictSettings(db, body, user.username, new Date().toISOString()));
        } catch (error) {
          if (error instanceof DistrictSettingsError) return fail(set, error.status, error.message);
          console.error("[districts] update failed:", error);
          return fail(set, 500, "Internal server error");
        }
      },
      { body: DistrictSettingsUpdateSchema },
    );
}
