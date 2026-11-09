# Kleinanzeigen (kleinanzeigen.de)

Server-rendered HTML, no bot wall observed (verified 2026-10-14). Cookie banner does not block extraction.

## Search URL

```
https://www.kleinanzeigen.de/s-wohnung-mieten/<slug>/anzeige:angebote[/seite:<n>]/preis::<warm_max>/c203l<locId>+wohnung_mieten.qm_d:<area_min>,+wohnung_mieten.zimmer_d:<rooms_min>,
```

- `anzeige:angebote` = offers only (drops "Gesuch" ads).
- `preis::1200` filters on the listed price, which is usually the **Kaltmiete** – warm rent is resolved later.
- `qm_d:50,` / `zimmer_d:2,` = min area / min rooms (open upper bound).
- Page 2+: insert `seite:<n>/` before `preis::` (25 results per page).
- `<slug>` is cosmetic, `l<locId>` decides the location.

Example (Idstein, verified): `https://www.kleinanzeigen.de/s-wohnung-mieten/idstein/anzeige:angebote/preis::1200/c203l4804+wohnung_mieten.qm_d:50,+wohnung_mieten.zimmer_d:2,`

## Location ids

| City | slug | locId |
|---|---|---|
| Frankfurt am Main | frankfurt-am-main | 4292 |
| Neu-Isenburg | neu-isenburg | 4541 |
| Hofheim am Taunus | hofheim-am-taunus | 4809 |
| Niedernhausen | niedernhausen | 4914 |
| Idstein | idstein | 4804 |
| Bad Camberg | bad-camberg | 14688 |
| Wiesbaden | wiesbaden | 4897 (Igstadt 26288, Nordenstadt 4912) |

New city: on any kleinanzeigen page run
`async () => (await fetch('/s-ort-empfehlungen.json?query=' + encodeURIComponent('<City>'))).json()`
→ keys look like `"_4804": "Idstein - Hessen"`.

## Page check (small output)

```js
() => { const h1 = document.querySelector('h1')?.innerText ?? ''; const total = Number(h1.match(/von ([\d.]+)/)?.[1]?.replace(/\./g, '') ?? 0); return { title: document.title, h1, count: document.querySelectorAll('#srchrslt-adtable article[data-adid]').length, total, pages: Math.ceil(total / 25) }; }
```

`h1` reads like `1 - 25 von 389 Ergebnissen in Frankfurt am Main - Hessen`.

## List extraction (save with `filename`)

```js
() => { const city = document.querySelector('h1')?.innerText.match(/Ergebnissen in (.+?) - /)?.[1] ?? null; return [...document.querySelectorAll('#srchrslt-adtable article[data-adid]')].map(a => { const ps = [...a.querySelectorAll('p')].map(p => p.innerText.trim()); const facts = ps.find(t => t.length < 80 && /\d\s*(m²|Zi\.)/.test(t)) ?? ''; const price = ps.find(t => /€/.test(t) && t.length < 40) ?? null; let ld = {}; try { ld = JSON.parse(a.querySelector('script[type="application/ld+json"]')?.textContent || '{}'); } catch {} const teaser = ps.filter(t => t !== facts && t !== price).sort((x, y) => y.length - x.length)[0] ?? null; const href = a.getAttribute('data-href') || a.querySelector('a[href*="/s-anzeige/"]')?.getAttribute('href') || ''; return { portal: 'kleinanzeigen', portal_id: a.dataset.adid, url: new URL(href, location.origin).href, city, title: a.querySelector('h3')?.innerText.trim() || ld.title || '', location: a.querySelector('svg[data-title="locationOutline"]')?.parentElement?.innerText.trim() ?? null, rent_cold: price, area: facts.match(/([\d.,]+)\s*m²/)?.[1] ?? null, rooms: facts.match(/([\d.,]+)\s*Zi/)?.[1] ?? null, features: facts.includes('Gesuch') ? ['Gesuch'] : [], description: ld.description ?? teaser, images: ld.contentUrl ? [ld.contentUrl] : [] }; }); }
```

## Detail extraction (save with `filename`, returns a one-element array)

Gallery: classic layout = every slide is `#viewad-image` (+ lightbox thumbnails); newer Tailwind layout = only the first slide has the id, the rest sit in the same `astro-island` (similar/other-ads `article`s are outside it, never take all `img`s); every URL is rewritten to `?rule=$_57.AUTO`
(1600×1200; `$_59` = 960 px, `$_2`/`$_1` = thumbnails).

```js
() => { const box = document.querySelector('#viewad-details')?.innerText ?? ''; const attr = label => box.match(new RegExp('(?:^|\\n)' + label + '\\s*\\n?\\s*([^\\n]+)'))?.[1]?.trim() ?? null; const id = location.pathname.match(/\/(\d+)-\d+-\d+/)?.[1]; const swap = attr('Tauschangebot'); const large = s => { const u = new URL(s); u.searchParams.set('rule', '$_57.AUTO'); return u.href.replace('%24', '$'); }; return [{ portal: 'kleinanzeigen', portal_id: id, url: location.origin + location.pathname, title: document.querySelector('#viewad-title')?.innerText.trim() ?? '', location: document.querySelector('#viewad-locality')?.innerText.trim() ?? null, rent_cold: document.querySelector('#viewad-price')?.innerText.trim() ?? null, rent_warm: attr('Warmmiete'), nebenkosten: attr('Nebenkosten'), heizkosten: attr('Heizkosten'), area: attr('Wohnfläche'), rooms: attr('Zimmer'), floor: attr('Etage'), available_from: attr('Verfügbar ab'), features: [attr('Wohnungstyp'), swap && !/kein/i.test(swap) ? 'Tauschangebot' : null, ...[...document.querySelectorAll('#viewad-configuration li, #viewad-configuration .checktag')].map(e => e.innerText.trim())].filter(Boolean), description: document.querySelector('#viewad-description-text')?.innerText.trim().slice(0, 8000) || null, images: [...new Set([...document.querySelectorAll('#viewad-image, #viewad-lightbox-thumbnail-list img'), ...(document.querySelector('#viewad-image')?.closest('astro-island')?.querySelectorAll('img') ?? [])].map(i => i.getAttribute('data-imgsrc') || i.getAttribute('src')).filter(s => s && s.includes('img.kleinanzeigen.de')).map(large))].slice(0, 30) }]; }
```

Verified 2026-10-14 (ad 3538928144): 9 images at 1600×1200, loading hotlinked with `referrerpolicy=no-referrer`; full description.

Detail attributes seen: Wohnfläche, Zimmer, Schlafzimmer, Etage (`0` = EG), Wohnungstyp (Erdgeschosswohnung, Terrassenwohnung, Souterrain …), Verfügbar ab, Tauschangebot (`Kein Tausch` / `Tausch`), Nebenkosten, Warmmiete, Heizkosten. Checkmark features: Balkon, Terrasse, Garten/-mitnutzung, Einbauküche, Keller …

## Availability check (save with `filename: data/raw/<date>-avail-<portal>-<portal_id>.json`)

End-of-run check for candidates from `bun scraper/availability.ts list` (see the skill). Returns `{status, signal}`:
`gone` only on an explicit signal, `active` when the listing renders, `unknown` otherwise (changes nothing).

A deleted ad redirects from `/s-anzeige/<slug>/<id>-…` to a search page (e.g. `/s-wohnung-mieten/schwanheim/c203l14050`, verified 2026-11-09). Only such a search page counts as gone; any other redirect
(login, consent, another host) is `unknown`.

```js
() => { const code = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0; if (/captcha|Zugriff verweigert|Roboter/i.test(document.title)) return { status: 'unknown', signal: 'Bot-Schutz' }; if (code === 404 || code === 410) return { status: 'gone', signal: 'HTTP ' + code }; if (!location.pathname.startsWith('/s-anzeige/')) return location.hostname === 'www.kleinanzeigen.de' && /^\/s-[a-z0-9-]+\//.test(location.pathname) ? { status: 'gone', signal: 'Weiterleitung auf ' + location.pathname } : { status: 'unknown', signal: 'Weiterleitung auf ' + location.hostname + location.pathname }; if (document.querySelector('#viewad-title')) return { status: 'active', signal: 'Anzeige online' }; return { status: 'unknown', signal: 'unerwartete Seite: ' + document.title.slice(0, 80) }; }
```

## Pitfalls

- Below the real results there is `#srchrslt-adtable-altads` ("Weitere Ergebnisse in anderen Orten" + Gesuche) – the selector `#srchrslt-adtable article` deliberately ignores it.
- Two detail layouts are live at the same time (classic `li.addetailslist--detail` and a newer Tailwind one). The `innerText` label/value regex above works for both; don't switch to class selectors.
- The list price is the Kaltmiete in most ads, sometimes the Warmmiete – the detail page `Warmmiete` attribute (if present) wins in ingest.
- Many ads are private: Warmmiete often only appears in the description ("Nebenkosten: 280 Euro") – ingest parses that as fallback.
- In big cities the card location is only `60314 Ostend` (no city name) – that's why the list script takes `city` from the `h1` ("… Ergebnissen in Frankfurt am Main - Hessen").
- Lots of "Wohnungsswap"/"TAUSCHWOHNUNG" ads (tauschwohnung.com syndication) – filtered by ingest.
- WG rooms and Tauschwohnungen show up in the Wohnung category; ingest filters them via keywords.
