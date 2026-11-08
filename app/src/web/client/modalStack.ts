// Pure stack logic behind the modal system (see modalStackInstance.ts for
// the actual document/body-wired singleton every modal uses). Kept
// DOM-free and side-effect-free — hooks are injected — so it's unit
// testable without a browser.
//
// Each modal calls `push(close)` when it opens and MUST call the returned
// `pop` function as part of its own `close()` (not separately) — that way
// Esc-triggered closes and button-triggered closes always go through the
// same path, and the stack never gets out of sync with what's actually
// open.

export type ModalCloseFn = () => void;

export interface ModalStackHooks {
  lock: () => void;
  unlock: () => void;
}

export interface ModalStack {
  push: (close: ModalCloseFn) => ModalCloseFn;
  closeTop: () => void;
  closeAll: () => void;
  isOpen: () => boolean;
}

export function createModalStack(hooks: ModalStackHooks): ModalStack {
  const stack: ModalCloseFn[] = [];

  function pop(close: ModalCloseFn): void {
    const index = stack.lastIndexOf(close);
    if (index === -1) return;
    stack.splice(index, 1);
    if (stack.length === 0) hooks.unlock();
  }

  function push(close: ModalCloseFn): ModalCloseFn {
    stack.push(close);
    if (stack.length === 1) hooks.lock();
    return () => pop(close);
  }

  function closeTop(): void {
    const top = stack[stack.length - 1];
    top?.();
  }

  function closeAll(): void {
    // Each close() is expected to call its own pop() (the function `push`
    // returned), shrinking the stack by one — bound the loop by the
    // starting size instead of `while (stack.length)` so a modal that
    // forgets to call pop() can't hang this forever.
    const startingSize = stack.length;
    for (let i = 0; i < startingSize && stack.length > 0; i++) closeTop();
  }

  function isOpen(): boolean {
    return stack.length > 0;
  }

  return { push, closeTop, closeAll, isOpen };
}
