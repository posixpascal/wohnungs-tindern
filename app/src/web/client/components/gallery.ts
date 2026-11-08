import { el, clear } from "../dom";
import { removeImage } from "../imageList";
import { classifyDragAxis } from "../swipeGesture";
import { pushModal } from "../modalStackInstance";

// Fullscreen image viewer: horizontal paging via native CSS scroll-snap
// (so it feels right on iOS/Android and still allows native pinch-zoom),
// closed via the ✕ button, Esc (handled by the shared modal stack), or a
// >100px vertical swipe-down.
const SWIPE_DOWN_CLOSE_PX = 100;
const DRAG_SLOP_PX = 10;

export interface GalleryOptions {
  images: readonly string[];
  startIndex: number;
  alt: string;
  // Broken images are removed here too (kept in sync with the card via this
  // callback) so a dead URL never shows an empty frame in either place.
  onImagesChange?: (images: string[]) => void;
}

export function openGallery(options: GalleryOptions): void {
  let images = [...options.images];
  if (images.length === 0) return;
  let index = Math.min(Math.max(options.startIndex, 0), images.length - 1);

  const counter = el("div", { class: "gallery-counter" });
  const closeButton = el(
    "button",
    { class: "gallery-close", type: "button", "aria-label": "Schließen" },
    ["✕"],
  );
  const track = el("div", { class: "gallery-track" });
  const overlay = el(
    "div",
    { class: "gallery-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Bildergalerie" },
    [track, closeButton, counter],
  );

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  function updateCounter(): void {
    counter.textContent = `${index + 1} / ${images.length}`;
  }

  function buildSlide(src: string, slideIndex: number): HTMLElement {
    const isNeighbor = Math.abs(slideIndex - index) <= 1;
    const img = el("img", {
      src,
      alt: options.alt,
      class: "gallery-image",
      referrerpolicy: "no-referrer",
      // Enumerated attribute: must be the literal string "false", a
      // falsy boolean prop would just omit it (default is draggable).
      draggable: "false",
      ...(isNeighbor ? {} : { loading: "lazy" }),
    });
    const slide = el("div", { class: "gallery-slide" }, [img]);
    img.addEventListener("error", () => handleBrokenImage(src, slide));
    return slide;
  }

  function renderSlides(): void {
    clear(track);
    images.forEach((src, i) => track.append(buildSlide(src, i)));
  }

  // Removes exactly the one broken slide (rather than rebuilding every
  // slide) so images that already loaded aren't forced to reload, and so a
  // slide's own `error` closure — bound to its URL, not its position — can
  // never act on the wrong image even if other broken images were removed
  // first and the array shifted underneath it.
  function handleBrokenImage(src: string, slideNode: HTMLElement): void {
    const removedIndex = images.indexOf(src);
    if (removedIndex === -1) return; // already handled
    images = removeImage(images, src);
    options.onImagesChange?.(images);
    slideNode.remove();
    if (images.length === 0) {
      close();
      return;
    }
    if (removedIndex < index) index -= 1;
    index = Math.min(Math.max(index, 0), images.length - 1);
    updateCounter();
    scrollToIndex(false);
  }

  function scrollToIndex(smooth: boolean): void {
    const slide = track.children[index];
    if (slide instanceof HTMLElement) {
      // "instant" isn't supported by older Safari's ScrollToOptions
      // (throws instead of scrolling); "auto" is the widely-supported way
      // to say "jump, don't animate".
      track.scrollTo({ left: slide.offsetLeft, behavior: smooth ? "smooth" : "auto" });
    }
  }

  let scrollRaf: number | null = null;
  function onTrackScroll(): void {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      const width = track.clientWidth || 1;
      const next = Math.round(track.scrollLeft / width);
      index = Math.min(Math.max(next, 0), images.length - 1);
      updateCounter();
    });
  }
  track.addEventListener("scroll", onTrackScroll, { passive: true });

  // Swipe-down-to-close, via touch events rather than Pointer Events:
  // once the browser decides a touch is a vertical pan it can cancel our
  // pointer (pointercancel) without ever telling us the final distance, so
  // a real swipe-down could silently fail to close. Touch events don't get
  // hijacked that way, and since we never preventDefault() here, native
  // pinch-zoom (two touches) and the horizontal scroll-snap paging both
  // keep working untouched.
  let touchStartX: number | null = null;
  let touchStartY: number | null = null;

  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) {
      touchStartX = null;
      touchStartY = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }

  function onTouchMove(event: TouchEvent): void {
    // A second finger landing mid-gesture means this is a pinch, not a
    // swipe-down — leave it entirely to the browser.
    if (event.touches.length > 1) {
      touchStartX = null;
      touchStartY = null;
    }
  }

  function onTouchEnd(event: TouchEvent): void {
    if (touchStartX === null || touchStartY === null) return;
    const touch = event.changedTouches[0];
    const startX = touchStartX;
    const startY = touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (classifyDragAxis(dx, dy, DRAG_SLOP_PX) === "vertical" && dy > SWIPE_DOWN_CLOSE_PX) close();
  }

  overlay.addEventListener("touchstart", onTouchStart, { passive: true });
  overlay.addEventListener("touchmove", onTouchMove, { passive: true });
  overlay.addEventListener("touchend", onTouchEnd, { passive: true });

  // Trivial mouse fallback for desktop/mouse-driven testing — touch
  // devices that also emit compatibility mouse events after a real touch
  // just run this a second time with a near-zero delta, which is a no-op.
  let mouseStartX: number | null = null;
  let mouseStartY: number | null = null;
  overlay.addEventListener("mousedown", (event) => {
    mouseStartX = event.clientX;
    mouseStartY = event.clientY;
  });
  overlay.addEventListener("mouseup", (event) => {
    if (mouseStartX === null || mouseStartY === null) return;
    const dx = event.clientX - mouseStartX;
    const dy = event.clientY - mouseStartY;
    mouseStartX = null;
    mouseStartY = null;
    if (classifyDragAxis(dx, dy, DRAG_SLOP_PX) === "vertical" && dy > SWIPE_DOWN_CLOSE_PX) close();
  });

  closeButton.addEventListener("click", () => close());

  let closed = false;
  const popModal = pushModal(close);

  function close(): void {
    if (closed) return;
    closed = true;
    track.removeEventListener("scroll", onTrackScroll);
    overlay.remove();
    popModal();
    previouslyFocused?.focus();
  }

  renderSlides();
  updateCounter();
  document.body.append(overlay);
  scrollToIndex(false);
  closeButton.focus();
}
