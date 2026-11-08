import type { OtherDecision } from "./types";

export const OTHER_DECISION_LABEL: Record<OtherDecision["decision"], string> = {
  liked: "mag das auch \u{1F49B}",
  noped: "mag das nicht",
  pending: "hat noch nicht geswiped",
};

// A listing is a match once every other user ("others" = everyone except
// the requester) has also liked it. Generic over the number of others, not
// hardcoded to a single partner.
export function isMatch(others: readonly OtherDecision[]): boolean {
  return others.length > 0 && others.every((other) => other.decision === "liked");
}
