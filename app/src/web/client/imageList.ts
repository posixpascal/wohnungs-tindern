// Pure helpers for the image carousel/gallery: index wrapping, immutable
// removal of a broken image, and mapping a tap's x position to an action.

export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

// Returns a new array with every occurrence of `src` removed (never
// mutates the input) so callers can just reassign their local reference.
// Removing by value rather than by index matters once multiple images can
// be loading concurrently (the fullscreen gallery): an index captured when
// a slide was rendered can point at the wrong image by the time its
// `error` event actually fires, if some other image was removed first and
// everything shifted. Listings don't repeat the same image URL, so
// removing every match is equivalent to removing "the" broken one.
export function removeImage(images: readonly string[], src: string): string[] {
  return images.filter((image) => image !== src);
}

export type TapZone = "prev" | "open" | "next";

// Tap target rule for the card/gallery image: left third = previous image,
// right third = next image, middle third = open the fullscreen viewer. With
// 0 or 1 images there's nothing to page through, so every tap opens it.
export function tapZone(x: number, width: number, imageCount: number): TapZone {
  if (imageCount <= 1 || width <= 0) return "open";
  const third = width / 3;
  if (x < third) return "prev";
  if (x > third * 2) return "next";
  return "open";
}

const SWIPE_MIN_PX = 40;

// Detail-view carousel: a dominantly horizontal swipe pages the images
// (finger moves left = next, like every photo viewer); anything shorter or
// mostly vertical is a tap or a scroll, not a swipe.
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
