import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { sessionPlugin } from "../auth/plugin";
import { ok, fail } from "../http/envelope";
import { getQueue } from "./queue";
import { getMatches } from "./matches";
import { getMyLikes } from "./likes";

const DEFAULT_QUEUE_LIMIT = 20;
const MAX_QUEUE_LIMIT = 100;

export function listingsRoutes(db: Database) {
  return new Elysia()
    .use(sessionPlugin(db))
    .get(
      "/api/queue",
      ({ user, query, set }) => {
        if (!user) return fail(set, 401, "Unauthorized");
        const requested = query.limit ? Number.parseInt(query.limit, 10) : DEFAULT_QUEUE_LIMIT;
        const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_QUEUE_LIMIT) : DEFAULT_QUEUE_LIMIT;
        return ok(getQueue(db, user.id, limit));
      },
      { query: t.Object({ limit: t.Optional(t.String()) }) },
    )
    .get("/api/matches", ({ user, set }) => {
      if (!user) return fail(set, 401, "Unauthorized");
      return ok(getMatches(db));
    })
    .get("/api/likes", ({ user, set }) => {
      if (!user) return fail(set, 401, "Unauthorized");
      return ok(getMyLikes(db, user.id));
    });
}
