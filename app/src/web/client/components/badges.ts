import { el } from "../dom";
import type { Listing } from "../types";
import { formatFloor } from "../format";

export function renderBadges(listing: Listing): HTMLElement {
  const badges: HTMLElement[] = [];
  const floorLabel = formatFloor(listing.floor);
  if (floorLabel) badges.push(el("span", { class: "badge" }, [floorLabel]));
  if (listing.has_garden === 1) badges.push(el("span", { class: "badge" }, ["Garten"]));
  if (listing.has_balcony === 1) badges.push(el("span", { class: "badge" }, ["Balkon"]));
  return el("div", { class: "badges" }, badges);
}
