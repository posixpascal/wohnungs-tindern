// CLI: bun scraper/ingest.ts [file.json | "glob*.json" ...]   (reads stdin when no argument is given)
// Validates, normalizes, filters, scores and upserts raw portal records.
// Records from detail files (data/raw/*-detail-*.json) are authoritative for images and description (media.ts).

import type { Database } from "bun:sqlite";
import { loadConfig } from "./config";
import { getListing, openDb, upsertListing } from "./db";
import { criteriaReason, normalize } from "./normalize";
import { authority, type MediaAuthority, pickDescription, pickImages } from "./media";
import { fromDetail, fromList, mergeRecords, parseRawRecord, recordId, type SourcedRecord } from "./raw";
import { scoreListing } from "./score";
import type { Config, Listing } from "./types";
import { DETAIL_GLOB, detailVisits, isDetailFile } from "./visits";

export interface Summary {
  readonly received: number;
  readonly new: number;
  readonly updated: number;
  readonly filtered: number;
  readonly invalid: number;
}

export interface Problem {
  readonly kind: "invalid" | "filtered";
  readonly id: string;
  readonly reason: string;
}

export interface IngestOptions {
  /** Records from detail pages, applied after the list records. */
  readonly detail?: readonly unknown[];
  /** id → date of the latest detail visit (visits.ts); a stored listing in here holds detail-page images/text. */
  readonly visits?: ReadonlyMap<string, string>;
}

const NO_DETAIL: MediaAuthority = { images: "larger", description: "larger" };

/** Fresh values win; missing detail fields and actual (non-estimated) rents are kept from the stored row. */
export function mergeWithExisting(existing: Listing | null, fresh: Listing, media: MediaAuthority = NO_DETAIL): Listing {
  if (!existing) return fresh;
  // keep the stored rent when the fresh one is missing or only an estimate replacing a real value
  const keepRent =
    existing.rent_warm !== null &&
    (fresh.rent_warm === null || (fresh.rent_warm_estimated === 1 && existing.rent_warm_estimated === 0));
  return {
    ...fresh,
    district: fresh.district ?? existing.district,
    address: fresh.address ?? existing.address,
    rent_cold: fresh.rent_cold ?? existing.rent_cold,
    rent_warm: keepRent ? existing.rent_warm : fresh.rent_warm,
    rent_warm_estimated: keepRent ? existing.rent_warm_estimated : fresh.rent_warm_estimated,
    rooms: fresh.rooms ?? existing.rooms,
    area_sqm: fresh.area_sqm ?? existing.area_sqm,
    floor: fresh.floor ?? existing.floor,
    has_garden: fresh.has_garden ?? existing.has_garden,
    has_balcony: fresh.has_balcony ?? existing.has_balcony,
    has_bathtub: fresh.has_bathtub ?? existing.has_bathtub,
    available_from: fresh.available_from ?? existing.available_from,
    description: pickDescription(existing.description, fresh.description, media.description),
    images: pickImages(existing.images, fresh.images, media.images),
    first_seen_at: existing.first_seen_at,
    synced_at: existing.synced_at,
  };
}

function validate(input: readonly unknown[], detail: readonly unknown[]): { records: SourcedRecord[]; problems: Problem[] } {
  const results = [...input, ...detail].map((item, i) => ({ i, res: parseRawRecord(item), isDetail: i >= input.length }));
  return {
    records: results.flatMap(({ res, isDetail }) => (res.ok ? [(isDetail ? fromDetail : fromList)(res.record)] : [])),
    problems: results.flatMap(({ i, res }) =>
      res.ok ? [] : [{ kind: "invalid" as const, id: `#${i}`, reason: res.error }],
    ),
  };
}

function processRecord(
  db: Database,
  config: Config,
  { record, detail }: SourcedRecord,
  now: string,
  visits: ReadonlyMap<string, string>,
): Problem | "new" | "updated" {
  const normalized = normalize(record, config, now);
  if ("reason" in normalized) return { kind: "filtered", id: recordId(record), reason: normalized.reason };
  const { id } = normalized.listing;
  const visited = visits.has(id);
  const media = { images: authority(visited, detail.images), description: authority(visited, detail.description) };
  const merged = mergeWithExisting(getListing(db, id), normalized.listing, media);
  const reason = criteriaReason(merged, config);
  if (reason) return { kind: "filtered", id: merged.id, reason };
  const { score, notes } = scoreListing(merged, config);
  return upsertListing(db, { ...merged, score, score_notes: notes });
}

export function ingestRecords(
  db: Database,
  config: Config,
  input: readonly unknown[],
  now: string = new Date().toISOString(),
  { detail = [], visits = new Map() }: IngestOptions = {},
): { summary: Summary; problems: Problem[] } {
  const { records, problems: invalid } = validate(input, detail);
  const outcomes = db.transaction(() => mergeRecords(records).map((r) => processRecord(db, config, r, now, visits)))();
  const filtered = outcomes.filter((o): o is Problem => typeof o === "object");
  return {
    summary: {
      received: input.length + detail.length,
      new: outcomes.filter((o) => o === "new").length,
      updated: outcomes.filter((o) => o === "updated").length,
      filtered: filtered.length,
      invalid: invalid.length,
    },
    problems: [...invalid, ...filtered],
  };
}

export function parseInput(text: string): unknown[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`input is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(json)) throw new Error("input must be a JSON array of raw records");
  return json;
}

/** Expands quoted glob arguments ("data/raw/2026-10-14-list-*.json") so a pattern without matches is not an error. */
export function expandArgs(args: readonly string[]): string[] {
  return args.flatMap((arg) =>
    arg.includes("*") ? [...new Bun.Glob(arg).scanSync({ cwd: "." })].sort() : [arg],
  );
}

/** Reads input files; a broken file is reported and skipped instead of aborting the whole run. */
export async function readInputs(files: readonly string[]): Promise<{ input: unknown[]; badFiles: number }> {
  if (files.length === 0) return { input: [], badFiles: 0 };
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        return parseInput(await Bun.file(file).text());
      } catch (err) {
        console.error(`invalid: ${file} – ${(err as Error).message}`);
        return null;
      }
    }),
  );
  return {
    input: results.flatMap((r) => r ?? []),
    badFiles: results.filter((r) => r === null).length,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = expandArgs(args);
  // stdin carries no provenance: treated as list records
  const list = args.length === 0
    ? { input: parseInput(await Bun.stdin.text()), badFiles: 0 }
    : await readInputs(files.filter((f) => !isDetailFile(f)));
  const detail = await readInputs(files.filter(isDetailFile));
  const config = await loadConfig();
  const db = openDb();
  try {
    const visits = detailVisits(expandArgs([DETAIL_GLOB]));
    const { summary, problems } = ingestRecords(db, config, list.input, undefined, { detail: detail.input, visits });
    for (const p of problems) console.error(`${p.kind}: ${p.id} – ${p.reason}`);
    console.log(JSON.stringify({ ...summary, invalid: summary.invalid + list.badFiles + detail.badFiles }));
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
