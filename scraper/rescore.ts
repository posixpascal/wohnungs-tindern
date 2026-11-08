// CLI: bun scraper/rescore.ts [db-path]   (default: data/wohnungen.sqlite)
// Re-applies the current exclusion rules and criteria to all active listings (rejected ones → gone) and
// recomputes score/score_notes of the rest with the current config/search.json.
// Changed rows get synced_at = NULL so the next push sends them to the server.

import type { Database } from "bun:sqlite";
import { loadConfig } from "./config";
import { openDb, queryListings } from "./db";
import { exclusionReason, hasBathtub } from "./detect";
import { criteriaReason } from "./normalize";
import { scoreListing } from "./score";
import type { Config, Listing } from "./types";

/** Feature lists are not stored, so a bathtub not detected at ingest can only come from title/description. */
const withBathtub = (l: Listing): Listing =>
  l.has_bathtub !== null ? l : { ...l, has_bathtub: hasBathtub(`${l.title}\n${l.description ?? ""}`) ? 1 : null };

function rescored(stored: Listing, config: Config): Listing {
  const l = withBathtub(stored);
  const { score, notes } = scoreListing(l, config);
  return { ...l, score, score_notes: notes };
}

const differs = (a: Listing, b: Listing): boolean =>
  a.score !== b.score || a.score_notes !== b.score_notes || a.has_bathtub !== b.has_bathtub;

/** Same rules as ingest; feature lists are not stored, so exclusions only see title and description. */
const rejected = (l: Listing, config: Config): boolean =>
  exclusionReason(l.title, l.description ?? "") !== null || criteriaReason(l, config) !== null;

/** Read and write in one transaction so a concurrent ingest cannot be overwritten with a stale score. */
export function rescoreListings(
  db: Database,
  config: Config,
): { rescored: number; changed: number; removed: number } {
  const update = db.query(
    "UPDATE listings SET has_bathtub = ?, score = ?, score_notes = ?, synced_at = NULL WHERE id = ?",
  );
  const markGone = db.query("UPDATE listings SET status = 'gone', synced_at = NULL WHERE id = ?");
  return db.transaction(() => {
    const active = queryListings(db, "status = 'active'");
    const removed = active.filter((l) => rejected(l, config));
    const listings = active.filter((l) => !removed.includes(l));
    const changed = listings.map((l) => rescored(l, config)).filter((l, i) => differs(l, listings[i]!));
    removed.forEach((l) => markGone.run(l.id));
    changed.forEach((l) => update.run(l.has_bathtub, l.score, l.score_notes, l.id));
    return { rescored: listings.length, changed: changed.length, removed: removed.length };
  })();
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const db = openDb(process.argv[2]);
  try {
    console.log(JSON.stringify(rescoreListings(db, config)));
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`rescore failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
