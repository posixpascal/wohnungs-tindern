---
name: wohnung-server
description: Day-2 operations for an existing wohnung-finden deployment (deploy.mk present, app already running) — status, logs, updating after code changes, backups and restore, rotating the INGEST_TOKEN, disk and TLS certificate checks. First-time server setup is wohnung-deploy. Use when the user says "server status", "läuft die app", "logs", "update deployen", "neue version hochladen", "backup", "backup einspielen", "restore", "token rotieren", "zertifikat", "festplatte voll", "server check" or runs /wohnung-server.
---

# Wohnung Server

Run from the repository root. Initial setup (server, Caddy, first deploy) is the
`wohnung-deploy` skill; this one is for an app that's already running.

Target values come from the gitignored `deploy.mk`: `DEPLOY_HOST`, `DEPLOY_USER` (admin SSH user
with sudo, or root — not the `wohnung` service user), `DOMAIN`, optional `SSH_PORT` (default 22).
Below, `<ssh>` = `ssh -p <SSH_PORT> <DEPLOY_USER>@<DEPLOY_HOST>`. If `deploy.mk` is missing,
point to `wohnung-deploy`.

**Rules:** read-only checks need no confirmation. Ask before every command that changes remote
state (deploy, restart, restore, token rotation, deleting files). Never print secrets: don't
`cat` `/etc/wohnung.env` or `.env`, don't echo tokens. Use `<ssh> -t` for anything with `sudo`
so a sudo password prompt works (as root without sudo installed, drop `sudo`).

## Status and logs

- `make status` — state of the `wohnung` service on the server.
- `make logs` — follows the journal (Ctrl-C to stop); for a one-off look:
  `<ssh> -t 'sudo journalctl -u wohnung -n 100 --no-pager'`.
- Reachability: `curl -fsS -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/` (200 expected).
- Backup timer: `<ssh> 'systemctl list-timers wohnung-backup.timer --no-pager'`.

## Update after code changes

Confirm, then `bun run test:app && make deploy` (add `bun run typecheck` after app changes). The upload
replaces the binary atomically and `wohnung-restart.path` restarts the service. Verify with
`make status` and the curl check.

## Backups

`make backup` downloads the latest nightly snapshot (`wohnung-backup.timer`, 03:30) into
`backups/wohnung-<timestamp>.sqlite`. Extra snapshot right now, kept on the server (before
risky changes): `make remote-cli ARGS="backup /var/lib/wohnung/manual-<timestamp>.sqlite"`
(always a new file name — `VACUUM INTO` refuses to overwrite).

## Restore a snapshot

All swipes and users since the snapshot are lost. Ask in German and wait for an explicit yes
naming the file, e.g. „Soll ich `backups/wohnung-20261107-033000.sqlite` einspielen? Alles seit
diesem Stand (Swipes, Benutzer) geht verloren.“ Then:
1. Safety copy of the current DB:
   `make remote-cli ARGS="backup /var/lib/wohnung/pre-restore-<timestamp>.sqlite"`
2. Upload without exposing it to other users: `chmod 600 backups/<file>` and
   `scp -p -P <SSH_PORT> backups/<file> <DEPLOY_USER>@<DEPLOY_HOST>:wohnung-restore.sqlite`
3. Stop, replace (stale WAL files must go, or SQLite replays them onto the snapshot), start:
   ```
   <ssh> -t 'sudo systemctl stop wohnung && sudo rm -f /var/lib/wohnung/wohnung.sqlite-wal /var/lib/wohnung/wohnung.sqlite-shm && sudo install -o wohnung -g wohnung -m 600 ~/wohnung-restore.sqlite /var/lib/wohnung/wohnung.sqlite && rm ~/wohnung-restore.sqlite && sudo systemctl start wohnung'
   ```
4. `make status`, `make remote-cli ARGS="user list"`. Listings missing from an old snapshot come
   back with the next search run's push; for an immediate full re-push see `wohnung-deploy`
   step 6 ("Simple").

## Rotate INGEST_TOKEN

Use when the token may have leaked. Confirm first. The new token is generated on the server and
copied into the local `.env` without ever being printed or read by you (add `-p <SSH_PORT>` if
not 22):
```
ssh -t <user>@<host> "sudo sh -c 'sed -i \"s/^INGEST_TOKEN=.*/INGEST_TOKEN=\$(openssl rand -hex 32)/\" /etc/wohnung.env'"
ssh -t <user>@<host> 'sudo systemctl restart wohnung'
sed -i.bak '/^INGEST_TOKEN=/d' .env && rm .env.bak && ssh <user>@<host> "sudo -n grep '^INGEST_TOKEN=' /etc/wohnung.env" >> .env
```
No `-t` on the copy line (with a TTY the sudo prompt and `\r` line endings would land in
`.env`), so it needs non-interactive sudo (`sudo -n true` succeeded in the preflight) or
`DEPLOY_USER` = `root` (then drop `sudo`). Otherwise hand the line to the human to run
themselves (Claude Code: `! <command>`) — never ask for their sudo password.
If the last ssh fails, `.env` has no token: fix the connection and re-run only the
`ssh … >> .env` part. Verify with `bun run push` (exit 0, no `401`). Every other machine that
pushes (e.g. a second laptop) needs the same `.env` update.

## Disk and certificate

- Disk: `<ssh> -t 'df -h / /var/lib/wohnung; sudo du -sh /var/lib/wohnung; journalctl --disk-usage'`.
  Above ~85 % used: suggest `sudo journalctl --vacuum-time=14d` (confirm first) and look for
  large files; never delete anything in `/var/lib/wohnung` without asking.
- TLS (Caddy renews automatically):
  `echo | openssl s_client -connect <DOMAIN>:443 -servername <DOMAIN> 2>/dev/null | openssl x509 -noout -enddate`.
  Less than 14 days left or an error → `<ssh> -t 'sudo journalctl -u caddy -n 50 --no-pager'`
  (common causes: DNS no longer points at the server, port 80/443 blocked).

## Summary (German, short)

Was geprüft/geändert wurde, Ergebnis (läuft / Fehler mit der relevanten Logzeile, ohne
Secrets), und ob noch etwas zu tun ist.
