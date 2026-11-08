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

// Line icons for the settings page (24×24, stroke = currentColor).
const LINE_ICONS = {
  shopping: ["M6 8h12l-1 12H7L6 8z", "M9 8V6a3 3 0 0 1 6 0v2"],
  culture: ["M3 9l9-5 9 5", "M5 10v8", "M10 10v8", "M14 10v8", "M19 10v8", "M3 21h18"],
  leisure: ["M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z", "M16 9h2a2 2 0 0 1 0 4h-2"],
  cinema: ["M4 5h16v14H4z", "M8 5v14", "M16 5v14", "M4 12h4", "M16 12h4"],
  pool: ["M2 15c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5", "M2 19c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5", "M8 12V6a2 2 0 0 1 4 0"],
  sights: ["M4 8h3l2-3h6l2 3h3v11H4z", "M15 13a3 3 0 1 1-6 0 3 3 0 1 1 6 0"],
  transit: ["M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z", "M5 10h14", "M9 21l1.5-4", "M15 21l-1.5-4"],
  excluded: ["M6 6l12 12", "M18 6 6 18"],
  neutral: ["M7 12h10"],
  allowed: ["M5 12l5 5 9-10"],
  preferred: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"],
  chevron: ["M9 6l6 6-6 6"],
} as const;

export type LineIcon = keyof typeof LINE_ICONS;

export function renderLineIcon(name: LineIcon, className = "line-icon"): SVGElement {
  const root = svg("svg", {
    viewBox: "0 0 24 24",
    class: className,
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  root.append(...LINE_ICONS[name].map((d) => svg("path", { d })));
  return root;
}
