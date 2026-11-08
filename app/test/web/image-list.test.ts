import { describe, expect, test } from "bun:test";
import { removeImage, swipeStep, tapZone, wrapIndex } from "../../src/web/client/imageList";

describe("wrapIndex", () => {
  test("wraps past the end back to the start", () => {
    expect(wrapIndex(3, 3)).toBe(0);
  });

  test("wraps before the start back to the end", () => {
    expect(wrapIndex(-1, 3)).toBe(2);
  });

  test("passes through an in-range index unchanged", () => {
    expect(wrapIndex(1, 3)).toBe(1);
  });

  test("returns 0 for an empty list", () => {
    expect(wrapIndex(5, 0)).toBe(0);
  });
});

describe("removeImage", () => {
  test("returns a new array without the given src", () => {
    const images = ["a", "b", "c"];
    const next = removeImage(images, "b");
    expect(next).toEqual(["a", "c"]);
    expect(images).toEqual(["a", "b", "c"]); // original untouched
  });

  test("removing a src that isn't present is a no-op", () => {
    const images = ["a", "b"];
    expect(removeImage(images, "z")).toEqual(["a", "b"]);
  });

  test("stays correct regardless of which index the removed image was at — the whole point of removing by value", () => {
    const images = ["a", "b", "c", "d"];
    expect(removeImage(images, "a")).toEqual(["b", "c", "d"]);
    expect(removeImage(images, "d")).toEqual(["a", "b", "c"]);
  });
});

describe("tapZone", () => {
  test("left third is prev", () => {
    expect(tapZone(10, 300, 5)).toBe("prev");
  });

  test("middle third is open", () => {
    expect(tapZone(150, 300, 5)).toBe("open");
  });

  test("right third is next", () => {
    expect(tapZone(290, 300, 5)).toBe("next");
  });

  test("single image always opens, even on the edges", () => {
    expect(tapZone(10, 300, 1)).toBe("open");
    expect(tapZone(290, 300, 1)).toBe("open");
  });

  test("no images (zero width) opens rather than throwing", () => {
    expect(tapZone(0, 0, 0)).toBe("open");
  });
});

describe("swipeStep", () => {
  test("a horizontal swipe left shows the next image, right the previous", () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, -10)).toBe(-1);
  });

  test("short or mostly vertical movement is not a swipe", () => {
    expect(swipeStep(-20, 0)).toBe(0);
    expect(swipeStep(-60, 90)).toBe(0);
  });
});
