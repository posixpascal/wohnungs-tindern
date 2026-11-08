// Districts: metadata files (config/districts/<city-slug>.json), canonical names and the per-location filter
// (allowed / excluded / preferred). Pure functions; loading happens in config.ts.

import { HIGHLIGHT_KEYS, type DistrictInfo, type HighlightKey, type Listing, type Location } from "./types";

export const MAX_SUMMARY = 200;
export const MAX_HIGHLIGHT = 300;
/** Mirrors the app's limits (app/src/districts/schema.ts) so config validation reports what a push would reject. */
export const LIMITS = { name: 200, aliases: 30, districts: 200, listItems: 200, cities: 50 } as const;

/** Problems with a name list that exceeds the app's limits. */
export function limitProblems(names: readonly string[], path: string, maxItems: number): string[] {
  return [
    ...(names.length > maxItems ? [`${path} must have at most ${maxItems} entries`] : []),
    ...names.filter((n) => n.length > LIMITS.name).map((n) => `${path}: "${n.slice(0, 40)}…" is longer than ${LIMITS.name} characters`),
  ];
}

/** The three district lists of a location, as in config/search.json and the app's settings. */
export interface DistrictLists {
  readonly allowed_districts: readonly string[];
  readonly excluded_districts: readonly string[];
  readonly preferred_districts: readonly string[];
}

/** A city's district selection as stored by the swipe app (data/district-selection.json). */
export interface DistrictSelection extends DistrictLists {
  readonly city: string;
}

export const DISTRICT_LISTS = ["allowed_districts", "excluded_districts", "preferred_districts"] as const;

/** "Frankfurt am Main" -> "frankfurt-am-main", "Höchst" -> "hoechst". */
export function citySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const fold = (s: string): string => s.trim().toLocaleLowerCase("de-DE");

/** Non-empty trimmed strings, or null when v is not such an array. */
export function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string" && s.trim())) return null;
  return v.map((s: string) => s.trim());
}

function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return null;
  return typeof v === "string" && v.trim().length <= max ? v.trim() || null : undefined;
}

function validateHighlights(v: unknown, path: string): { value: DistrictInfo["highlights"]; problems: string[] } {
  if (v === undefined) return { value: {}, problems: [] };
  if (!isObj(v)) return { value: {}, problems: [`${path} must be an object`] };
  const problems = Object.keys(v).flatMap((k) =>
    HIGHLIGHT_KEYS.includes(k as HighlightKey) ? [] : [`${path}.${k} is unknown (allowed: ${HIGHLIGHT_KEYS.join(", ")})`],
  );
  const entries = HIGHLIGHT_KEYS.flatMap((k): [HighlightKey, string][] => {
    const text = optionalText(v[k], MAX_HIGHLIGHT);
    if (text === undefined) problems.push(`${path}.${k} must be a string of at most ${MAX_HIGHLIGHT} characters`);
    return text ? [[k, text]] : [];
  });
  return { value: Object.fromEntries(entries), problems };
}

function validateDistrict(v: unknown, path: string): { value: DistrictInfo | null; problems: string[] } {
  if (!isObj(v)) return { value: null, problems: [`${path} must be an object`] };
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const aliases = v.aliases === undefined ? [] : stringList(v.aliases);
  const summary = optionalText(v.summary, MAX_SUMMARY);
  const highlights = validateHighlights(v.highlights, `${path}.highlights`);
  const problems = [
    ...(name ? [] : [`${path}.name must be a non-empty string`]),
    ...(name.length > LIMITS.name ? [`${path}.name must be at most ${LIMITS.name} characters`] : []),
    ...(aliases ? limitProblems(aliases, `${path}.aliases`, LIMITS.aliases) : [`${path}.aliases must be an array of strings`]),
    ...(summary === undefined ? [`${path}.summary must be a string of at most ${MAX_SUMMARY} characters`] : []),
    ...highlights.problems,
  ];
  const value = { name, aliases: aliases ?? [], summary: summary ?? null, highlights: highlights.value };
  return { value: problems.length === 0 ? value : null, problems };
}

/** Validates a parsed districts file for `city`; problems are prefixed with `path` (the file name). */
export function validateDistrictFile(
  input: unknown,
  city: string,
  path: string,
): { districts: DistrictInfo[]; problems: string[] } {
  if (!isObj(input)) return { districts: [], problems: [`${path} must be a JSON object`] };
  const cityProblem = input.city === city ? [] : [`${path}.city must be "${city}"`];
  if (!Array.isArray(input.districts) || input.districts.length === 0) {
    return { districts: [], problems: [...cityProblem, `${path}.districts must be a non-empty array`] };
  }
  const tooMany =
    input.districts.length > LIMITS.districts ? [`${path}.districts must have at most ${LIMITS.districts} entries`] : [];
  const results = input.districts.map((d, i) => validateDistrict(d, `${path}.districts[${i}]`));
  const districts = results.flatMap((r) => (r.value ? [r.value] : []));
  const spellings = districts.flatMap((d) => [d.name, ...d.aliases].map((s) => ({ s: fold(s), name: d.name })));
  const clashes = spellings.filter((x) => spellings.some((y) => y.s === x.s && y.name !== x.name)).map((x) => x.s);
  const duplicates = [...new Set(clashes)].map((s) => `${path}: "${s}" is used by more than one district`);
  return { districts, problems: [...cityProblem, ...tooMany, ...results.flatMap((r) => r.problems), ...duplicates] };
}

/** Problems with district lists that name districts unknown to the location's metadata (skipped without metadata). */
export function unknownDistricts(loc: Location, path: string): string[] {
  if (loc.districts.length === 0) return [];
  const known = new Set(loc.districts.flatMap((d) => [d.name, ...d.aliases].map(fold)));
  return DISTRICT_LISTS.flatMap((list) =>
    loc[list].filter((d) => !known.has(fold(d))).map((d) => `${path}.${list}: "${d}" is not in config/districts/${citySlug(loc.city)}.json`),
  );
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Letters incl. umlauts count as word characters so "Bornheimer Landstraße" != "Bornheim".
const containsWord = (text: string, word: string): boolean =>
  new RegExp(`(?<![\\p{L}\\d])${escapeRe(word)}(?![\\p{L}\\d])`, "iu").test(text);

interface Spelling {
  readonly spelling: string;
  readonly name: string;
}

/** Every known spelling -> canonical name, longest first (so "Nordend-West" wins over "Nordend"). */
function spellings(loc: Location): Spelling[] {
  const meta = loc.districts.flatMap((d) => [d.name, ...d.aliases].map((spelling) => ({ spelling, name: d.name })));
  const listed = DISTRICT_LISTS.flatMap((list) => loc[list]).map((spelling) => ({
    spelling,
    name: meta.find((m) => fold(m.spelling) === fold(spelling))?.name ?? spelling,
  }));
  const cityLevel = (s: Spelling): number => (isCityName(s.spelling, loc.city) ? 1 : 0);
  return [...meta, ...listed].sort((a, b) => cityLevel(a) - cityLevel(b) || b.spelling.length - a.spelling.length);
}

/**
 * "Bad Camberg", "Camberg", "Hofheim", "Idstein (Taunus)": a spelling that only
 * names (part of) the city, usually an alias of the core town. Every portal
 * location contains it, so it may only win when no named district matches
 * ("65520 Bad Camberg, Erbach").
 */
function isCityName(spelling: string, city: string): boolean {
  return containsWord(city, spelling.replace(/\s*\([^)]*\)\s*$/, "").trim());
}

/** Maps a portal's district text to the canonical name (exact spelling first, then a contained one); unknown stays as is. */
export function canonicalDistrict(raw: string, loc: Location): string {
  const all = spellings(loc);
  const exact = all.find((s) => fold(s.spelling) === fold(raw));
  if (exact) return exact.name;
  return all.find((s) => containsWord(raw, s.spelling))?.name ?? raw;
}

/** The longest known district spelling mentioned in a free text, as canonical name. */
export function districtInText(text: string, loc: Location): string | null {
  if (!text) return null;
  return spellings(loc).find((s) => containsWord(text, s.spelling))?.name ?? null;
}

const canonicalSet = (names: readonly string[], loc: Location): Set<string> =>
  new Set(names.map((n) => fold(canonicalDistrict(n, loc))));

/** Whitelist incl. preferred districts; empty = the whole city is allowed. */
export function effectiveAllowed(loc: Location): Set<string> {
  if (loc.allowed_districts.length === 0) return new Set();
  return canonicalSet([...loc.allowed_districts, ...loc.preferred_districts], loc);
}

/**
 * German reason when the listing's district is excluded or outside a whitelist, else null.
 * An unknown district only fails a whitelist; `unknownPasses` lets it through (candidates.ts: the detail page decides).
 */
export function districtReason(
  l: Pick<Listing, "city" | "district">,
  locations: readonly Location[],
  unknownPasses = false,
): string | null {
  const loc = locations.find((c) => c.city === l.city);
  if (!loc) return null;
  const allowed = effectiveAllowed(loc);
  if (l.district === null) return allowed.size > 0 && !unknownPasses ? "Stadtteil unbekannt" : null;
  const district = fold(canonicalDistrict(l.district, loc));
  if (canonicalSet(loc.excluded_districts, loc).has(district)) return `Stadtteil ausgeschlossen (${l.district})`;
  if (allowed.size > 0 && !allowed.has(district)) return `Stadtteil nicht im Suchgebiet (${l.district})`;
  return null;
}

/** The canonical preferred district a listing lies in, or null. */
export function preferredDistrict(l: Pick<Listing, "city" | "district">, locations: readonly Location[]): string | null {
  const loc = locations.find((c) => c.city === l.city);
  if (!loc || l.district === null) return null;
  const district = canonicalDistrict(l.district, loc);
  return loc.preferred_districts.some((p) => fold(canonicalDistrict(p, loc)) === fold(district)) ? district : null;
}

/** Validates data/district-selection.json (written by settings.ts from the app's answer). Throws listing every problem. */
export function validateSelection(input: unknown): DistrictSelection[] {
  const cities = isObj(input) && Array.isArray(input.cities) ? input.cities : null;
  if (!cities) throw new Error("district selection must be an object with a cities array");
  const problems: string[] = [];
  const selections = cities.flatMap((c, i): DistrictSelection[] => {
    const path = `cities[${i}]`;
    const city = isObj(c) && typeof c.city === "string" ? c.city.trim() : "";
    if (!isObj(c) || !city) {
      problems.push(`${path}.city must be a non-empty string`);
      return [];
    }
    const read = (list: (typeof DISTRICT_LISTS)[number]): string[] => {
      const names = stringList(c[list] ?? []);
      if (!names) problems.push(`${path}.${list} must be an array of strings`);
      return names ?? [];
    };
    return [
      {
        city,
        allowed_districts: read("allowed_districts"),
        excluded_districts: read("excluded_districts"),
        preferred_districts: read("preferred_districts"),
      },
    ];
  });
  if (problems.length > 0) throw new Error(`invalid district selection:\n- ${problems.join("\n- ")}`);
  return selections;
}

/** The app's selection replaces a location's three lists (app overrides config); other cities keep config/search.json. */
export function applySelection(locations: readonly Location[], selections: readonly DistrictSelection[]): Location[] {
  return locations.map((loc) => {
    const sel = selections.find((s) => s.city === loc.city);
    return sel
      ? {
          ...loc,
          allowed_districts: sel.allowed_districts,
          excluded_districts: sel.excluded_districts,
          preferred_districts: sel.preferred_districts,
        }
      : loc;
  });
}
