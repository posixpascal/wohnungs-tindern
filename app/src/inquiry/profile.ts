// The group's inquiry profile: who "wir" are in the generated text. One row
// shared by all users, edited from the inquiry sheet.

import type { Database } from "bun:sqlite";

export type InquiryProfile = {
  // Free text about the household: names, jobs, income, move-in date, pets …
  readonly about: string;
  // Closing line(s), e.g. "Alex und Sam Muster, 0151 …".
  readonly signature: string;
};

export const EMPTY_PROFILE: InquiryProfile = { about: "", signature: "" };

export const PROFILE_LIMITS = { about: 2000, signature: 300 } as const;

export function getProfile(db: Database): InquiryProfile {
  const row = db
    .query<InquiryProfile, []>("SELECT about, signature FROM inquiry_profile WHERE id = 1")
    .get();
  return row ? { about: row.about, signature: row.signature } : EMPTY_PROFILE;
}

export function saveProfile(db: Database, profile: InquiryProfile): InquiryProfile {
  const clean: InquiryProfile = { about: profile.about.trim(), signature: profile.signature.trim() };
  db.query(
    `INSERT INTO inquiry_profile (id, about, signature, updated_at)
     VALUES (1, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (id) DO UPDATE SET about = excluded.about, signature = excluded.signature, updated_at = excluded.updated_at`,
  ).run(clean.about, clean.signature);
  return clean;
}
