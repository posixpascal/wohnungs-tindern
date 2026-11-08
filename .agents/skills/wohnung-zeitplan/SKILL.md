---
name: wohnung-zeitplan
description: Schedules the daily unattended search (bun run scrape:headless) — macOS launchd LaunchAgent or Linux systemd user timer / cron — and shows how to test, check and remove it. Use when the user says "zeitplan", "täglich automatisch suchen", "cronjob", "automatisieren", "jeden morgen suchen", "zeitplan entfernen", "schedule", "daily run", "launchd", "cron" or runs /wohnung-zeitplan.
---

# Wohnung Zeitplan

Run from the repository root. The job runs `bun run scrape:headless` (the `wohnung-suche` skill in
headless mode via `SCRAPE_HEADLESS_CMD`; for Codex or another agent set the override in `.env`,
see docs/reference.md "Daily use"). Headless runs never wait: a portal showing a
captcha is skipped for the day and named in the report.

## 1. Preconditions (check, explain in German)

- **Permissions**: unattended runs can't answer permission prompts. Claude Code: the committed
  `.claude/settings.json` already allows the `playwright` server from `.mcp.json` and
  `bun scraper/*` (see docs/reference.md "Headless runs: permissions"); if the user's Playwright server has
  another name, they add it to `.claude/settings.local.json`. Codex: `--full-auto` + network
  access for the push. Without it the job hangs or does nothing.
- **Push target**: the run pushes to `WOHNUNG_URL` from `.env`. With the local default the app
  must be running at that time. Recommend the Docker app (`bun run docker:up`): it restarts with
  Docker, so no terminal has to stay open (on macOS, Docker Desktop must run at that time:
  Settings → "Start Docker Desktop when you sign in"); `bun run dev` works too. Otherwise point `.env` at the
  deployed server (`wohnung-deploy`). A failed push isn't lost — the next `bun run push` or run sends it.
- **Desktop session**: the browser is headed, so the user must be logged in (screen lock is
  fine). On macOS the Mac must be awake; launchd runs a missed job after wake, but not while
  shut down. Optional wake timer the user sets themselves (needs sudo):
  `sudo pmset repeat wakeorpoweron MTWRFSU 07:25:00`.
- **Tools on PATH**: the scheduler starts with a minimal PATH. Collect the directories of
  `command -v bun npx claude` (or `codex`) — below, `TOOL_DIRS` = those directories joined
  with `:`, and `/ABS/PATH/TO/bun` = the `bun` result.

## 2. Ask

Ask for the time (default 07:30, daily). Then show the exact file content and path you're
about to write and ask for confirmation — it lives outside the repo. Ask again before loading
or enabling it (`launchctl bootstrap`, `systemctl --user enable`, `crontab`). Logs go to
`data/logs/scrape.log` (gitignored); the scheduler doesn't create directories, so run
`mkdir -p data/logs` first.

## 3a. macOS: LaunchAgent

Write `~/Library/LaunchAgents/de.wohnung-finden.scrape.plist` (absolute paths, no `~`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>de.wohnung-finden.scrape</string>
  <key>WorkingDirectory</key><string>/ABS/PATH/TO/REPO</string>
  <key>ProgramArguments</key><array><string>/ABS/PATH/TO/bun</string><string>run</string><string>scrape:headless</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>TOOL_DIRS:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>/ABS/PATH/TO/REPO/data/logs/scrape.log</string>
  <key>StandardErrorPath</key><string>/ABS/PATH/TO/REPO/data/logs/scrape.log</string>
</dict></plist>
```
Check `plutil -lint <plist>`, then load: `launchctl bootstrap gui/$(id -u) <plist>`
(already loaded → `launchctl bootout gui/$(id -u)/de.wohnung-finden.scrape` first).

- Test once now: `launchctl kickstart -k gui/$(id -u)/de.wohnung-finden.scrape`, then follow
  `data/logs/scrape.log` and check `reports/<date>.md`.
- Status: `launchctl print gui/$(id -u)/de.wohnung-finden.scrape | grep -E 'state|last exit'`
- Remove: `launchctl bootout gui/$(id -u)/de.wohnung-finden.scrape` and delete the plist.

## 3b. Linux: systemd user timer (preferred) or cron

`~/.config/systemd/user/wohnung-scrape.service`:
```ini
[Unit]
Description=wohnung-finden daily search

[Service]
Type=oneshot
WorkingDirectory=/ABS/PATH/TO/REPO
Environment=PATH=TOOL_DIRS:/usr/local/bin:/usr/bin:/bin
ExecStart=/ABS/PATH/TO/bun run scrape:headless
StandardOutput=append:/ABS/PATH/TO/REPO/data/logs/scrape.log
StandardError=append:/ABS/PATH/TO/REPO/data/logs/scrape.log
```
`~/.config/systemd/user/wohnung-scrape.timer`:
```ini
[Timer]
OnCalendar=*-*-* 07:30
Persistent=true

[Install]
WantedBy=timers.target
```
The headed browser needs the session's display: `systemctl --user import-environment DISPLAY
WAYLAND_DISPLAY XAUTHORITY` (or set them via `Environment=`). Then
`systemctl --user daemon-reload && systemctl --user enable --now wohnung-scrape.timer`.
Test: `systemctl --user start wohnung-scrape.service`; status: `systemctl --user list-timers
wohnung-scrape.timer`; remove: `systemctl --user disable --now wohnung-scrape.timer` and delete
both files.

Cron alternative (`crontab -e`, show the line, user confirms):
`30 7 * * * cd /ABS/PATH/TO/REPO && PATH=TOOL_DIRS:/usr/bin:/bin DISPLAY=:0 /ABS/PATH/TO/bun run scrape:headless >> data/logs/scrape.log 2>&1`

## 4. Summary (German, short)

Uhrzeit, Datei/Unit, Log-Pfad, Ergebnis des Testlaufs, wie man es wieder entfernt, und offene
Voraussetzungen (Berechtigungen, App/Server erreichbar, Mac wach).
