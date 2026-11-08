import { el, clear } from "../dom";
import { api, ApiError } from "../api";
import { renderListItem } from "../components/listItem";
import { openDetailSheet } from "../components/detailSheet";

export function renderMatchesView(container: HTMLElement): void {
  clear(container);
  const root = el("div", { class: "view list-view" });
  const statusEl = el("div", { class: "list-status" }, ["Lade Matches …"]);
  root.append(statusEl);
  container.append(root);

  api
    .matches()
    .then((matches) => {
      if (matches.length === 0) {
        statusEl.textContent = "Noch keine Matches — weiterswipen!";
        return;
      }
      clear(root);
      for (const listing of matches) {
        root.append(renderListItem(listing, { onOpen: () => openDetailSheet({ listing }) }));
      }
    })
    .catch((error) => {
      statusEl.textContent = error instanceof ApiError ? error.message : "Matches konnten nicht geladen werden.";
    });
}
