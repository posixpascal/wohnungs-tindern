import type { Database } from "bun:sqlite";
import type { AppEnv } from "./env";
import { buildApp } from "./app";
import { pruneExpiredSessions } from "./auth/session";
import { fail } from "./http/envelope";
import indexHtml from "./web/dist/index.html" with { type: "text" };
import appJs from "./web/dist/app.js" with { type: "text" };
import appCss from "./web/dist/app.css" with { type: "text" };

const MAX_REQUEST_BODY_SIZE = 8 * 1024 * 1024; // 8 MiB
const SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly

// Wraps the API app with the embedded frontend bundle (built by
// `bun run build:web` into src/web/dist/* before this module is imported).
// Exported separately from `serve()` so tests can exercise routing/fallback
// behavior via `.handle()` without actually binding a port.
export function buildServedApp(db: Database, env: AppEnv) {
  return buildApp(db, env)
    .get("/assets/app.js", ({ set }) => {
      set.headers["content-type"] = "text/javascript; charset=utf-8";
      return appJs;
    })
    .get("/assets/app.css", ({ set }) => {
      set.headers["content-type"] = "text/css; charset=utf-8";
      return appCss;
    })
    // Wildcard fallback for the SPA. `/api/*` must never fall through to
    // index.html (a client requesting a bad/old API path should see a JSON
    // 404, not an HTML page it'll fail to parse as JSON) — checked here
    // because a more specific `/api/*` route declared alongside `*` does not
    // take priority over it in Elysia's router.
    .get("*", ({ request, set }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/")) return fail(set, 404, "Not found");
      set.headers["content-type"] = "text/html; charset=utf-8";
      return indexHtml;
    });
}

export function serve(db: Database, env: AppEnv): void {
  const app = buildServedApp(db, env);
  app.listen({ hostname: env.host, port: env.port, maxRequestBodySize: MAX_REQUEST_BODY_SIZE });
  console.log(`wohnung-finden listening on http://${env.host}:${env.port}`);

  setInterval(() => pruneExpiredSessions(db), SESSION_PRUNE_INTERVAL_MS);
}
