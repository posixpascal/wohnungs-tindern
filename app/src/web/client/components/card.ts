import { el } from "../dom";
import type { Listing } from "../types";
import { formatEuro, formatFactsLine } from "../format";
import { renderBadges } from "./badges";
import { renderCarousel } from "./carousel";
import { renderDetailGrid } from "./detailGrid";
import { renderDescription } from "./description";
import { renderInfoIcon } from "./icon";
import { renderPortalLink } from "./portalLink";

const rentText = (listing: Listing): string =>
  `~ ${formatEuro(listing.rent_warm)} € warm${listing.rent_warm_estimated === 1 ? " (geschätzt)" : ""}`;

const likedHint = (likedBy: readonly string[]): HTMLElement | null =>
  likedBy.length > 0
    ? el("div", { class: "partner-hint" }, [`\u{1F49B} ${likedBy.join(" & ")} ${likedBy.length > 1 ? "mögen" : "mag"} das`])
    : null;

function flipButton(label: string): HTMLButtonElement {
  return el("button", { type: "button", class: "card-flip-button", "aria-label": label }, [renderInfoIcon("card-flip-icon")]);
}

// Front: the photos fill the whole card, with title/rent/facts on a gradient
// at the bottom so the text never fights the image for space.
function renderFront(listing: Listing, likedBy: readonly string[], button: HTMLButtonElement): HTMLElement {
  const hint = likedHint(likedBy);
  const overlay = el("div", { class: "card-overlay" }, [
    el("h2", { class: "card-title" }, [listing.title]),
    el("div", { class: "rent-line" }, [rentText(listing)]),
    el("div", { class: "facts-line" }, [formatFactsLine(listing)]),
    ...(hint ? [hint] : []),
  ]);
  return el("div", { class: "card-face card-front" }, [
    renderCarousel({ images: listing.images, alt: listing.title }),
    overlay,
    button,
  ]);
}

// Back: everything about the listing, scrollable.
function renderBack(
  listing: Listing,
  likedBy: readonly string[],
  button: HTMLButtonElement,
): { face: HTMLElement; body: HTMLElement } {
  const hint = likedHint(likedBy);
  const link = renderPortalLink(listing.url, "portal-link-button");
  const body = el("div", { class: "card-back-body" }, [
    el("h2", { class: "card-title" }, [listing.title]),
    el("div", { class: "rent-line" }, [rentText(listing)]),
    renderBadges(listing),
    ...(hint ? [hint] : []),
    ...(link ? [link] : []),
    renderDetailGrid(listing),
    renderDescription(listing.description),
  ]);
  return { face: el("div", { class: "card-face card-back" }, [body, button]), body };
}

// The info button in the top right flips the card between photos and details.
export function renderCard(listing: Listing, likedBy: readonly string[]): HTMLElement {
  const showDetails = flipButton("Details anzeigen");
  const showPhotos = flipButton("Bilder anzeigen");
  const front = renderFront(listing, likedBy, showDetails);
  const { face: back, body: backBody } = renderBack(listing, likedBy, showPhotos);
  const card = el("article", { class: "card" }, [el("div", { class: "card-inner" }, [front, back])]);

  function flip(toBack: boolean): void {
    card.classList.toggle("card-flipped", toBack);
    // the hidden face must not be reachable by keyboard / screen reader
    front.toggleAttribute("inert", toBack);
    back.toggleAttribute("inert", !toBack);
    if (toBack) backBody.scrollTo(0, 0);
    (toBack ? showPhotos : showDetails).focus({ preventScroll: true });
  }

  back.toggleAttribute("inert", true);
  showDetails.addEventListener("click", () => flip(true));
  showPhotos.addEventListener("click", () => flip(false));
  return card;
}
