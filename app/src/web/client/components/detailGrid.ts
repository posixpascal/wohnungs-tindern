import { el } from "../dom";
import type { Listing } from "../types";
import { formatDateDE, formatEuro, formatFloor, formatRooms } from "../format";
import { PORTAL_LABEL } from "../portalLabels";

function detailRow(label: string, value: string | null): HTMLElement | null {
  if (value === null) return null;
  return el("div", { class: "detail-row" }, [el("span", { class: "detail-row-label" }, [label]), el("span", {}, [value])]);
}

// "Everything about a listing" as label/value rows — shared by the detail
// sheet (Likes/Matches) and the back of the swipe card.
export function renderDetailGrid(listing: Listing): HTMLElement {
  const rentEstimateSuffix = listing.rent_warm_estimated === 1 ? " (geschätzt)" : "";
  const rows = [
    detailRow("Warmmiete", `${formatEuro(listing.rent_warm)} €${rentEstimateSuffix}`),
    detailRow("Kaltmiete", listing.rent_cold === null ? null : `${formatEuro(listing.rent_cold)} €`),
    detailRow("Zimmer", formatRooms(listing.rooms)),
    detailRow("Fläche", listing.area_sqm === null ? null : `${listing.area_sqm} m²`),
    detailRow("Etage", formatFloor(listing.floor)),
    detailRow("Garten", listing.has_garden === 1 ? "Ja" : null),
    detailRow("Balkon", listing.has_balcony === 1 ? "Ja" : null),
    detailRow("Verfügbar ab", formatDateDE(listing.available_from)),
    detailRow("Adresse", listing.address),
    detailRow("Stadtteil", listing.district),
    detailRow("Stadt", listing.city),
    detailRow("Portal", PORTAL_LABEL[listing.portal]),
    detailRow("Score", listing.score_notes ? `${listing.score}/100 · ${listing.score_notes}` : `${listing.score}/100`),
    detailRow("Zuerst gesehen", formatDateDE(listing.first_seen_at)),
  ].filter((row): row is HTMLElement => row !== null);
  return el("div", { class: "detail-grid" }, rows);
}
