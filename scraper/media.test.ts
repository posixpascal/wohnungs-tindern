import { describe, expect, test } from "bun:test";
import { authority, pickDescription, pickImages } from "./media";

const three = ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"];
const one = ["https://x/9.jpg"];

describe("authority", () => {
  test("a fresh detail visit beats everything, a stored detail visit beats a list sighting", () => {
    expect(authority(false, true)).toBe("fresh");
    expect(authority(true, true)).toBe("fresh");
    expect(authority(true, false)).toBe("stored");
    expect(authority(false, false)).toBe("larger");
  });
});

describe("pickImages", () => {
  test("fresh: any non-empty gallery replaces, also a smaller one; empty keeps", () => {
    expect(pickImages(three, one, "fresh")).toEqual(one);
    expect(pickImages(three, [], "fresh")).toEqual(three);
  });

  test("stored: fresh only fills an empty gallery", () => {
    expect(pickImages(one, three, "stored")).toEqual(one);
    expect(pickImages([], three, "stored")).toEqual(three);
  });

  test("larger: more images win, ties go to fresh", () => {
    expect(pickImages(three, one, "larger")).toEqual(three);
    expect(pickImages(one, three, "larger")).toEqual(three);
    expect(pickImages(one, ["https://x/8.jpg"], "larger")).toEqual(["https://x/8.jpg"]);
  });
});

describe("pickDescription", () => {
  test("fresh: non-blank replaces, also a shorter one; blank keeps", () => {
    expect(pickDescription("Lang und ausführlich", "Kurz", "fresh")).toBe("Kurz");
    expect(pickDescription("Lang", "  ", "fresh")).toBe("Lang");
    expect(pickDescription<string | null>("Lang", null, "fresh")).toBe("Lang");
  });

  test("stored: fresh only fills a blank description", () => {
    expect(pickDescription("Alt", "Neu und länger", "stored")).toBe("Alt");
    expect(pickDescription<string | null>(null, "Neu", "stored")).toBe("Neu");
  });

  test("larger: the longer text wins", () => {
    expect(pickDescription("Lang und ausführlich", "Kurz…", "larger")).toBe("Lang und ausführlich");
    expect(pickDescription<string | undefined>(undefined, "Kurz", "larger")).toBe("Kurz");
    expect(pickDescription("ab", "     ", "larger")).toBe("ab");
  });
});
