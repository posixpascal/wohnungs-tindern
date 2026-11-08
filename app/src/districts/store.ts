import type { Database } from "bun:sqlite";
import type { DistrictLists, DistrictPush, DistrictSettingsUpdate, Highlights } from "./schema";

// District metadata (pushed by the scraper) and the group's shared selection
// per city. The selection is the authority for the scraper once it exists:
// scraper/settings.ts stores it locally and applies it on top of
// config/search.json. A push seeds it from the config only for cities without
// one (or for all cities with `overwrite`).

export type CitySelection = { city: string } & DistrictLists;

export type DistrictView = {
  name: string;
  summary: string | null;
  highlights: Highlights;
  /** Active listings in this district. */
  active_listings: number;
  /** false = only seen in listings, no metadata from config/districts. */
  described: boolean;
};

export type CitySettings = CitySelection & {
  districts: DistrictView[];
  updated_at: string;
  /** null = set by the scraper (config/search.json). */
  updated_by: string | null;
};

type SettingsRow = {
  city: string;
  allowed_districts: string;
  excluded_districts: string;
  preferred_districts: string;
  updated_at: string;
  updated_by: string | null;
};

type DistrictRow = { name: string; aliases: string; summary: string | null; highlights: string };

const LISTS = ["allowed_districts", "excluded_districts", "preferred_districts"] as const;

function parseJson(text: string, fallback: unknown): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const stringArray = (text: string): string[] => {
  const v = parseJson(text, []);
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
};

const highlights = (text: string): Highlights => {
  const v = parseJson(text, {});
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const entries = Object.entries(v).filter(
    (e): e is [keyof Highlights, string] =>
      HIGHLIGHT_KEYS.includes(e[0]) && typeof e[1] === "string",
  );
  return Object.fromEntries(entries);
};

const HIGHLIGHT_KEYS: readonly string[] = ["shopping", "culture", "leisure", "transit", "cinema", "pool", "sights"];

const fold = (s: string): string => s.trim().toLocaleLowerCase("de-DE");

const toSelection = (row: SettingsRow): CitySelection => ({
  city: row.city,
  allowed_districts: stringArray(row.allowed_districts),
  excluded_districts: stringArray(row.excluded_districts),
  preferred_districts: stringArray(row.preferred_districts),
});

const settingsRows = (db: Database): SettingsRow[] =>
  db.query<SettingsRow, []>("SELECT * FROM district_settings ORDER BY position, city").all();

function writeSelection(db: Database, city: string, lists: DistrictLists, now: string, by: string | null): void {
  db.query(
    `UPDATE district_settings
     SET allowed_districts = ?, excluded_districts = ?, preferred_districts = ?, updated_at = ?, updated_by = ?
     WHERE city = ?`,
  ).run(...LISTS.map((l) => JSON.stringify(lists[l])), now, by, city);
}

/**
 * Replaces the pushed cities' district metadata and returns the selection of
 * every city the app knows. Cities missing from the push are kept, unless
 * `overwrite` (config is the authority) drops them with their selection.
 */
export function pushDistricts(db: Database, push: DistrictPush, now: string): CitySelection[] {
  const cities = push.cities.map((c) => c.city);
  const placeholders = cities.map(() => "?").join(", ");
  const insertDistrict = db.query(
    "INSERT OR REPLACE INTO districts (city, name, position, aliases, summary, highlights) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertCity = db.query(
    `INSERT INTO district_settings (city, position, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(city) DO UPDATE SET position = excluded.position`,
  );
  return db.transaction(() => {
    if (push.overwrite) {
      // config is the authority: cities no longer configured go, with their metadata
      db.query(`DELETE FROM district_settings WHERE city NOT IN (${placeholders || "NULL"})`).run(...cities);
      db.query("DELETE FROM districts").run();
    } else {
      db.query(`DELETE FROM districts WHERE city IN (${placeholders || "NULL"})`).run(...cities);
    }
    push.cities.forEach((c, position) => {
      const isNew = !db.query("SELECT 1 FROM district_settings WHERE city = ?").get(c.city);
      insertCity.run(c.city, position, now);
      if (isNew || push.overwrite) writeSelection(db, c.city, c, now, null);
      c.districts.forEach((d, i) =>
        insertDistrict.run(c.city, d.name, i, JSON.stringify(d.aliases), d.summary, JSON.stringify(d.highlights)),
      );
    });
    return settingsRows(db).map(toSelection);
  })();
}

/** Metadata districts first, then districts only seen in listings or only named in the selection. */
function cityDistricts(db: Database, selection: CitySelection): DistrictView[] {
  const { city } = selection;
  const meta = db
    .query<DistrictRow, [string]>("SELECT name, aliases, summary, highlights FROM districts WHERE city = ? ORDER BY position")
    .all(city);
  const counts = db
    .query<{ district: string; n: number }, [string]>(
      `SELECT district, COUNT(*) AS n FROM listings
       WHERE status = 'active' AND city = ? AND district IS NOT NULL GROUP BY district ORDER BY district`,
    )
    .all(city);
  const spellingOf = new Map(meta.flatMap((m) => [m.name, ...stringArray(m.aliases)].map((s) => [fold(s), m.name])));
  const countFor = (name: string): number =>
    counts.filter((c) => (spellingOf.get(fold(c.district)) ?? c.district) === name).reduce((sum, c) => sum + c.n, 0);
  const described = meta.map((m) => ({
    name: m.name,
    summary: m.summary,
    highlights: highlights(m.highlights),
    active_listings: countFor(m.name),
    described: true,
  }));
  const seenOnly = counts
    .filter((c) => !spellingOf.has(fold(c.district)))
    .map((c) => ({ name: c.district, summary: null, highlights: {}, active_listings: c.n, described: false }));
  const shown = new Set([...described, ...seenOnly].map((d) => fold(d.name)));
  const selectedOnly = [...new Set(LISTS.flatMap((l) => selection[l]))]
    .filter((name) => !shown.has(fold(name)))
    .map((name) => ({ name, summary: null, highlights: {}, active_listings: 0, described: false }));
  return [...described, ...seenOnly, ...selectedOnly];
}

export function getDistrictSettings(db: Database): CitySettings[] {
  return settingsRows(db).map((row) => {
    const selection = toSelection(row);
    return { ...selection, districts: cityDistricts(db, selection), updated_at: row.updated_at, updated_by: row.updated_by };
  });
}

export class DistrictSettingsError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

/** Replaces a city's selection; every name must be a district shown for that city and in at most one list. */
export function updateDistrictSettings(
  db: Database,
  update: DistrictSettingsUpdate,
  username: string,
  now: string,
): CitySettings {
  const current = getDistrictSettings(db).find((c) => c.city === update.city);
  if (!current) throw new DistrictSettingsError(404, "Stadt nicht gefunden");
  const known = new Set(current.districts.map((d) => d.name));
  const names = LISTS.flatMap((l) => [...new Set(update[l])]);
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) throw new DistrictSettingsError(400, `Unbekannte Stadtteile: ${unknown.join(", ")}`);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length > 0) throw new DistrictSettingsError(400, `Stadtteil mehrfach gewählt: ${twice.join(", ")}`);
  const lists = Object.fromEntries(LISTS.map((l) => [l, [...new Set(update[l])]])) as DistrictLists;
  writeSelection(db, update.city, lists, now, username);
  return { ...current, ...lists, updated_at: now, updated_by: username };
}

/**
 * SQL condition (listing alias `l`): false for listings the selection rules
 * out – an excluded district, or outside a whitelist (allowed + preferred) incl.
 * an unknown district. Mirrors scraper/districts.ts districtReason.
 */
export const DISTRICT_VISIBLE_SQL = `NOT EXISTS (
  SELECT 1 FROM district_settings ds
  WHERE ds.city = l.city AND (
    EXISTS (SELECT 1 FROM json_each(ds.excluded_districts) e WHERE e.value = l.district COLLATE NOCASE)
    OR (json_array_length(ds.allowed_districts) > 0 AND (l.district IS NULL OR NOT EXISTS (
      SELECT 1 FROM json_each(ds.allowed_districts) a WHERE a.value = l.district COLLATE NOCASE
      UNION ALL
      SELECT 1 FROM json_each(ds.preferred_districts) p WHERE p.value = l.district COLLATE NOCASE
    )))
  )
)`;
