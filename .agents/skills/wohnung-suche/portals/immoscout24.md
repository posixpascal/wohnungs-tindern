# ImmoScout24 (immobilienscout24.de)

## Bot wall – read first

IS24 serves an **"Ich bin kein Roboter – Gleich geht's weiter"** interstitial (HTTP 401) on the first request of a session.
Verified 2026-10-14 in the headed Playwright browser: it resolved by itself after ~5–8 s (`browser_wait_for` time 8),
then the real result page loaded and later pages/exposes in the same session went through without a challenge.

Handling:
1. After `browser_navigate`, run the page check below. If `blocked: true`, `browser_wait_for` `{ time: 8 }` and check again (max 2×).
2. Still blocked (a real puzzle/captcha is shown):
   - interactive run → tell the user: "ImmoScout24 zeigt ein Captcha – bitte im Playwright-Fenster lösen und dann 'weiter' schreiben." Wait, then re-check.
   - non-interactive (`claude -p`) → skip IS24 for this run and note `ImmoScout24: Captcha – übersprungen` in the summary.
3. Never retry in a tight loop, never open parallel tabs.

## Search URL

```
https://www.immobilienscout24.de/Suche/<geopath>/wohnung-mieten?numberofrooms=<rooms_min>-&price=-<warm_max>.0&livingspace=<area_min>.0-&pricetype=calculatedtotalrent&sorting=2[&pagenumber=<n>]
```

- `pricetype=calculatedtotalrent` makes `price` a **Warmmiete** filter (verified: chip "bis 1.200 € Warmmiete").
- Write numbers as decimals with one place: `numberofrooms=2.5-`, `3.0-`; `livingspace=60.0-`.
- `sorting=2` = newest first ("Aktualität (neueste zuerst)").
- 20 results per page, `pagenumber=2` …

Example (Idstein, verified, 21 hits): `https://www.immobilienscout24.de/Suche/de/hessen/rheingau-taunus-kreis/idstein/wohnung-mieten?numberofrooms=2.0-&price=-1200.0&livingspace=50.0-&pricetype=calculatedtotalrent&sorting=2`

## Geopaths

| City | geopath |
|---|---|
| Frankfurt am Main | /de/hessen/frankfurt-am-main |
| Neu-Isenburg | /de/hessen/offenbach-kreis/neu-isenburg |
| Hofheim am Taunus | /de/hessen/main-taunus-kreis/hofheim-am-taunus |
| Niedernhausen | /de/hessen/rheingau-taunus-kreis/niedernhausen |
| Idstein | /de/hessen/rheingau-taunus-kreis/idstein |
| Bad Camberg | /de/hessen/limburg-weilburg-kreis/bad-camberg |
| Wiesbaden | /de/hessen/wiesbaden (districts: /de/hessen/wiesbaden/igstadt, /de/hessen/wiesbaden/nordenstadt) |

New city (run on any IS24 page after the bot check passed):

```js
async () => (await (await fetch('/geoautocomplete/v3/locations.json?i=' + encodeURIComponent('<City>'))).json()).slice(0, 5).map(e => ({ label: e.entity.label, geopath: e.entity.geopath.uri }))
```

## Page check (small output)

```js
() => { const m = window.IS24?.resultList?.resultListModel?.searchResponseModel?.['resultlist.resultlist']; return { title: document.title, blocked: !m && /Roboter|captcha/i.test(document.title + document.body.innerText.slice(0, 500)), page: m?.paging?.pageNumber ?? null, pages: m?.paging?.numberOfPages ?? null, hits: m?.paging?.numberOfHits ?? null }; }
```

## List extraction (save with `filename`)

Uses the embedded `IS24.resultList` JSON (no CSS selectors). Returns `[]` when the page is blocked.

```js
() => { const m = window.IS24?.resultList?.resultListModel?.searchResponseModel?.['resultlist.resultlist']; if (!m) return []; const arr = x => Array.isArray(x) ? x : x ? [x] : []; const bool = v => v === 'true' || v === true ? true : v === 'false' || v === false ? false : null; return arr(m.resultlistEntries).flatMap(e => arr(e.resultlistEntry)).filter(e => !e['resultlist.realEstate']?.missedListingLabel).map(e => { const r = e['resultlist.realEstate'] ?? {}; const a = r.address ?? {}; const id = String(r['@id'] ?? e['@id']); return { portal: 'immoscout24', portal_id: id, url: 'https://www.immobilienscout24.de/expose/' + id, title: r.title ?? '', city: a.city ?? null, district: a.quarter ?? null, address: [a.street, a.houseNumber].filter(Boolean).join(' ') || null, location: a.description?.text ?? null, rent_cold: r.price?.value ?? null, rent_warm: r.calculatedTotalRent?.totalRent?.value ?? null, rooms: r.numberOfRooms ?? null, area: r.livingSpace ?? null, has_garden: bool(r.garden), has_balcony: bool(r.balcony), features: arr(e.realEstateTags?.tag ?? r.realEstateTags?.tag).map(String), images: arr(r.galleryAttachments?.attachment).map(x => arr(x.urls)[0]?.url?.['@href']).filter(Boolean).map(u => u.replace('%WIDTH%', '1200').replace('%HEIGHT%', '900')).slice(0, 30) }; }); }
```

Notes: `price.value` = Kaltmiete, `calculatedTotalRent.totalRent.value` = Warmmiete (IS24-calculated, `calculationMode: SUMMARIZED`).
`balcony`/`garden` are explicit booleans. **Floor is not in the list data** → detail page.
Result pages also carry recently deactivated "missed" listings (`resultlist.realEstate.missedListingLabel`, e.g.
`"deaktiviert vor 18 Std."`, verified 2026-11-09); the script drops them so they are neither new nor "seen today".

## Detail extraction (save with `filename`, returns a one-element array)

The full gallery is embedded as `galleryData` JSON in an inline script (the DOM only renders ~5 previews).
Images are requested as `ORIG/resize/1200x900%3E` (max 1200×900, never upscaled).

```js
() => { const q = s => document.querySelector(s)?.innerText.trim() || null; const dd = k => q('dd.is24qa-' + k); const id = location.pathname.match(/expose\/(\d+)/)?.[1]; const bools = [...document.querySelectorAll('.criteriagroup.boolean-listing span, .boolean-listing span')].map(s => s.innerText.trim()).filter(t => t && t.length < 40); const gallery = [...document.scripts].map(s => s.textContent).find(t => t.includes('galleryData')) ?? ''; const images = [...new Set([...gallery.matchAll(/"galleryPictureUrl":"(https:\/\/pictures\.immobilienscout24\.de\/listings\/[^"\/?]+)/g)].map(m => m[1] + '/ORIG/resize/1200x900%3E/format/webp/quality/73'))].slice(0, 30); const description = [...document.querySelectorAll('.expose-description-body, .expose-location-description, .tenant-description-block')].map(e => { const h = e.previousElementSibling; return (h?.matches('h3, h4') ? h.innerText.trim() + ':\n' : '') + e.innerText.trim(); }).filter(t => t.trim()).join('\n\n').slice(0, 8000) || null; return [{ portal: 'immoscout24', portal_id: id, url: 'https://www.immobilienscout24.de/expose/' + id, title: q('#expose-title') ?? q('h1') ?? document.title, location: q('.address-block') ?? q('.address-text'), rent_cold: dd('kaltmiete'), nebenkosten: dd('nebenkosten'), heizkosten: dd('heizkosten'), rent_warm: dd('gesamtmiete'), rooms: dd('zimmer'), area: dd('wohnflaeche-ca'), floor: dd('etage'), available_from: dd('bezugsfrei-ab'), features: [dd('typ'), ...bools].filter(Boolean), description, images }]; }
```

Verified 2026-10-14 (expose 167457333): 8 images (all load hotlinked with `referrerpolicy=no-referrer`), description 1.7k chars
(Objektbeschreibung/Ausstattung/Sonstiges/Lage with headings). Expose 171312880 has no photos at all (gallery placeholder) → `images: []` is correct there.
Verified fields (expose 171687683): `typ=Souterrain`, `etage=1 von 2`, `kaltmiete=850 €`, `nebenkosten=+ 250 €`,
`heizkosten=in Nebenkosten enthalten`, `gesamtmiete=1.100 €`, `wohnflaeche-ca=90 m²`, `zimmer=3`, `bezugsfrei-ab=12.10.2026`.
ingest parses all of these formats ("1 von 2" → 1, "+ 250 €" → 250, text → ignored).

## Availability check (save with `filename: data/raw/<date>-avail-<portal>-<portal_id>.json`)

End-of-run check for candidates from `bun scraper/availability.ts list` (see the skill). Returns `{status, signal}`:
`gone` only on an explicit signal, `active` when the listing renders, `unknown` otherwise (changes nothing).

A deactivated expose still renders completely (HTTP 200, gallery, prices) with a banner
`[data-testid="gallery-entry-deactivated-notification"]` ("Angebot wurde deaktiviert", verified 2026-11-09 on 102191830 and
100640669); a live one (164767549) has none. A redirect away from the expose was never observed → `unknown`.

```js
() => { const code = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0; if (/Roboter|captcha/i.test(document.title + document.body.innerText.slice(0, 500))) return { status: 'unknown', signal: 'Bot-Schutz' }; if (document.querySelector('[data-testid="gallery-entry-deactivated-notification"]')) return { status: 'gone', signal: 'Angebot wurde deaktiviert' }; if (code === 404 || code === 410) return { status: 'gone', signal: 'HTTP ' + code }; if (!/\/expose\/\d+/.test(location.pathname)) return { status: 'unknown', signal: 'Weiterleitung auf ' + location.pathname }; if (document.querySelector('#expose-title, dd.is24qa-kaltmiete, .tenant-description-block')) return { status: 'active', signal: 'Exposé online' }; return { status: 'unknown', signal: 'unerwartete Seite: ' + document.title.slice(0, 80) }; }
```

## Pitfalls

- The expose URL gets `#/` appended – harmless, the script rebuilds a clean URL.
- `Typ` and `Etage` can contradict each other (Souterrain + "1 von 2"); ingest trusts `Etage`.
- Tenant listings ("Nachvermietung", posted by the current tenant) use another layout: no `dd.is24qa-*`, `galleryData.imageCount` is 0
  (IS24 shows no photos there, `no-images-placeholder`), the text is in `.tenant-description-block` (covered by the script). Rent/rooms/area come from the list record.
- No `galleryData` images → the expose has no photos (only "Grundrisse & Dokumente"); that's not an extraction error.
- Description text lives in `.expose-description-body` spans (Objektbeschreibung, Ausstattung, Sonstiges) plus `.expose-location-description`; the old `is24qa-objektbeschreibung` classes are gone. Some exposes have none – `description: null` is fine.
- Expect the bot interstitial again after long pauses or many requests – keep ≥ 3 s between navigations.
