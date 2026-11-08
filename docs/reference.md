# Reference

Technical reference for wohnung-finden. Overview and quickstart (German): [README](../README.md). Instructions for coding agents: [AGENTS.md](../AGENTS.md).

## How it works

```
 config/search.json
        |
        v
 coding agent + Playwright MCP  --- list pages ---> data/raw/<date>-list-*.json
   (skill: wohnung-suche)                                   |
        ^                                                   v
        |                                     scraper/candidates.ts  (which detail pages to visit)
        +--- detail pages (new / backfill / refresh) -----> data/raw/<date>-detail-*.json
                                                            |
                                                            v
                         scraper/ingest.ts  normalize -> hard filters -> score -> data/wohnungen.sqlite
                         scraper/sweep.ts   unseen for 3 days -> gone
                         scraper/push.ts    POST /api/ingest  ---> swipe app (app/, Elysia + SQLite)
                         scraper/report.ts  reports/<date>.md          every user swipes -> matches
```

The agent only navigates and runs extraction scripts. Parsing, filtering, scoring and storage are deterministic TypeScript in `scraper/`.

## Skills

Skills live in `.agents/skills/<name>/SKILL.md`. In Claude Code run `/<name>`; in other agents say "use the `<name>` skill".

| Skill | What it does |
|---|---|
| `wohnung-setup` | First-time onboarding: prerequisites, `bun run setup`, criteria interview, location ids, app via Docker or `bun run dev`, users, first run. |
| `wohnung-suche` | A search run (interactive, `headless` or `backfill`): portals -> ingest -> push -> report -> German summary. |
| `wohnung-kriterien` | Change budget, rooms, area, cities, districts, portals or preferences later; validates, rescores, pushes. |
| `wohnung-users` | Add, list, re-password or remove app users, locally or on the server. |
| `wohnung-zeitplan` | Schedule the daily headless run (launchd on macOS, systemd timer or cron on Linux). |
| `wohnung-portal-fix` | Repair a portal's extraction scripts after a layout change and verify them. |
| `wohnung-deploy` | Put the app on your own server (Debian + systemd + Caddy, or Docker Compose + Caddy) and point the scraper at it. |
| `wohnung-server` | Day-2 ops for the deployed app: status, logs, updates, backups/restore, token rotation, disk/TLS. |

## Daily use

Keep the app running so the push step has a target: `bun run docker:up` (background container, see [Docker](#docker)), `bun run dev`, or a deployed app.

| Mode | Claude Code | What happens |
|---|---|---|
| Interactive | `claude "/wohnung-suche"` or `bun run scrape` | Full run. On a captcha the agent asks you to solve it in the browser window and waits for `weiter`. |
| Headless | `claude -p "/wohnung-suche headless"` or `bun run scrape:headless` | Same steps, never waits. A portal that shows a captcha is skipped and listed in the summary. |
| Backfill | `claude "/wohnung-suche backfill"` | No search. Only revisits known listings (missing gallery/description, then due refreshes). |

`bun run scrape` / `bun run scrape:headless` run `SCRAPE_CMD` / `SCRAPE_HEADLESS_CMD` (defaults above; the agent process doesn't get `INGEST_TOKEN`). Other agents have no `/wohnung-suche` slash command, so ask for the skill by name. Set the override in `.env` (or the environment), e.g. for Codex:

```sh
SCRAPE_CMD='codex "Use the wohnung-suche skill"'
SCRAPE_HEADLESS_CMD='codex exec --full-auto "Use the wohnung-suche skill in headless mode"'
```

A run:
1. Searches every portal x city from `config/search.json` (max 3 result pages each, newest first).
2. Visits detail pages for full gallery and description, sharing one budget of 80 per run: all new listings that pass the filters (best score first), then **backfill** (known listings with no detail visit yet and <= 1 image or no description), then **refresh** (known listings whose last detail visit is >= 7 days old).
3. Ingests, sweeps (unseen for 3 days -> `gone`), pushes to `WOHNUNG_URL`, writes `reports/<date>.md`, ends with a short German summary.

How updates work: the detail page is the source of truth. Added, removed or replaced photos and rewritten descriptions replace the stored ones on the next refresh. An empty gallery or text from a detail page (extraction failure) never wipes stored data, and a list page never overrides what a detail visit delivered. A listing without photos on the portal is revisited weekly, not daily.

Scheduling: the `wohnung-zeitplan` skill installs a daily `bun run scrape:headless` job (macOS LaunchAgent, Linux systemd user timer or cron) and shows how to test and remove it. The browser is headed, so it needs a logged-in desktop session and, on macOS, an awake Mac.

### Headless runs: permissions

Headless runs cannot answer permission prompts. For Claude Code the committed `.claude/settings.json` enables the `playwright` server from `.mcp.json`, allows its tools and the scraper scripts, and denies reading `.env`:

```json
{
  "enabledMcpjsonServers": ["playwright"],
  "permissions": {
    "allow": ["mcp__playwright", "Bash(bun scraper/*)", "Bash(bun run doctor)"],
    "deny": ["Read(./.env)"]
  }
}
```

If your Playwright server has another name (e.g. a user-level one), add `mcp__<name>` to the gitignored `.claude/settings.local.json`; to skip the repo's server there, use `"disabledMcpjsonServers": ["playwright"]`. With Codex, `--full-auto` lets it write files in the repo; the push to a local app also needs network access (`-c sandbox_workspace_write.network_access=true`).

## Configuration

`config/search.json` (gitignored, created from `config/search.example.json`) is the single source of truth for search criteria. It is validated on every scraper run; invalid values abort with a list of all problems.

| Field | Meaning |
|---|---|
| `budget.warm_max` | Hard limit on warm rent (EUR). Also the portal search filter. |
| `budget.nebenkosten_estimate_per_sqm` | Used to estimate warm rent for Kaltmiete-only listings (`cold + area x this`). |
| `rooms.min` / `rooms.ideal` | Hard minimum / full score points. |
| `area_sqm.min` | Hard minimum (m²). |
| `area_sqm.ideal_min` / `ideal_max` | Full size points inside this range (optional; default `min` .. unlimited). |
| `preferences.amenities` | Any of `garden`, `balcony`, `bathtub`; each earns score points when the listing has it. |
| `preferences.ground_floor` | Score bonus for EG (and a third of it for the 1st floor). |
| `requirements.ground_floor_or_balcony` | Optional hard filter: listing must confirm EG, balcony/terrace/loggia, or a garden at ground level. |
| `locations[].city` | Cities to search. A listing must resolve to one of them. Each needs a location id in every portal file. |
| `locations[].allowed_districts` | Optional whitelist ("Ja"); empty = whole city. With entries, only these and the preferred districts pass. |
| `locations[].excluded_districts` | Optional; listings in these districts are filtered ("Nein"). |
| `locations[].preferred_districts` | Optional; score bonus ("Favorit"), and allowed when a whitelist is set. Alone it never restricts. |
| `locations[].radius_km` | Accepted, currently unused (searches are city-only). |
| `portals` | Subset of `immoscout24`, `immowelt`, `kleinanzeigen`, `wg-gesucht`. |

**Hard filters** (ingest, `scraper/normalize.ts` + `scraper/detect.ts`) reject a listing when: it is not in a configured city; its district is excluded or outside a district whitelist (see [Districts](#districts)); warm rent is unknown or above `warm_max` (missing warm rent is estimated from Nebenkosten, `nebenkosten_estimate_per_sqm`, or cold + 150 EUR); rooms or area are known and below the minimum; the outdoor requirement is enabled and not confirmed (unknown counts as no, which is why new listings get a detail visit); values are implausible (> 8 rooms, < 5 EUR/m² warm); or the text marks it as WG-Zimmer, Tausch, Zeitwohnen/short-term, Monteurwohnung, single-person only, or Senioren/WBS-only.

### Districts

Portals search whole cities, so district choice happens in the scraper. Per city, `config/districts/<city-slug>.json` (optional, gitignored except `*.example.json`; slug = lowercase-kebab with ae/oe/ue/ss, e.g. `frankfurt-am-main`) lists the city's districts, written by the onboarding agent (`wohnung-setup` step 3a):

```json
{ "city": "Frankfurt am Main",
  "districts": [{ "name": "Gallus", "aliases": ["Gallusviertel"], "summary": "…",
                  "highlights": { "shopping": "…", "culture": "…", "leisure": "…", "cinema": "…",
                                  "pool": "…", "sights": "…", "transit": "…" } }] }
```

- `name` is canonical: whatever spelling a portal uses (`district` field, a known name/alias in location, address or title, Kleinanzeigen's `60316 Nordend`), the listing is stored under it, so one district has one name across portals. `bun run rescore` re-maps stored districts and fills missing ones from address/title.
- Validation (`scraper/districts.ts`, fail fast with every problem): city must match, names non-empty, a spelling belongs to one district only, only the seven highlight keys (German text, ≤ 300 chars; `summary` ≤ 200). With a file, every name in the three district lists must be a `name` or `alias` from it.
- Filter (`districtReason`, applied by ingest and candidates; known listings it rules out get no detail visits): an excluded district is rejected (`Stadtteil ausgeschlossen (…)`); with a whitelist anything else is rejected (`Stadtteil nicht im Suchgebiet (…)`), an unknown district too (`Stadtteil unbekannt`) – `candidates.ts` lets unknown ones through so the detail visit can tell.

**App settings override the config.** The swipe app's **Einstellungen** tab shows each city's districts with summary, highlights (Einkaufen, Kultur, Freizeit & Ausgehen, Kino, Schwimmbad, Sehenswürdigkeiten, ÖPNV) and active listing count; the group toggles Egal / Ja / Favorit / Nein (one shared selection, saved per city). Sync with `bun run districts` (`scraper/settings.ts`, also step 1 of every `wohnung-suche` run):

1. It `POST`s every configured city, its districts file and its config lists to `/api/ingest/districts` (bearer `INGEST_TOKEN`). The app replaces the pushed cities' district metadata and takes the config lists only for a city it has no selection for yet; cities missing from the push are kept. `bun run districts -- --from-config` overwrites the app's selection with the config lists (after editing them with `wohnung-kriterien`) and drops cities no longer configured.
2. The answer, the selection now held by the app, is stored in `data/district-selection.json`. `loadConfig` applies it on top of `config/search.json`: per city the app's lists replace the config's. Without `WOHNUNG_URL`/`INGEST_TOKEN` nothing is synced and the stored selection is deleted, so the config applies; if the app is unreachable the last stored selection applies. `rescore` and `report` print on stderr which cities use the app's selection.

The app hides listings an excluded district or a whitelist rules out from the swipe queue right away (matches and likes keep them) and shows them again when the district is allowed again: `rescore` deliberately doesn't mark district-rejected listings `gone`. New listings found while a district is excluded are rejected at ingest and only come back if a later search finds them again. The queue matches exact (canonical) names only, so after adding a districts file or aliases run `bun run rescore && bun run push` to re-map the stored districts on the server. The settings page is public to read (`/#einstellungen`, also linked from the login page; who changed it is hidden from guests); changing it needs a login. `bun run scrape` / `scrape:headless` pull the selection (`scraper/settings.ts`) before the agent starts, so local and scheduled runs filter by it. Routes: `GET /api/settings/districts` (public), `PUT /api/settings/districts` (session; takes `{ city, allowed_districts, excluded_districts, preferred_districts }`, names must be districts shown for that city, each in one list at most), `POST /api/ingest/districts` (token).

**Score** (0-100, `scraper/score.ts`) adds weighted parts: rooms 20, size 20, garden 11, balcony 7, bathtub 8, ground floor 12, price headroom 12 (full at one third below budget), preferred district 10. Each part adds a short German note (`3 Zi ✓, EG ✓, warm 1.050 €`) shown in the app and report. After changing the config (or with the `wohnung-kriterien` skill), `bun run rescore && bun run push` updates existing listings: rescore re-applies the filters except the district filter (listings that no longer pass -> `gone`) and recomputes scores. Loosening criteria doesn't revive filtered or gone listings; the next search run finds them again.

`.env` (from `.env.example`, used by the scraper push and the local app): `WOHNUNG_URL`, `INGEST_TOKEN` (>= 32 chars), `PORT`, `HOST`, `DB_PATH`, `COOKIE_SECURE`, `TRUST_PROXY`. Without `WOHNUNG_URL` and `INGEST_TOKEN` the push step is skipped. Plain `http` is only allowed for `localhost`/`127.0.0.1`.

#### Upgrading an existing install

District filtering only works for cities with a `config/districts/<city-slug>.json`. After pulling this version:

1. `bun run doctor`: the `districts` line names every city without district data.
2. Run the `wohnung-kriterien` skill ("Stadtteile einrichten"): it researches the missing cities in parallel research agents (`.agents/skills/wohnung-setup/district-research.md`) and validates the files.
3. Deploy the app (new tables `districts`, `district_settings` are created on startup), then `bun run districts` (push district data), `bun run rescore && bun run push` (canonical district names on stored listings).
4. Choose districts on the Einstellungen page. `bun run scrape` pulls the selection before every run; interactive `wohnung-suche` runs also check district readiness before opening a portal.

### Inquiry text ("Anfrage schreiben")

The detail sheet (Likes and Matches) has an **Anfrage schreiben** button: it opens an editable German inquiry text for the landlord, built from the listing (title, place, rooms, area, floor, balcony/garden, rents, availability, description) and the group's shared **Über uns** profile (free text + signature, stored in the app DB table `inquiry_profile`, edited in the same sheet). The app never sends anything; you copy the text and contact the landlord on the portal.

Text source (`app/src/inquiry/`): an LLM via the Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) when configured, otherwise a deterministic template (`template.ts`). A failed LLM call falls back to the template with a warning. The scraped description is fenced in the prompt and treated as data. LLM generations are limited per user to 10 per minute and 100 per day (one SDK retry).

| Variable | Meaning |
|---|---|
| `INQUIRY_API_KEY` | API key; alone it targets OpenRouter. |
| `INQUIRY_BASE_URL` | Any OpenAI-compatible endpoint (default `https://openrouter.ai/api/v1`). Set alone, without key, for a local Ollama / LM Studio (`http://127.0.0.1:11434/v1`; from the Docker app `http://host.docker.internal:11434/v1`, on Linux plus `extra_hosts: ["host.docker.internal:host-gateway"]`). |
| `INQUIRY_MODEL` | Model id (default `anthropic/claude-haiku-5.5`). |

Locally they go in `.env`, on a systemd server in `/etc/wohnung.env`, with Docker in the server's `.env`. Routes: `GET/PUT /api/inquiry/profile`, `POST /api/listings/:id/inquiry`.

## Users

One account per person; a listing is a match once **every** user has liked it (so a third account changes matches). Commands that take a password show a hidden double prompt; run them yourself in a terminal (Claude Code: `! bun run user alex`), never through the agent. The `wohnung-users` skill walks you through it.

```sh
bun run users                   # id, name, created, #swipes, #active sessions
bun run user alex          # add (password >= 12 chars)
bun run passwd alex        # new password, logs the user out everywhere
bun run user-remove alex   # delete user + sessions + swipes, no confirmation
bun run docker:users            # same CLI in the local Docker app: docker:user|docker:passwd|docker:user-remove <name>
make remote-cli ARGS="user list"   # same CLI on the server: user add|list|passwd|remove <name>
```

## Docker

The swipe app (not the scraper: that runs next to the agent and its headed browser) ships as an image: `Dockerfile` compiles it into a single binary on `debian:bookworm-slim`, running as uid 10001 with a read-only root filesystem and no capabilities. `compose.yaml` publishes it on `127.0.0.1:${PORT}` (default 3000, the local `WOHNUNG_URL`) and keeps the DB in the named volume `wohnung-data`. It reads `INGEST_TOKEN`, `COOKIE_SECURE` and `TRUST_PROXY` from `.env`; `HOST`, `PORT` and `DB_PATH` are fixed inside the container.

```sh
bun run docker:up      # docker compose up -d --build (restarts with Docker)
bun run docker:logs    # follow the app logs
bun run docker:users   # user list; docker:user / docker:passwd / docker:user-remove <name>
bun run docker:down    # stop (the volume and its users/swipes stay)
```

The Docker app and `bun run dev` have separate databases (volume vs. `data/wohnung.sqlite`) and the same port; run one of them. `bun run doctor` detects the running container. For a server, see Deploy (`DEPLOY_MODE=docker`).

## Deploy

To share the app with everyone in your search, run the `wohnung-deploy` skill: it sets the app up either on a Debian server with systemd and Caddy (TLS), or on any Linux host with Docker (`DEPLOY_MODE := docker` in `deploy.mk`: the committed tree goes to `DOCKER_DIR` via `git archive`, `docker compose` runs the app plus a Caddy container enabled by `COMPOSE_PROFILES=https` and `DOMAIN` in the server's `.env`). Either way it creates the users and points the scraper's `.env` at it (`WOHNUNG_URL=https://wohnung.example.com`). The manual steps are in [ops/SETUP.md](../ops/SETUP.md). `deploy.mk` (gitignored) holds `DEPLOY_HOST`, `DEPLOY_USER` (admin SSH user with sudo, or root) and `DOMAIN`. Afterwards: `make deploy` (build + upload, auto-restart), `make status`, `make logs`, `make backup` (download the daily DB snapshot into `backups/`), `make remote-cli ARGS="..."` (same targets in Docker mode; `make backup` then takes a fresh snapshot, there is no nightly timer). Day-2 tasks (restore, token rotation, disk/TLS checks) are in the `wohnung-server` skill.

## Repo layout

```
.agents/skills/        the skills above; wohnung-suche/portals/<portal>.md holds URLs, ids, extraction scripts
.claude/skills         symlink to .agents/skills (Claude Code)
AGENTS.md              instructions for coding agents (CLAUDE.md is a symlink)
config/                search.example.json (committed), search.json (yours, gitignored), districts/<city-slug>.json (district descriptions; *.example.json committed)
scraper/               candidates, ingest, normalize, detect, districts, score, sweep, push, settings (district sync), report, rescore (+ *.test.ts)
db/schema.sql          scraper DB schema
app/                   swipe app: Elysia server (src/), web client (src/web/client), tests (test/)
Dockerfile, compose.yaml  swipe app image + compose (app, optional Caddy profile `https`)
ops/                   systemd units, Caddyfile.example, Caddyfile.docker, wohnung-cli, SETUP.md
data/                  wohnungen.sqlite (scraper), wohnung.sqlite (local app), raw/ (extraction JSON), district-selection.json (app's district selection), gitignored
reports/               daily <date>.md, gitignored
```

## Development

```sh
bun run test:app          # app tests (app/test)
bun run test:scraper  # scraper tests (scraper/*.test.ts)
bun run typecheck     # tsc --noEmit
make build         # single-file binary dist/wohnung (linux-x64)
make help          # all targets
```

## Troubleshooting

- **Captcha / bot wall**: run interactively and solve it in the Playwright window, then type `weiter`. Headless runs skip that portal for the day. ImmoScout24's first-request interstitial usually clears by itself after a few seconds.
- **A portal returns nothing although the site shows results**: the layout changed. Run interactively; the summary names the portal. Run the `wohnung-portal-fix` skill: it fixes the script in `.agents/skills/wohnung-suche/portals/<portal>.md` and verifies it with a test extraction + ingest.
- **Many `Stadtteil nicht im Suchgebiet` / `Stadtteil unbekannt` filters**: expected with a district whitelist (searches are city-wide). If a district you want is missing, add its portal spelling as an alias in `config/districts/<city-slug>.json`, then `bun run rescore && bun run push`. Check what applies with `bun run districts` (per-city lines on stderr).
- **Ingest says `Ort nicht im Suchgebiet` for everything from one portal**: the city/location field is missing from that portal's extraction (portal file pitfalls; `wohnung-portal-fix` repairs it).
- **App down / errors on the server**: `make status`, `make logs` (`wohnung-server` skill).
- **Push fails**: locally, the app must be running (`bun run docker:up` or `bun run dev`) and `WOHNUNG_URL`/`INGEST_TOKEN` in `.env` must match the app. Fix it, then `bun run push` (only push again) and `bun run report` (only rewrite the report).
- **Not sure what's missing**: `bun run doctor` checks dependencies, `.env`, config, portal ids, users, the app and `npx`, and prints the next step.
- **Docker build fails with `no space left on device`**: Docker's disk is full. Check `docker system df` and free space (Docker Desktop: Troubleshoot) before `bun run docker:up` again.
- **`bun` not found**: install it from https://bun.sh (or `nix develop` with the flake).
- **Windows**: everything except the server targets and the `wohnung-zeitplan` scheduler (macOS/Linux only; use Task Scheduler with `bun run scrape:headless` yourself) runs natively. The hidden password prompt of `bun run user` relies on `stty`; without it (plain cmd/PowerShell) the password is visible while typing, so use WSL if that matters.

## Fair use

Runs are sequential with pauses, capped at 3 result pages per portal and city and 80 detail pages per day; the agent never logs in, contacts landlords or submits forms. Keep it that way and respect each portal's terms of use.
