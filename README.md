# wohnung-finden

A flat-hunting tool for two people. Your coding agent drives a real (headed) browser through ImmoScout24, immowelt (incl. immonet), Kleinanzeigen and WG-Gesucht, extracts listings with small per-portal scripts, and hands them to a Bun pipeline that filters, scores and stores them in SQLite. The listings are pushed to a small swipe app (Tinder-style, one account per person); a flat becomes a match when both of you like it. Every run also writes a Markdown report of the day's new listings.

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
                         scraper/report.ts  reports/<date>.md          two users swipe -> matches
```

The agent only navigates and runs extraction scripts. Parsing, filtering, scoring and storage are deterministic TypeScript in `scraper/`.

## Quickstart

Prerequisites:
- [Bun](https://bun.sh) — the only runtime; one-line install on macOS, Linux and Windows.
- A coding agent (Claude Code, Codex, Cursor, ...) with a Playwright MCP server for a **headed** browser, so you can solve captchas. Claude Code picks up the repo's `.mcp.json` (needs [Node.js](https://nodejs.org) for `npx`) and asks once to enable it.
- Only for deploying to a server: `make` and `ssh` (macOS, Linux or WSL).

```sh
git clone <repo-url> wohnung-finden && cd wohnung-finden
bun run setup    # app dependencies, .env with a generated INGEST_TOKEN, config/search.json from the example, web build
bun run doctor   # checklist of what's set up and the next step
```

Then open the repo in your agent and say "run the wohnung-setup skill" (Claude Code: `/wohnung-setup`). It interviews you about your search and writes `config/search.json`, looks up portal location ids for new cities, creates the app users and does a first run.

Manual path:

```sh
$EDITOR config/search.json # your cities, budget, rooms, area
bun run dev                # local swipe app on http://127.0.0.1:3000 (keep it running)
bun run user alex          # one account per person, hidden password prompt (>= 12 chars)
bun run user sam
```

Then run the `wohnung-suche` skill in your agent (Claude Code: `/wohnung-suche`, or `bun run scrape`). New cities need their portal location ids in `.agents/skills/wohnung-suche/portals/<portal>.md` first; `wohnung-setup` does that for you, and `bun run doctor` lists missing ones.

All local tasks are `package.json` scripts (`bun run <script>`): `setup`, `doctor`, `dev`, `users`, `user`, `passwd`, `user-remove`, `test`, `typecheck`, `scrape`, `scrape:headless`, `push`, `report`, `rescore`. Server operations (`make deploy|backup|status|logs|remote-cli`) are in the Makefile. Nix users can still use `nix develop` (`flake.nix`).

## Skills

Skills live in `.agents/skills/<name>/SKILL.md`. In Claude Code run `/<name>`; in other agents say "use the `<name>` skill".

| Skill | What it does |
|---|---|
| `wohnung-setup` | First-time onboarding: prerequisites, `bun run setup`, criteria interview, location ids, users, first run. |
| `wohnung-suche` | A search run (interactive, `headless` or `backfill`): portals -> ingest -> push -> report -> German summary. |
| `wohnung-kriterien` | Change budget, rooms, area, cities, portals or preferences later; validates, rescores, pushes. |
| `wohnung-users` | Add, list, re-password or remove app users, locally or on the server. |
| `wohnung-zeitplan` | Schedule the daily headless run (launchd on macOS, systemd timer or cron on Linux). |
| `wohnung-portal-fix` | Repair a portal's extraction scripts after a layout change and verify them. |
| `wohnung-deploy` | Put the app on your own Debian server (systemd + Caddy) and point the scraper at it. |
| `wohnung-server` | Day-2 ops for the deployed app: status, logs, updates, backups/restore, token rotation, disk/TLS. |

## Daily use

Keep `bun run dev` running (or deploy the app) so the push step has a target.

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
| `locations[].preferred_districts` | Optional; score bonus when the listing's district matches. |
| `locations[].radius_km` | Accepted, currently unused (searches are city-only). |
| `portals` | Subset of `immoscout24`, `immowelt`, `kleinanzeigen`, `wg-gesucht`. |

**Hard filters** (ingest, `scraper/normalize.ts` + `scraper/detect.ts`) reject a listing when: it is not in a configured city; warm rent is unknown or above `warm_max` (missing warm rent is estimated from Nebenkosten, `nebenkosten_estimate_per_sqm`, or cold + 150 EUR); rooms or area are known and below the minimum; the outdoor requirement is enabled and not confirmed (unknown counts as no, which is why new listings get a detail visit); values are implausible (> 8 rooms, < 5 EUR/m² warm); or the text marks it as WG-Zimmer, Tausch, Zeitwohnen/short-term, Monteurwohnung, single-person only, or Senioren/WBS-only.

**Score** (0-100, `scraper/score.ts`) adds weighted parts: rooms 20, size 20, garden 11, balcony 7, bathtub 8, ground floor 12, price headroom 12 (full at one third below budget), preferred district 10. Each part adds a short German note (`3 Zi ✓, EG ✓, warm 1.050 €`) shown in the app and report. After changing the config (or with the `wohnung-kriterien` skill), `bun run rescore && bun run push` updates existing listings: rescore re-applies the filters (listings that no longer pass -> `gone`) and recomputes scores. Loosening criteria doesn't revive filtered or gone listings; the next search run finds them again.

`.env` (from `.env.example`, used by the scraper push and the local app): `WOHNUNG_URL`, `INGEST_TOKEN` (>= 32 chars), `PORT`, `HOST`, `DB_PATH`, `COOKIE_SECURE`, `TRUST_PROXY`. Without `WOHNUNG_URL` and `INGEST_TOKEN` the push step is skipped. Plain `http` is only allowed for `localhost`/`127.0.0.1`.

## Users

One account per person; a listing is a match once **every** user has liked it (so a third account changes matches). Commands that take a password show a hidden double prompt; run them yourself in a terminal (Claude Code: `! bun run user alex`), never through the agent. The `wohnung-users` skill walks you through it.

```sh
bun run users                   # id, name, created, #swipes, #active sessions
bun run user alex          # add (password >= 12 chars)
bun run passwd alex        # new password, logs the user out everywhere
bun run user-remove alex   # delete user + sessions + swipes, no confirmation
make remote-cli ARGS="user list"   # same CLI on the server: user add|list|passwd|remove <name>
```

## Deploy

To share the app with your partner, run the `wohnung-deploy` skill: it sets the app up on a Debian server with systemd and Caddy (TLS), creates the users and points the scraper's `.env` at it (`WOHNUNG_URL=https://wohnung.example.com`). The manual steps are in [ops/SETUP.md](ops/SETUP.md). `deploy.mk` (gitignored) holds `DEPLOY_HOST`, `DEPLOY_USER` (admin SSH user with sudo, or root) and `DOMAIN`. Afterwards: `make deploy` (build + upload, auto-restart), `make status`, `make logs`, `make backup` (download the daily DB snapshot into `backups/`), `make remote-cli ARGS="..."`. Day-2 tasks (restore, token rotation, disk/TLS checks) are in the `wohnung-server` skill.

## Repo layout

```
.agents/skills/        the skills above; wohnung-suche/portals/<portal>.md holds URLs, ids, extraction scripts
.claude/skills         symlink to .agents/skills (Claude Code)
AGENTS.md              instructions for coding agents (CLAUDE.md is a symlink)
config/                search.example.json (committed), search.json (yours, gitignored)
scraper/               candidates, ingest, normalize, detect, score, sweep, push, report, rescore (+ *.test.ts)
db/schema.sql          scraper DB schema
app/                   swipe app: Elysia server (src/), web client (src/web/client), tests (test/)
ops/                   systemd units, Caddyfile.example, wohnung-cli, SETUP.md
data/                  wohnungen.sqlite (scraper), wohnung.sqlite (local app), raw/ (extraction JSON), gitignored
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
- **Ingest says `Ort nicht im Suchgebiet` for everything from one portal**: the city/location field is missing from that portal's extraction (portal file pitfalls; `wohnung-portal-fix` repairs it).
- **App down / errors on the server**: `make status`, `make logs` (`wohnung-server` skill).
- **Push fails**: locally, `bun run dev` must be running and `WOHNUNG_URL`/`INGEST_TOKEN` in `.env` must match the app. Fix it, then `bun run push` (only push again) and `bun run report` (only rewrite the report).
- **Not sure what's missing**: `bun run doctor` checks dependencies, `.env`, config, portal ids, users, the app and `npx`, and prints the next step.
- **`bun` not found**: install it from https://bun.sh (or `nix develop` with the flake).
- **Windows**: everything except the server targets and the `wohnung-zeitplan` scheduler (macOS/Linux only; use Task Scheduler with `bun run scrape:headless` yourself) runs natively. The hidden password prompt of `bun run user` relies on `stty`; without it (plain cmd/PowerShell) the password is visible while typing, so use WSL if that matters.

## Fair use

Runs are sequential with pauses, capped at 3 result pages per portal and city and 80 detail pages per day; the agent never logs in, contacts landlords or submits forms. Keep it that way and respect each portal's terms of use.
