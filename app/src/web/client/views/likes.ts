import { el, clear } from "../dom";
import { api, ApiError } from "../api";
import { renderListItem } from "../components/listItem";
import { openDetailSheet } from "../components/detailSheet";
import { isMatch } from "../otherStatus";
import type { LikedListing } from "../types";

export function renderLikesView(container: HTMLElement): void {
  clear(container);
  const root = el("div", { class: "view list-view" });
  const statusEl = el("div", { class: "list-status" }, ["Lade deine Likes …"]);
  root.append(statusEl);
  container.append(root);

  let likes: LikedListing[] = [];

  function renderList(): void {
    clear(root);
    if (likes.length === 0) {
      root.append(el("div", { class: "list-status" }, ["Noch keine Likes — ab zum Swipen!"]));
      return;
    }
    for (const listing of likes) {
      root.append(
        renderListItem(listing, {
          matched: isMatch(listing.others),
          onOpen: () => openSheet(listing),
        }),
      );
    }
  }

  function openSheet(listing: LikedListing): void {
    openDetailSheet({
      listing,
      onRemove: () =>
        api.swipe(listing.id, "nope").then(() => {
          likes = likes.filter((l) => l.id !== listing.id);
          renderList();
        }),
    });
  }

  api
    .likes()
    .then((loaded) => {
      likes = loaded;
      renderList();
    })
    .catch((error) => {
      statusEl.textContent = error instanceof ApiError ? error.message : "Likes konnten nicht geladen werden.";
    });
}
