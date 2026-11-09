import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_STATE,
  contactedUntil,
  markSent,
  parseArgs,
  readState,
  run,
  selectNew,
  toBrief,
  validateMatchesData,
  validateProfile,
  type Match,
} from "./ansprache";
import type { FetchFn } from "./push";

const match = (id: string, matched_at: string, overrides: Partial<Match> = {}): Match => ({
  id,
  portal: "immoscout24",
  url: `https://www.immobilienscout24.de/expose/${id}`,
  title: "3 Zimmer",
  city: "Frankfurt am Main",
  district: "Bornheim",
  address: null,
  rent_cold: 1000,
  rent_warm: 1250,
  rent_warm_estimated: 0,
  rooms: 3,
  area_sqm: 72,
  floor: 2,
  has_garden: null,
  has_balcony: 1,
  available_from: null,
  description: "Helle Wohnung.",
  score_notes: null,
  status: "active",
  matched_at,
  ...overrides,
});

const A = match("immoscout24:1", "2026-11-01T10:00:00.000Z");
const B = match("immoscout24:2", "2026-11-03T10:00:00.000Z");
const C = match("immoscout24:3", "2026-11-02T10:00:00.000Z");
const GONE = match("immoscout24:4", "2026-11-04T10:00:00.000Z", { status: "gone" });
const PROFILE = { about: "Wir sind zwei.", signature: "Alex Muster" };

describe("selectNew", () => {
  test("without state lists every active match, oldest match first", () => {
    expect(selectNew([B, A, GONE, C], EMPTY_STATE).map((m) => m.id)).toEqual([A.id, C.id, B.id]);
  });

  test("skips sent ids, also when they are matched again later", () => {
    const relike = { ...A, matched_at: "2026-11-09T10:00:00.000Z" };
    expect(selectNew([relike, B, C], { cutoff: null, sent: [A.id, B.id] }).map((m) => m.id)).toEqual([C.id]);
  });

  test("an older match nobody contacted is listed despite a later cutoff", () => {
    expect(selectNew([A, B], { cutoff: B.matched_at, sent: [B.id] }).map((m) => m.id)).toEqual([A.id]);
  });

  test("--all includes sent ones but not gone listings", () => {
    const state = { cutoff: B.matched_at, sent: [A.id, B.id, C.id] };
    expect(selectNew([A, B, C, GONE], state, true).map((m) => m.id)).toEqual([A.id, C.id, B.id]);
  });
});

describe("contactedUntil", () => {
  test("stops before the first match not contacted", () => {
    expect(contactedUntil([A, B, C], [A.id, B.id])).toBe(A.matched_at);
    expect(contactedUntil([A, B, C], [A.id, B.id, C.id])).toBe(B.matched_at);
    expect(contactedUntil([A, B, C], [B.id])).toBeNull();
  });

  test("equal timestamps: covered only when all of them are contacted", () => {
    const twin = match("immoscout24:9", A.matched_at);
    expect(contactedUntil([A, twin, B], [A.id, B.id])).toBeNull();
  });

  test("ignores gone listings", () => {
    expect(contactedUntil([A, GONE], [A.id])).toBe(A.matched_at);
  });
});

describe("markSent", () => {
  test("adds ids and recomputes the cutoff", () => {
    expect(markSent(EMPTY_STATE, [A, B, C], [A.id, C.id])).toEqual({
      state: { cutoff: C.matched_at, sent: [A.id, C.id] },
      unknown: [],
    });
  });

  test("partial mark: the cutoff never passes an open match", () => {
    expect(markSent(EMPTY_STATE, [A, B, C], [B.id]).state).toEqual({ cutoff: null, sent: [B.id] });
  });

  test("skips and reports ids that are no current match, dedups ids", () => {
    expect(markSent(EMPTY_STATE, [A], [A.id, A.id, "immoscout24:999"])).toEqual({
      state: { cutoff: A.matched_at, sent: [A.id] },
      unknown: ["immoscout24:999"],
    });
  });

  test("undo removes ids and moves the cutoff back", () => {
    const state = { cutoff: B.matched_at, sent: [A.id, B.id, C.id] };
    expect(markSent(state, [A, B, C], [C.id], true).state).toEqual({ cutoff: A.matched_at, sent: [A.id, B.id] });
  });
});

describe("validation", () => {
  test("matches response", () => {
    expect(validateMatchesData({ profile: PROFILE, matches: [A] })).toEqual({ profile: PROFILE, matches: [A] });
    expect(() => validateMatchesData({ profile: PROFILE })).toThrow("unexpected matches response");
    expect(() => validateMatchesData({ profile: PROFILE, matches: [{ id: "x" }] })).toThrow("unexpected match #0");
    expect(() => validateMatchesData({ profile: PROFILE, matches: [{ ...A, description: 1 }] })).toThrow("unexpected match #0");
  });

  test("profile is trimmed and length-checked", () => {
    expect(validateProfile({ about: " Wir ", signature: " Alex " })).toEqual({ about: "Wir", signature: "Alex" });
    expect(() => validateProfile({ about: "x" })).toThrow("profile file must be");
    expect(() => validateProfile({ about: "x".repeat(2001), signature: "y".repeat(301) })).toThrow(
      "about is 2001 chars (max 2000); signature is 301 chars (max 300)",
    );
  });

  test("toBrief drops status and caps the description", () => {
    const brief = toBrief({ ...A, description: "x".repeat(5000) });
    expect("status" in brief).toBe(false);
    expect(brief.description).toHaveLength(4000);
  });
});

describe("parseArgs", () => {
  test("commands", () => {
    expect(parseArgs([])).toEqual({ kind: "list", all: false });
    expect(parseArgs(["list", "--all"])).toEqual({ kind: "list", all: true });
    expect(parseArgs(["mark", "a:1", "a:2"])).toEqual({ kind: "mark", ids: ["a:1", "a:2"] });
    expect(parseArgs(["unmark", "a:1"])).toEqual({ kind: "unmark", ids: ["a:1"] });
    expect(parseArgs(["profile", "p.json"])).toEqual({ kind: "profile", file: "p.json" });
  });

  test("errors", () => {
    expect(() => parseArgs(["list", "--since"])).toThrow("unknown option --since");
    expect(() => parseArgs(["mark"])).toThrow("mark needs at least one listing id");
    expect(() => parseArgs(["profile"])).toThrow("profile needs exactly one JSON file");
    expect(() => parseArgs(["send"])).toThrow("unknown command send");
  });
});

describe("run", () => {
  const ENV = { baseUrl: "https://wohnung.example", token: "t".repeat(32) };
  let dir: string;
  let statePath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ansprache-"));
    statePath = join(dir, "data", "ansprache.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  type Call = { url: string; body: unknown };
  const fakeFetch = (calls: Call[], data: unknown): FetchFn => async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true, data, error: null }));
  };

  test("list, mark, list again: contacted matches are not listed twice", async () => {
    const calls: Call[] = [];
    const fetchFn = fakeFetch(calls, { profile: PROFILE, matches: [A, B] });

    const first = (await run({ kind: "list", all: false }, ENV, { statePath, fetchFn })) as { new: number; profile: unknown };
    expect(first.new).toBe(2);
    expect(first.profile).toEqual(PROFILE);
    expect(calls[0]?.url).toBe("https://wohnung.example/api/ingest/matches");

    await run({ kind: "mark", ids: [A.id, B.id] }, ENV, { statePath, fetchFn });
    expect(await readState(statePath)).toEqual({ cutoff: B.matched_at, sent: [A.id, B.id] });

    await run({ kind: "unmark", ids: [B.id] }, ENV, { statePath, fetchFn });
    expect(await readState(statePath)).toEqual({ cutoff: A.matched_at, sent: [A.id] });
    await run({ kind: "mark", ids: [B.id] }, ENV, { statePath, fetchFn });

    const second = (await run({ kind: "list", all: false }, ENV, { statePath, fetchFn })) as { new: number };
    expect(second.new).toBe(0);
  });

  test("profile posts the validated file", async () => {
    const calls: Call[] = [];
    const file = join(dir, "profile.json");
    await Bun.write(file, JSON.stringify({ about: " Wir sind zwei. ", signature: "Alex Muster" }));
    const result = await run({ kind: "profile", file }, ENV, { statePath, fetchFn: fakeFetch(calls, PROFILE) });
    expect(calls).toEqual([{ url: "https://wohnung.example/api/ingest/inquiry-profile", body: PROFILE }]);
    expect(result).toEqual({ saved: PROFILE });
  });

  test("a missing profile file fails with its path", async () => {
    const file = join(dir, "nope.json");
    await expect(run({ kind: "profile", file }, ENV, { statePath })).rejects.toThrow(file);
  });

  test("an invalid state file fails with its path", async () => {
    await Bun.write(statePath, JSON.stringify({ cutoff: 1, sent: [] }));
    await expect(readState(statePath)).rejects.toThrow(`${statePath} is invalid: state.cutoff must be a string or null`);
  });
});
