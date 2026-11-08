import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import type { AppEnv } from "./env";
import { sessionPlugin } from "./auth/plugin";
import { authRoutes } from "./auth/routes";
import { LoginRateLimiter } from "./auth/rateLimit";
import { ingestRoutes } from "./ingest/routes";
import { listingsRoutes } from "./listings/routes";
import { swipesRoutes } from "./swipes/routes";
import { ok, fail } from "./http/envelope";

// Builds the API-only Elysia app (no static frontend assets). Used directly
// by tests and wrapped by src/server.ts for the `serve` CLI command, which
// additionally mounts the embedded frontend bundle.
export function buildApp(db: Database, env: AppEnv) {
  const limiter = new LoginRateLimiter();

  return new Elysia()
    .onError(({ code, error, set }) => {
      console.error(`[http] ${code}:`, error);
      if (code === "VALIDATION") return fail(set, 400, "Invalid request");
      if (code === "NOT_FOUND") return fail(set, 404, "Not found");
      return fail(set, 500, "Internal server error");
    })
    .use(sessionPlugin(db))
    .get("/healthz", () => ok({ status: "ok" }))
    .use(authRoutes(db, env, limiter))
    .use(ingestRoutes(db, env.ingestToken))
    .use(listingsRoutes(db))
    .use(swipesRoutes(db));
}

export type App = ReturnType<typeof buildApp>;
