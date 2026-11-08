// Keyword detection on untrusted listing text (title, description, feature lists).

import { parseNumber } from "./parse";

const FEATURE = "(?:garten|balkon|terrasse|loggia)\\w*";
const NEGATIONS = [
  new RegExp(`\\b(?:kein(?:e|en|em)?|ohne)\\s+(?:eigene[nrm]?\\s+)?${FEATURE}(?:\\s*(?:,|oder|und|bzw\\.?)\\s*${FEATURE})*`, "gi"),
  new RegExp(`\\bweder\\s+${FEATURE}\\s+noch\\s+${FEATURE}`, "gi"),
  new RegExp(`${FEATURE}\\s*:?\\s*(?:nein|nicht vorhanden)\\b`, "gi"),
];
// Compounds count (Südbalkon, Mietergarten), public/unrelated gardens don't.
const NOT_OWN_GARDEN = /\b\w*(kinder|bier|palmen|zoo|schre?ber|bot)garten\w*|garten(stra(ß|ss)e|str\.|weg|platz|stadt|haus|center|markt)\w*/gi;
const GARDEN = /garten/i;
const BALCONY = /balkon(?!ien)|loggia|loggien|terrasse/i;
// Badewanne, Eckbadewanne, Wannenbad, "Bad mit Wanne" – but a Duschwanne is a shower tray.
const BATHTUB = /(?<!dusch-?)wanne/i;
// Own negations without a list tail: "keine Badewanne, Balkon" must keep the balcony and vice versa.
const TUB_WORD = "(?<!\\p{L})\\p{L}*wanne\\p{L}*";
const BATHTUB_NEGATIONS = [
  new RegExp(`(?<!\\p{L})(?:kein(?:e|en|em)?|ohne|statt|anstatt|anstelle)\\s+(?:(?:eine[rns]?|der|des)\\s+)?${TUB_WORD}`, "giu"),
  new RegExp(`${TUB_WORD}\\s*:?\\s*(?:nein|nicht vorhanden)(?!\\p{L})`, "giu"),
  new RegExp(`${TUB_WORD}\\s+wurde\\b[^.\\n]{0,40}?(?:ersetzt|entfernt|ausgebaut)`, "giu"),
];

const withoutNegations = (text: string): string => NEGATIONS.reduce((t, re) => t.replace(re, " "), text);

export const hasGarden = (text: string): boolean => GARDEN.test(withoutNegations(text).replace(NOT_OWN_GARDEN, " "));
export const hasBalcony = (text: string): boolean => BALCONY.test(withoutNegations(text));
export const hasBathtub = (text: string): boolean =>
  BATHTUB.test(BATHTUB_NEGATIONS.reduce((t, re) => t.replace(re, " "), text));

/**
 * Floor hints in free text; null when nothing conclusive is found.
 * `strict` (for long descriptions) only accepts compound words – "Fahrradkeller im Erdgeschoss" says nothing about the flat.
 */
export function floorFromText(text: string, strict = false): number | null {
  const ground = strict ? /\b(erdgeschosswohnung|eg-wohnung)\b/i : /\b(erdgeschosswohnung|eg-wohnung|im erdgeschoss|hochparterre)\b/i;
  const basement = strict
    ? /\b(souterrainwohnung|souterrain-wohnung|untergeschosswohnung)\b/i
    : /\b(souterrainwohnung|souterrain-wohnung|im souterrain|untergeschosswohnung)\b/i;
  if (ground.test(text)) return 0;
  if (basement.test(text)) return -1;
  return null;
}

// A bare "WG" only counts in the title: descriptions often say "auch für 2er-WG geeignet".
const WG_IN_TITLE = /\bwg\b(?![- ]?(geeignet|tauglich|fähig|auflösung))/i;
const WG_ANYWHERE =
  /\bwg[- ]zimmer\b|\b(suchen?|neuen?|neue[rn]?) mitbewohner(in)?\b|\bwg[- ]neugründung|\b(in|für) (unsere|eine|meine)r? (\d+er[- ])?wg\b|\bzimmer\b[^.\n]{0,40}\bin (einer |meiner |unserer )?\d[- ]?zimmer[- ]?wohnung\b|\bzimmer\b[^.\n]{0,40}\bin (?:einer |'?ner |meiner |unserer )?(?:\d+(?:-\d+)?er[- ]?)?wg\b(?![- ]?(geeignet|tauglich|fähig))/i;

const EXCLUSIONS: readonly (readonly [string, RegExp])[] = [
  [
    "Monteurwohnung",
    /\bmou?nteur|\b(arbeiter|handwerker)(wohnung|zimmer|unterkunft)|(\b(pro|je)\s+|\/\s*)((person|pers\.?)\s*(und|pro|\/)\s*)?nacht\b|übernachtung(spreis)?\b[^.\n]{0,30}\d|\d[^.\n]{0,20}\b(pro|je) übernachtung/iu,
  ],
  [
    "Einzelperson",
    /(?<!nicht )\b(?:(ausschließlich|nur)( an| für)? (eine )?(\p{L}+ ){0,2}einzelperson\b|nur (an|für) (1|eine) person\b|nur für singles?\b)(?!\s*(oder|bzw\.?|\/|und)\s*(ein(en)? )?(paar|paare|2|zwei))/iu,
  ],
  ["Tauschwohnung", /tauschwohnung|wohnungstausch|wohnungsswap|\bswap\b|tauschangebot|zum tausch|\btausche\b|tauschpartner/i],
  [
    "Zeitwohnen",
    /zeitwohnen|wohnen auf zeit|möbliert auf zeit|zwischenmiete|möblierte?s?\b[^.\n]{0,60}(?<!un)befristet|(?<!un)befristet[^.\n]{0,60}möbliert/i,
  ],
  [
    "Seniorenwohnen/WBS",
    /seniorenwohn|seniorenresidenz|betreutes wohnen|nur für senioren|\bab [5-8]\d jahren?\b|(nur )?mit wbs\b|\bwbs[- ]?(erforderlich|notwendig|benötigt|zwingend|pflicht)|wohnberechtigungsschein (ist )?(erforderlich|notwendig|benötigt)|nur mit wohnberechtigungsschein/i,
  ],
];

const NEGATED_MONTEUR = /\b(keine?|nicht (?:an|für))\s+(?:vermietung (?:an|für)\s+)?mou?nteur\w*/gi;
const NEGATED_WBS = /\b(kein(?:en)?|ohne)\s+(wbs|wohnberechtigungsschein)\b[^.\n]{0,20}/gi;
// "keine WG", "auch als WG", "oder 2er-WG", "nicht geeignet für eine WG", "für eine WG geeignet" describe a whole flat
const NEGATED_WG =
  /\b(keine?|nicht (?:geeignet )?(?:für|als|an)|auch|oder)\s+(?:als |für )?(?:eine )?(?:\d+(?:-\d+)?er[- ])?wgs?\b|\b(?:für|als) (?:eine )?(?:\d+(?:-\d+)?er[- ])?wg (?:geeignet|möglich)/gi;

const clean = (text: string): string =>
  text.replace(NEGATED_WBS, " ").replace(NEGATED_WG, " ").replace(NEGATED_MONTEUR, " ").replace(/\bkein tausch\b/gi, " ");

/** Returns the German exclusion category for a listing (title + description/features), or null. */
export function exclusionReason(title: string, body = ""): string | null {
  const t = clean(title);
  const all = `${t}\n${clean(body)}`;
  if (WG_IN_TITLE.test(t) || WG_ANYWHERE.test(all)) return "WG-Zimmer";
  const hit = EXCLUSIONS.find(([, pattern]) => pattern.test(all));
  return hit ? hit[0] : null;
}

function parseGermanDate(value: string | undefined): Date | null {
  const m = value?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const MIN_RENTAL_DAYS = 365 - 31;

/** True when a "frei ab … bis …" range is shorter than ~12 months. */
export function shortTermRental(from: string | undefined, to: string | undefined): boolean {
  const end = parseGermanDate(to);
  if (!end) return false;
  const start = parseGermanDate(from) ?? new Date();
  return (end.getTime() - start.getTime()) / 86_400_000 < MIN_RENTAL_DAYS;
}

const COST_PATTERNS = {
  kaltmiete: { re: /kaltmiete\b[^\d\n]{0,25}(\d[\d.,]*)(\s*(?:€|eur))?/i, min: 100, max: 5000 },
  nebenkosten: { re: /nebenkosten\b[^\d\n]{0,25}(\d[\d.,]*)(\s*(?:€|eur))?/i, min: 20, max: 1000 },
  warmmiete: { re: /warmmiete\b[^\d\n]{0,25}(\d[\d.,]*)(\s*(?:€|eur))?/i, min: 100, max: 5000 },
} as const;

/** "ab 2027" is a year, "2000 €" a price. */
const YEAR = /^(19|20)\d\d$/;

/** Extracts "Kaltmiete: 845 €" / "Nebenkosten: 280 Euro" / "Warmmiete beträgt 826€" style amounts from free text. */
export function costFromText(text: string, kind: keyof typeof COST_PATTERNS): number | null {
  const { re, min, max } = COST_PATTERNS[kind];
  const m = text.match(re);
  if (m?.[1] && YEAR.test(m[1]) && !m[2]) return null;
  const n = parseNumber(m?.[1]);
  return n !== null && n >= min && n <= max ? n : null;
}
