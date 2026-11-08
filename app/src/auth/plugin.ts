import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { findUserBySessionToken, type SessionUser } from "./session";

export const SESSION_COOKIE_NAME = "session";

// Derives `user: SessionUser | null` on every request from the session
// cookie. Protected routes check `user` themselves and return 401 if absent.
export function sessionPlugin(db: Database) {
  return new Elysia({ name: "session-plugin" }).derive(
    { as: "global" },
    ({ cookie }): { user: SessionUser | null } => {
      const token = cookie[SESSION_COOKIE_NAME]?.value;
      const user = typeof token === "string" && token.length > 0 ? findUserBySessionToken(db, token) : null;
      return { user };
    },
  );
}
