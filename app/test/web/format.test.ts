import { describe, expect, test } from "bun:test";
import { formatDateDE, formatFactsLine } from "../../src/web/client/format";

describe("formatDateDE", () => {
  test("formats an ISO date de-DE style", () => {
    expect(formatDateDE("2026-03-05")).toBe("05.03.2026");
  });

  test("null stays null", () => {
    expect(formatDateDE(null)).toBeNull();
  });

  test("garbage input becomes null, not 'Invalid Date'", () => {
    expect(formatDateDE("not-a-date")).toBeNull();
  });
});

describe("formatFactsLine", () => {
  test("rooms, area and place in one line", () => {
    expect(formatFactsLine({ rooms: 3, area_sqm: 70, city: "Idstein", district: "Wörsdorf" })).toBe(
      "3 Zi · 70 m² · Idstein · Wörsdorf",
    );
  });

  test("unknown values show as ? and a missing district is left out", () => {
    expect(formatFactsLine({ rooms: 2.5, area_sqm: null, city: "Idstein", district: null })).toBe("2.5 Zi · ? m² · Idstein");
  });
});
