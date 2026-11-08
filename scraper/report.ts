// CLI: bun scraper/report.ts [--gone N]   (N = "gone" count printed by sweep.ts; estimated when omitted)
// Writes reports/YYYY-MM-DD.md (German) and prints its path.

import type { Database } from "bun:sqlite";
import { CONFIG_PATH, readSelection, REPORTS_DIR, selectionNote, selectionPathFor } from "./config";
import { openDb, queryListings } from "./db";
import { cutoffIso, DEFAULT_SWEEP_DAYS } from "./sweep";
import type { Listing } from "./types";

export interface ReportData {
  readonly day: string;
  readonly fresh: readonly Listing[];
  readonly goneCount: number;
  readonly activeCount: number;
}

const euro = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const pad = (n: number): string => String(n).padStart(2, "0");

/** Local calendar day as YYYY-MM-DD. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const startOfLocalDay = (d: Date): string =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();

const count = (db: Database, where: string, ...params: string[]): number =>
  db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM listings WHERE ${where}`).get(...params)?.n ?? 0;

/**
 * Listings first seen today, the active count, and the gone count. Pass `goneCount` from sweep.ts;
 * without it, listings whose last sighting falls into today's sweep window are counted (exact for daily runs).
 */
export function collectReport(db: Database, now: string, goneCount?: number): ReportData {
  const date = new Date(now);
  return {
    day: localDay(date),
    fresh: queryListings(
      db,
      "first_seen_at >= ? AND status = 'active' ORDER BY score DESC, rent_warm ASC",
      startOfLocalDay(date),
    ),
    activeCount: count(db, "status = 'active'"),
    goneCount:
      goneCount ??
      count(
        db,
        "status = 'gone' AND last_seen_at < ? AND last_seen_at >= ?",
        cutoffIso(DEFAULT_SWEEP_DAYS, now),
        cutoffIso(DEFAULT_SWEEP_DAYS + 1, now),
      ),
  };
}

/** URL safe inside a markdown link target. */
const mdUrl = (url: string): string =>
  url.replace(/[()<>[\]\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

const md = (s: string): string => s.replace(/([\\`*_[\]|<>#])/g, "\\$1").replace(/\s+/g, " ");
const yesNo = (v: 0 | 1 | null): string => (v === 1 ? "ja" : v === 0 ? "nein" : "?");

const floorLabel = (f: number | null): string =>
  f === null ? "?" : f === 0 ? "EG" : f < 0 ? "Souterrain" : `${f}. OG`;

function listingBlock(l: Listing, i: number): string {
  const place = l.district ? `${l.city} – ${l.district}` : l.city;
  const warm = l.rent_warm === null ? "?" : `${euro.format(l.rent_warm)} €${l.rent_warm_estimated ? " (geschätzt)" : ""}`;
  const facts = [
    `warm ${warm}`,
    `${l.rooms === null ? "?" : decimal.format(l.rooms)} Zi`,
    `${l.area_sqm === null ? "?" : decimal.format(l.area_sqm)} m²`,
    `Etage: ${floorLabel(l.floor)}`,
    `Garten: ${yesNo(l.has_garden)}`,
    `Balkon: ${yesNo(l.has_balcony)}`,
  ].join(" · ");
  return [
    `### ${i + 1}. [${md(l.title)}](${mdUrl(l.url)}) – Score ${l.score}`,
    `${md(place)} · ${l.portal}`,
    "",
    facts,
    "",
    `> ${md(l.score_notes ?? "")}`,
  ].join("\n");
}

function countTable(title: string, key: string, items: readonly string[]): string {
  const counts = [...new Set(items)].map((k) => [k, items.filter((x) => x === k).length] as const);
  const rows = counts.sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${md(k)} | ${n} |`);
  return [`### ${title}`, "", `| ${key} | Neu |`, "|---|---|", ...rows].join("\n");
}

export function renderReport(data: ReportData): string {
  const [y, m, d] = data.day.split("-");
  const header = [
    `# Wohnungssuche – ${d}.${m}.${y}`,
    "",
    `**${data.fresh.length} neue Wohnungen** · ${data.activeCount} aktiv insgesamt · Nicht mehr gefunden: ${data.goneCount}`,
  ].join("\n");
  if (data.fresh.length === 0) return `${header}\n\nHeute keine neuen Wohnungen gefunden.\n`;
  return [
    header,
    "## Neue Wohnungen (nach Score)",
    data.fresh.map(listingBlock).join("\n\n"),
    "## Verteilung",
    countTable("Nach Portal", "Portal", data.fresh.map((l) => l.portal)),
    countTable("Nach Ort", "Ort", data.fresh.map((l) => l.city)),
  ].join("\n\n") + "\n";
}

export function parseGone(argv: readonly string[]): number | undefined {
  const i = argv.indexOf("--gone");
  if (i < 0) return undefined;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--gone must be a non-negative integer, got "${argv[i + 1]}"`);
  return n;
}

async function main(): Promise<void> {
  const gone = parseGone(process.argv.slice(2));
  const db = openDb();
  try {
    const data = collectReport(db, new Date().toISOString(), gone);
    const path = `${REPORTS_DIR}/${data.day}.md`;
    await Bun.write(path, renderReport(data));
    // the report itself doesn't depend on the selection: a broken cache file is only mentioned
    const selection = await readSelection(selectionPathFor(CONFIG_PATH)).catch((err: unknown) => {
      console.error(`district selection unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    console.error(selectionNote(selection));
    console.log(path);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`report failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
