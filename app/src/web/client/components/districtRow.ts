import { el } from "../dom";
import type { DistrictState, DistrictView, HighlightKey } from "../districts";
import { renderLineIcon } from "./icon";

// One compact line per district: name, listing count, the icons of the
// highlights it has, and the state toggle. Tapping the name unfolds the
// summary and the highlight texts. `onChange` null = read-only (logged out).

const HIGHLIGHTS: ReadonlyArray<readonly [HighlightKey, string]> = [
  ["shopping", "Einkaufen"],
  ["culture", "Kultur"],
  ["cinema", "Kino"],
  ["pool", "Schwimmbad"],
  ["sights", "Sehenswürdigkeiten"],
  ["leisure", "Freizeit & Ausgehen"],
  ["transit", "ÖPNV"],
];

export const STATES: ReadonlyArray<readonly [DistrictState, string]> = [
  ["excluded", "Nein"],
  ["neutral", "Egal"],
  ["allowed", "Ja"],
  ["preferred", "Favorit"],
];

export interface DistrictRow {
  readonly element: HTMLElement;
  /** Reflects a (new) state on the toggle and the row. */
  readonly show: (state: DistrictState) => void;
}

function renderDetails(district: DistrictView): HTMLElement {
  const items = HIGHLIGHTS.flatMap(([key, label]) => {
    const text = district.highlights[key];
    return text ? [el("li", { title: label }, [renderLineIcon(key), el("span", {}, [text])])] : [];
  });
  return el("div", { class: "district-details" }, [
    ...(district.summary ? [el("p", { class: "district-summary" }, [district.summary])] : []),
    items.length > 0 ? el("ul", { class: "district-highlights" }, items) : el("p", { class: "district-summary" }, ["Noch keine Infos"]),
  ]);
}

export function renderDistrictRow(
  district: DistrictView,
  state: DistrictState,
  onChange: ((state: DistrictState) => void) | null,
): DistrictRow {
  const buttons = STATES.map(([value, label]) => {
    const button = el("button", {
      type: "button",
      class: "district-state",
      title: label,
      "aria-label": `${district.name}: ${label}`,
      disabled: onChange === null,
    });
    button.append(renderLineIcon(value));
    button.dataset["state"] = value;
    if (onChange) button.addEventListener("click", () => onChange(value));
    return button;
  });

  const featureIcons = HIGHLIGHTS.filter(([key]) => district.highlights[key]).map(([key]) => renderLineIcon(key));
  const expand = el("button", { type: "button", class: "district-name", "aria-expanded": "false" }, [
    renderLineIcon("chevron", "line-icon district-chevron"),
    el("span", { class: "district-label" }, [
      el("span", { class: "district-title" }, [
        el("span", {}, [district.name]),
        ...(district.active_listings > 0 ? [el("span", { class: "district-count" }, [String(district.active_listings)])] : []),
      ]),
      ...(featureIcons.length > 0 ? [el("span", { class: "district-features" }, featureIcons)] : []),
    ]),
  ]);
  const details = renderDetails(district);
  details.hidden = true;
  expand.addEventListener("click", () => {
    details.hidden = !details.hidden;
    expand.setAttribute("aria-expanded", String(!details.hidden));
  });

  const element = el("div", { class: "district-row" }, [
    el("div", { class: "district-line" }, [expand, el("div", { class: "district-states", role: "group", "aria-label": `Auswahl für ${district.name}` }, buttons)]),
    details,
  ]);

  const show = (current: DistrictState): void => {
    element.dataset["state"] = current;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset["state"] === current));
  };
  show(state);
  return { element, show };
}
