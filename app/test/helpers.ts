import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { hashPassword } from "../src/auth/password";
import type { AppEnv } from "../src/env";

export function testEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    port: 3000,
    host: "127.0.0.1",
    dbPath: ":memory:",
    ingestToken: "test-ingest-token-32-characters!!",
    cookieSecure: false,
    trustProxy: false,
    inquiry: null,
    ...overrides,
  };
}

export function testDb(): Database {
  return openDb(":memory:");
}

export async function createUser(db: Database, username: string, password: string): Promise<number> {
  const hash = await hashPassword(password);
  const result = db
    .query("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, hash);
  return Number(result.lastInsertRowid);
}

export function jsonRequest(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

export function extractSessionCookie(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) throw new Error("No Set-Cookie header on response");
  const pair = raw.split(";")[0];
  if (!pair) throw new Error("Malformed Set-Cookie header");
  return pair;
}

export type ListingFixture = {
  id: string;
  portal?: string;
  city?: string;
  score?: number;
  status?: "active" | "gone";
  firstSeenAt?: string;
  lastSeenAt?: string;
};

export function insertListing(db: Database, fixture: ListingFixture): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO listings (
       id, portal, portal_id, url, title, city, rent_warm_estimated, images,
       score, status, first_seen_at, last_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, ?, ?, ?)`,
  ).run(
    fixture.id,
    fixture.portal ?? "immoscout24",
    fixture.id,
    `https://example.com/${fixture.id}`,
    `Listing ${fixture.id}`,
    fixture.city ?? "Frankfurt am Main",
    fixture.score ?? 50,
    fixture.status ?? "active",
    fixture.firstSeenAt ?? now,
    fixture.lastSeenAt ?? now,
  );
}
