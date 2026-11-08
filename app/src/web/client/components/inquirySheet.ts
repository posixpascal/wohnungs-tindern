import { el } from "../dom";
import { api, ApiError } from "../api";
import type { Inquiry, InquiryProfile, Listing } from "../types";
import { renderPortalLink } from "./portalLink";
import { pushModal } from "../modalStackInstance";

// Overlay above the detail sheet: a ready-to-copy inquiry text for one
// listing, plus the shared "Über uns" profile it is written from. Nothing is
// sent anywhere: the user copies the text and contacts the landlord on the
// portal themselves.

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function sourceLabel(inquiry: Inquiry): string {
  if (inquiry.warning) return inquiry.warning;
  return inquiry.source === "llm" ? `Mit KI erstellt (${inquiry.model}) – bitte prüfen.` : "Aus Vorlage erstellt.";
}

function renderProfileForm(onSaved: () => void): HTMLElement {
  const about = el("textarea", {
    class: "inquiry-input",
    rows: "4",
    maxlength: "2000",
    placeholder: "Wer zieht ein? Beruf, Einkommen, Einzugstermin, Haustiere …",
  });
  const signature = el("input", { class: "inquiry-input", type: "text", maxlength: "300", placeholder: "Namen, Telefon" });
  const save = el("button", { class: "button-secondary", type: "button" }, ["Speichern & neu erstellen"]);
  const status = el("div", { class: "inquiry-status" });

  api
    .inquiryProfile()
    .then((profile) => {
      about.value = profile.about;
      signature.value = profile.signature;
    })
    .catch((error: unknown) => {
      status.textContent = errorMessage(error, "Profil konnte nicht geladen werden.");
    });

  save.addEventListener("click", () => {
    const profile: InquiryProfile = { about: about.value, signature: signature.value };
    save.toggleAttribute("disabled", true);
    api
      .saveInquiryProfile(profile)
      .then(() => {
        status.textContent = "Gespeichert.";
        onSaved();
      })
      .catch((error: unknown) => {
        status.textContent = errorMessage(error, "Speichern fehlgeschlagen.");
      })
      .finally(() => save.toggleAttribute("disabled", false));
  });

  return el("details", { class: "inquiry-profile" }, [
    el("summary", {}, ["Über uns (gilt für alle Anfragen)"]),
    el("label", { class: "inquiry-label" }, ["Über uns", about]),
    el("label", { class: "inquiry-label" }, ["Signatur", signature]),
    save,
    status,
  ]);
}

export function openInquirySheet(listing: Listing): void {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backButton = el("button", { class: "control undo detail-back", type: "button", "aria-label": "Zurück" }, ["←"]);
  const header = el("div", { class: "detail-header" }, [backButton, el("h2", { class: "card-title" }, ["Anfrage"])]);

  const status = el("div", { class: "inquiry-status" });
  const text = el("textarea", { class: "inquiry-text", rows: "16", "aria-label": "Anfragetext" });
  const copyButton = el("button", { class: "portal-link-button inquiry-button", type: "button" }, ["Text kopieren"]);
  const regenerateButton = el("button", { class: "button-secondary", type: "button" }, ["Neu erstellen"]);

  let generation = 0;
  function generate(): void {
    const mine = ++generation;
    status.textContent = "Anfrage wird erstellt …";
    text.toggleAttribute("disabled", true);
    regenerateButton.toggleAttribute("disabled", true);
    api
      .inquiry(listing.id)
      .then((inquiry) => {
        if (mine !== generation) return;
        text.value = inquiry.text;
        status.textContent = sourceLabel(inquiry);
      })
      .catch((error: unknown) => {
        if (mine !== generation) return;
        status.textContent = errorMessage(error, "Anfrage konnte nicht erstellt werden.");
      })
      .finally(() => {
        if (mine !== generation) return;
        text.toggleAttribute("disabled", false);
        regenerateButton.toggleAttribute("disabled", false);
      });
  }

  copyButton.addEventListener("click", () => {
    navigator.clipboard
      .writeText(text.value)
      .then(() => {
        copyButton.textContent = "Kopiert ✓";
      })
      .catch(() => {
        text.select();
        status.textContent = "Kopieren nicht möglich – Text ist markiert.";
      });
  });
  regenerateButton.addEventListener("click", generate);

  const portalLink = renderPortalLink(listing.url, "portal-link-button");
  const actions = el("div", { class: "inquiry-actions" }, [copyButton, regenerateButton, ...(portalLink ? [portalLink] : [])]);
  const body = el("div", { class: "detail-body inquiry-body" }, [status, text, actions, renderProfileForm(generate)]);
  const sheet = el(
    "div",
    { class: "detail-sheet inquiry-sheet", role: "dialog", "aria-modal": "true", "aria-label": `Anfrage zu ${listing.title}` },
    [header, body],
  );

  let closed = false;
  const popModal = pushModal(close);
  function close(): void {
    if (closed) return;
    closed = true;
    sheet.remove();
    popModal();
    previouslyFocused?.focus();
  }
  backButton.addEventListener("click", () => close());

  document.body.append(sheet);
  backButton.focus();
  generate();
}
