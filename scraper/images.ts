// Rewrites portal thumbnail URLs to a large rendition (verified live 2026-10-14).

const REWRITES: readonly (readonly [host: string, from: RegExp, to: string])[] = [
  // .../x.jpg/ORIG/legacy_thumbnail/800x600/format/webp/quality/50 -> max 1200x900, never upscaled
  ["pictures.immobilienscout24.de", /(\.\w+)\/ORIG\/.*$/, "$1/ORIG/resize/1200x900%3E/format/webp/quality/73"],
  // ?rule=$_59.AUTO (960px) / $_2 / $_1 thumbnails -> $_57.AUTO (1600px)
  ["img.kleinanzeigen.de", /\?rule=\$_\d+\.\w+$/, "?rule=$$_57.AUTO"],
  // .small.jpeg / .sized.jpg -> .large.jpeg
  ["img.wg-gesucht.de", /\.(?:small|sized)(\.\w+)$/, ".large$1"],
];

export function upgradeImageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname;
  // ?w=525&h=394 -> 1200 wide, other params untouched
  if (host === "mms.immowelt.de") {
    parsed.searchParams.delete("h");
    parsed.searchParams.set("w", "1200");
    return parsed.href;
  }
  const rule = REWRITES.find(([h]) => h === host);
  return rule ? url.replace(rule[1], rule[2]) : url;
}

/** Large, deduplicated (thumbnails of the same picture collapse) and capped. */
export const largeImages = (urls: readonly string[], max: number): string[] =>
  [...new Set(urls.map(upgradeImageUrl))].slice(0, max);
