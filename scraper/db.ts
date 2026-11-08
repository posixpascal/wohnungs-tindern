// Local SQLite access for the listings table (schema: db/schema.sql).

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { DB_PATH, SCHEMA_PATH } from "./config";
import { PORTALS, type Flag, type Listing, type Portal } from "./types";

const COLUMNS = [
  "id", "portal", "portal_id", "url", "title", "city", "district", "address",
  "rent_cold", "rent_warm", "rent_warm_estimated", "rooms", "area_sqm", "floor",
  "has_garden", "has_balcony", "has_bathtub", "available_from", "description", "images",
  "score", "score_notes", "status", "first_seen_at", "last_seen_at", "synced_at",
] as const;

/** Columns refreshed on every sighting; first_seen_at and synced_at are preserved. */
const UPDATED_ON_CONFLICT = COLUMNS.filter((c) => !["id", "first_seen_at", "synced_at"].includes(c));

const UPSERT_SQL = `
  INSERT INTO listings (${COLUMNS.join(", ")})
  VALUES (${COLUMNS.map(() => "?").join(", ")})
  ON CONFLICT(id) DO UPDATE SET ${UPDATED_ON_CONFLICT.map((c) => `${c} = excluded.${c}`).join(", ")}`;

type Row = Record<(typeof COLUMNS)[number], string | number | null>;

/** Columns added after the first release: CREATE TABLE IF NOT EXISTS does not add them to an existing DB. */
const ADDED_COLUMNS = [["has_bathtub", "INTEGER CHECK (has_bathtub IN (0,1))"]] as const;

/** Check and ALTER under one write lock, so two processes upgrading an old DB at once don't collide. */
export function migrate(db: Database): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = new Set(db.query<{ name: string }>("PRAGMA table_info(listings)").all().map((c) => c.name));
    for (const [name, definition] of ADDED_COLUMNS) {
      if (!existing.has(name)) db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${definition}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function openDb(path: string = DB_PATH): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  migrate(db);
  return db;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const flag = (v: unknown): Flag | null => (v === 0 || v === 1 ? v : null);

function decodeImages(v: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function rowToListing(row: Row): Listing {
  return {
    id: String(row.id),
    portal: PORTALS.includes(row.portal as Portal) ? (row.portal as Portal) : "immoscout24",
    portal_id: String(row.portal_id),
    url: String(row.url),
    title: String(row.title),
    city: String(row.city),
    district: str(row.district),
    address: str(row.address),
    rent_cold: num(row.rent_cold),
    rent_warm: num(row.rent_warm),
    rent_warm_estimated: flag(row.rent_warm_estimated) ?? 0,
    rooms: num(row.rooms),
    area_sqm: num(row.area_sqm),
    floor: num(row.floor),
    has_garden: flag(row.has_garden),
    has_balcony: flag(row.has_balcony),
    has_bathtub: flag(row.has_bathtub),
    available_from: str(row.available_from),
    description: str(row.description),
    images: decodeImages(row.images),
    score: num(row.score) ?? 0,
    score_notes: str(row.score_notes),
    status: row.status === "gone" ? "gone" : "active",
    first_seen_at: String(row.first_seen_at),
    last_seen_at: String(row.last_seen_at),
    synced_at: str(row.synced_at),
  };
}

export function getListing(db: Database, id: string): Listing | null {
  const row = db.query<Row>("SELECT * FROM listings WHERE id = ?").get(id);
  return row ? rowToListing(row) : null;
}

export function queryListings(db: Database, where: string, ...params: (string | number)[]): Listing[] {
  return db.query<Row>(`SELECT * FROM listings WHERE ${where}`).all(...params).map(rowToListing);
}

/** Inserts or updates a listing. Returns whether the row was new. */
export function upsertListing(db: Database, l: Listing): "new" | "updated" {
  const existed = db.query("SELECT 1 FROM listings WHERE id = ?").get(l.id) !== null;
  const values = COLUMNS.map((c) => (c === "images" ? JSON.stringify(l.images) : l[c]));
  db.query(UPSERT_SQL).run(...values);
  return existed ? "updated" : "new";
}
