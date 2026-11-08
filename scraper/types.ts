export const PORTALS = ["immoscout24", "immowelt", "kleinanzeigen", "wg-gesucht"] as const;
export type Portal = (typeof PORTALS)[number];

export type Flag = 0 | 1;

export const AMENITIES = ["garden", "balcony", "bathtub"] as const;
export type Amenity = (typeof AMENITIES)[number];

/** What a district offers nearby; shown during onboarding and on the app's settings page (German text). */
export const HIGHLIGHT_KEYS = ["shopping", "culture", "leisure", "transit", "cinema", "pool", "sights"] as const;
export type HighlightKey = (typeof HIGHLIGHT_KEYS)[number];

/** One entry of config/districts/<city-slug>.json. */
export interface DistrictInfo {
  /** Canonical name; listings are stored with it. */
  readonly name: string;
  /** Other spellings used by the portals ("Gallusviertel" for "Gallus"). */
  readonly aliases: readonly string[];
  readonly summary: string | null;
  readonly highlights: Readonly<Partial<Record<HighlightKey, string>>>;
}

export interface Location {
  readonly city: string;
  readonly radius_km: number;
  /** Score bonus; also allowed when allowed_districts is non-empty. */
  readonly preferred_districts: readonly string[];
  /** Whitelist; empty = the whole city. */
  readonly allowed_districts: readonly string[];
  readonly excluded_districts: readonly string[];
  /** Known districts from config/districts/<city-slug>.json; [] without that file. */
  readonly districts: readonly DistrictInfo[];
}

export interface Config {
  readonly budget: { readonly warm_max: number; readonly nebenkosten_estimate_per_sqm: number };
  readonly rooms: { readonly min: number; readonly ideal: number };
  /** Full size points within ideal_min..ideal_max; without a configured range ideal_min = min, ideal_max = Infinity. */
  readonly area_sqm: { readonly min: number; readonly ideal_min: number; readonly ideal_max: number };
  readonly preferences: { readonly amenities: readonly Amenity[]; readonly ground_floor: boolean };
  /** Hard filters beyond budget/rooms/area; unknown listing values pass. */
  readonly requirements: { readonly ground_floor_or_balcony: boolean };
  readonly locations: readonly Location[];
  readonly portals: readonly Portal[];
}

/**
 * Raw record as produced by the browser_evaluate extraction scripts
 * (see .agents/skills/wohnung-suche/portals/*.md). Every field except
 * portal, portal_id, url and title is optional; numbers may be German strings.
 */
export interface RawRecord {
  readonly portal: Portal;
  readonly portal_id: string;
  readonly url: string;
  readonly title: string;
  readonly location?: string;
  readonly city?: string;
  readonly district?: string;
  readonly address?: string;
  readonly rent_cold?: number | string;
  readonly rent_warm?: number | string;
  readonly nebenkosten?: number | string;
  readonly heizkosten?: number | string;
  readonly rooms?: number | string;
  readonly area?: number | string;
  readonly floor?: number | string;
  readonly has_garden?: boolean;
  readonly has_balcony?: boolean;
  readonly available_from?: string;
  readonly available_to?: string;
  readonly features: readonly string[];
  readonly description?: string;
  readonly images: readonly string[];
}

/** One row of the listings table (db/schema.sql) with images decoded. */
export interface Listing {
  readonly id: string;
  readonly portal: Portal;
  readonly portal_id: string;
  readonly url: string;
  readonly title: string;
  readonly city: string;
  readonly district: string | null;
  readonly address: string | null;
  readonly rent_cold: number | null;
  readonly rent_warm: number | null;
  readonly rent_warm_estimated: Flag;
  readonly rooms: number | null;
  readonly area_sqm: number | null;
  readonly floor: number | null;
  readonly has_garden: Flag | null;
  readonly has_balcony: Flag | null;
  /** Local only (not pushed): detected from title/features/description, NULL = unknown. */
  readonly has_bathtub: Flag | null;
  readonly available_from: string | null;
  readonly description: string | null;
  readonly images: readonly string[];
  readonly score: number;
  readonly score_notes: string | null;
  readonly status: "active" | "gone";
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly synced_at: string | null;
}
