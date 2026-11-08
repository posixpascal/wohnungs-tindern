// Pure gesture math for the swipe card: axis-lock detection, the
// release decision (like/nope/cancel), and the LIKE/NOPE stamp opacity.
// Kept framework- and DOM-free so it's unit-testable without a browser.

export type SwipeDecision = "like" | "nope" | "cancel";
export type DragAxis = "pending" | "horizontal" | "vertical";

// Once a pointer has moved past `slopPx`, decide whether the gesture is a
// horizontal swipe (we drive it) or a vertical scroll (left to the browser,
// via touch-action: pan-y). Below the slop the axis stays "pending" so tiny
// jitters don't lock in the wrong direction.
export function classifyDragAxis(dx: number, dy: number, slopPx: number): DragAxis {
  if (Math.hypot(dx, dy) < slopPx) return "pending";
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

export interface SwipeThresholds {
  distancePx: number;
  velocityMinDxPx: number;
  velocityThresholdPxMs: number;
}

// Decide the outcome of a released drag from its total horizontal distance
// and elapsed time: far enough, or fast enough in one direction, commits;
// otherwise the card springs back.
export function resolveSwipeDecision(dx: number, elapsedMs: number, thresholds: SwipeThresholds): SwipeDecision {
  const elapsed = Math.max(1, elapsedMs);
  const velocity = dx / elapsed;
  const fastEnough =
    Math.abs(dx) > thresholds.velocityMinDxPx && Math.abs(velocity) > thresholds.velocityThresholdPxMs;

  if (dx > thresholds.distancePx || (fastEnough && velocity > 0)) return "like";
  if (dx < -thresholds.distancePx || (fastEnough && velocity < 0)) return "nope";
  return "cancel";
}

// Opacity (0..1) of the LIKE/NOPE stamps as the card is dragged: each stamp
// fades in only on its own side, reaching full opacity at the commit
// threshold.
export function swipeStampOpacity(dx: number, thresholdPx: number): { like: number; nope: number } {
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
  return { like: clamp(dx / thresholdPx), nope: clamp(-dx / thresholdPx) };
}

export function swipeRotationDeg(dx: number, divisor = 12): number {
  return dx / divisor;
}
