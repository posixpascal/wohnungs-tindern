// Raw portal record -> Listing (unscored) plus hard-criteria checks.

import { canonicalDistrict, districtInText, districtReason } from "./districts";
import { costFromText, exclusionReason, floorFromText, hasBalcony, hasBathtub, hasGarden, shortTermRental } from "./detect";
import { cleanText, parseFloor, parseNumber, parseRooms } from "./parse";
import { largeImages } from "./images";
import { recordId } from "./raw";
import type { Config, Flag, Listing, Location, Portal, RawRecord } from "./types";

export type NormalizeResult = { listing: Listing } | { reason: string };

/** Without area or Nebenkosten, warm rent is assumed to be at least kalt + this buffer. */
export const KALT_ONLY_BUFFER = 150;
export const MAX_IMAGES = 30;
export const MAX_DESCRIPTION = 8000;
/** Sanity bounds: beyond these the parsed values are scraping errors or not a regular flat (Monteurwohnung, WG-Zimmer). */
export const MAX_PLAUSIBLE_ROOMS = 8;
export const MIN_PLAUSIBLE_WARM_PER_SQM = 5;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Frankfurt am Main" also matches "Frankfurt", "Hofheim am Taunus" also "Hofheim". */
const aliases = (city: string): string[] => {
  const short = city.replace(/\s+(am|an der|im|in der|ob der)\s+.+$/i, "");
  return short !== city ? [city, short] : [city];
};

// Letters incl. umlauts count as word characters so "Frankfurter" != "Frankfurt".
const wordRe = (word: string): RegExp => new RegExp(`(?<![\\p{L}\\d])${escapeRe(word)}(?![\\p{L}\\d])`, "giu");

// A short alias must not be followed by another qualifier: "Frankfurt (Oder)", "Hofheim in Unterfranken".
const shortAliasRe = (word: string): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\d])${escapeRe(word)}(?![\\p{L}\\d])(?!\\s*\\((?!\\d))(?!\\s+(?:am|an der|in|im|ob der)\\s)`,
    "giu",
  );

/** Position of the last occurrence of any alias (first = full name, rest = short forms), or -1. */
const lastIndexOf = (text: string, names: readonly string[]): number =>
  Math.max(
    -1,
    ...names.flatMap((n, i) => [...text.matchAll(i === 0 ? wordRe(n) : shortAliasRe(n))].map((m) => m.index ?? -1)),
  );

/** Resolves the configured location from location-like texts (in priority order). */
export function resolveCity(texts: readonly (string | undefined)[], config: Config): Location | null {
  for (const text of texts) {
    if (!text) continue;
    const hits = config.locations
      .map((loc) => ({ loc, at: lastIndexOf(text, aliases(loc.city)) }))
      .filter((h) => h.at >= 0)
      .sort((a, b) => b.at - a.at);
    if (hits[0]) return hits[0].loc;
  }
  return null;
}

const isCityName = (text: string, loc: Location): boolean =>
  aliases(loc.city).some((a) => a.toLowerCase() === text.toLowerCase());

/**
 * Portal district field, else a known district (config/districts, district lists) in location/address,
 * else parsed from the location, else a known district in the title (least reliable: "Nähe Bornheim").
 */
function rawDistrict(r: RawRecord, loc: Location): string | null {
  const explicit = cleanText(r.district, 100);
  if (explicit && !isCityName(explicit, loc)) return explicit;
  return (
    districtInText([r.location, r.address].filter(Boolean).join(" "), loc) ??
    districtFromLocation(r.location ?? "", loc) ??
    districtInText(r.title, loc)
  );
}

/** Canonical district name (config/districts aliases), so every portal stores "Gallus" for "Gallusviertel". */
function resolveDistrict(r: RawRecord, loc: Location): string | null {
  const raw = rawDistrict(r, loc);
  return raw === null ? null : canonicalDistrict(raw, loc);
}

/** Kleinanzeigen's "60316 Nordend": the place after the postcode, unless it is the city itself. */
function districtAfterPostcode(location: string, loc: Location): string | null {
  const place = location.match(/^\s*\d{5}\s+([^,\d]{2,40})$/)?.[1]?.trim();
  return place && !isCityName(place, loc) ? place : null;
}

/** "Straße 1, Zeilsheim, Frankfurt am Main (65931)" -> Zeilsheim; "Frankfurt am Main Griesheim, …" -> Griesheim; "60316 Nordend" -> Nordend. */
function districtFromLocation(location: string, loc: Location): string | null {
  const parts = location.split(",").map((p) => p.trim());
  const idx = parts.findIndex((p) => lastIndexOf(p, aliases(loc.city)) >= 0);
  if (idx < 0) return districtAfterPostcode(location, loc);
  const rest = aliases(loc.city)
    .reduce((s, a) => s.replace(wordRe(a), ""), parts[idx] ?? "")
    .replace(/\(?\d{5}\)?|\bHessen\b|(^|\s)-(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-–\s(]+|[)\s]+$/g, "")
    .trim();
  if (rest) return rest;
  const prev = parts[idx - 1];
  return prev && !/\d/.test(prev) && prev.length <= 40 ? prev : null;
}

interface Rent {
  readonly cold: number | null;
  readonly warm: number | null;
  readonly estimated: Flag;
}

/** Below this a rent is a placeholder ("0 €", "1 € VB"), not a price. */
const MIN_RENT = 100;
const rentAmount = (v: unknown): number | null => {
  const n = parseNumber(v);
  return n !== null && n >= MIN_RENT ? n : null;
};

/** IS24's rent_warm is a calculated total that equals the Kaltmiete when no Nebenkosten are entered; the other portals label it "Warmmiete"/Gesamtmiete. */
const CALCULATED_WARM: readonly Portal[] = ["immoscout24"];
const INCLUSIVE_COSTS = "inkl(?:\\.|usive)?\\s+(?:aller\\s+)?(?:nk|nebenkosten|betriebskosten|heizkosten)\\b";
/** On the price field/features any wording counts; in the description only when it is about the rent. */
const INCLUSIVE_FIELD = new RegExp(`\\b${INCLUSIVE_COSTS}|\\bwarmmiete\\b|\\bpauschalmiete\\b`, "i");
const INCLUSIVE_TEXT = new RegExp(`\\b(?:miete|mietpreis)\\b[^.\\n]{0,30}\\b${INCLUSIVE_COSTS}|\\bpauschalmiete\\b`, "i");

/** Card warm rent, unless it is just IS24's copy of the cold rent without any wording that it includes costs. */
function cardWarm(r: RawRecord, cold: number | null): number | null {
  const warm = rentAmount(r.rent_warm);
  const copiesCold = warm !== null && warm === cold && CALCULATED_WARM.includes(r.portal);
  const inclusive =
    INCLUSIVE_FIELD.test([String(r.rent_warm), ...r.features].join("\n")) || INCLUSIVE_TEXT.test(r.description ?? "");
  return copiesCold && !inclusive ? null : warm;
}

/** A description amount may replace the single card price only within this share of it ("Stellplatz: 120 €" is not the rent). */
const TEXT_RENT_TOLERANCE = 0.5;
const within = (n: number | null, min: number, max: number): number | null => (n !== null && n >= min && n <= max ? n : null);

function resolveRent(r: RawRecord, area: number | null, config: Config): Rent {
  const text = r.description ?? "";
  const card = rentAmount(r.rent_cold);
  const textWarm = costFromText(text, "warmmiete");
  // One card price in both fields: explicit "Kaltmiete:"/"Warmmiete:" lines in the description say which it is.
  if (card !== null && card === rentAmount(r.rent_warm)) {
    const cold = within(costFromText(text, "kaltmiete"), card * (1 - TEXT_RENT_TOLERANCE), card) ?? card;
    const warm = within(textWarm, card, card * (1 + TEXT_RENT_TOLERANCE)) ?? cardWarm(r, card);
    return warm !== null ? { cold, warm, estimated: 0 } : estimateWarm(r, cold, area, config);
  }
  const warm = cardWarm(r, card) ?? textWarm;
  if (warm !== null) return { cold: card, warm, estimated: 0 };
  return card === null ? { cold: null, warm: null, estimated: 0 } : estimateWarm(r, card, area, config);
}

function estimateWarm(r: RawRecord, cold: number, area: number | null, config: Config): Rent {
  const nk = parseNumber(r.nebenkosten) ?? costFromText(r.description ?? "", "nebenkosten");
  const heating = parseNumber(r.heizkosten);
  if (nk !== null && heating !== null) return { cold, warm: round2(cold + nk + heating), estimated: 0 };
  if (nk !== null) return { cold, warm: round2(cold + nk), estimated: 1 };
  if (area !== null) {
    return { cold, warm: round2(cold + area * config.budget.nebenkosten_estimate_per_sqm), estimated: 1 };
  }
  return { cold, warm: cold + KALT_ONLY_BUFFER, estimated: 1 };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const flag = (explicit: boolean | undefined, detected: boolean): Flag | null =>
  explicit !== undefined ? (explicit ? 1 : 0) : detected ? 1 : null;

const roomsFromTitle = (title: string): number | null =>
  parseRooms(title.match(/(?<![\p{L}\d])(\d(?:[.,]5)?)\s*-?\s*(?:zimmer|zi\b|zkb)/iu)?.[1]);

const FLOOR_FEATURE = /geschoss|\b(eg|og|ug)\b|souterrain|parterre|etage/i;
const FLOOR_PLURAL = /etagen|geschosse/i;

const resolveFloor = (r: RawRecord): number | null =>
  parseFloor(r.floor) ??
  r.features
    .filter((f) => FLOOR_FEATURE.test(f) && !FLOOR_PLURAL.test(f))
    .map(parseFloor)
    .find((f) => f !== null) ??
  floorFromText([r.title, ...r.features].join(" ")) ??
  floorFromText(r.description ?? "", true);

export function normalize(r: RawRecord, config: Config, now: string): NormalizeResult {
  const loc = resolveCity([r.city, r.location, r.address], config);
  if (!loc) return { reason: "Ort nicht im Suchgebiet" };
  const excluded = exclusionReason(r.title, [r.description ?? "", ...r.features].join("\n"));
  if (excluded) return { reason: excluded };
  if (shortTermRental(r.available_from, r.available_to)) return { reason: "Zeitwohnen" };

  const area = parseNumber(r.area);
  const rent = resolveRent(r, area, config);
  const featureText = [r.title, ...r.features, r.description ?? ""].join("\n");
  return {
    listing: {
      id: recordId(r),
      portal: r.portal,
      portal_id: r.portal_id,
      url: r.url,
      title: cleanText(r.title, 200) ?? r.portal_id,
      city: loc.city,
      district: resolveDistrict(r, loc),
      address: cleanText(r.address, 200),
      rent_cold: rent.cold,
      rent_warm: rent.warm,
      rent_warm_estimated: rent.estimated,
      rooms: parseRooms(r.rooms) ?? roomsFromTitle(r.title),
      area_sqm: area,
      floor: resolveFloor(r),
      has_garden: flag(r.has_garden, hasGarden(featureText)),
      has_balcony: flag(r.has_balcony, hasBalcony(featureText)),
      has_bathtub: hasBathtub(featureText) ? 1 : null,
      available_from: cleanText(r.available_from, 50),
      description: cleanText(r.description, MAX_DESCRIPTION, true),
      images: largeImages(r.images, MAX_IMAGES),
      score: 0,
      score_notes: null,
      status: "active",
      first_seen_at: now,
      last_seen_at: now,
      synced_at: null,
    },
  };
}

export interface CriteriaOptions {
  /** candidates.ts: an unknown district passes a whitelist so the detail page can tell. */
  readonly unknownDistrictPasses?: boolean;
  /** rescore.ts: the district filter is left to the app queue, so un-excluding brings listings back. */
  readonly ignoreDistrict?: boolean;
}

/** Hard criteria on a normalized listing; returns a German reason or null. */
export function criteriaReason(
  l: Listing,
  config: Config,
  { unknownDistrictPasses = false, ignoreDistrict = false }: CriteriaOptions = {},
): string | null {
  if (!config.portals.includes(l.portal)) return "Portal nicht aktiviert";
  const district = ignoreDistrict ? null : districtReason(l, config.locations, unknownDistrictPasses);
  if (district) return district;
  const implausible = plausibilityReason(l);
  if (implausible) return implausible;
  if (l.rent_warm === null) return "Miete unbekannt";
  if (l.rent_warm > config.budget.warm_max) return `Warmmiete > ${config.budget.warm_max} €`;
  if (l.rooms !== null && l.rooms < config.rooms.min) return `weniger als ${config.rooms.min} Zimmer`;
  if (l.area_sqm !== null && l.area_sqm < config.area_sqm.min) return `kleiner als ${config.area_sqm.min} m²`;
  if (config.requirements.ground_floor_or_balcony && !hasOutdoorSpace(l)) return "kein EG, Balkon oder Garten";
  return null;
}

function plausibilityReason(l: Listing): string | null {
  if (l.rooms !== null && l.rooms > MAX_PLAUSIBLE_ROOMS) return `Zimmerzahl unplausibel (> ${MAX_PLAUSIBLE_ROOMS})`;
  // rent 0 is candidates.ts' placeholder for "no price yet", not a price
  if (l.rent_warm && l.area_sqm && l.rent_warm / l.area_sqm < MIN_PLAUSIBLE_WARM_PER_SQM) {
    return `Warmmiete unplausibel (< ${MIN_PLAUSIBLE_WARM_PER_SQM} €/m²)`;
  }
  return null;
}

/**
 * Confirmed outdoor space: EG, a balcony (covers Terrasse/Loggia, see detect.ts and IS24 "Balkon/Terrasse"),
 * or a garden at ground level (Souterrain or unknown floor) – a shared garden below an upper floor does not count.
 */
function hasOutdoorSpace(l: Listing): boolean {
  const groundLevel = l.floor === null || l.floor <= 0;
  return l.floor === 0 || l.has_balcony === 1 || (l.has_garden === 1 && groundLevel);
}
