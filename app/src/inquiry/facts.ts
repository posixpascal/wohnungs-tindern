// Turns a listing into short German fact phrases ("3 Zimmer", "72 m²", …)
// shared by the template text and the LLM prompt, so both only ever mention
// what the listing actually says.

import type { ApiListing } from "../listings/types";

export type InquiryListing = Pick<
  ApiListing,
  | "title"
  | "city"
  | "district"
  | "address"
  | "rent_cold"
  | "rent_warm"
  | "rent_warm_estimated"
  | "rooms"
  | "area_sqm"
  | "floor"
  | "has_garden"
  | "has_balcony"
  | "available_from"
  | "description"
  | "url"
>;

const euro = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function formatPlace(listing: Pick<InquiryListing, "city" | "district" | "address">): string {
  if (listing.address) return listing.address;
  return listing.district ? `${listing.city}-${listing.district}` : listing.city;
}

function floorLabel(floor: number): string {
  if (floor === 0) return "im Erdgeschoss";
  if (floor < 0) return "im Souterrain";
  return `im ${floor}. Obergeschoss`;
}

// "2025-12-01" -> "01.12.2025"; free text like "sofort" is kept as is.
export function formatAvailable(value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : value;
}

export function listingFacts(listing: InquiryListing): readonly string[] {
  const facts: (string | null)[] = [
    listing.rooms !== null ? `${decimal.format(listing.rooms)} Zimmer` : null,
    listing.area_sqm !== null ? `${decimal.format(listing.area_sqm)} m²` : null,
    listing.floor !== null ? floorLabel(listing.floor) : null,
    listing.has_balcony === 1 ? "mit Balkon" : null,
    listing.has_garden === 1 ? "mit Garten" : null,
    listing.rent_cold !== null ? `${euro.format(listing.rent_cold)} € kalt` : null,
    listing.rent_warm !== null && listing.rent_warm_estimated === 0 ? `${euro.format(listing.rent_warm)} € warm` : null,
    listing.available_from ? `frei ab ${formatAvailable(listing.available_from)}` : null,
  ];
  return facts.filter((fact): fact is string => fact !== null);
}
