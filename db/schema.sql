-- Shared listings schema. Used by the local scraper DB (data/wohnungen.sqlite)
-- and by the server DB (app adds its own users/sessions/swipes tables).
-- All timestamps are ISO-8601 UTC strings.

CREATE TABLE IF NOT EXISTS listings (
  id                  TEXT PRIMARY KEY,          -- "<portal>:<portal_id>", e.g. "immoscout24:151234567"
  portal              TEXT NOT NULL CHECK (portal IN ('immoscout24','immowelt','kleinanzeigen','wg-gesucht')),
  portal_id           TEXT NOT NULL,
  url                 TEXT NOT NULL,
  title               TEXT NOT NULL,
  city                TEXT NOT NULL,             -- normalized city name from config/search.json
  district            TEXT,
  address             TEXT,
  rent_cold           REAL,                      -- EUR / month
  rent_warm           REAL,                      -- EUR / month (actual or estimated)
  rent_warm_estimated INTEGER NOT NULL DEFAULT 0 CHECK (rent_warm_estimated IN (0,1)),
  rooms               REAL,
  area_sqm            REAL,
  floor               INTEGER,                   -- 0 = Erdgeschoss, -1 = Souterrain, NULL = unknown
  has_garden          INTEGER CHECK (has_garden IN (0,1)),   -- NULL = unknown
  has_balcony         INTEGER CHECK (has_balcony IN (0,1)),  -- NULL = unknown (Terrasse counts as balcony)
  has_bathtub         INTEGER CHECK (has_bathtub IN (0,1)),  -- local DB only (unused and possibly absent on the server), NULL = unknown; added to old DBs by scraper/db.ts migrate()
  available_from      TEXT,
  description         TEXT,
  images              TEXT NOT NULL DEFAULT '[]', -- JSON array of absolute image URLs
  score               INTEGER NOT NULL DEFAULT 0, -- 0..100, computed by scraper/score.ts
  score_notes         TEXT,                       -- short human-readable reasons, German
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','gone')),
  first_seen_at       TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  synced_at           TEXT                        -- local DB only: last successful push to server
);

CREATE UNIQUE INDEX IF NOT EXISTS listings_portal_uq ON listings (portal, portal_id);
CREATE INDEX IF NOT EXISTS listings_first_seen_idx ON listings (first_seen_at);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status);
