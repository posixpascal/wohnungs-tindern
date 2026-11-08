import { AMENITIES, PORTALS, type Amenity, type Config, type Location, type Portal } from "./types";

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

function validateLocation(p: Problems, v: unknown, i: number): Location {
  const path = `locations[${i}]`;
  if (!isObj(v)) {
    p.list.push(`${path} must be an object`);
    return { city: "", radius_km: 0, preferred_districts: [] };
  }
  const city = typeof v.city === "string" ? v.city.trim() : "";
  if (!city) p.list.push(`${path}.city must be a non-empty string`);
  const districts = v.preferred_districts ?? [];
  const validDistricts = Array.isArray(districts) && districts.every((d) => typeof d === "string" && d.trim());
  if (!validDistricts) p.list.push(`${path}.preferred_districts must be an array of strings`);
  return {
    city,
    radius_km: p.num(v, "radius_km", path, 0, 0),
    preferred_districts: validDistricts ? (districts as string[]).map((d) => d.trim()) : [],
  };
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

/** Validates parsed search.json content. Throws one error listing every problem. */
export function validateConfig(input: unknown): Config {
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
    locations: locations.map((l, i) => validateLocation(p, l, i)),
    portals: validatePortals(p, input.portals),
  };
  if (p.list.length > 0) throw new Error(`invalid config:\n- ${p.list.join("\n- ")}`);
  return config;
}

export async function loadConfig(path: string = CONFIG_PATH): Promise<Config> {
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
  return validateConfig(json);
}
