import { describe, expect, test } from "bun:test";
import { parseInline, parseMarkdown } from "../../src/web/client/markdown";

describe("parseInline", () => {
  test("splits **bold** and __bold__ spans", () => {
    expect(parseInline("Miete **850 €** warm __inkl.__ NK")).toEqual([
      { text: "Miete ", bold: false },
      { text: "850 €", bold: true },
      { text: " warm ", bold: false },
      { text: "inkl.", bold: true },
      { text: " NK", bold: false },
    ]);
  });

  test("keeps unmatched markers as text", () => {
    expect(parseInline("2 * 3 ** offen")).toEqual([{ text: "2 * 3 ** offen", bold: false }]);
  });
});

describe("parseMarkdown", () => {
  test("headings, paragraphs, lists and rules", () => {
    const md = [
      "## Objekt",
      "Helle Wohnung,",
      "ruhige Lage.",
      "",
      "Ausstattung:",
      "- Balkon",
      "* Keller",
      "• **EBK**",
      "---",
      "Lage:",
      "Nahe S-Bahn.",
    ].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { type: "heading", text: "Objekt" },
      {
        type: "paragraph",
        lines: [[{ text: "Helle Wohnung,", bold: false }], [{ text: "ruhige Lage.", bold: false }]],
      },
      { type: "heading", text: "Ausstattung" },
      {
        type: "list",
        items: [
          [{ text: "Balkon", bold: false }],
          [{ text: "Keller", bold: false }],
          [{ text: "EBK", bold: true }],
        ],
      },
      { type: "rule" },
      { type: "heading", text: "Lage" },
      { type: "paragraph", lines: [[{ text: "Nahe S-Bahn.", bold: false }]] },
    ]);
  });

  test("a long sentence ending in a colon is not a heading", () => {
    const blocks = parseMarkdown("Die Wohnung bietet folgende Vorteile für Sie und Ihre Familie:");
    expect(blocks[0]?.type).toBe("paragraph");
  });

  test("empty input gives no blocks", () => {
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });
});
