import { el, clear } from "../dom";
import { api, ApiError } from "../api";
import type { Listing } from "../types";
import { renderCard } from "../components/card";
import { classifyDragAxis, resolveSwipeDecision, swipeRotationDeg, swipeStampOpacity } from "../swipeGesture";
import { isModalOpen } from "../modalStackInstance";

const DRAG_THRESHOLD_PX = 110;
const DRAG_SLOP_PX = 10;
const VELOCITY_MIN_DX_PX = 40;
const VELOCITY_THRESHOLD_PX_MS = 0.6;
const SWIPE_THRESHOLDS = {
  distancePx: DRAG_THRESHOLD_PX,
  velocityMinDxPx: VELOCITY_MIN_DX_PX,
  velocityThresholdPxMs: VELOCITY_THRESHOLD_PX_MS,
};
const PREFETCH_AT = 4;
const STACK_SIZE = 3;
const QUEUE_PAGE_SIZE = 20;
const FLING_ANIMATION_MS = 220;
const ERROR_TOAST_MS = 3000;
const FLING_DISTANCE_PX = 560;
const MATCH_OVERLAY_MS = 1800;

type Decision = "like" | "nope";

export function renderSwipeView(container: HTMLElement): () => void {
  clear(container);

  let queue: Listing[] = [];
  let history: Listing[] = [];
  let loading = true;
  let fetchError: string | null = null;
  // Ids ever placed into `queue` or `history`: prevents a background
  // loadMore() from re-adding a listing that was already swiped (optimistic
  // local removal) but that the server hasn't caught up with yet, and
  // likewise for undo racing a concurrent loadMore().
  const seen = new Set<string>();
  // Blocks keys/buttons/undo/new drags from acting on a second card while a
  // swipe is mid-fling or mid-commit, so a fast second input can never land
  // on the wrong listing.
  let animating = false;
  // True only while a drag is actively tracking the finger (pointer
  // captured) — separate from `animating`, so a background loadMore() that
  // resolves mid-drag knows not to blow the card stack away either.
  let dragActive = false;
  let detachTopDrag: (() => void) | null = null;
  let errorToastTimer: ReturnType<typeof setTimeout> | null = null;
  let matchOverlayTimer: ReturnType<typeof setTimeout> | null = null;
  let loadMoreInFlight: Promise<void> | null = null;
  // The currently-on-top card DOM node and its LIKE/NOPE stamps, so a
  // button/arrow-key decision can fling the same card a drag release would.
  let topCard: HTMLElement | null = null;
  let topStampLike: HTMLElement | null = null;
  let topStampNope: HTMLElement | null = null;

  const root = el("div", { class: "view swipe-view" });
  const stackEl = el("div", { class: "card-stack" });
  const statusEl = el("div", { class: "swipe-status", role: "status", "aria-live": "polite" });
  const errorToastEl = el("div", { class: "toast toast-error hidden", role: "status", "aria-live": "polite" });
  const matchOverlay = el("div", { class: "match-overlay hidden" }, [
    el("div", { class: "match-overlay-text" }, ["Es ist ein Match! \u{1F3E1}"]),
  ]);
  // Tapping the overlay dismisses it early instead of blocking the stack
  // underneath for the full timer.
  matchOverlay.addEventListener("click", () => hideMatchOverlay());

  const nopeButton = el(
    "button",
    { class: "control nope", type: "button", "aria-label": "Nope" },
    ["✕"],
  );
  const undoButton = el("button", { class: "control undo", type: "button", "aria-label": "Zurück" }, ["↺"]);
  const likeButton = el(
    "button",
    { class: "control like", type: "button", "aria-label": "Like" },
    ["♥"],
  );
  nopeButton.addEventListener("click", () => decideFromControl("nope"));
  likeButton.addEventListener("click", () => decideFromControl("like"));
  undoButton.addEventListener("click", () => void undo());

  const controls = el("div", { class: "swipe-controls" }, [nopeButton, undoButton, likeButton]);
  root.append(stackEl, statusEl, controls, matchOverlay, errorToastEl);
  container.append(root);

  function onKeydown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // A modal (the fullscreen gallery, the detail sheet) is on top — don't
    // also swipe the card underneath it.
    if (isModalOpen()) return;
    decideFromControl(event.key === "ArrowLeft" ? "nope" : "like");
  }
  document.addEventListener("keydown", onKeydown);

  function markSeen(listings: readonly Listing[]): void {
    for (const listing of listings) seen.add(listing.id);
  }

  async function loadMore(): Promise<void> {
    // Coalesce concurrent callers (e.g. two swipes in a row both crossing
    // PREFETCH_AT before the first fetch resolves) into a single request.
    if (loadMoreInFlight) return loadMoreInFlight;
    loadMoreInFlight = (async () => {
      try {
        const more = await api.queue(QUEUE_PAGE_SIZE);
        const fresh = more.filter((l) => !seen.has(l.id));
        markSeen(fresh);
        queue.push(...fresh);
        fetchError = null;
      } catch (error) {
        fetchError = error instanceof ApiError ? error.message : "Angebote konnten nicht geladen werden.";
      } finally {
        loadMoreInFlight = null;
      }
    })();
    return loadMoreInFlight;
  }

  async function ensureStock(): Promise<void> {
    if (queue.length > PREFETCH_AT) return;
    const stackWasShort = queue.length < STACK_SIZE;
    await loadMore();
    // Only re-render here if the visible stack actually needed the new
    // cards and nothing's mid-gesture right now — otherwise the next
    // commit()'s own renderStack() picks them up naturally, instead of a
    // stack rebuild potentially cutting off an in-progress drag or fling.
    if (stackWasShort && !animating && !dragActive) renderStack();
  }

  function showError(message: string): void {
    if (errorToastTimer) clearTimeout(errorToastTimer);
    errorToastEl.textContent = message;
    errorToastEl.classList.remove("hidden");
    errorToastTimer = setTimeout(() => errorToastEl.classList.add("hidden"), ERROR_TOAST_MS);
  }

  function updateControlsDisabled(): void {
    nopeButton.toggleAttribute("disabled", animating);
    likeButton.toggleAttribute("disabled", animating);
    undoButton.toggleAttribute("disabled", animating || history.length === 0);
  }

  function renderStack(): void {
    clear(stackEl);
    updateControlsDisabled();
    topCard = null;
    topStampLike = null;
    topStampNope = null;

    if (loading) {
      statusEl.textContent = "Lade Angebote …";
      return;
    }
    if (fetchError && queue.length === 0) {
      statusEl.textContent = fetchError;
      return;
    }
    if (queue.length === 0) {
      statusEl.textContent = "Alles geswiped — morgen gibt's Nachschub.";
      return;
    }
    statusEl.textContent = "";

    const visible = queue.slice(0, STACK_SIZE).reverse();
    for (const listing of visible) {
      const isTop = listing.id === queue[0]?.id;
      const card = renderCard(listing, listing.liked_by ?? []);
      card.classList.add("card-slot");
      // the cards underneath are decoration: no focus, no screen reader
      if (!isTop) card.inert = true;
      if (isTop) {
        const stampLike = el("div", { class: "stamp stamp-like" }, ["LIKE"]);
        const stampNope = el("div", { class: "stamp stamp-nope" }, ["NOPE"]);
        card.append(stampLike, stampNope);
        topCard = card;
        topStampLike = stampLike;
        topStampNope = stampNope;
        detachTopDrag = attachDrag(card, listing, stampLike, stampNope);
      }
      stackEl.append(card);
    }
  }

  function attachDrag(
    card: HTMLElement,
    listing: Listing,
    stampLike: HTMLElement,
    stampNope: HTMLElement,
  ): () => void {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    // The single pointer this gesture is tracking — any other concurrent
    // pointer (e.g. a second touch) is ignored entirely instead of
    // confusing dx/dy with a mix of two fingers.
    let activePointerId: number | null = null;
    let captured = false;

    function reset(): void {
      card.style.transition = "transform 180ms ease-out";
      card.style.transform = "";
      stampLike.style.opacity = "0";
      stampNope.style.opacity = "0";
      setTimeout(() => {
        card.style.transition = "";
      }, 180);
    }

    function onPointerDown(event: PointerEvent): void {
      if (animating) return;
      if (activePointerId !== null) return; // already tracking a different pointer
      const target = event.target as HTMLElement | null;
      // Buttons/links (the card flip buttons, the portal link) must not
      // start a drag. A drag that starts on the image carousel, though,
      // should still swipe the card — see carousel.ts for how a plain tap
      // there still gets through as a click instead.
      if (target?.closest("button, a")) return;
      // Clear any leftover reset()/fling transition so this fresh drag
      // tracks the finger 1:1 from the very first pointermove.
      card.style.transition = "";
      activePointerId = event.pointerId;
      captured = false;
      startX = event.clientX;
      startY = event.clientY;
      startTime = performance.now();
    }

    function onPointerMove(event: PointerEvent): void {
      if (event.pointerId !== activePointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!captured) {
        const axis = classifyDragAxis(dx, dy, DRAG_SLOP_PX);
        if (axis === "pending") return;
        if (axis === "vertical") {
          // Dominantly vertical movement: let the browser scroll instead.
          activePointerId = null;
          return;
        }
        try {
          card.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already be gone (released elsewhere) by the
          // time we try to capture it — bail out of the gesture rather
          // than fight the browser.
          activePointerId = null;
          return;
        }
        captured = true;
        dragActive = true;
      }

      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${swipeRotationDeg(dx)}deg)`;
      const opacity = swipeStampOpacity(dx, DRAG_THRESHOLD_PX);
      stampLike.style.opacity = String(opacity.like);
      stampNope.style.opacity = String(opacity.nope);
    }

    function onPointerUp(event: PointerEvent): void {
      if (event.pointerId !== activePointerId) return;
      const wasCaptured = captured;
      activePointerId = null;
      captured = false;
      dragActive = false;
      if (!wasCaptured) return;

      const dx = event.clientX - startX;
      const elapsed = performance.now() - startTime;
      const decision = resolveSwipeDecision(dx, elapsed, SWIPE_THRESHOLDS);

      if (decision === "cancel") reset();
      else beginDecision(listing, decision, card, stampLike, stampNope);
    }

    function onPointerCancel(event: PointerEvent): void {
      if (event.pointerId !== activePointerId) return;
      const wasCaptured = captured;
      activePointerId = null;
      captured = false;
      dragActive = false;
      if (wasCaptured) reset();
    }

    card.addEventListener("pointerdown", onPointerDown);
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerup", onPointerUp);
    card.addEventListener("pointercancel", onPointerCancel);

    return () => {
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", onPointerUp);
      card.removeEventListener("pointercancel", onPointerCancel);
    };
  }

  function decideFromControl(decision: Decision): void {
    if (animating) return;
    const listing = queue[0];
    if (!listing) return;
    beginDecision(listing, decision, topCard, topStampLike, topStampNope);
  }

  // Always flings the visible top card (from a drag release, a control
  // button, or an arrow key) so every path to a decision gets the same
  // fly-out animation.
  function beginDecision(
    listing: Listing,
    decision: Decision,
    card: HTMLElement | null,
    stampLike: HTMLElement | null,
    stampNope: HTMLElement | null,
  ): void {
    if (animating) return;
    animating = true;
    detachTopDrag?.();
    detachTopDrag = null;
    updateControlsDisabled();

    if (card) {
      const direction = decision === "like" ? 1 : -1;
      if (stampLike) stampLike.style.opacity = decision === "like" ? "1" : "0";
      if (stampNope) stampNope.style.opacity = decision === "nope" ? "1" : "0";
      card.style.transition = `transform ${FLING_ANIMATION_MS}ms ease-out`;
      card.style.transform = `translate(${direction * FLING_DISTANCE_PX}px, -40px) rotate(${direction * 30}deg)`;
      setTimeout(() => void commit(listing, decision), FLING_ANIMATION_MS);
    } else {
      void commit(listing, decision);
    }
  }

  async function commit(listing: Listing, decision: Decision): Promise<void> {
    // Defensive: the animating lock above should make this impossible, but
    // never swipe the wrong card if the queue somehow moved on already.
    if (queue[0]?.id !== listing.id) {
      animating = false;
      updateControlsDisabled();
      return;
    }

    queue = queue.slice(1);
    history.push(listing);
    seen.add(listing.id);
    renderStack();
    void ensureStock();

    try {
      const result = await api.swipe(listing.id, decision);
      if (result.match) showMatchOverlay();
    } catch (error) {
      // Didn't actually persist — put it back at the front of the queue
      // instead of silently losing it (mirrors how undo() below handles a
      // failed request).
      if (history[history.length - 1]?.id === listing.id) history.pop();
      queue = [listing, ...queue];
      showError(error instanceof ApiError ? error.message : "Swipe konnte nicht gespeichert werden.");
      renderStack();
    } finally {
      animating = false;
      updateControlsDisabled();
    }
  }

  async function undo(): Promise<void> {
    if (animating) return;
    const listing = history.pop();
    if (!listing) return;
    animating = true;
    updateControlsDisabled();

    try {
      await api.undoSwipe(listing.id);
      queue.unshift(listing);
    } catch (error) {
      // The undo didn't actually happen server-side — keep it in history so
      // the user can retry, rather than silently losing it.
      history.push(listing);
      showError(error instanceof ApiError ? error.message : "Zurücknehmen fehlgeschlagen.");
    } finally {
      animating = false;
      renderStack();
    }
  }

  function showMatchOverlay(): void {
    matchOverlay.classList.remove("hidden");
    if (matchOverlayTimer) clearTimeout(matchOverlayTimer);
    matchOverlayTimer = setTimeout(() => hideMatchOverlay(), MATCH_OVERLAY_MS);
  }

  function hideMatchOverlay(): void {
    matchOverlay.classList.add("hidden");
    if (matchOverlayTimer) {
      clearTimeout(matchOverlayTimer);
      matchOverlayTimer = null;
    }
  }

  (async () => {
    await loadMore();
    loading = false;
    renderStack();
  })();

  return () => document.removeEventListener("keydown", onKeydown);
}
