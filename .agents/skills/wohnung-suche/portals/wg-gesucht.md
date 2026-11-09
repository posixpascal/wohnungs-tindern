# WG-Gesucht (wg-gesucht.de) – Wohnungen only

Search **category 2 = Wohnung** only (never 0 = WG-Zimmer, 1 = 1-Zimmer-Wohnung). Server-rendered HTML, no bot wall seen (verified 2026-10-14).
The list price is the **Gesamtmiete (warm)**.

## Search URL

```
https://www.wg-gesucht.de/wohnungen-in-<Slug>.<cityId>.2.1.<page0>.html?offer_filter=1&city_id=<cityId>&sort_order=0&noDeact=1&categories%5B%5D=2&rent_types%5B%5D=2&rMax=<warm_max>&sMin=<area_min>
```

- `categories[]=2` Wohnung, `rent_types[]=2` = **unbefristet** (drops Zwischenmiete/Zeitwohnen up front).
- `rMax` max total rent, `sMin` min area. There is no reliable rooms filter – ingest drops listings below `rooms.min`.
- `<page0>` is the zero-based page number in the path (`.2.1.0.html` = page 1, `.2.1.1.html` = page 2). Small cities rarely have more than one page.
- `<Slug>` is cosmetic (`Frankfurt-am-Main`), `<cityId>` decides.

Example (Frankfurt, verified, 14 results): `https://www.wg-gesucht.de/wohnungen-in-Frankfurt-am-Main.41.2.1.0.html?offer_filter=1&city_id=41&sort_order=0&noDeact=1&categories%5B%5D=2&rent_types%5B%5D=2&rMax=1200&sMin=50`

## City ids

| City | Slug | cityId |
|---|---|---|
| Frankfurt am Main | Frankfurt-am-Main | 41 |
| Neu-Isenburg | Neu-Isenburg | 3304 |
| Hofheim am Taunus | Hofheim-am-Taunus | 3275 |
| Niedernhausen | Niedernhausen | 3319 |
| Idstein | Idstein | 465 |
| Bad Camberg | Bad-Camberg | 3394 |
| Wiesbaden | Wiesbaden | 135 |

New city: `async () => (await (await fetch('/api/location/cities/names/' + encodeURIComponent('<City>'))).json())._embedded.cities.map(c => ({ id: c.city_id, name: c.city_and_state }))`

## Page check (small output)

```js
() => ({ title: document.title, count: document.querySelectorAll('.offer_list_item[data-id]:not(.premium_sticky_asset)').length, pages: Math.max(1, ...[...document.querySelectorAll('ul.pagination a, a.page-link')].map(a => Number(a.innerText.trim())).filter(Number.isFinite)) })
```

## List extraction (save with `filename`)

```js
() => { const city = document.querySelector('#autocompinp')?.value?.trim() || null; return [...document.querySelectorAll('.offer_list_item[data-id]:not(.premium_sticky_asset)')].map(c => { const info = (c.querySelector('.card-details-text, .ad-subtitle')?.getAttribute('title') ?? '').split('·').map(s => s.replace(/\s+/g, ' ').trim()); const cols = [...(c.querySelector('.middle-row')?.children ?? [])].map(d => d.innerText.trim()); const dates = (cols[1] ?? '').split('-').map(s => s.trim()); return { portal: 'wg-gesucht', portal_id: c.dataset.id, url: new URL(c.getAttribute('href') ?? '', location.origin).href, title: c.querySelector('.card-title-text, .ad-title')?.innerText.trim() || c.getAttribute('aria-label') || '', city, location: [info[1], info[2]].filter(Boolean).join(', '), rooms: info[0]?.match(/(\d+(?:,\d+)?)-Zimmer/)?.[1] ?? null, rent_warm: c.querySelector('.price-row .card-main-text')?.innerText.trim() ?? null, area: cols[0] ?? null, available_from: dates[0] || null, available_to: dates[1] || null, features: info[0] ? [info[0]] : [], images: [...c.querySelectorAll('img.top-image-card[src*="img.wg-gesucht.de"]')].map(i => i.src).slice(0, 4) }; }); }
```

Card layout (changed 2026-10-22): each result is an `<a class="wgg-list-card offer_list_item" data-id href>`; price in `.price-row .card-main-text` (`990 €`),
title `.card-title-text` (was `.ad-title` until 2026-11), facts in the `title` attribute of `.card-details-text` (was `.ad-subtitle`) (`2-Zimmer-Wohnung · Frankfurt am Main Nied · Sauerstr. 23`),
`.middle-row` children = `53 m²` · `01.01.2027` (or `01.11.2026 - 31.03.2027` when befristet). The sticky promoted card
(`.premium_sticky_asset`, usually a WG-Zimmer from another category) is skipped. ~10 results per page, small cities have none.

## Detail extraction (save with `filename`, returns a one-element array)

Gallery: `#WG-Pictures img[data-large]` (`.large.jpg`, ~1024 px). Description tabs `#freitext_0` (Wohnung), `_1` (Lage), `_2` (WG-Leben),
`_3` (Sonstiges) – only the first is visible, so the script reads `textContent` of their `<p>`s (the ad slot inside `_0` is skipped).

```js
() => { const t = document.body.innerText; const val = label => t.match(new RegExp(label + ':\\s*\\n?\\s*([^\\n]+)'))?.[1]?.trim() ?? null; const between = (a, b) => { const i = t.indexOf('\n' + a + '\n'); if (i < 0) return ''; const j = t.indexOf('\n' + b + '\n', i + a.length); return t.slice(i + a.length + 2, j > i ? j : i + 2500); }; const id = location.pathname.match(/\.(\d+)\.html/)?.[1]; const tabs = ['', 'Lage', 'WG-Leben', 'Sonstiges']; const description = [...document.querySelectorAll('[id^="freitext_"]')].map(e => { const body = [...e.querySelectorAll('p')].map(p => p.textContent.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n\n'); const label = tabs[Number(e.id.split('_')[1])]; return body && (label ? label + ':\n' + body : body); }).filter(Boolean).join('\n\n').slice(0, 8000) || null; return [{ portal: 'wg-gesucht', portal_id: id, url: location.origin + location.pathname, title: document.querySelector('h1')?.innerText.trim() ?? document.title, location: between('Adresse', 'Verfügbarkeit').replace(/\s+/g, ' ').trim() || null, rent_cold: val('Miete'), nebenkosten: val('Nebenkosten'), available_from: val('frei ab'), available_to: val('frei bis'), features: [...document.querySelectorAll('.utility_icons > div, .section_panel_detail')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(s => s && !s.endsWith(':')), description, images: [...new Set([...document.querySelectorAll('#WG-Pictures img[data-large]')].map(i => i.getAttribute('data-large')).filter(s => s && s.includes('/media/up/')))].slice(0, 30) }]; }
```

Verified 2026-10-14 (ad 14170720): 9 images (1024×1820), loading hotlinked with `referrerpolicy=no-referrer`; description with Lage + Sonstiges.

Verified "Kosten" block: `Miete: 705€`, `Nebenkosten: 130€`, `Sonstige Kosten: n.a.`; "Angaben zum Objekt" icons: `WG geeignet`, `Badewanne, Dusche`, `Keller`, `Balkon`, `Erdgeschoss` … (go to `features`).

## Availability check (save with `filename: data/raw/<date>-avail-<portal>-<portal_id>.json`)

End-of-run check for candidates from `bun scraper/availability.ts list` (see the skill). Returns `{status, signal}`:
`gone` only on an explicit signal, `active` when the listing renders, `unknown` otherwise (changes nothing).

A deactivated ad stays at its URL (HTTP 200, title, one picture) with a visible `.alert` box
"Die Anzeige in … ist deaktiviert." (verified 2026-11-09 on 11236782). Only visible alerts count – hidden ones would match via `innerText`.

```js
() => { const code = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0; if (code === 404 || code === 410) return { status: 'gone', signal: 'HTTP ' + code }; const off = [...document.querySelectorAll('.alert')].find(e => e.checkVisibility() && /Anzeige\b.*\bist (momentan )?deaktiviert/.test(e.innerText)); if (off) return { status: 'gone', signal: 'Anzeige deaktiviert' }; if (/\.\d+\.html$/.test(location.pathname) && document.querySelector('#WG-Pictures, [id^="freitext_"]')) return { status: 'active', signal: 'Anzeige online' }; return { status: 'unknown', signal: 'unerwartete Seite: ' + document.title.slice(0, 80) }; }
```

## Pitfalls

- Never search category 0 (WG-Zimmer) – the user wants whole flats. Category 1 (1-Zimmer-Wohnung) is below the room minimum anyway.
- `Miete` on the detail page is the Kaltmiete part; the list price is the total – ingest keeps the list value as `rent_warm`.
- "WG geeignet" is an amenity, not a WG room – ingest ignores it for exclusion.
- Profiles/contact need login; never log in, the public data is enough.
