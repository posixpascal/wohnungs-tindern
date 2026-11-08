import type { Envelope, Listing, LikedListing } from "./types";

export class ApiError extends Error {}

// Paths that handle their own 401s (the initial session probe, and login
// itself — a wrong password is a 401 too, and must not be treated as "the
// session expired, go to the login view" mid-submit).
const NO_REDIRECT_ON_401 = new Set(["/api/login", "/api/me"]);

let onUnauthorized: (() => void) | null = null;

// Called once from main.ts so any other 401 (queue/swipes/matches/likes)
// routes the user back to the login view instead of failing silently.
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (response.status === 401 && !NO_REDIRECT_ON_401.has(path.split("?")[0] ?? path)) {
    onUnauthorized?.();
  }
  let json: Envelope<T>;
  try {
    json = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError("Server nicht erreichbar");
  }
  if (!json.success) throw new ApiError(json.error ?? "Unbekannter Fehler");
  return json.data;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<null>("/api/logout", { method: "POST", body: "{}" }),
  me: () => request<{ username: string }>("/api/me"),
  queue: (limit = 20) => request<Listing[]>(`/api/queue?limit=${limit}`),
  swipe: (listingId: string, decision: "like" | "nope") =>
    request<{ match: boolean }>("/api/swipes", {
      method: "POST",
      body: JSON.stringify({ listing_id: listingId, decision }),
    }),
  undoSwipe: (listingId: string) =>
    request<{ deleted: boolean }>(`/api/swipes/${encodeURIComponent(listingId)}`, { method: "DELETE" }),
  matches: () => request<Listing[]>("/api/matches"),
  likes: () => request<LikedListing[]>("/api/likes"),
};
