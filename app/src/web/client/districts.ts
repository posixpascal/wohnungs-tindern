import { request } from "./api";

// District settings (GET/PUT /api/settings/districts), shared by the group.
// Kept out of api.ts/types.ts so the settings feature stays self-contained.

export type HighlightKey = "shopping" | "culture" | "leisure" | "transit" | "cinema" | "pool" | "sights";

export type DistrictView = {
  name: string;
  summary: string | null;
  highlights: Partial<Record<HighlightKey, string>>;
  active_listings: number;
  described: boolean;
};

export type DistrictLists = {
  allowed_districts: string[];
  excluded_districts: string[];
  preferred_districts: string[];
};

export type CitySettings = DistrictLists & {
  city: string;
  districts: DistrictView[];
  updated_at: string;
  updated_by: string | null;
};

/** One state per district; "neutral" = in no list. */
export type DistrictState = "neutral" | "allowed" | "preferred" | "excluded";

export const districtsApi = {
  load: () => request<CitySettings[]>("/api/settings/districts"),
  save: (city: string, lists: DistrictLists) =>
    request<CitySettings>("/api/settings/districts", { method: "PUT", body: JSON.stringify({ city, ...lists }) }),
};

export function stateOf(settings: DistrictLists, name: string): DistrictState {
  if (settings.preferred_districts.includes(name)) return "preferred";
  if (settings.allowed_districts.includes(name)) return "allowed";
  if (settings.excluded_districts.includes(name)) return "excluded";
  return "neutral";
}

/** New lists with `name` moved into the list of `state` (and out of the others). */
export function withState(settings: DistrictLists, name: string, state: DistrictState): DistrictLists {
  const without = (list: string[]): string[] => list.filter((n) => n !== name);
  const add = (list: string[], target: DistrictState): string[] =>
    state === target ? [...without(list), name] : without(list);
  return {
    allowed_districts: add(settings.allowed_districts, "allowed"),
    excluded_districts: add(settings.excluded_districts, "excluded"),
    preferred_districts: add(settings.preferred_districts, "preferred"),
  };
}

/** German one-liner of what a city's selection means for the search. */
export function selectionSummary(settings: DistrictLists): string {
  const allowed = settings.allowed_districts.length;
  const preferred = settings.preferred_districts.length;
  const excluded = settings.excluded_districts.length;
  const scope = allowed > 0 ? `Nur ${allowed + preferred} ausgewählte Stadtteile` : "Alle Stadtteile";
  const extras = [
    preferred > 0 ? `${preferred} bevorzugt` : null,
    excluded > 0 ? `${excluded} ausgeschlossen` : null,
  ].filter((s): s is string => s !== null);
  return [scope, ...extras].join(" · ");
}
