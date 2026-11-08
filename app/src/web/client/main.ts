import { api, setUnauthorizedHandler } from "./api";
import { el, clear } from "./dom";
import { renderLoginView } from "./views/login";
import { renderSwipeView } from "./views/swipe";
import { renderMatchesView } from "./views/matches";
import { renderLikesView } from "./views/likes";
import { renderSettingsView } from "./views/settings";
import { closeAllModals } from "./modalStackInstance";

type Tab = "swipe" | "matches" | "likes" | "settings";

const appRoot = document.getElementById("app");
if (!appRoot) throw new Error("#app root element missing");

let currentCleanup: (() => void) | null = null;
let tabBarEl: HTMLElement | null = null;

function updateTabBarActive(tab: Tab): void {
  if (!tabBarEl) return;
  for (const button of tabBarEl.querySelectorAll<HTMLButtonElement>("button")) {
    button.classList.toggle("tab-active", button.dataset["tab"] === tab);
  }
}

function switchView(content: HTMLElement, tab: Tab): void {
  closeAllModals();
  currentCleanup?.();
  currentCleanup = null;
  if (tab === "swipe") currentCleanup = renderSwipeView(content);
  else if (tab === "matches") renderMatchesView(content);
  else if (tab === "settings") renderSettingsView(content);
  else renderLikesView(content);
  updateTabBarActive(tab);
}

function tabButton(tab: Tab, label: string, content: HTMLElement): HTMLElement {
  const button = el("button", { type: "button", class: "tab-button" }, [label]);
  button.dataset["tab"] = tab;
  button.addEventListener("click", () => switchView(content, tab));
  return button;
}

function renderApp(username: string, initialTab: Tab = "swipe"): void {
  clear(appRoot!);
  const content = el("main", { class: "app-content" });
  const logoutButton = el("button", { class: "link-button", type: "button" }, ["Abmelden"]);
  logoutButton.addEventListener("click", () => {
    api.logout().finally(renderLoginGate);
  });
  const header = el("header", { class: "app-header" }, [
    el("span", { class: "app-header-user" }, [username]),
    logoutButton,
  ]);
  const tabBar = el("nav", { class: "tab-bar" }, [
    tabButton("swipe", "Swipen", content),
    tabButton("matches", "Matches", content),
    tabButton("likes", "Meine Likes", content),
    tabButton("settings", "Einstellungen", content),
  ]);
  tabBarEl = tabBar;
  appRoot!.append(header, content, tabBar);
  switchView(content, initialTab);
}

const PUBLIC_SETTINGS_HASH = "#einstellungen";

function resetView(): void {
  closeAllModals();
  currentCleanup?.();
  currentCleanup = null;
}

function renderLoginGate(): void {
  resetView();
  if (location.hash === PUBLIC_SETTINGS_HASH) history.replaceState(null, "", location.pathname);
  renderLoginView(appRoot!, () => api.me().then((me) => renderApp(me.username)), renderPublicSettings);
}

// Logged out: the district settings are public to read.
function renderPublicSettings(): void {
  resetView();
  clear(appRoot!);
  if (location.hash !== PUBLIC_SETTINGS_HASH) history.replaceState(null, "", PUBLIC_SETTINGS_HASH);
  const content = el("main", { class: "app-content" });
  appRoot!.append(el("header", { class: "app-header" }, [el("span", { class: "app-header-user" }, ["Wohnung finden"])]), content);
  renderSettingsView(content, { onLogin: renderLoginGate });
}

setUnauthorizedHandler(renderLoginGate);

api
  .me()
  .then((me) => renderApp(me.username, location.hash === PUBLIC_SETTINGS_HASH ? "settings" : "swipe"))
  .catch(() => (location.hash === PUBLIC_SETTINGS_HASH ? renderPublicSettings() : renderLoginGate()));
