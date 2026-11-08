import type { Database } from "bun:sqlite";
import { randomBytes, createHash } from "node:crypto";

export type SessionUser = {
  readonly id: number;
  readonly username: string;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: Database, userId: number): { token: string; expiresAt: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

export function deleteSession(db: Database, token: string): void {
  db.query("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function findUserBySessionToken(db: Database, token: string): SessionUser | null {
  const row = db
    .query<
      { id: number; username: string; expires_at: string },
      [string]
    >(
      `SELECT users.id AS id, users.username AS username, sessions.expires_at AS expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(hashToken(token));

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.query("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    return null;
  }
  return { id: row.id, username: row.username };
}

export function pruneExpiredSessions(db: Database): void {
  db.query("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}
