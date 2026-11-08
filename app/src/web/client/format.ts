import type { Listing } from "./types";

export function formatEuro(value: number | null): string {
  if (value === null) return "?";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value);
}

export function formatFloor(floor: number | null): string | null {
  if (floor === null) return null;
  if (floor === 0) return "EG";
  if (floor < 0) return "Souterrain";
  return `${floor}. OG`;
}

export function formatRooms(rooms: number | null): string {
  if (rooms === null) return "?";
  return Number.isInteger(rooms) ? String(rooms) : rooms.toFixed(1);
}

// The one-line summary on the card's photo overlay.
export function formatFactsLine(
  listing: Pick<Listing, "rooms" | "area_sqm" | "city" | "district">,
): string {
  const place = listing.district ? `${listing.city} · ${listing.district}` : listing.city;
  return `${formatRooms(listing.rooms)} Zi · ${listing.area_sqm ?? "?"} m² · ${place}`;
}

// Dates from the DB are plain "YYYY-MM-DD" or ISO timestamps; render them
// de-DE style. Invalid/missing input renders as null so callers can decide
// whether to show the field at all.
export function formatDateDE(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

// Defense in depth: the server already filters non-http(s) URLs, but a link
// the user can click should never be rendered from untrusted data without
// re-checking its scheme here too.
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
