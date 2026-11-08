// CLI: bun scraper/sweep.ts [days=3]
// Marks active listings as gone when they were not seen for N days.

import type { Database } from "bun:sqlite";
import { openDb } from "./db";

export const DEFAULT_SWEEP_DAYS = 3;
const DAY_MS = 86_400_000;

export const cutoffIso = (days: number, now: string): string =>
  new Date(new Date(now).getTime() - days * DAY_MS).toISOString();

/** Returns the number of listings marked gone. Clears synced_at so the status change gets pushed. */
export function sweepGone(db: Database, days: number, now: string = new Date().toISOString()): number {
  const result = db
    .query("UPDATE listings SET status = 'gone', synced_at = NULL WHERE status = 'active' AND last_seen_at < ?")
    .run(cutoffIso(days, now));
  return result.changes;
}

export function parseDays(arg: string | undefined): number {
  if (arg === undefined) return DEFAULT_SWEEP_DAYS;
  const days = Number(arg);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error(`days must be an integer 1..365, got "${arg}"`);
  return days;
}

if (import.meta.main) {
  try {
    const days = parseDays(process.argv[2]);
    const db = openDb();
    try {
      console.log(JSON.stringify({ gone: sweepGone(db, days), days }));
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
