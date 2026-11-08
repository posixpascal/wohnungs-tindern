import { describe, expect, test } from "bun:test";
import {
  classifyDragAxis,
  resolveSwipeDecision,
  swipeRotationDeg,
  swipeStampOpacity,
} from "../../src/web/client/swipeGesture";

const THRESHOLDS = { distancePx: 110, velocityMinDxPx: 40, velocityThresholdPxMs: 0.6 };

describe("classifyDragAxis", () => {
  test("stays pending below the slop", () => {
    expect(classifyDragAxis(4, 3, 10)).toBe("pending");
  });

  test("locks horizontal once past slop with dx dominant", () => {
    expect(classifyDragAxis(30, 5, 10)).toBe("horizontal");
  });

  test("locks vertical once past slop with dy dominant", () => {
    expect(classifyDragAxis(5, 30, 10)).toBe("vertical");
  });
});

describe("resolveSwipeDecision", () => {
  test("commits like past the distance threshold", () => {
    expect(resolveSwipeDecision(150, 400, THRESHOLDS)).toBe("like");
  });

  test("commits nope past the distance threshold", () => {
    expect(resolveSwipeDecision(-150, 400, THRESHOLDS)).toBe("nope");
  });

  test("cancels when released near the center and slow", () => {
    expect(resolveSwipeDecision(20, 400, THRESHOLDS)).toBe("cancel");
  });

  test("commits like on a fast fling even under the distance threshold", () => {
    expect(resolveSwipeDecision(60, 50, THRESHOLDS)).toBe("like");
  });

  test("commits nope on a fast fling even under the distance threshold", () => {
    expect(resolveSwipeDecision(-60, 50, THRESHOLDS)).toBe("nope");
  });

  test("a fast but too-short fling still cancels", () => {
    expect(resolveSwipeDecision(20, 10, THRESHOLDS)).toBe("cancel");
  });
});

describe("swipeStampOpacity", () => {
  test("like stamp fades in with positive dx, nope stays at 0", () => {
    expect(swipeStampOpacity(55, 110)).toEqual({ like: 0.5, nope: 0 });
  });

  test("nope stamp fades in with negative dx, like stays at 0", () => {
    expect(swipeStampOpacity(-55, 110)).toEqual({ like: 0, nope: 0.5 });
  });

  test("clamps at 1 beyond the threshold", () => {
    expect(swipeStampOpacity(500, 110)).toEqual({ like: 1, nope: 0 });
  });
});

describe("swipeRotationDeg", () => {
  test("rotates proportionally to horizontal distance", () => {
    expect(swipeRotationDeg(120)).toBe(10);
    expect(swipeRotationDeg(-60)).toBe(-5);
  });
});
