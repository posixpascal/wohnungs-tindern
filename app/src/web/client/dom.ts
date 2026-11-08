// Tiny DOM builder. Text content always goes through `textContent` (string
// children below) so listing data (untrusted, scraped) can never be
// interpreted as HTML. Event listeners are always attached explicitly via
// addEventListener by callers, not through a prop here, so there's exactly
// one obvious place to look for them.

type Props = Record<string, string | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (typeof value === "boolean") {
      if (value) node.setAttribute(key, "");
      continue;
    }
    node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}
