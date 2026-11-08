export type Listing = {
  id: string;
  portal: "immoscout24" | "immowelt" | "kleinanzeigen" | "wg-gesucht";
  portal_id: string;
  url: string;
  title: string;
  city: string;
  district: string | null;
  address: string | null;
  rent_cold: number | null;
  rent_warm: number | null;
  rent_warm_estimated: 0 | 1;
  rooms: number | null;
  area_sqm: number | null;
  floor: number | null;
  has_garden: 0 | 1 | null;
  has_balcony: 0 | 1 | null;
  available_from: string | null;
  description: string | null;
  images: string[];
  score: number;
  score_notes: string | null;
  status: "active" | "gone";
  first_seen_at: string;
  last_seen_at: string;
  liked_by?: string[];
};

export type OtherDecision = { username: string; decision: "liked" | "noped" | "pending" };

export type LikedListing = Listing & { others: OtherDecision[] };

export type Envelope<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: string };
