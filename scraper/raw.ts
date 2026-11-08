// Validation of untrusted raw records coming from browser_evaluate extraction.

import { authority, takesFreshDescription, takesFreshImages } from "./media";
import { PORTALS, type Portal, type RawRecord } from "./types";

export const PORTAL_HOSTS: Readonly<Record<Portal, string>> = {
  immoscout24: "immobilienscout24.de",
  immowelt: "immowelt.de",
  kleinanzeigen: "kleinanzeigen.de",
  "wg-gesucht": "wg-gesucht.de",
};

export type ParseResult = { ok: true; record: RawRecord } | { ok: false; error: string };

type Obj = Record<string, unknown>;

const NUMERIC_FIELDS = ["rent_cold", "rent_warm", "nebenkosten", "heizkosten", "rooms", "area", "floor"] as const;
const TEXT_FIELDS = ["location", "city", "district", "address", "available_from", "available_to", "description"] as const;
const BOOL_FIELDS = ["has_garden", "has_balcony"] as const;
const MAX_TEXT = 20_000;
const MAX_LIST = 100;

const isHttpUrl = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

const onPortalHost = (url: string, portal: Portal): boolean => {
  const host = new URL(url).hostname;
  const expected = PORTAL_HOSTS[portal];
  return host === expected || host.endsWith(`.${expected}`);
};

const stringList = (v: unknown[]): string[] =>
  v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().slice(0, 500));

function requiredFields(o: Obj): { error: string } | Pick<RawRecord, "portal" | "portal_id" | "url" | "title"> {
  if (!PORTALS.includes(o.portal as Portal)) return { error: `portal must be one of ${PORTALS.join(", ")}` };
  const portal = o.portal as Portal;
  const id = typeof o.portal_id === "number" ? String(o.portal_id) : o.portal_id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { error: "portal_id must be 1-64 [A-Za-z0-9_-]" };
  if (!isHttpUrl(o.url) || !onPortalHost(o.url, portal)) return { error: `url must be an http(s) URL on ${PORTAL_HOSTS[portal]}` };
  if (typeof o.title !== "string" || !o.title.trim()) return { error: "title must be a non-empty string" };
  return { portal, portal_id: id, url: new URL(o.url).href, title: o.title.slice(0, MAX_TEXT) };
}

function optionalFields(o: Obj): { error: string } | { fields: Obj } {
  const out: Obj = {};
  for (const key of NUMERIC_FIELDS) {
    const v = o[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" && typeof v !== "string") return { error: `${key} must be a number or string` };
    out[key] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  for (const key of TEXT_FIELDS) {
    const v = o[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { error: `${key} must be a string` };
    out[key] = v.slice(0, MAX_TEXT);
  }
  for (const key of BOOL_FIELDS) {
    const v = o[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "boolean") return { error: `${key} must be a boolean` };
    out[key] = v;
  }
  for (const key of ["features", "images"] as const) {
    const v = o[key] ?? [];
    if (!Array.isArray(v)) return { error: `${key} must be an array` };
    out[key] =
      key === "images"
        ? v.filter(isHttpUrl).map((u) => new URL(u).href).slice(0, MAX_LIST)
        : stringList(v).slice(0, MAX_LIST);
  }
  return { fields: out };
}

/** Validates one untrusted record. Unknown keys are dropped. */
export function parseRawRecord(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "record is not an object" };
  }
  const o = input as Obj;
  const required = requiredFields(o);
  if ("error" in required) return { ok: false, error: required.error };
  const optional = optionalFields(o);
  if ("error" in optional) return { ok: false, error: optional.error };
  return { ok: true, record: { ...optional.fields, ...required } as unknown as RawRecord };
}

export const recordId = (r: Pick<RawRecord, "portal" | "portal_id">): string => `${r.portal}:${r.portal_id}`;

const definedEntries = (r: RawRecord): [string, unknown][] =>
  Object.entries(r).filter(([, v]) => v !== undefined && v !== null && v !== "");

/** A validated record and whether its images / description come from a detail page (vs. a result list). */
export interface SourcedRecord {
  readonly record: RawRecord;
  readonly detail: { readonly images: boolean; readonly description: boolean };
}

export const fromList = (record: RawRecord): SourcedRecord => ({ record, detail: { images: false, description: false } });
export const fromDetail = (record: RawRecord): SourcedRecord => ({ record, detail: { images: true, description: true } });

function mergeTwo(a: SourcedRecord, b: SourcedRecord): SourcedRecord {
  // provenance follows the winning value, so a list thumbnail standing in for an empty detail gallery stays a list value
  const freshImages = takesFreshImages(a.record.images, b.record.images, authority(a.detail.images, b.detail.images));
  const freshText = takesFreshDescription(
    a.record.description,
    b.record.description,
    authority(a.detail.description, b.detail.description),
  );
  return {
    record: {
      ...a.record,
      ...Object.fromEntries(definedEntries(b.record)),
      description: freshText ? b.record.description : a.record.description,
      features: [...new Set([...a.record.features, ...b.record.features])],
      images: freshImages ? b.record.images : a.record.images,
    } as RawRecord,
    detail: {
      images: freshImages ? b.detail.images : a.detail.images,
      description: freshText ? b.detail.description : a.detail.description,
    },
  };
}

/** Merges records sharing portal:portal_id (e.g. list + detail page); later values win, detail images/text win (media.ts). */
export function mergeRecords(records: readonly SourcedRecord[]): SourcedRecord[] {
  const byId = new Map<string, SourcedRecord>(); // local accumulator, never escapes
  for (const r of records) {
    const id = recordId(r.record);
    const prev = byId.get(id);
    byId.set(id, prev ? mergeTwo(prev, r) : r);
  }
  return [...byId.values()];
}
