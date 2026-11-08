import { describe, expect, test } from "bun:test";
import { largeImages, upgradeImageUrl } from "./images";

describe("upgradeImageUrl", () => {
  test("ImmoScout24 thumbnails -> resize to max 1200x900", () => {
    expect(
      upgradeImageUrl(
        "https://pictures.immobilienscout24.de/listings/f73a-2022633770.jpg/ORIG/legacy_thumbnail/800x600/format/webp/quality/50",
      ),
    ).toBe("https://pictures.immobilienscout24.de/listings/f73a-2022633770.jpg/ORIG/resize/1200x900%3E/format/webp/quality/73");
  });

  test("Kleinanzeigen rule -> $_57 (1600px)", () => {
    expect(upgradeImageUrl("https://img.kleinanzeigen.de/api/v1/prod-ads/images/66/6682?rule=$_59.AUTO")).toBe(
      "https://img.kleinanzeigen.de/api/v1/prod-ads/images/66/6682?rule=$_57.AUTO",
    );
  });

  test("immowelt size params -> w=1200", () => {
    expect(upgradeImageUrl("https://mms.immowelt.de/f/3/d/7/f3d7.jpg?w=525&h=394")).toBe(
      "https://mms.immowelt.de/f/3/d/7/f3d7.jpg?w=1200",
    );
  });

  test("WG-Gesucht small/sized -> large", () => {
    expect(upgradeImageUrl("https://img.wg-gesucht.de/media/up/2026/40/a7_IMG_8605.small.jpeg")).toBe(
      "https://img.wg-gesucht.de/media/up/2026/40/a7_IMG_8605.large.jpeg",
    );
    expect(upgradeImageUrl("https://img.wg-gesucht.de/media/up/2026/39/x.sized.JPEG")).toBe(
      "https://img.wg-gesucht.de/media/up/2026/39/x.large.JPEG",
    );
  });

  test("leaves already large and unknown URLs alone", () => {
    const urls = [
      "https://img.wg-gesucht.de/media/up/2026/39/x.large.jpg",
      "https://example.com/a.small.jpg?rule=$_59.AUTO",
      "not a url",
    ];
    for (const u of urls) expect(upgradeImageUrl(u)).toBe(u);
  });
});

describe("largeImages", () => {
  test("upgrades, dedupes thumbnails of the same image and caps", () => {
    const ka = (rule: string) => `https://img.kleinanzeigen.de/api/v1/prod-ads/images/66/a?rule=${rule}`;
    expect(largeImages([ka("$_59.AUTO"), ka("$_57.AUTO"), ka("$_1.AUTO")], 30)).toEqual([ka("$_57.AUTO")]);
    const many = Array.from({ length: 40 }, (_, i) => `https://img/${i}.jpg`);
    expect(largeImages(many, 30)).toHaveLength(30);
  });
});
