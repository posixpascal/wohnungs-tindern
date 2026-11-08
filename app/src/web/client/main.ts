import { api, setUnauthorizedHandler } from "./api";
import { el, clear } from "./dom";
import { renderLoginView } from "./views/login";
import { renderSwipeView } from "./views/swipe";
import { renderMatchesView } from "./views/matches";
import { renderLikesView } from "./views/likes";
import { closeAllModals } from "./modalStackInstance";

type Tab = "swipe" | "matches" | "likes";

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
  else renderLikesView(content);
  updateTabBarActive(tab);
}

function tabButton(tab: Tab, label: string, content: HTMLElement): HTMLElement {
  const button = el("button", { type: "button", class: "tab-button" }, [label]);
  button.dataset["tab"] = tab;
  button.addEventListener("click", () => switchView(content, tab));
  return button;
}

function renderApp(username: string): void {
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
  ]);
  tabBarEl = tabBar;
  appRoot!.append(header, content, tabBar);
  switchView(content, "swipe");
}

function renderLoginGate(): void {
  closeAllModals();
  currentCleanup?.();
  currentCleanup = null;
  renderLoginView(appRoot!, () => api.me().then((me) => renderApp(me.username)));
}

setUnauthorizedHandler(renderLoginGate);

api
  .me()
  .then((me) => renderApp(me.username))
  .catch(renderLoginGate);
