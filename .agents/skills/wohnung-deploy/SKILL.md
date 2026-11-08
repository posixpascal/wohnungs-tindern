---
name: wohnung-deploy
description: First-time deployment — puts the local wohnung-finden app online on a server that doesn't run it yet: one-time Debian/Ubuntu systemd setup (or a pointer for NixOS), Caddy with your domain, first binary upload, and switching the local scraper to push to production. Use when there is no deployment yet (no deploy.mk) and the user says "deploy", "online stellen", "server einrichten", "neuer server", "wohnung deploy", "live schalten" or runs /wohnung-deploy. For an app that's already running (updates, status, logs, backups) use wohnung-server.
---

# Wohnung Deploy

Full reference: `ops/SETUP.md`. This skill drives those steps interactively instead of
duplicating them — read it for the exact commands and reconcile with what's below if the repo
has moved on since this was written.

**This is the user's server.** Confirm with them before any command that changes remote state
(installing packages, writing files, restarting services, firewall rules). Preflight checks and
local-only commands don't need confirmation.

## 1. Gather target info

Ask for:
- Server host/IP and `DEPLOY_USER`: an **existing admin SSH account with `sudo`** (or `root`
  itself) — NOT `wohnung`, which is a pure `nologin` service account created in step 3 and never
  logged into. Usually the user's own login.
- Domain name — check DNS actually points at the server: `dig +short <domain>` (A) and
  `dig +short <domain> AAAA` if they use IPv6
- OS: Debian/Ubuntu with systemd (this skill handles it) or NixOS (point them at the NixOS
  snippet at the bottom of `ops/SETUP.md` and offer to adapt it, but don't attempt a generic
  Nix deploy here — out of scope)

## 2. Preflight

`ssh -o BatchMode=yes -o ConnectTimeout=5 <user>@<host> true` to confirm key-based access works
before anything else. Then `ssh <user>@<host> sudo -n true`: if it succeeds, `sudo` is
passwordless for this user; if it fails, just tell the user that later steps using `sudo`
(server setup, `make backup`, `make status`, `make logs`, `make remote-cli`) will prompt them
for their password interactively over SSH — that's expected, not an error.

Write `deploy.mk` (gitignored, read by the `Makefile` via `-include`) with:
```makefile
DEPLOY_HOST := <host>
DEPLOY_USER := <user>
DOMAIN := <domain>
```
`DOMAIN` is optional (only used for the HTTP check in `make status`), but cheap to set now.

## 3. One-time server setup (confirm each step with the user)

Follow `ops/SETUP.md` sections 1–4 and 7:
1. The `wohnung` service user, and `/opt/wohnung` owned by `DEPLOY_USER` mode `755` — not
   `wohnung:wohnung` (section 1; that model doesn't work, `sftp` needs a real login shell)
2. `/etc/wohnung.env` (section 2) — copy `.env.example`, then set production values:
   `TRUST_PROXY=true`, `COOKIE_SECURE=true`, `HOST=127.0.0.1`,
   `DB_PATH=/var/lib/wohnung/wohnung.sqlite`, `PORT=3000`, and a **new**
   `INGEST_TOKEN` generated on the server so it's never transmitted, printed or written to
   sudo's command log (`$(…)` expands inside `sh -c`, not on the sudo command line):
   `ssh -t <user>@<host> "sudo sh -c 'sed -i \"s/^INGEST_TOKEN=.*/INGEST_TOKEN=\$(openssl rand -hex 32)/\" /etc/wohnung.env'"`.
   Then `chown root:wohnung` + `chmod 640`.
3. systemd units, `wohnung-restart.path`, `wohnung-backup.timer` (section 3; the service is
   only enabled here, the first deploy starts it)
4. `ops/wohnung-cli` → `/usr/local/bin/wohnung-cli` (section 4)
5. Caddy (section 7): copy `ops/Caddyfile.example` to `/etc/caddy/Caddyfile` on the server,
   replace the domain placeholder with the real domain, `systemctl reload caddy`. If Caddy isn't
   installed, ask before adding the official apt repo and installing it.

Ask before any `ufw`/firewall change; only 22/80/443 should need to be open.

## 4. First deploy

If the user has been swiping locally and wants to keep it, do the DB copy from step 6
("Preserves swipes") **before** this step: the first upload starts the service, which creates
an empty DB.

From the workstation: `make deploy DEPLOY_HOST=<host> DEPLOY_USER=<user>` (builds the
linux-x64 binary and uploads it via sftp **as `DEPLOY_USER`**, no `sudo` needed since
`DEPLOY_USER` owns `/opt/wohnung`; `wohnung-restart.path` on the server (re)starts the service,
which runs as `wohnung` — no SSH needed for this part).

Verify: `make status DEPLOY_HOST=<host> DEPLOY_USER=<user>` and `curl -fsS https://<domain>/`.

## 5. First users on the server

Same rule as local setup — you must not see passwords. Tell the user to run this themselves:
```
make remote-cli ARGS="user add alex"
```
This runs `ssh -t <user>@<host> 'sudo wohnung-cli user add alex'`; the allocated terminal lets
`wohnung-cli` prompt for the password itself, hidden, twice. ≥12 characters. Details and the
other user commands: `wohnung-users` skill.

## 6. Point the local scraper at production

Update the local `.env` without reading or printing it: point `WOHNUNG_URL` at the domain and
replace `INGEST_TOKEN` with the server's token (delete, then append straight from the server):
```
sed -i.bak 's|^WOHNUNG_URL=.*|WOHNUNG_URL=https://<domain>|' .env && rm .env.bak
sed -i.bak '/^INGEST_TOKEN=/d' .env && rm .env.bak && ssh <user>@<host> "sudo -n grep '^INGEST_TOKEN=' /etc/wohnung.env" >> .env
```
No `-t` on the copy line (with a TTY the sudo prompt and `\r` line endings would land in
`.env`), so it needs non-interactive sudo (`sudo -n true` succeeded in the preflight) or
`DEPLOY_USER` = `root` (then drop `sudo`). Otherwise hand the line to the human to run
themselves (Claude Code: `! <command>`) — never ask for their sudo password.
If the ssh fails, `.env` has no token: fix it and re-run only the `ssh … >> .env` part.

Then decide how to get existing listings onto the fresh server — two options, pick based on
whether local swipe progress matters:

- **Simple, loses local swipe state**: `scraper/push.ts` only pushes listings where
  `synced_at IS NULL OR synced_at < last_seen_at` — a fresh server needs everything, so force a
  full re-push:
  ```
  sqlite3 data/wohnungen.sqlite "UPDATE listings SET synced_at = NULL"
  bun run push
  ```
  The production app's own database (`/var/lib/wohnung/wohnung.sqlite`, separate from the
  scraper's `data/wohnungen.sqlite`) starts empty, so every listing arrives unswiped — any
  swiping already done in the local app (`data/wohnung.sqlite`) is **not** carried over by push
  (it only ever sends listing data, not swipe state).
- **Preserves swipes** (done before the first deploy in step 4): copy the local
  app's own database over instead. Stop the local app, take a clean snapshot
  (`cd app && bun --env-file=../.env src/index.ts backup ../data/local-snapshot.sqlite` —
  uses `VACUUM INTO`, safe even with WAL). `wohnung` is `nologin`, so `scp` it to `DEPLOY_USER`'s
  home or `/tmp` first, then move it into place with the right ownership:
  `scp local-snapshot.sqlite <user>@<host>:/tmp/` then
  `ssh -t <user>@<host> 'sudo install -D -m 0600 -o wohnung -g wohnung /tmp/local-snapshot.sqlite /var/lib/wohnung/wohnung.sqlite && rm /tmp/local-snapshot.sqlite'`.
  Don't also do the `synced_at` reset/full push in this case — the data's already there.

Ask the user which they want; default to the second if they've already been swiping locally.

## 7. Ongoing

- Updates: `make deploy` again (same command, idempotent).
- Status: `make status` — service state, last 20 log lines, and (with `DOMAIN` set) an HTTP
  check.
- Logs: `make logs` tails `journalctl -u wohnung -f` over SSH.
- Backups: `make backup` downloads the latest `wohnung-backup.timer` snapshot into
  `./backups/`.
- Any other CLI command on the server: `make remote-cli ARGS="user list"`.
- Day-2 operations beyond this (restore, `INGEST_TOKEN` rotation, disk/TLS checks) are the
  `wohnung-server` skill's job, not this one.
