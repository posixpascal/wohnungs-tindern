# Wohnungs-Tindern

**Wohnungssuche zum Wischen.** Ein KI-Agent durchsucht jeden Tag ImmoScout24, immowelt, Kleinanzeigen und WG-Gesucht, sortiert alles aus, was nicht passt, und legt dir den Rest als Karten in eine Swipe-App. Wenn alle in eurer Gruppe nach rechts wischen, habt ihr ein Match.

<p align="center">
  <img src="docs/demo.gif" alt="Swipe-App: Wohnungen als Karten mit Fotos, Warmmiete, Score und Details" width="300">
  <br>
  <sub><a href="docs/demo.mp4">Video in voller Qualität</a></sub>
</p>

## Was es macht

1. **Suchen:** Dein Coding-Agent steuert einen echten Browser durch vier Portale, für jede Stadt aus deinen Kriterien, neueste Anzeigen zuerst.
2. **Aussortieren:** Was zu teuer oder zu klein ist, nicht in deinen Städten liegt oder ein WG-Zimmer, Tausch, Zeitwohnen oder WBS-only ist, fliegt raus, bevor du es je siehst. Bei Anzeigen, die nur die Kaltmiete nennen, wird die Warmmiete geschätzt.
3. **Bewerten:** Jede Wohnung bekommt einen Score von 0 bis 100 (Zimmer, Fläche, Balkon, Garten, Badewanne, Erdgeschoss, Preis, Wunsch-Stadtteil) und eine kurze Begründung wie `3 Zi ✓, EG ✓, warm 1.050 €`.
4. **Wischen:** Die Treffer landen mit allen Fotos, Grundriss und Beschreibung in der App. Bereits gewischte Wohnungen tauchen nicht wieder auf, und offline genommene Anzeigen werden automatisch aussortiert.

Dazu gibt es jeden Tag einen kurzen Bericht über die neuen Anzeigen.

## Warum das Zeit spart

Ohne das Tool klickt man jeden Tag vier Portale × alle Städte durch, sieht dieselben Anzeigen immer wieder und liest Exposés, die am Ende doch zu teuer oder ein WG-Zimmer sind. Danach schickt man sich Links hin und her und fragt: „Hast du die schon gesehen?“

Mit Wohnungs-Tindern läuft die Suche morgens automatisch. Du siehst nur neue Wohnungen, die deine harten Kriterien erfüllen, die besten zuerst. Ein Wisch reicht pro Wohnung, und Matches zeigen sofort, worüber ihr euch alle einig seid. So bleibt die Zeit für Besichtigungen und Bewerbungen.

## Multiplayer

Beliebig viele Leute, ein Account pro Person: für Paare, WGs oder die ganze Familie.

- **Match** = alle haben die Wohnung geliked.
- Wohnungen, die andere schon mögen, kommen bei dir zuerst, mit dem Hinweis „💛 Alex & Sam mögen das“.
- **Matches** und **Meine Likes** haben eigene Tabs, deine Likes sortiert nach Score.

Lokal läuft die App auf deinem Rechner. Damit alle vom Handy aus wischen können, stellst du sie mit dem Skill `wohnung-deploy` auf einen eigenen Server (Debian, HTTPS über Caddy).

## Was du brauchst

- **[Bun](https://bun.sh):** einzige Laufzeit, Installation mit einem Befehl auf macOS, Linux und Windows
- **Einen Coding-Agenten**, z. B. [Claude Code](https://claude.com/claude-code) (empfohlen, ist schon vorkonfiguriert), Codex oder Cursor
- **[Node.js](https://nodejs.org):** für den Playwright-Browser des Agenten (`npx`)

Der Browser läuft sichtbar. Taucht ein Captcha auf, löst du es kurz selbst. Bei unbeaufsichtigten Läufen wird das betroffene Portal für den Tag übersprungen.

## Loslegen

```sh
git clone <repo-url> wohnungs-tindern && cd wohnungs-tindern
bun run setup     # Abhängigkeiten, .env mit Token, Beispiel-Konfiguration
bun run doctor    # zeigt, was fertig ist und was als Nächstes kommt
```

Dann im Agenten den Setup-Skill starten (Claude Code: `/wohnung-setup`). Er fragt Städte, Budget, Zimmer, Fläche und Wünsche ab, legt die Accounts an und startet die erste Suche. Danach `bun run dev` laufen lassen, <http://127.0.0.1:3000> öffnen und loswischen.

## Im Alltag

| | |
|---|---|
| Suche starten | `/wohnung-suche` im Agenten oder `bun run scrape` |
| Jeden Morgen automatisch | `/wohnung-zeitplan` (macOS/Linux) |
| Kriterien ändern | `/wohnung-kriterien` |
| Accounts verwalten | `/wohnung-users` |
| Portal hat sein Layout geändert | `/wohnung-portal-fix` |
| Online stellen / Server pflegen | `/wohnung-deploy`, `/wohnung-server` |

Andere Agenten kennen keine Slash-Commands. Dort sagst du z. B. „Use the wohnung-suche skill“.

## Fair Use

Der Agent loggt sich nirgends ein, schreibt keine Vermieter an und schickt keine Formulare ab. Er arbeitet nacheinander mit Pausen und ruft höchstens 3 Ergebnisseiten pro Portal und Stadt und 80 Exposés pro Tag ab. Bitte halte dich an die Nutzungsbedingungen der Portale.

---

Technische Details (Pipeline, Konfiguration, Scoring, Deployment, Troubleshooting): [docs/reference.md](docs/reference.md) · Für Coding-Agenten: [AGENTS.md](AGENTS.md)
