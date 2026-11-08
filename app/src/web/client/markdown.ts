// Minimal Markdown subset for listing descriptions (untrusted text): parsed
// into plain data so rendering can stay textContent-only — no HTML ever.

export type Inline = { text: string; bold: boolean };

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; items: Inline[][] }
  | { type: "rule" };

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
// Scraped section labels ("Lage:", "Objektbeschreibung:") act as headings.
const LABEL = /^([^.!?:]{1,40}):$/;
const BULLET = /^(?:[-*•–]|\d+[.)])\s+(.+)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const BOLD = /\*\*(.+?)\*\*|__(.+?)__/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), bold: false });
    out.push({ text: m[1] ?? m[2] ?? "", bold: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

function lineBlock(line: string): Block | Inline[] {
  const heading = line.match(HEADING) ?? line.match(LABEL);
  if (heading?.[1]) return { type: "heading", text: heading[1].replace(/\*\*|__/g, "") };
  if (RULE.test(line)) return { type: "rule" };
  const bullet = line.match(BULLET);
  if (bullet?.[1]) return { type: "list", items: [parseInline(bullet[1])] };
  return parseInline(line);
}

/** Consecutive bullet lines form one list, consecutive text lines one paragraph; blank lines separate. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null; // list/paragraph still accepting lines
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      open = null;
      continue;
    }
    const block = lineBlock(line);
    if (Array.isArray(block)) {
      if (open?.type === "paragraph") open.lines.push(block);
      else blocks.push((open = { type: "paragraph", lines: [block] }));
    } else if (block.type === "list") {
      if (open?.type === "list") open.items.push(...block.items);
      else blocks.push((open = block));
    } else {
      blocks.push(block);
      open = null;
    }
  }
  return blocks;
}
