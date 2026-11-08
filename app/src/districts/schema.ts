import { t, type Static } from "elysia";

// Request bodies of the district routes. Limits mirror scraper/districts.ts
// (MAX_SUMMARY / MAX_HIGHLIGHT) with headroom; names are short labels.

// 200 = listings.district (ingest/schema.ts): a district only seen in listings must stay savable.
const name = t.String({ minLength: 1, maxLength: 200 });
const nameList = t.Array(name, { maxItems: 200 });
const text = (maxLength: number) => t.String({ maxLength });

export const HighlightsSchema = t.Object(
  {
    shopping: t.Optional(text(400)),
    culture: t.Optional(text(400)),
    leisure: t.Optional(text(400)),
    transit: t.Optional(text(400)),
    cinema: t.Optional(text(400)),
    pool: t.Optional(text(400)),
    sights: t.Optional(text(400)),
  },
  { additionalProperties: false },
);

const listFields = {
  allowed_districts: nameList,
  excluded_districts: nameList,
  preferred_districts: nameList,
};

export const DistrictListsSchema = t.Object(listFields);

const DistrictInfoSchema = t.Object({
  name,
  aliases: t.Array(name, { maxItems: 30 }),
  summary: t.Union([text(300), t.Null()]),
  highlights: HighlightsSchema,
});

const CityPushSchema = t.Object({
  city: t.String({ minLength: 1, maxLength: 200 }),
  districts: t.Array(DistrictInfoSchema, { maxItems: 200 }),
  ...listFields,
});

/** POST /api/ingest/districts (scraper, bearer token). */
export const DistrictPushSchema = t.Object({
  overwrite: t.Boolean(),
  cities: t.Array(CityPushSchema, { maxItems: 50 }),
});

/** PUT /api/settings/districts (settings page, session). */
export const DistrictSettingsUpdateSchema = t.Object({
  city: t.String({ minLength: 1, maxLength: 200 }),
  ...listFields,
});

export type DistrictLists = Static<typeof DistrictListsSchema>;
export type DistrictPush = Static<typeof DistrictPushSchema>;
export type DistrictSettingsUpdate = Static<typeof DistrictSettingsUpdateSchema>;
export type Highlights = Static<typeof HighlightsSchema>;
