// CLI: bun scraper/push.ts
// Pushes new/changed listings to ${WOHNUNG_URL}/api/ingest (Bun loads .env automatically).

import type { Database } from "bun:sqlite";
import { openDb, queryListings } from "./db";
import type { Listing } from "./types";

export const BATCH_SIZE = 200;
const TIMEOUT_MS = 30_000;

export interface PushEnv {
  readonly baseUrl: string;
  readonly token: string;
}

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; redirect: "error"; signal?: AbortSignal },
) => Promise<Response>;

/** has_bathtub stays local: the server has no column for it and shows it via score_notes ("Wanne ✓"). */
export type Payload = Omit<Listing, "synced_at" | "has_bathtub">;

/** Returns null when push is not configured at all; throws on partial/invalid configuration. */
export function readPushEnv(env: Record<string, string | undefined>): PushEnv | null {
  const baseUrl = env.WOHNUNG_URL?.trim();
  const token = env.INGEST_TOKEN?.trim();
  if (!baseUrl && !token) return null;
  if (!baseUrl) throw new Error("WOHNUNG_URL is missing (set it in .env)");
  if (!token) throw new Error("INGEST_TOKEN is missing (set it in .env)");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`WOHNUNG_URL is not a valid URL: ${baseUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("WOHNUNG_URL must be http(s)");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("WOHNUNG_URL must use https (plain http only for localhost) – the token would be sent unencrypted");
  }
  return { baseUrl, token };
}

/** Never pushed, or seen/changed since the last push (sweep clears synced_at on status changes). */
export function pendingListings(db: Database): Listing[] {
  return queryListings(db, "synced_at IS NULL OR synced_at < last_seen_at ORDER BY id");
}

export function toPayload(l: Listing): Payload {
  const { synced_at: _synced, has_bathtub: _bathtub, ...rest } = l;
  return { ...rest, images: [...l.images] };
}

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** POSTs `body` with the bearer token to `${WOHNUNG_URL}/<path>`; returns the envelope's data or throws with the server's error. */
export async function postJson(env: PushEnv, path: string, body: unknown, fetchFn: FetchFn): Promise<unknown> {
  const url = new URL(path, env.baseUrl.endsWith("/") ? env.baseUrl : `${env.baseUrl}/`).toString();
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.token}` },
    body: JSON.stringify(body),
    redirect: "error", // never re-send the bearer token to a redirect target
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // handled below
  }
  const envelope = parsed as { success?: unknown; data?: unknown; error?: unknown } | null;
  const serverError = typeof envelope?.error === "string" ? envelope.error : text.slice(0, 200);
  if (!res.ok) throw new Error(`server responded ${res.status}: ${serverError}`);
  if (envelope?.success === false) throw new Error(`server rejected request: ${serverError}`);
  if (envelope?.success !== true) throw new Error(`unexpected response: ${text.slice(0, 200)}`);
  return envelope.data;
}

async function sendBatch(env: PushEnv, batch: readonly Listing[], fetchFn: FetchFn): Promise<void> {
  await postJson(env, "api/ingest", { listings: batch.map(toPayload) }, fetchFn);
}

/** Pushes all pending listings; marks each batch synced right after it succeeded. */
export async function pushListings(
  db: Database,
  env: PushEnv,
  fetchFn: FetchFn = fetch,
  now: string = new Date().toISOString(),
): Promise<{ pushed: number; batches: number }> {
  const batches = chunk(pendingListings(db), BATCH_SIZE);
  const markSynced = db.query("UPDATE listings SET synced_at = ? WHERE id = ?");
  let pushed = 0;
  for (const batch of batches) {
    await sendBatch(env, batch, fetchFn);
    db.transaction(() => batch.forEach((l) => markSynced.run(now, l.id)))();
    pushed += batch.length;
  }
  return { pushed, batches: batches.length };
}

async function main(): Promise<void> {
  const env = readPushEnv(Bun.env);
  if (!env) {
    console.log(JSON.stringify({ pushed: 0, skipped: "WOHNUNG_URL/INGEST_TOKEN not set" }));
    return;
  }
  const db = openDb();
  try {
    console.log(JSON.stringify(await pushListings(db, env)));
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`push failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
