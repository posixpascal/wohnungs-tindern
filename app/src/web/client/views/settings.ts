import { el, clear } from "../dom";
import { ApiError } from "../api";
import { districtsApi, selectionSummary, stateOf, withState, type CitySettings, type DistrictState } from "../districts";
import { STATES, renderDistrictRow, type DistrictRow } from "../components/districtRow";
import { renderLineIcon } from "../components/icon";

const INTRO = "Gilt für die ganze Gruppe. Tippe auf einen Stadtteil für Infos.";

const READ_ONLY_INTRO = "Hier sucht die Gruppe. Tippe auf einen Stadtteil für Infos.";

const LEGEND_HINT = "Sobald ein Stadtteil auf Ja steht, wird nur noch dort gesucht. Ausgeschlossene kommen zurück, wenn ihr sie wieder erlaubt.";

const EMPTY = "Noch keine Stadtteile. Sie kommen mit dem nächsten Suchlauf.";

function renderLegend(): HTMLElement {
  const items = STATES.map(([state, label]) =>
    el("span", { class: "settings-legend-item", "data-state": state }, [renderLineIcon(state), label]),
  );
  return el("div", { class: "settings-legend" }, [el("div", { class: "settings-legend-items" }, items), el("p", {}, [LEGEND_HINT])]);
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

const updatedLine = (city: CitySettings): string =>
  city.updated_by ? `Zuletzt geändert von ${city.updated_by} am ${formatDate(city.updated_at)}` : "Aus der Suchkonfiguration";

function renderCity(initial: CitySettings, open: boolean, readOnly: boolean): HTMLElement {
  let settings = initial;
  // Saves run one after another so an older request can never overwrite a newer choice.
  let pending: Promise<unknown> = Promise.resolve();
  const rows = new Map<string, DistrictRow>();
  const summaryEl = el("span", { class: "settings-city-summary" }, [selectionSummary(settings)]);
  const statusEl = el("div", { class: "settings-status", role: "status" }, [updatedLine(settings)]);

  const refresh = (): void => {
    summaryEl.textContent = selectionSummary(settings);
    for (const [name, row] of rows) row.show(stateOf(settings, name));
  };

  const change = (name: string, state: DistrictState): void => {
    const previous = settings;
    settings = { ...settings, ...withState(settings, name, state) };
    refresh();
    statusEl.textContent = "Speichere …";
    const lists = {
      allowed_districts: settings.allowed_districts,
      excluded_districts: settings.excluded_districts,
      preferred_districts: settings.preferred_districts,
    };
    pending = pending
      .then(() => districtsApi.save(settings.city, lists))
      .then((saved) => {
        statusEl.textContent = updatedLine(saved);
      })
      .catch((error: unknown) => {
        settings = previous;
        refresh();
        statusEl.textContent = error instanceof ApiError ? error.message : "Speichern fehlgeschlagen.";
      });
  };

  const list = el("div", { class: "district-list" });
  for (const district of settings.districts) {
    const row = renderDistrictRow(district, stateOf(settings, district.name), readOnly ? null : (state) => change(district.name, state));
    rows.set(district.name, row);
    list.append(row.element);
  }
  if (settings.districts.length === 0) {
    list.append(el("div", { class: "list-status" }, ["Für diese Stadt sind noch keine Stadtteile bekannt."]));
  }

  const summary = el("summary", { class: "settings-city-title" }, [el("span", {}, [settings.city]), summaryEl]);
  return el("details", { class: "settings-city", open }, [summary, statusEl, list]);
}

export interface SettingsViewOptions {
  // Logged out: the page is public to read; toggles are disabled and a
  // login button is offered instead.
  readonly onLogin?: () => void;
}

export function renderSettingsView(container: HTMLElement, options: SettingsViewOptions = {}): void {
  const readOnly = options.onLogin !== undefined;
  clear(container);
  const root = el("div", { class: "view list-view settings-view" });
  const statusEl = el("div", { class: "list-status" }, ["Lade Einstellungen …"]);
  root.append(el("h2", { class: "settings-title" }, ["Stadtteile"]), el("p", { class: "settings-intro" }, [readOnly ? READ_ONLY_INTRO : INTRO]));
  if (options.onLogin) {
    const login = el("button", { type: "button", class: "button-secondary" }, ["Zum Bearbeiten anmelden"]);
    login.addEventListener("click", options.onLogin);
    root.append(login);
  }
  root.append(renderLegend(), statusEl);
  container.append(root);

  districtsApi
    .load()
    .then((cities) => {
      if (cities.length === 0) {
        statusEl.textContent = EMPTY;
        return;
      }
      statusEl.remove();
      cities.forEach((city, i) => root.append(renderCity(city, i === 0, readOnly)));
    })
    .catch((error: unknown) => {
      statusEl.textContent = error instanceof ApiError ? error.message : "Einstellungen konnten nicht geladen werden.";
    });
}
