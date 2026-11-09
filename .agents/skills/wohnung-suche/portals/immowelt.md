# immowelt (immowelt.de) – also covers immonet

**immonet.de now redirects to immowelt** (same AVIV group, merged inventory) – do not search immonet separately.

React micro-frontends; listing data in the page is LZ-compressed (`__UFRN_FETCHER__`), so extraction uses stable `data-testid` attributes instead. No bot wall seen (verified 2026-10-14, DataDome script present – keep the pace slow).

## Search URL

```
https://www.immowelt.de/classified-search?distributionTypes=Rent&estateTypes=Apartment&locations=<code>&numberOfRoomsMin=<rooms_min>&priceMax=<warm_max>&spaceMin=<area_min>&order=DateDesc[&page=<n>]
```

- `priceMax` filters the **Kaltmiete** (cards show "Kaltmiete").
- `numberOfRoomsMin` (not `roomsMin` – that one is silently ignored).
- `order=DateDesc` = "Aktuellste Angebote" (newest first), important because pages are capped.
- 30 results per page, `page=2` … (verified).
- The legacy `/suche/<slug>/wohnungen/mieten?…` URLs redirect but **drop all filters** – don't use them for searching.

Example (Neu-Isenburg, verified): `https://www.immowelt.de/classified-search?distributionTypes=Rent&estateTypes=Apartment&locations=AD08DE2647&numberOfRoomsMin=2&priceMax=1200&spaceMin=50&order=DateDesc`

## Location codes

| City | code |
|---|---|
| Frankfurt am Main | AD08DE2509 |
| Neu-Isenburg | AD08DE2647 |
| Hofheim am Taunus | AD08DE2621 |
| Niedernhausen | AD08DE2662 |
| Idstein | AD08DE2659 |
| Bad Camberg | AD08DE2737 |
| Wiesbaden | AD08DE2511 |

New city (run on any immowelt page, returns `[{id, labels}]`, take the `AD08…` entry):

```js
async () => (await (await fetch('/search-mfe-bff/autocomplete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '<City>', limit: 5, placeTypes: ['AD08', 'NBH2'], parentTypes: ['AD08'], locale: 'de' }) })).json()).map(p => ({ id: p.id, labels: p.labels }))
```

## Page check (small output)

```js
() => { const h1 = document.querySelector('h1')?.innerText ?? ''; const total = Number(h1.match(/^([\d.]+)/)?.[1]?.replace(/\./g, '') ?? 0); return { title: document.title, h1, count: document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]').length, total, pages: Math.ceil(total / 30) }; }
```

## List extraction (save with `filename`)

Only "core" cards are real results; `serp-enlarged-card-testid` cards are nearby towns and are skipped.

```js
() => [...document.querySelectorAll('[data-testid="serp-core-classified-card-testid"]')].map(c => { const a = c.querySelector('a[data-testid="card-mfe-covering-link-testid"]'); const url = (a?.href ?? '').split(/[?#]/)[0]; const t = s => c.querySelector(`[data-testid="${s}"]`)?.textContent.trim() || null; const head = a?.getAttribute('title') ?? ''; const specs = head.split(' - ').slice(3).join(' - '); const kind = t('cardmfe-description-box-text-test-id')?.match(/zur Miete · ([^0-9]+)/)?.[1]?.trim(); const teaser = t('cardmfe-description-text-test-id'); return { portal: 'immowelt', portal_id: url.split('/').pop(), url, title: teaser ? teaser.split(/(?<=[.!?])\s/)[0].slice(0, 90) : head, location: t('cardmfe-description-box-address'), rent_cold: t('cardmfe-price-testid'), rooms: specs.match(/([\d,]+)\s*Zimmer/)?.[1] ?? null, area: specs.match(/([\d.,]+)\s*m²/)?.[1] ?? null, floor: specs.match(/(Geschoss\s*[^,]+|\d+\.\s*Geschoss|Erdgeschoss)/)?.[1] ?? null, available_from: specs.match(/frei ab ([^,]+)/)?.[1] ?? null, features: kind ? [kind] : [], description: teaser, images: [...c.querySelectorAll('img[src*="mms.immowelt.de"]')].map(i => i.src).filter(s => !s.includes('?h=50')).slice(0, 6) }; })
```

Cards have no headline: `title` is the first sentence of the teaser (the detail page headline replaces it if a detail record is saved).
The covering link `title` attribute is the most stable source of facts, e.g.
`Wohnung zur Miete - Frankfurt am Main - 759 € - 2 Zimmer, 52 m², 1. Geschoss, frei ab 22.10.2026`.
Floor formats: `1. Geschoss`, `Geschoss 1/3`, `Geschoss EG/2`, `Geschoss -1/1` (all handled by ingest).

## Detail extraction (save with `filename`, returns a one-element array)

Detail URLs: `/expose/<uuid-or-id>` (verified). `/wl-cdp/<ID>` cards are partner listings – the same script is best effort there.
The DOM renders only ~5 gallery previews, but the page HTML contains every gallery + floor-plan URL (`mms.immowelt.de/<a>/<b>/<c>/<d>/<uuid>.jpg`);
`?w=1200` gives a 1200 px rendition. Description texts are fully in the DOM (only CSS-clamped behind "Mehr anzeigen"):
headline in `cdp-main-description-title` (generic "Über diese Immobilie" when the ad has none → `document.title`), main text in
`cdp-main-description-expandable-text`, amenity prose in the non-list children of `cdp-features`, Lage in `cdp-location-description-expandable-text`,
Sonstiges in `cdp-additional-description-expandable-text` (layout changed 2026-10-25: main text moved out of `cdp-features`).

```js
() => { const txt = (document.querySelector('main') || document.body).innerText; const heads = ['Merkmale', 'Grundrisse', 'Realisiere Dein Projekt', 'Bausubstanz und Energie', 'Mietkosten', 'Bei Nebenkosten sparen', 'Lage', 'Weitere Informationen']; const section = name => txt.match(new RegExp('\\n' + name + '\\n([\\s\\S]*?)(?=\\n(?:' + heads.join('|') + ')\\n|$)'))?.[1] ?? ''; const after = (block, label) => block.match(new RegExp('(?:^|\\n)' + label + '\\n(?:[^\\n]*€/m²\\n)?([^\\n]+)'))?.[1] ?? null; const costs = section('Mietkosten'); const tid = id => document.querySelector(`[data-testid="${id}"]`)?.innerText.trim() || null; const mtitle = tid('cdp-main-description-title'); const headline = mtitle && !/^Über diese Immobilie$/i.test(mtitle) ? mtitle : null; const top = txt.split(/\nBerechne die Fahrtzeit/)[0]; const extra = [...(document.querySelector('[data-testid="cdp-features"] > div')?.children ?? [])].filter(c => !c.matches('h2, ul') && !c.querySelector('button')).map(c => c.innerText.trim()).filter(Boolean).join('\n\n'); const loc = tid('cdp-location-description-expandable-text'); const description = [tid('cdp-main-description-expandable-text'), extra && 'Ausstattung:\n' + extra, loc && 'Lage:\n' + loc, tid('cdp-additional-description-expandable-text')].filter(Boolean).join('\n\n').slice(0, 8000) || null; const images = [...new Set(document.documentElement.outerHTML.match(/https:\/\/mms\.immowelt\.de\/[0-9a-f]\/[0-9a-f]\/[0-9a-f]\/[0-9a-f]\/[0-9a-f-]{36}\.(?:jpe?g|png|webp)/gi) ?? [])].map(u => u + '?w=1200').slice(0, 30); return [{ portal: 'immowelt', portal_id: location.pathname.split('/').pop(), url: location.origin + location.pathname, title: headline ?? document.title, location: tid('cdp-location-address') ?? top.split('\n').filter(Boolean).pop() ?? null, rent_cold: after(costs, 'Kaltmiete'), rent_warm: after(costs, 'Warmmiete'), nebenkosten: after(costs, 'Nebenkosten'), heizkosten: after(costs, 'Heizkosten'), rooms: top.match(/\n([\d,]+) Zimmer\n/)?.[1] ?? null, area: top.match(/\n([\d.,]+) m²\n/)?.[1] ?? null, floor: top.match(/\n([^\n]*Geschoss[^\n]*|Erdgeschoss)\n/)?.[1] ?? null, available_from: top.match(/frei ab ([^\n]+)/)?.[1] ?? null, features: [...document.querySelectorAll('[data-testid="cdp-features"] ul li')].map(li => li.innerText.trim()).filter(s => s && s.length < 60), description, images }]; }
```

Verified 2026-10-14 (expose 29539c63-…): 13 images (11 photos + 2 floor plans, page says "11 Bilder"), all load hotlinked with
`referrerpolicy=no-referrer`; description 2.9k chars incl. Lage and Sonstiges.

"Mietkosten" block (verified): `Warmmiete 1.036,20 €`, `Kaltmiete 759,20 €`, `Nebenkosten 124 €`, `Heizkosten 153 €`.

## Availability check (save with `filename: data/raw/<date>-avail-<portal>-<portal_id>.json`)

End-of-run check for candidates from `bun scraper/availability.ts list` (see the skill). Returns `{status, signal}`:
`gone` only on an explicit signal, `active` when the listing renders, `unknown` otherwise (changes nothing).

A deleted expose answers HTTP 410 with "Anzeige gelöscht" (verified 2026-11-09). A redirect elsewhere was never observed → `unknown`.

```js
() => { const code = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0; const text = document.body.innerText.slice(0, 3000); if (/captcha|Zugriff verweigert|Roboter/i.test(document.title + text.slice(0, 500))) return { status: 'unknown', signal: 'Bot-Schutz' }; if (code === 404 || code === 410) return { status: 'gone', signal: 'HTTP ' + code }; if (/Anzeige gelöscht|wurde bereits gelöscht/.test(text)) return { status: 'gone', signal: 'Anzeige gelöscht' }; if (!/^\/expose\//.test(location.pathname)) return { status: 'unknown', signal: 'Weiterleitung auf ' + location.pathname }; if (document.querySelector('[data-testid="cdp-main-description-title"], [data-testid="cdp-location-address"], [data-testid="cdp-features"]')) return { status: 'active', signal: 'Exposé online' }; return { status: 'unknown', signal: 'unerwartete Seite: ' + document.title.slice(0, 80) }; }
```

## Pitfalls

- Usercentrics consent dialog (shadow DOM) blocks *clicks* but not `browser_evaluate`. If you need to click, dismiss it with
  `async () => { const sr = document.getElementById('usercentrics-root')?.shadowRoot; [...(sr?.querySelectorAll('button') ?? [])].find(b => /ablehnen/i.test(b.innerText))?.click(); await new Promise(r => setTimeout(r, 1000)); [...(sr?.querySelectorAll('button') ?? [])].find(b => b.innerText.trim() === 'Alles ablehnen')?.click(); }`
- Many results are "Tauschwohnung" (tauschwohnung.com syndication); the card shows `Wohnung zur Miete · Tauschwohnung` → captured in `features`, filtered by ingest.
- `/wl-cdp/<ID>` (uppercase) redirects to `/expose/<id>` (lowercase), so the detail script returns a lowercased `portal_id`
  that doesn't match the list record (→ duplicate listing). For wl-cdp candidates, set `portal_id`/`url` in the saved detail
  file back to the candidate's values (`jq '.[0] |= (.portal_id=$id | .url=$url)'`). Seen 2026-10-15.
- The `h1` count includes only core results; the page additionally renders ~30 enlarged (nearby) cards – ignore them.
