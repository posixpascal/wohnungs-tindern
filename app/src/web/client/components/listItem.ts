import { el } from "../dom";
import type { Listing } from "../types";
import { formatEuro, formatRooms } from "../format";
import { renderBadges } from "./badges";
import { renderPortalLink } from "./portalLink";

export interface ListItemOptions {
  // Opens the detail sheet.
  onOpen: () => void;
  matched?: boolean;
}

// Tries each image in turn on error, falling back to the placeholder only
// once none of them load — never leaves a bare broken <img> visible.
function buildThumb(listing: Listing): HTMLElement {
  let candidates = listing.images;
  const firstSrc = candidates[0];
  if (!firstSrc) return el("div", { class: "thumb thumb-placeholder" });

  const img = el("img", {
    src: firstSrc,
    referrerpolicy: "no-referrer",
    alt: listing.title,
    class: "thumb",
    draggable: "false",
  });
  img.addEventListener("error", () => {
    candidates = candidates.slice(1);
    const next = candidates[0];
    if (next) img.setAttribute("src", next);
    else img.replaceWith(el("div", { class: "thumb thumb-placeholder" }));
  });
  return img;
}

export function renderListItem(listing: Listing, options: ListItemOptions): HTMLElement {
  const thumb = buildThumb(listing);

  const facts = el("div", { class: "list-item-facts" }, [
    `${formatEuro(listing.rent_warm)} € · ${formatRooms(listing.rooms)} Zi · ${listing.area_sqm ?? "?"} m²`,
  ]);

  const location = el("div", { class: "list-item-location" }, [
    listing.district ? `${listing.city} · ${listing.district}` : listing.city,
  ]);

  const scoreLine = el("div", { class: "list-item-score" }, [`Score ${listing.score}/100`]);

  // A real <button> (not the whole row via role="button") so a screen
  // reader/keyboard user gets exactly one, unambiguous control to open the
  // detail sheet — nesting an interactive row around the portal link
  // (also interactive) is what caused Enter on the link to be swallowed by
  // the row before.
  const titleButton = el("button", { type: "button", class: "list-item-title" }, [listing.title]);
  titleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onOpen();
  });

  const body: (Node | string)[] = [titleButton, facts, renderBadges(listing), location, scoreLine];

  if (options.matched) {
    body.push(el("div", { class: "match-badge" }, ["Match ♥♥"]));
  }

  const portalLink = renderPortalLink(listing.url, "portal-link-small");
  if (portalLink) body.push(portalLink);

  const classes = ["list-item", "list-item-clickable"];
  if (listing.status === "gone") classes.push("list-item-gone");
  if (options.matched) classes.push("list-item-match");

  const item = el("div", { class: classes.join(" ") }, [thumb, el("div", { class: "list-item-body" }, body)]);
  // Plain click (mouse/touch) convenience for opening the row anywhere —
  // keyboard access goes through titleButton above instead of this div,
  // so there's no role="button"/tabindex/keydown handling to get wrong.
  item.addEventListener("click", () => options.onOpen());

  if (listing.status === "gone") {
    item.append(el("div", { class: "gone-tag" }, ["nicht mehr online"]));
  }

  return item;
}
