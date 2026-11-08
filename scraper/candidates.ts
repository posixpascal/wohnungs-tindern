// CLI: bun scraper/candidates.ts [--limit 80] [--refresh-days 7] [file.json | "glob*.json" ...]
// Lists the detail pages worth visiting, sharing one --limit budget in this order:
//   new      – every listing from the given list files that is not in the DB yet and passes the filters (best score first)
//   backfill – active DB listings without any detail visit still lacking a gallery (<= 1 image) or a description (best score first)
//   refresh  – every other active DB listing whose latest detail visit is >= --refresh-days old (never visited first, then oldest)
// Detail visits are read from data/raw/*-detail-*.json (visits.ts), so a listing without photos on the
// portal is revisited weekly, not on every run. Without files: backfill + refresh only.
// Run it before ingest.ts.

import type { Database } from "bun:sqlite";
import { loadConfig } from "./config";
import { getListing, openDb, queryListings } from "./db";
import { expandArgs, readInputs } from "./ingest";
import { districtReason } from "./districts";
import { criteriaReason, normalize } from "./normalize";
import { fromList, mergeRecords, parseRawRecord } from "./raw";
import { scoreListing } from "./score";
import { localDay } from "./report";
import type { Config, Listing } from "./types";
import { DETAIL_GLOB, detailVisits } from "./visits";

export const DEFAULT_LIMIT = 80;
export const DEFAULT_REFRESH_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Candidate {
  readonly id: string;
  readonly url: string;
  readonly kind: "new" | "backfill" | "refresh";
  readonly missing: readonly string[];
  readonly score: number;
}

export interface CandidateOptions {
  readonly limit?: number;
  readonly now?: string;
  /** id → date (YYYY-MM-DD) of the latest detail visit, see visits.ts. */
  readonly visits?: ReadonlyMap<string, string>;
  readonly refreshDays?: number;
}

const missingFields = (l: Listing): string[] => [
  ...(l.rent_warm === null || l.rent_warm_estimated === 1 ? ["warm"] : []),
  ...(l.floor === null ? ["etage"] : []),
  ...(l.has_garden === null && l.has_balcony === null ? ["garten/balkon"] : []),
  ...(l.images.length <= 1 ? ["bilder"] : []),
  ...(l.description === null ? ["beschreibung"] : []),
];

const byScore = (cs: readonly Candidate[]): Candidate[] => [...cs].sort((a, b) => b.score - a.score);

const needsBackfill = (l: Listing): boolean => l.images.length <= 1 || l.description === null;

const known = (l: Listing, kind: Candidate["kind"]): Candidate =>
  ({ id: l.id, url: l.url, kind, missing: missingFields(l), score: l.score });

function newCandidates(db: Database, config: Config, input: readonly unknown[], now: string): Candidate[] {
  const records = input.flatMap((item) => {
    const res = parseRawRecord(item);
    return res.ok ? [fromList(res.record)] : [];
  });
  return mergeRecords(records).flatMap(({ record }): Candidate[] => {
    const n = normalize(record, config, now);
    if ("reason" in n || getListing(db, n.listing.id)) return [];
    const l = n.listing;
    const missing = missingFields(l);
    // an estimated or missing warm rent may be too pessimistic: judge by Kaltmiete (if any) and let the detail page decide
    // likewise an unknown floor or balcony: assume EG / balcony so only a confirmed miss skips the visit,
    // and an unknown district passes a district whitelist
    const judged = {
      ...l,
      rent_warm: missing.includes("warm") ? l.rent_cold ?? 0 : l.rent_warm,
      floor: l.floor ?? 0,
      has_balcony: l.has_balcony ?? 1,
    };
    if (criteriaReason(judged, config, { unknownDistrictPasses: true })) return [];
    return [{ id: l.id, url: l.url, kind: "new", missing, score: scoreListing(l, config).score }];
  });
}

export function detailCandidates(
  db: Database,
  config: Config,
  input: readonly unknown[],
  { limit = DEFAULT_LIMIT, now = new Date().toISOString(), visits = new Map(), refreshDays = DEFAULT_REFRESH_DAYS }: CandidateOptions = {},
): Candidate[] {
  // a filtered-out listing that already got a detail visit never reached the DB: don't visit it again
  const fresh = newCandidates(db, config, input, now).filter((c) => !visits.has(c.id));
  // listings the district selection rules out stay active (rescore.ts) but aren't worth a detail visit
  const active = queryListings(db, "status = 'active' ORDER BY score DESC, id").filter(
    (l) => districtReason(l, config.locations, true) === null,
  );
  const isBackfill = (l: Listing): boolean => !visits.has(l.id) && needsBackfill(l);
  // detail file names carry the local date
  const cutoff = localDay(new Date(Date.parse(now) - refreshDays * DAY_MS));
  const lastVisit = (l: Listing): string => visits.get(l.id) ?? ""; // "" = never visited, sorts first
  const refresh = active
    .filter((l) => !isBackfill(l) && lastVisit(l) <= cutoff)
    .sort((a, b) => lastVisit(a).localeCompare(lastVisit(b)) || b.score - a.score)
    .map((l) => known(l, "refresh"));
  const backfill = active.filter(isBackfill).map((l) => known(l, "backfill"));
  // new listings first (flats go fast), backfill and refresh only fill the remaining budget
  return [...byScore(fresh), ...byScore(backfill), ...refresh].slice(0, limit);
}

function positiveInt(argv: readonly string[], flag: string, fallback: number): number {
  const i = argv.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

export function parseArgs(argv: readonly string[]): { limit: number; refreshDays: number; files: string[] } {
  const flagged = new Set(["--limit", "--refresh-days"].flatMap((f) => {
    const i = argv.indexOf(f);
    return i < 0 ? [] : [i, i + 1];
  }));
  const files = argv.filter((_, j) => !flagged.has(j));
  const unknown = files.find((f) => f.startsWith("--"));
  if (unknown) throw new Error(`unknown option ${unknown}`);
  return {
    limit: positiveInt(argv, "--limit", DEFAULT_LIMIT),
    refreshDays: positiveInt(argv, "--refresh-days", DEFAULT_REFRESH_DAYS),
    files,
  };
}

async function main(): Promise<void> {
  const { limit, refreshDays, files } = parseArgs(process.argv.slice(2));
  const { input } = await readInputs(expandArgs(files));
  const config = await loadConfig();
  const db = openDb();
  try {
    const visits = detailVisits(expandArgs([DETAIL_GLOB]));
    for (const c of detailCandidates(db, config, input, { limit, refreshDays, visits })) {
      console.log(JSON.stringify(c));
    }
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`candidates failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
