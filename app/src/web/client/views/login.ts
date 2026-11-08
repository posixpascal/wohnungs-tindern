import { el, clear } from "../dom";
import { api, ApiError } from "../api";

export function renderLoginView(
  container: HTMLElement,
  onSuccess: () => void | Promise<void>,
  onShowSettings?: () => void,
): void {
  clear(container);

  const usernameInput = el("input", {
    type: "text",
    name: "username",
    autocomplete: "username",
    required: true,
    placeholder: "Benutzername",
    class: "input",
  });
  const passwordInput = el("input", {
    type: "password",
    name: "password",
    autocomplete: "current-password",
    required: true,
    placeholder: "Passwort",
    class: "input",
  });
  const errorEl = el("div", { class: "form-error hidden" });
  const submitButton = el("button", { type: "submit", class: "button-primary" }, ["Einloggen"]);

  const form = el("form", { class: "login-form" }, [
    el("h1", { class: "login-title" }, ["Wohnung finden"]),
    usernameInput,
    passwordInput,
    errorEl,
    submitButton,
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    errorEl.classList.add("hidden");
    submitButton.toggleAttribute("disabled", true);

    api
      .login((usernameInput as HTMLInputElement).value, (passwordInput as HTMLInputElement).value)
      .then(onSuccess)
      .catch((error: unknown) => {
        errorEl.textContent = error instanceof ApiError ? error.message : "Login fehlgeschlagen.";
        errorEl.classList.remove("hidden");
      })
      .finally(() => submitButton.toggleAttribute("disabled", false));
  });

  const children: HTMLElement[] = [form];
  if (onShowSettings) {
    const settingsLink = el("button", { type: "button", class: "link-button" }, ["Stadtteile ansehen"]);
    settingsLink.addEventListener("click", onShowSettings);
    children.push(settingsLink);
  }
  container.append(el("div", { class: "view login-view" }, children));
}
