import { describe, expect, test } from "bun:test";
import { detailVisits, isDetailFile } from "./visits";

describe("detailVisits", () => {
  test("maps ids to the date of their latest detail file and ignores other files", () => {
    const visits = detailVisits([
      "data/raw/2026-10-13-detail-kleinanzeigen-b.json",
      "data/raw/2026-10-01-detail-kleinanzeigen-b.json",
      "data/raw/2026-10-13-detail-wg-gesucht-14170222.json",
      "data/raw/2026-10-13-list-kleinanzeigen-idstein-p1.json",
      "data/raw/detail-kleinanzeigen-x.json",
    ]);
    expect([...visits]).toEqual([
      ["kleinanzeigen:b", "2026-10-13"],
      ["wg-gesucht:14170222", "2026-10-13"],
    ]);
  });

  test("isDetailFile tells detail from list files", () => {
    expect(isDetailFile("data/raw/2026-10-13-detail-immowelt-a1.json")).toBe(true);
    expect(isDetailFile("data/raw/2026-10-13-list-immowelt-idstein-p1.json")).toBe(false);
  });
});
