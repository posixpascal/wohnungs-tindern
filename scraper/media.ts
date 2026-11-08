// Which images/description survive when a fresh record meets a stored one.
// A detail visit is authoritative (galleries may shrink, texts may get shorter); a list
// sighting only carries thumbnails and a teaser, so it never overrides a detail visit.

/** fresh = fresh detail visit wins, stored = stored detail visit wins, larger = no detail visit: more/longer wins. */
export type Authority = "fresh" | "stored" | "larger";

export const authority = (storedFromDetail: boolean, freshFromDetail: boolean): Authority =>
  freshFromDetail ? "fresh" : storedFromDetail ? "stored" : "larger";

/** Images and description are judged separately: either may come from a list page standing in for an empty detail value. */
export interface MediaAuthority {
  readonly images: Authority;
  readonly description: Authority;
}

const isBlank = (s: string | null | undefined): boolean => !s?.trim();

/** An empty gallery never wins against a non-empty one (an extraction failure must not wipe data). */
export function takesFreshImages(stored: readonly string[], fresh: readonly string[], a: Authority): boolean {
  if (a === "fresh") return fresh.length > 0 || stored.length === 0;
  if (a === "stored") return stored.length === 0;
  return fresh.length >= stored.length;
}

/** A blank text never wins against a non-blank one. */
export function takesFreshDescription(stored: string | null | undefined, fresh: string | null | undefined, a: Authority): boolean {
  if (isBlank(fresh) || isBlank(stored)) return isBlank(stored);
  if (a === "fresh") return true;
  if (a === "stored") return false;
  return (fresh?.length ?? 0) >= (stored?.length ?? 0);
}

export const pickImages = (stored: readonly string[], fresh: readonly string[], a: Authority): readonly string[] =>
  takesFreshImages(stored, fresh, a) ? fresh : stored;

export const pickDescription = <T extends string | null | undefined>(stored: T, fresh: T, a: Authority): T =>
  takesFreshDescription(stored, fresh, a) ? fresh : stored;
