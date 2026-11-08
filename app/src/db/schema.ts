import listingsSchema from "../../../db/schema.sql" with { type: "text" };

// Server-only tables, applied in addition to the shared listings schema.
// users/sessions/swipes are owned entirely by the app (the scraper never
// touches them).
const appSchema = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS swipes (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  decision   TEXT NOT NULL CHECK (decision IN ('like', 'nope')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS swipes_listing_idx ON swipes (listing_id);
`;

export const fullSchema = `${listingsSchema}\n${appSchema}`;
