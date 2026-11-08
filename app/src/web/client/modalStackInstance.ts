// The one modal stack every full-screen overlay (gallery, detail sheet)
// shares, wired to the actual document/body. See modalStack.ts for the
// (DOM-free, unit-tested) stack logic itself.

import { createModalStack } from "./modalStack";

let previousBodyOverflow = "";

const modalStack = createModalStack({
  lock: () => {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  },
  unlock: () => {
    document.body.style.overflow = previousBodyOverflow;
  },
});

// A single top-level Esc listener, registered once (modules are cached),
// closes only the top-most modal — each modal's own close() handles its
// own cleanup (removing itself from the DOM, popping itself off the
// stack), so this never needs to know what kind of modal is open.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalStack.isOpen()) modalStack.closeTop();
});

export function pushModal(close: () => void): () => void {
  return modalStack.push(close);
}

export function isModalOpen(): boolean {
  return modalStack.isOpen();
}

export function closeAllModals(): void {
  modalStack.closeAll();
}
