import { t } from "elysia";
import type { TSchema } from "@sinclair/typebox";

const httpUrl = (maxLength: number) => t.String({ maxLength, pattern: "^https?://" });

function nullable<T extends TSchema>(schema: T) {
  return t.Union([schema, t.Null()]);
}

const zeroOrOne = t.Union([t.Literal(0), t.Literal(1)]);

export const ListingSchema = t.Object({
  id: t.String({ minLength: 1, maxLength: 300 }),
  portal: t.Union([
    t.Literal("immoscout24"),
    t.Literal("immowelt"),
    t.Literal("kleinanzeigen"),
    t.Literal("wg-gesucht"),
  ]),
  portal_id: t.String({ minLength: 1, maxLength: 200 }),
  url: httpUrl(2048),
  title: t.String({ minLength: 1, maxLength: 500 }),
  city: t.String({ minLength: 1, maxLength: 200 }),
  district: t.Optional(nullable(t.String({ maxLength: 200 }))),
  address: t.Optional(nullable(t.String({ maxLength: 500 }))),
  rent_cold: t.Optional(nullable(t.Number())),
  rent_warm: t.Optional(nullable(t.Number())),
  rent_warm_estimated: zeroOrOne,
  rooms: t.Optional(nullable(t.Number())),
  area_sqm: t.Optional(nullable(t.Number())),
  floor: t.Optional(nullable(t.Integer())),
  has_garden: t.Optional(t.Union([zeroOrOne, t.Null()])),
  has_balcony: t.Optional(t.Union([zeroOrOne, t.Null()])),
  available_from: t.Optional(nullable(t.String({ maxLength: 100 }))),
  description: t.Optional(nullable(t.String({ maxLength: 20000 }))),
  images: t.Array(httpUrl(2048), { maxItems: 30 }),
  score: t.Integer({ minimum: 0, maximum: 100 }),
  score_notes: t.Optional(nullable(t.String({ maxLength: 2000 }))),
  status: t.Union([t.Literal("active"), t.Literal("gone")]),
  first_seen_at: t.String({ minLength: 1, maxLength: 40 }),
  last_seen_at: t.String({ minLength: 1, maxLength: 40 }),
});

export const IngestBodySchema = t.Object({
  listings: t.Array(ListingSchema, { maxItems: 200 }),
});
