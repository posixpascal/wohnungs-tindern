import { el } from "../dom";
import { ApiError } from "../api";
import type { Listing, LikedListing } from "../types";
import { OTHER_DECISION_LABEL, isMatch } from "../otherStatus";
import { renderCarousel } from "./carousel";
import { renderDetailGrid } from "./detailGrid";
import { renderDescription } from "./description";
import { renderPortalLink } from "./portalLink";
import { pushModal } from "../modalStackInstance";

export interface DetailSheetOptions {
  listing: Listing | LikedListing;
  // Only passed from the Likes tab: shows the "Aus Shortlist entfernen"
  // action, wired to api.swipe(id, "nope") by the caller.
  onRemove?: () => Promise<void>;
}

// Full-screen overlay with back button; shown from both the Likes and
// Matches lists so there's exactly one place that renders "everything about
// a listing".
export function openDetailSheet(options: DetailSheetOptions): void {
  const { listing } = options;

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backButton = el("button", { class: "control undo detail-back", type: "button", "aria-label": "Zurück" }, [
    "←",
  ]);
  const titleEl = el("h2", { class: "card-title" }, [listing.title]);
  const header = el("div", { class: "detail-header" }, [backButton, titleEl]);

  const dataGrid = renderDetailGrid(listing);

  const bodyChildren: (Node | string)[] = [
    renderCarousel({ images: listing.images, alt: listing.title, swipeable: true }),
    dataGrid,
    renderDescription(listing.description),
  ];

  if ("others" in listing) {
    const matched = isMatch(listing.others);
    const statusLines = listing.others.map((other) =>
      el("div", {}, [`${other.username}: ${OTHER_DECISION_LABEL[other.decision]}`]),
    );
    const partnerStatusChildren: (HTMLElement | null)[] = [
      matched ? el("div", { class: "match-badge" }, ["Match ♥♥"]) : null,
      ...statusLines,
    ];
    bodyChildren.push(
      el(
        "div",
        { class: "detail-partner-status" },
        partnerStatusChildren.filter((node): node is HTMLElement => node !== null),
      ),
    );
  }

  const portalLink = renderPortalLink(listing.url, "portal-link-button");
  if (portalLink) bodyChildren.push(el("div", { class: "detail-actions" }, [portalLink]));

  if (options.onRemove) {
    const removeError = el("div", { class: "form-error hidden" });
    let confirming = false;
    const removeButton = el(
      "button",
      { class: "button-danger", type: "button" },
      ["Aus Shortlist entfernen"],
    );
    removeButton.addEventListener("click", () => {
      if (!confirming) {
        confirming = true;
        removeButton.textContent = "Wirklich entfernen?";
        removeButton.classList.add("confirming");
        return;
      }
      removeButton.toggleAttribute("disabled", true);
      removeButton.textContent = "Entfernt …";
      options
        .onRemove!()
        .then(() => close())
        .catch((error: unknown) => {
          confirming = false;
          removeButton.toggleAttribute("disabled", false);
          removeButton.textContent = "Aus Shortlist entfernen";
          removeButton.classList.remove("confirming");
          removeError.textContent =
            error instanceof ApiError ? error.message : "Entfernen fehlgeschlagen.";
          removeError.classList.remove("hidden");
        });
    });
    bodyChildren.push(el("div", { class: "detail-actions" }, [removeButton, removeError]));
  }

  const body = el("div", { class: "detail-body" }, bodyChildren);
  const sheet = el(
    "div",
    { class: "detail-sheet", role: "dialog", "aria-modal": "true", "aria-label": `Details zu ${listing.title}` },
    [header, body],
  );

  backButton.addEventListener("click", () => close());

  let closed = false;
  const popModal = pushModal(close);

  function close(): void {
    if (closed) return;
    closed = true;
    sheet.remove();
    popModal();
    previouslyFocused?.focus();
  }

  document.body.append(sheet);
  backButton.focus();
}
