// CLI: bun scraper/ansprache.ts [list [--all] | mark <id>... | unmark <id>... | profile <file.json>]
// Feeds the wohnung-ansprache skill from the swipe app (${WOHNUNG_URL}/api/ingest/…, bearer INGEST_TOKEN):
//   list     prints the group profile and every active match not contacted yet; --all includes contacted ones;
//   mark     records the given match ids as contacted, unmark takes them back;
//   profile  stores {"about","signature"} from a JSON file as the group's shared inquiry profile.
// State lives in data/ansprache.json (gitignored): { cutoff, sent }. `sent` decides what is listed; `cutoff`
// is the watermark "every active match up to here was contacted", recomputed on every mark/unmark. It is
// not a filter on its own, so a partial mark, equal timestamps or a listing that comes back never hide a
// match nobody contacted.

import { postJson, readPushEnv, type FetchFn, type PushEnv } from "./push";

export const STATE_PATH = "data/ansprache.json";
export const MATCHES_PATH = "api/ingest/matches";
export const PROFILE_PATH = "api/ingest/inquiry-profile";
// Same limits as the app (app/src/inquiry/profile.ts); checked here to fail before the request.
export const PROFILE_LIMITS = { about: 2000, signature: 300 } as const;
const MAX_DESCRIPTION_CHARS = 4000;

export interface AnspracheState {
  readonly cutoff: string | null;
  readonly sent: readonly string[];
}

export interface Profile {
  readonly about: string;
  readonly signature: string;
}

export interface Match {
  readonly id: string;
  readonly portal: string;
  readonly url: string;
  readonly title: string;
  readonly city: string;
  readonly district: string | null;
  readonly address: string | null;
  readonly rent_cold: number | null;
  readonly rent_warm: number | null;
  readonly rent_warm_estimated: number;
  readonly rooms: number | null;
  readonly area_sqm: number | null;
  readonly floor: number | null;
  readonly has_garden: number | null;
  readonly has_balcony: number | null;
  readonly available_from: string | null;
  readonly description: string | null;
  readonly score_notes: string | null;
  readonly status: string;
  readonly matched_at: string;
}

export interface MatchesData {
  readonly profile: Profile;
  readonly matches: readonly Match[];
}

export const EMPTY_STATE: AnspracheState = { cutoff: null, sent: [] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

export function validateState(value: unknown): AnspracheState {
  if (!isRecord(value)) throw new Error("state must be an object");
  const { cutoff, sent } = value;
  if (cutoff !== null && !isString(cutoff)) throw new Error("state.cutoff must be a string or null");
  if (!Array.isArray(sent) || !sent.every(isString)) throw new Error("state.sent must be a string array");
  return { cutoff, sent };
}

export async function readState(path: string): Promise<AnspracheState> {
  if (!(await Bun.file(path).exists())) return EMPTY_STATE;
  try {
    return validateState(JSON.parse(await Bun.file(path).text()));
  } catch (err) {
    throw new Error(`${path} is invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Bun.write creates missing parent directories (data/). */
export async function writeState(path: string, state: AnspracheState): Promise<void> {
  await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** Validates the app's answer: only the fields the skill relies on are checked strictly. */
export function validateMatchesData(data: unknown): MatchesData {
  if (!isRecord(data) || !isRecord(data.profile) || !Array.isArray(data.matches)) {
    throw new Error("unexpected matches response");
  }
  const { about, signature } = data.profile;
  if (!isString(about) || !isString(signature)) throw new Error("unexpected profile in matches response");
  const matches = data.matches.map((m, i) => {
    const valid =
      isRecord(m) && isString(m.id) && isString(m.url) && isString(m.status) && isString(m.matched_at) &&
      (m.description === null || isString(m.description));
    if (!valid) {
      throw new Error(`unexpected match #${i} in matches response`);
    }
    return m as unknown as Match;
  });
  return { profile: { about, signature }, matches };
}

const byMatchedAt = (a: Match, b: Match): number => a.matched_at.localeCompare(b.matched_at);

/** Active matches not contacted yet, oldest match first; `all` includes contacted ones. */
export function selectNew(matches: readonly Match[], state: AnspracheState, all = false): Match[] {
  const sent = new Set(state.sent);
  return matches.filter((m) => m.status === "active" && (all || !sent.has(m.id))).toSorted(byMatchedAt);
}

/** Latest matched_at up to which every active match is in `sent` (null if the oldest one isn't). */
export function contactedUntil(matches: readonly Match[], sent: readonly string[]): string | null {
  const done = new Set(sent);
  const active = matches.filter((m) => m.status === "active");
  const firstOpen = active.filter((m) => !done.has(m.id)).toSorted(byMatchedAt)[0]?.matched_at;
  const handled = active.filter((m) => firstOpen === undefined || m.matched_at < firstOpen).map((m) => m.matched_at);
  return handled.length > 0 ? handled.reduce((a, b) => (b > a ? b : a)) : null;
}

export interface MarkResult {
  readonly state: AnspracheState;
  readonly unknown: readonly string[];
}

/** Adds (or with `undo` removes) `ids` in the sent list; ids that are no current match are skipped and reported. */
export function markSent(
  state: AnspracheState,
  matches: readonly Match[],
  ids: readonly string[],
  undo = false,
): MarkResult {
  const current = new Set(matches.map((m) => m.id));
  const wanted = [...new Set(ids)];
  const unknown = undo ? [] : wanted.filter((id) => !current.has(id));
  const known = wanted.filter((id) => undo || current.has(id));
  const sent = undo ? state.sent.filter((id) => !known.includes(id)) : [...new Set([...state.sent, ...known])];
  return { state: { cutoff: contactedUntil(matches, sent), sent }, unknown };
}

/** What the agent needs to write one inquiry (description capped). */
export function toBrief(m: Match) {
  const { status: _status, ...rest } = m;
  return { ...rest, description: m.description ? m.description.slice(0, MAX_DESCRIPTION_CHARS) : null };
}

export function validateProfile(value: unknown): Profile {
  if (!isRecord(value) || !isString(value.about) || !isString(value.signature)) {
    throw new Error('profile file must be {"about": string, "signature": string}');
  }
  const about = value.about.trim();
  const signature = value.signature.trim();
  const problems = [
    about.length > PROFILE_LIMITS.about ? `about is ${about.length} chars (max ${PROFILE_LIMITS.about})` : null,
    signature.length > PROFILE_LIMITS.signature ? `signature is ${signature.length} chars (max ${PROFILE_LIMITS.signature})` : null,
  ].filter(isString);
  if (problems.length > 0) throw new Error(problems.join("; "));
  return { about, signature };
}

export type Command =
  | { readonly kind: "list"; readonly all: boolean }
  | { readonly kind: "mark" | "unmark"; readonly ids: readonly string[] }
  | { readonly kind: "profile"; readonly file: string };

export function parseArgs(argv: readonly string[]): Command {
  const [command = "list", ...rest] = argv;
  if (command === "list") {
    const unknown = rest.find((a) => a !== "--all");
    if (unknown) throw new Error(`unknown option ${unknown}`);
    return { kind: "list", all: rest.includes("--all") };
  }
  if (command === "mark" || command === "unmark") {
    if (rest.length === 0) throw new Error(`${command} needs at least one listing id`);
    return { kind: command, ids: rest };
  }
  if (command === "profile") {
    if (rest.length !== 1) throw new Error("profile needs exactly one JSON file");
    return { kind: "profile", file: rest[0]! };
  }
  throw new Error(`unknown command ${command} (list | mark | unmark | profile)`);
}

async function readProfileFile(path: string): Promise<Profile> {
  try {
    return validateProfile(JSON.parse(await Bun.file(path).text()));
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fetchMatches(env: PushEnv, fetchFn: FetchFn = fetch): Promise<MatchesData> {
  return validateMatchesData(await postJson(env, MATCHES_PATH, {}, fetchFn));
}

export async function run(
  command: Command,
  env: PushEnv,
  { statePath = STATE_PATH, fetchFn = fetch }: { readonly statePath?: string; readonly fetchFn?: FetchFn } = {},
): Promise<unknown> {
  if (command.kind === "profile") {
    const profile = await readProfileFile(command.file);
    return { saved: validateProfile(await postJson(env, PROFILE_PATH, profile, fetchFn)) };
  }
  const state = await readState(statePath);
  const { profile, matches } = await fetchMatches(env, fetchFn);
  if (command.kind === "list") {
    const fresh = selectNew(matches, state, command.all);
    return { cutoff: state.cutoff, all: command.all, total: matches.length, new: fresh.length, profile, matches: fresh.map(toBrief) };
  }
  const undo = command.kind === "unmark";
  const { state: next, unknown } = markSent(state, matches, command.ids, undo);
  for (const id of unknown) console.error(`${id}: kein aktueller Match, übersprungen`);
  await writeState(statePath, next);
  const changed = Math.abs(next.sent.length - state.sent.length);
  return { [undo ? "unmarked" : "marked"]: changed, skipped: unknown.length, cutoff: next.cutoff, sent: next.sent.length, path: statePath };
}

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));
  const env = readPushEnv(Bun.env);
  if (!env) throw new Error("WOHNUNG_URL and INGEST_TOKEN must be set in .env – matches live in the swipe app");
  console.log(JSON.stringify(await run(command, env)));
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`ansprache failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
