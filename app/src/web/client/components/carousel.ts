import { el, clear } from "../dom";
import { removeImage, swipeStep, tapZone, wrapIndex } from "../imageList";
import { renderPhotoOffIcon } from "./icon";
import { openGallery } from "./gallery";

// Images beyond this count collapse the dot row into a "3 / 12" counter
// pill — a dozen+ dots would just be visual noise.
const DOT_CAP = 10;

export interface CarouselOptions {
  images: string[];
  alt: string;
  // Horizontal swipe pages the images. Only where no outer gesture owns the
  // horizontal axis: in the swipe card a horizontal drag means like/nope.
  swipeable?: boolean;
}

// The image area used by both the swipe card and the detail sheet: tap
// left/right thirds to page, tap the middle third to open the fullscreen
// gallery, dots (or a counter pill) show position, broken images are
// dropped instead of showing an empty frame.
export function renderCarousel(options: CarouselOptions): HTMLElement {
  let images = options.images;
  let index = 0;
  // The URL the single reused <img> below is currently trying to load —
  // tracked separately from `index` so a broken image is always removed by
  // its actual value, never by a position that could have shifted.
  let attemptedSrc = images[0] ?? "";

  const imgEl = el("img", {
    src: attemptedSrc,
    referrerpolicy: "no-referrer",
    alt: options.alt,
    class: "card-image",
    draggable: "false",
  });
  // A placeholder sibling (not a replacement for imgEl) so a broken image
  // doesn't permanently disable the carousel: showImage() keeps updating
  // the same img element, it just stays hidden until it loads successfully.
  const placeholder = el("div", { class: "card-image-placeholder hidden" }, [
    renderPhotoOffIcon("placeholder-icon"),
    "Keine Bilder",
  ]);

  const indicator = el("div", { class: "carousel-indicator", "aria-hidden": "true" });
  // Decorative tap zones (left/right thirds) aren't reachable by keyboard —
  // this gives keyboard/screen-reader users an equivalent way to open the
  // fullscreen gallery.
  const openGalleryButton = el(
    "button",
    { type: "button", class: "sr-only", "aria-label": "Bilder ansehen" },
    [],
  );

  function renderIndicator(): void {
    clear(indicator);
    if (images.length <= 1) return;
    if (images.length > DOT_CAP) {
      indicator.append(el("div", { class: "carousel-counter" }, [`${index + 1} / ${images.length}`]));
      return;
    }
    indicator.append(
      el(
        "div",
        { class: "carousel-dots" },
        images.map((_, i) => el("span", { class: i === index ? "dot dot-active" : "dot" })),
      ),
    );
  }

  function showImage(next: number): void {
    if (images.length === 0) {
      imgEl.classList.add("hidden");
      placeholder.classList.remove("hidden");
      return;
    }
    index = wrapIndex(next, images.length);
    attemptedSrc = images[index] ?? "";
    imgEl.classList.remove("hidden");
    placeholder.classList.add("hidden");
    imgEl.setAttribute("src", attemptedSrc);
    renderIndicator();
  }

  imgEl.addEventListener("error", () => {
    images = removeImage(images, attemptedSrc);
    showImage(index);
  });

  const carousel = el(
    "div",
    { class: "carousel" },
    images.length > 0 ? [imgEl, placeholder, indicator, openGalleryButton] : [placeholder],
  );

  function openImageGallery(): void {
    if (images.length === 0) return;
    openGallery({
      images,
      startIndex: index,
      alt: options.alt,
      onImagesChange: (next) => {
        images = next;
        showImage(index);
      },
    });
  }
  openGalleryButton.addEventListener("click", (event) => {
    // Without this, the click would also bubble to the carousel's own
    // click-zone handler below and run tapZone() against this (clipped,
    // effectively zero-size) button's position instead of a real tap.
    event.stopPropagation();
    openImageGallery();
  });

  // A genuine tap (no meaningful movement) reaches here as a native click;
  // a horizontal drag is captured by the card's own pointer listeners
  // before it ever turns into a click, and a vertical scroll is suppressed
  // by the browser's own "moved too far, cancel the click" behavior. That's
  // what lets a drag that *starts* on the image still swipe the card while
  // a plain tap pages the carousel instead.
  let swipedAt = 0;
  if (options.swipeable) attachSwipe();

  function attachSwipe(): void {
    carousel.classList.add("carousel-swipeable");
    let start: { id: number; x: number; y: number } | null = null;
    carousel.addEventListener("pointerdown", (event) => {
      start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    carousel.addEventListener("pointerup", (event) => {
      if (!start || event.pointerId !== start.id) return;
      const step = swipeStep(event.clientX - start.x, event.clientY - start.y);
      start = null;
      if (step === 0 || images.length < 2) return;
      swipedAt = event.timeStamp;
      showImage(index + step);
    });
    carousel.addEventListener("pointercancel", () => {
      start = null;
    });
  }

  carousel.addEventListener("click", (event) => {
    if (images.length === 0) return;
    // a mouse swipe still ends in a click — it must not also page/open
    if (event.timeStamp - swipedAt < 400) return;
    const rect = carousel.getBoundingClientRect();
    const x = (event as MouseEvent).clientX - rect.left;
    const zone = tapZone(x, rect.width, images.length);
    if (zone === "prev") showImage(index - 1);
    else if (zone === "next") showImage(index + 1);
    else openImageGallery();
  });

  if (images.length === 0) placeholder.classList.remove("hidden");
  renderIndicator();

  return carousel;
}
