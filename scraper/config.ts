import { dirname, join } from "node:path";
import {
  applySelection,
  citySlug,
  DISTRICT_LISTS,
  LIMITS,
  limitProblems,
  stringList,
  unknownDistricts,
  validateDistrictFile,
  validateSelection,
  type DistrictSelection,
} from "./districts";
import { AMENITIES, PORTALS, type Amenity, type Config, type DistrictInfo, type Location, type Portal } from "./types";

/** Repository root for the scraper/ directory below it; handles both path separators (Windows). */
export const repoRoot = (scraperDir: string): string => scraperDir.replace(/[\\/]scraper[\\/]?$/, "");

export const ROOT = repoRoot(import.meta.dir);
export const CONFIG_PATH = `${ROOT}/config/search.json`;
export const DB_PATH = `${ROOT}/data/wohnungen.sqlite`;
export const SCHEMA_PATH = `${ROOT}/db/schema.sql`;
export const REPORTS_DIR = `${ROOT}/reports`;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Problems {
  readonly list: string[] = [];

  num(obj: Obj, key: string, path: string, min: number, fallback?: number): number {
    const v = obj[key];
    if (v === undefined && fallback !== undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min) {
      this.list.push(`${path}.${key} must be a number >= ${min}`);
      return min;
    }
    return v;
  }

  bool(obj: Obj, key: string, path: string): boolean {
    const v = obj[key];
    if (typeof v !== "boolean") this.list.push(`${path}.${key} must be a boolean`);
    return v === true;
  }

  obj(parent: Obj, key: string, optional = false): Obj {
    const v = parent[key];
    if (v === undefined && optional) return {};
    if (!isObj(v)) this.list.push(`${key} must be an object`);
    return isObj(v) ? v : {};
  }
}

/** Parsed config/districts/<city-slug>.json per city; an Error when the file exists but cannot be read or parsed. */
export type DistrictFiles = ReadonlyMap<string, unknown>;

function validateDistricts(p: Problems, city: string, files: DistrictFiles): DistrictInfo[] {
  const file = files.get(city);
  if (file === undefined || !city) return [];
  const path = `config/districts/${citySlug(city)}.json`;
  if (file instanceof Error) {
    p.list.push(`${path}: ${file.message}`);
    return [];
  }
  const { districts, problems } = validateDistrictFile(file, city, path);
  p.list.push(...problems);
  return districts;
}

function validateLocation(p: Problems, v: unknown, i: number, files: DistrictFiles): Location {
  const path = `locations[${i}]`;
  if (!isObj(v)) {
    p.list.push(`${path} must be an object`);
    return { city: "", radius_km: 0, preferred_districts: [], allowed_districts: [], excluded_districts: [], districts: [] };
  }
  const city = typeof v.city === "string" ? v.city.trim() : "";
  if (!city) p.list.push(`${path}.city must be a non-empty string`);
  if (city.length > LIMITS.name) p.list.push(`${path}.city must be at most ${LIMITS.name} characters`);
  const [allowed, excluded, preferred] = DISTRICT_LISTS.map((list) => {
    const names = stringList(v[list] ?? []);
    if (!names) p.list.push(`${path}.${list} must be an array of strings`);
    p.list.push(...limitProblems(names ?? [], `${path}.${list}`, LIMITS.listItems));
    return names ?? [];
  });
  const loc: Location = {
    city,
    radius_km: p.num(v, "radius_km", path, 0, 0),
    preferred_districts: preferred ?? [],
    allowed_districts: allowed ?? [],
    excluded_districts: excluded ?? [],
    districts: validateDistricts(p, city, files),
  };
  p.list.push(...unknownDistricts(loc, path));
  return loc;
}

function validateArea(p: Problems, area: Obj): Config["area_sqm"] {
  const min = p.num(area, "min", "area_sqm", 0, 0);
  const idealMin = p.num(area, "ideal_min", "area_sqm", 0, min);
  const idealMax = p.num(area, "ideal_max", "area_sqm", 0, Infinity);
  if (idealMin < min) p.list.push(`area_sqm.ideal_min must be >= area_sqm.min (${min})`);
  if (idealMax < idealMin) p.list.push(`area_sqm.ideal_max must be >= area_sqm.ideal_min (${idealMin})`);
  return { min, ideal_min: idealMin, ideal_max: idealMax };
}

/** preferences.amenities; falls back to the legacy garden_or_balcony flag. */
function validateAmenities(p: Problems, prefs: Obj): Amenity[] {
  const v = prefs.amenities;
  if (v === undefined) {
    if (prefs.garden_or_balcony === undefined) return [];
    return p.bool(prefs, "garden_or_balcony", "preferences") ? ["garden", "balcony"] : [];
  }
  if (!Array.isArray(v)) {
    p.list.push("preferences.amenities must be an array");
    return [];
  }
  return v.filter((name, i): name is Amenity => {
    const known = AMENITIES.includes(name as Amenity);
    if (!known) p.list.push(`preferences.amenities[${i}] must be one of ${AMENITIES.join(", ")}`);
    return known;
  });
}

function validatePortals(p: Problems, v: unknown): Portal[] {
  if (!Array.isArray(v) || v.length === 0) {
    p.list.push("portals must be a non-empty array");
    return [];
  }
  return v.filter((name, i): name is Portal => {
    const known = PORTALS.includes(name as Portal);
    if (!known) p.list.push(`portals[${i}] must be one of ${PORTALS.join(", ")}`);
    return known;
  });
}

/** Validates parsed search.json content (+ district files by city). Throws one error listing every problem. */
export function validateConfig(input: unknown, districtFiles: DistrictFiles = new Map()): Config {
  if (!isObj(input)) throw new Error("config must be a JSON object");
  const p = new Problems();
  const budget = p.obj(input, "budget");
  const rooms = p.obj(input, "rooms");
  const area = p.obj(input, "area_sqm", true);
  const prefs = p.obj(input, "preferences");
  const reqs = p.obj(input, "requirements", true);

  const roomsMin = p.num(rooms, "min", "rooms", 1);
  const roomsIdeal = p.num(rooms, "ideal", "rooms", 1);
  if (roomsIdeal < roomsMin) p.list.push("rooms.ideal must be >= rooms.min");

  const locations = Array.isArray(input.locations) ? input.locations : [];
  if (locations.length === 0) p.list.push("locations must be a non-empty array");
  if (locations.length > LIMITS.cities) p.list.push(`locations must have at most ${LIMITS.cities} entries`);

  const config: Config = {
    budget: {
      warm_max: p.num(budget, "warm_max", "budget", 1),
      nebenkosten_estimate_per_sqm: p.num(budget, "nebenkosten_estimate_per_sqm", "budget", 0),
    },
    rooms: { min: roomsMin, ideal: roomsIdeal },
    area_sqm: validateArea(p, area),
    preferences: {
      amenities: validateAmenities(p, prefs),
      ground_floor: p.bool(prefs, "ground_floor", "preferences"),
    },
    requirements: {
      ground_floor_or_balcony:
        reqs.ground_floor_or_balcony !== undefined &&
        p.bool(reqs, "ground_floor_or_balcony", "requirements"),
    },
    locations: locations.map((l, i) => validateLocation(p, l, i, districtFiles)),
    portals: validatePortals(p, input.portals),
  };
  if (p.list.length > 0) throw new Error(`invalid config:\n- ${p.list.join("\n- ")}`);
  return config;
}

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

const cityNames = (input: unknown): string[] =>
  isObj(input) && Array.isArray(input.locations)
    ? input.locations.flatMap((l) => (isObj(l) && typeof l.city === "string" && l.city.trim() ? [l.city.trim()] : []))
    : [];

/** Reads config/districts/<city-slug>.json for every configured city that has one. */
async function readDistrictFiles(dir: string, cities: readonly string[]): Promise<DistrictFiles> {
  const entries = await Promise.all(
    cities.map(async (city): Promise<[string, unknown][]> => {
      const path = join(dir, `${citySlug(city)}.json`);
      if (!(await Bun.file(path).exists())) return [];
      return [[city, await readJson(path).catch((err: unknown) => err as Error)]];
    }),
  );
  return new Map(entries.flat());
}

export interface LoadOptions {
  /** Default: config/districts next to the config file. */
  readonly districtsDir?: string;
  /** The app's district selection (written by settings.ts); null = config/search.json only. Default: data/district-selection.json. */
  readonly selectionPath?: string | null;
}

/** Path of the cached app selection for a config file: <repo>/data/district-selection.json. */
export const selectionPathFor = (configPath: string): string =>
  join(dirname(configPath), "..", "data", "district-selection.json");

export async function loadConfig(path: string = CONFIG_PATH, options: LoadOptions = {}): Promise<Config> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (err) {
    throw new Error(`cannot read config ${path}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`config ${path} is not valid JSON: ${(err as Error).message}`);
  }
  const districtsDir = options.districtsDir ?? join(dirname(path), "districts");
  const config = validateConfig(json, await readDistrictFiles(districtsDir, cityNames(json)));
  const selectionPath = options.selectionPath === undefined ? selectionPathFor(path) : options.selectionPath;
  const selection = selectionPath === null ? null : await readSelection(selectionPath);
  return selection ? { ...config, locations: applySelection(config.locations, selection) } : config;
}

/** The app's stored district selection (settings.ts), null without the file. */
export async function readSelection(path: string): Promise<DistrictSelection[] | null> {
  if (!(await Bun.file(path).exists())) return null;
  return validateSelection(await readJson(path));
}

/** German stderr line naming the cities whose district lists come from the app (only `cities`, when given). */
export function selectionNote(selection: readonly DistrictSelection[] | null, cities?: readonly string[]): string {
  const fromApp = (selection ?? []).map((s) => s.city).filter((c) => !cities || cities.includes(c));
  return fromApp.length > 0
    ? `Stadtteil-Auswahl aus der App: ${fromApp.join(", ")}`
    : "Stadtteil-Auswahl aus config/search.json (keine App-Auswahl gespeichert)";
}
