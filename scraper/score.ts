// Pure scoring 0..100 with short German notes.

import { preferredDistrict } from "./districts";
import type { Amenity, Config, Listing } from "./types";

export interface Score {
  readonly score: number;
  readonly notes: string;
}

interface Part {
  readonly points: number;
  readonly note: string | null;
}

const WEIGHTS = { rooms: 20, size: 20, garden: 11, balcony: 7, bathtub: 8, ground: 12, price: 12, district: 10 } as const;
/** Price points reach the maximum at one third below budget. */
const PRICE_FULL_AT = 1 / 3;
/** Above ideal_max size points fall linearly to zero over this many m² (110 m² ≈ 86 %, 140 m² ≈ 43 %). */
const SIZE_DROP_SPAN_SQM = 70;
/** Share of the rooms weight: unknown, more than ideal, and the range from min to just below ideal. */
const ROOMS_UNKNOWN = 1 / 6;
const ROOMS_ABOVE_IDEAL = 0.73;
const ROOMS_BELOW_IDEAL = { from: 1 / 3, to: 0.87 } as const;
/** Share of the ground-floor weight for the 1st floor. */
const FIRST_FLOOR = 1 / 3;

const AMENITY_NOTES: Readonly<Record<Amenity, string>> = { garden: "Garten ✓", balcony: "Balkon ✓", bathtub: "Wanne ✓" };
const AMENITY_FLAGS = { garden: "has_garden", balcony: "has_balcony", bathtub: "has_bathtub" } as const;

const euro = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function roomsPart(rooms: number | null, config: Config): Part {
  if (rooms === null) return { points: ROOMS_UNKNOWN * WEIGHTS.rooms, note: "Zi ?" };
  const label = `${decimal.format(rooms)} Zi`;
  if (rooms === config.rooms.ideal) return { points: WEIGHTS.rooms, note: `${label} ✓` };
  if (rooms > config.rooms.ideal) return { points: ROOMS_ABOVE_IDEAL * WEIGHTS.rooms, note: label };
  const span = config.rooms.ideal - config.rooms.min;
  const ratio = span > 0 ? clamp01((rooms - config.rooms.min) / span) : 0;
  const { from, to } = ROOMS_BELOW_IDEAL;
  return { points: (from + ratio * (to - from)) * WEIGHTS.rooms, note: label };
}

function amenityPart(amenity: Amenity, l: Listing, config: Config): Part {
  if (!config.preferences.amenities.includes(amenity) || l[AMENITY_FLAGS[amenity]] !== 1) return { points: 0, note: null };
  return { points: WEIGHTS[amenity], note: AMENITY_NOTES[amenity] };
}

function floorPart(floor: number | null, config: Config): Part {
  if (floor === null) return { points: 0, note: null };
  const note = floor === 0 ? "EG ✓" : floor < 0 ? "Souterrain" : `${floor}. OG`;
  if (!config.preferences.ground_floor) return { points: 0, note: floor === 0 ? "EG" : note };
  if (floor === 0) return { points: WEIGHTS.ground, note };
  return { points: floor === 1 ? FIRST_FLOOR * WEIGHTS.ground : 0, note };
}

function pricePart(l: Listing, config: Config): Part {
  if (l.rent_warm === null) return { points: 0, note: null };
  const headroom = (config.budget.warm_max - l.rent_warm) / config.budget.warm_max;
  const note = `warm ${euro.format(l.rent_warm)} €${l.rent_warm_estimated ? " (geschätzt)" : ""}`;
  return { points: clamp01(headroom / PRICE_FULL_AT) * WEIGHTS.price, note };
}

/** Warn only: "halbe Warmmiete im Dezember" and similar make the warm rent unreliable. */
const rentWarningPart = (l: Listing): Part => ({
  points: 0,
  note: l.rent_warm !== null && l.rent_cold !== null && l.rent_warm < l.rent_cold ? "⚠ warm < kalt" : null,
});

function districtPart(l: Listing, config: Config): Part {
  const preferred = preferredDistrict(l, config.locations);
  return preferred ? { points: WEIGHTS.district, note: `${preferred} ✓` } : { points: 0, note: null };
}

/** Full points inside the ideal range, linear rise from min, gentle linear drop above. */
function sizePart(area: number | null, config: Config): Part {
  if (area === null) return { points: 0, note: null };
  const { min, ideal_min, ideal_max } = config.area_sqm;
  const label = `${decimal.format(area)} m²`;
  if (area < ideal_min) {
    const ratio = clamp01((area - min) / (ideal_min - min));
    return { points: ratio * WEIGHTS.size, note: `${label} (< ${decimal.format(ideal_min)})` };
  }
  if (area > ideal_max) {
    const ratio = clamp01(1 - (area - ideal_max) / SIZE_DROP_SPAN_SQM);
    return { points: ratio * WEIGHTS.size, note: `${label} (> ${decimal.format(ideal_max)})` };
  }
  return { points: WEIGHTS.size, note: `${label} ✓` };
}

export function scoreListing(l: Listing, config: Config): Score {
  const parts = [
    roomsPart(l.rooms, config),
    floorPart(l.floor, config),
    amenityPart("garden", l, config),
    amenityPart("balcony", l, config),
    amenityPart("bathtub", l, config),
    pricePart(l, config),
    rentWarningPart(l),
    districtPart(l, config),
    sizePart(l.area_sqm, config),
  ];
  const total = parts.reduce((sum, p) => sum + p.points, 0);
  return {
    score: Math.round(Math.min(100, Math.max(0, total))),
    notes: parts.flatMap((p) => (p.note ? [p.note] : [])).join(", "),
  };
}
