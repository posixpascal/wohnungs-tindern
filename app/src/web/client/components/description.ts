import { el } from "../dom";
import { parseMarkdown, type Block, type Inline } from "../markdown";

const inlines = (parts: readonly Inline[]): Node[] =>
  parts.map((p) => (p.bold ? el("strong", {}, [p.text]) : document.createTextNode(p.text)));

function renderBlock(block: Block): HTMLElement {
  switch (block.type) {
    case "heading":
      return el("h4", { class: "md-heading" }, [block.text]);
    case "rule":
      return el("hr", { class: "md-rule" });
    case "list":
      return el("ul", { class: "md-list" }, block.items.map((item) => el("li", {}, inlines(item))));
    case "paragraph":
      return el(
        "p",
        { class: "md-paragraph" },
        block.lines.flatMap((line, i) => (i === 0 ? inlines(line) : [el("br"), ...inlines(line)])),
      );
  }
}

// Untrusted text: parsed into data and built with text nodes only, never innerHTML.
const renderMarkdown = (text: string): HTMLElement =>
  el("div", { class: "description description-md" }, parseMarkdown(text).map(renderBlock));

export function renderDescription(description: string | null): HTMLElement {
  if (!description) return el("p", { class: "description description-empty" }, ["Keine Beschreibung."]);
  return renderMarkdown(description);
}
