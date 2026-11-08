// Tiny trusted (not user-data) inline icons, built via the SVG DOM API
// rather than innerHTML — dom.ts's `el()` only targets the HTML namespace,
// and the project avoids innerHTML entirely so there's exactly one path
// (textContent) that untrusted listing data could ever flow through.

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// A simple house-with-photo glyph for "no images available" placeholders.
export function renderPhotoOffIcon(className: string): SVGElement {
  const root = svg("svg", {
    viewBox: "0 0 24 24",
    class: className,
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  root.append(
    svg("path", { d: "M3 10.5 12 3l9 7.5" }),
    svg("path", { d: "M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" }),
    svg("circle", { cx: "12", cy: "14", r: "2.5" }),
    svg("path", { d: "M9.5 14a2.5 2.5 0 0 1 2.5-2.5" }),
  );
  return root;
}

// A circled "i" for the card's flip-to-details button.
export function renderInfoIcon(className: string): SVGElement {
  const root = svg("svg", {
    viewBox: "0 0 24 24",
    class: className,
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
  });
  root.append(
    svg("circle", { cx: "12", cy: "12", r: "9.5" }),
    svg("path", { d: "M12 11v6" }),
    svg("circle", { cx: "12", cy: "7.5", r: "0.6", fill: "currentColor" }),
  );
  return root;
}
