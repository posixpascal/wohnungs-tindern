// Parsers for untrusted, German-formatted portal values.

const MAX_AMOUNT = 1_000_000_000;

/** Parses "1.036,20 €", "+ 250 €", "759.2", 870 … into a non-negative number. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  // "1 036 €" (space / NBSP / narrow NBSP as thousands separator)
  const compact = value.replace(/(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/g, "$1");
  const match = compact.match(/-?\d[\d.,]*/);
  if (!match || match[0].startsWith("-")) return null;
  const token = match[0].replace(/[.,]$/, "");
  const normalized = token.includes(",")
    ? token.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(token)
      ? token.replace(/\./g, "")
      : token;
  const n = Number(normalized);
  return Number.isFinite(n) && n <= MAX_AMOUNT ? n : null;
}

export function parseRooms(value: unknown): number | null {
  const n = parseNumber(value);
  return n !== null && n >= 1 && n <= 20 ? n : null;
}

const GROUND = /^(eg|erdgeschoss|hochparterre|parterre)\b/i;
const BASEMENT = /^(ug|untergeschoss|souterrain|tiefparterre)\b/i;

/** Parses a floor value: 0 = Erdgeschoss, -1 = Souterrain, null = unknown. */
export function parseFloor(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= -2 && value <= 60 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^geschoss\s+/i, "");
  if (GROUND.test(text)) return 0;
  if (BASEMENT.test(text)) return -1;
  const n = text.match(/^(-?\d{1,2})(?:\.|\s|\/|$)/);
  return n ? parseFloor(Number(n[1])) : null;
}

/** Trims and collapses whitespace (optionally keeping paragraphs and line breaks), then truncates. */
export function cleanText(value: unknown, maxLength: number, keepParagraphs = false): string | null {
  if (typeof value !== "string") return null;
  const collapsed = keepParagraphs
    ? value
        .split(/\r?\n[^\S\n]*\n\s*/)
        .map((p) =>
          p
            .split("\n")
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join("\n"),
        )
        .filter(Boolean)
        .join("\n\n")
    : value.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.slice(0, maxLength) : null;
}
