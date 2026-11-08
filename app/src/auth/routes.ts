import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { verifyPassword } from "./password";
import { createSession, deleteSession, pruneExpiredSessions } from "./session";
import { LoginRateLimiter } from "./rateLimit";
import { getClientIp, csrfGuard } from "./request";
import { ok, fail } from "../http/envelope";
import { SESSION_COOKIE_NAME, sessionPlugin } from "./plugin";
import type { AppEnv } from "../env";

// Fixed-cost dummy hash so a login attempt for a non-existent username takes
// the same time as a wrong-password attempt (no username enumeration via timing).
const DUMMY_HASH = await Bun.password.hash("not-a-real-password-used-only-for-timing-safety");

type UserRow = { id: number; username: string; password_hash: string };

export function authRoutes(db: Database, env: AppEnv, limiter: LoginRateLimiter) {
  return new Elysia()
    .use(sessionPlugin(db))
    .onRequest(csrfGuard)
    .post(
      "/api/login",
      async ({ body, request, server, set, cookie }) => {
        const ip = getClientIp(request, env.trustProxy, server);
        if (limiter.isBlocked(ip, body.username)) {
          return fail(set, 429, "Too many attempts, try again later");
        }

        // Record the attempt *before* the slow argon2 verify below, so
        // parallel requests can't all observe isBlocked()===false and pass
        // through together — recordSuccess() clears it again if this
        // attempt turns out to be valid.
        limiter.recordAttempt(ip, body.username);

        if (!limiter.tryAcquireVerificationSlot()) {
          return fail(set, 429, "Server busy, try again shortly");
        }

        try {
          const row = db
            .query<UserRow, [string]>("SELECT id, username, password_hash FROM users WHERE username = ?")
            .get(body.username);

          const passwordValid = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH);
          if (!row || !passwordValid) {
            return fail(set, 401, "Invalid credentials");
          }

          limiter.recordSuccess(ip, body.username);
          pruneExpiredSessions(db);

          // If the browser already presented a session cookie (e.g. logging
          // in again without logging out first), delete that old session
          // rather than leaving it valid alongside the new one.
          const presentedToken = cookie[SESSION_COOKIE_NAME]?.value;
          if (typeof presentedToken === "string" && presentedToken.length > 0) {
            deleteSession(db, presentedToken);
          }

          const { token, expiresAt } = createSession(db, row.id);
          cookie[SESSION_COOKIE_NAME]!.set({
            value: token,
            httpOnly: true,
            secure: env.cookieSecure,
            sameSite: "lax",
            path: "/",
            expires: new Date(expiresAt),
          });
          return ok({ username: row.username });
        } finally {
          limiter.releaseVerificationSlot();
        }
      },
      {
        body: t.Object({
          username: t.String({ minLength: 1, maxLength: 100 }),
          password: t.String({ minLength: 1, maxLength: 200 }),
        }),
      },
    )
    .post("/api/logout", ({ cookie }) => {
      const token = cookie[SESSION_COOKIE_NAME]?.value;
      if (typeof token === "string" && token.length > 0) deleteSession(db, token);
      cookie[SESSION_COOKIE_NAME]!.remove();
      return ok(null);
    })
    .get("/api/me", ({ user, set }) => {
      if (!user) return fail(set, 401, "Unauthorized");
      return ok({ username: user.username });
    });
}
