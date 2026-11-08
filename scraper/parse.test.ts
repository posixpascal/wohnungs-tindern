import { describe, expect, test } from "bun:test";
import { cleanText, parseFloor, parseNumber, parseRooms } from "./parse";

describe("parseNumber", () => {
  test.each([
    [870, 870],
    ["870 €", 870],
    ["1.036,20 €", 1036.2],
    ["1.200 €Kaltmiete", 1200],
    ["+ 250 €", 250],
    ["759.2", 759.2],
    ["69.58", 69.58],
    ["79,80 m²", 79.8],
    ["62 m²", 62],
    ["1.234.567", 1234567],
    ["2,5", 2.5],
    ["1 036 €", 1036],
    ["1\u00a0200 €", 1200],
  ] as const)("%p -> %p", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });

  test.each([null, undefined, "", "n.a.", "in Nebenkosten enthalten", "VB", NaN, Infinity, {}, true])(
    "%p -> null",
    (input) => {
      expect(parseNumber(input)).toBeNull();
    },
  );

  test("rejects negative amounts", () => {
    expect(parseNumber(-5)).toBeNull();
    expect(parseNumber("-5 €")).toBeNull();
  });
});

describe("parseRooms", () => {
  test("parses plain and German decimals", () => {
    expect(parseRooms("3")).toBe(3);
    expect(parseRooms("2,5")).toBe(2.5);
    expect(parseRooms(4)).toBe(4);
  });

  test("rejects implausible values", () => {
    expect(parseRooms(0)).toBeNull();
    expect(parseRooms(25)).toBeNull();
    expect(parseRooms("x")).toBeNull();
  });
});

describe("parseFloor", () => {
  test.each([
    [0, 0],
    [2, 2],
    ["0", 0],
    ["EG", 0],
    ["Erdgeschoss", 0],
    ["Hochparterre", 0],
    ["Parterre", 0],
    ["Geschoss EG/2", 0],
    ["Souterrain", -1],
    ["UG", -1],
    ["Untergeschoss", -1],
    ["Geschoss -1/1", -1],
    ["1. Geschoss", 1],
    ["Geschoss 1/3", 1],
    ["1 von 2", 1],
    ["3. OG", 3],
    ["2. Obergeschoss", 2],
  ] as const)("%p -> %p", (input, expected) => {
    expect(parseFloor(input)).toBe(expected);
  });

  test.each([null, undefined, "", "Dachgeschoss", "k.A.", 1.5, 99])("%p -> null", (input) => {
    expect(parseFloor(input)).toBeNull();
  });
});

describe("cleanText", () => {
  test("collapses whitespace and truncates", () => {
    expect(cleanText("  a \n\n  b  ", 10)).toBe("a b");
    expect(cleanText("abcdef", 3)).toBe("abc");
  });

  test("keeps paragraph and line breaks (lists) when asked", () => {
    expect(cleanText("a\n\n\n b", 100, true)).toBe("a\n\nb");
    expect(cleanText("Kosten:\r\n-  Kalt 800 €\n\t- NK  150 €  \n \n\nEnde", 100, true)).toBe(
      "Kosten:\n- Kalt 800 €\n- NK 150 €\n\nEnde",
    );
  });

  test("returns null for non-strings and blanks", () => {
    expect(cleanText(undefined, 10)).toBeNull();
    expect(cleanText("   ", 10)).toBeNull();
    expect(cleanText(42, 10)).toBeNull();
  });
});
