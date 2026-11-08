import { el } from "../dom";
import { isHttpUrl } from "../format";

// The one consistent "open on the portal" link used on the card, the detail
// sheet, and both list views. Returns null (render nothing) for listings
// without a usable http(s) URL.
export function renderPortalLink(url: string, className: string): HTMLElement | null {
  if (!isHttpUrl(url)) return null;
  const link = el("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: className }, [
    "Inserat öffnen ↗",
  ]);
  // List items are clickable (open the detail sheet) — the link must not
  // also trigger that.
  link.addEventListener("click", (event) => event.stopPropagation());
  return link;
}
