# Server setup (one-time)

Assumes a Debian 13 host with systemd and Caddy 2.6 as the TLS-terminating
reverse proxy. A NixOS snippet is at the bottom.

Two different users are involved, deliberately not the same one:

- **`DEPLOY_USER`** — an existing admin SSH account with `sudo` (or `root`
  itself), e.g. your own login. `make deploy`, `make backup`, `make status`,
  `make logs` and `make remote-cli` all SSH in as this user. It needs a real
  home directory and shell, because `make deploy` uploads the binary over
  `sftp` as this user.
- **`wohnung`** — a static, `nologin` service account that only ever runs
  the app. Nothing logs into it directly (that's also why a plain `sftp` as
  `wohnung`, as earlier versions of this doc had it, does not work: `sftp`'s
  server side needs a usable login shell).

## 1. Create the service user and the deploy directory

On the server; replace `$DEPLOY_USER` with the actual account name (or set
it first: `DEPLOY_USER=alex`). As `root` without `sudo` installed, drop the
`sudo` prefixes here and below.

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin wohnung
sudo mkdir -p /opt/wohnung
sudo chown "$DEPLOY_USER":"$DEPLOY_USER" /opt/wohnung
sudo chmod 755 /opt/wohnung
```

`/opt/wohnung` is owned by `DEPLOY_USER` (mode `755`) so `make deploy` can
`sftp` the binary in directly, without touching `wohnung` at all. The
service only needs to read and execute the binary, which `755`
(`rwxr-xr-x`) already grants to every other user, including `wohnung`.

`/var/lib/wohnung` (the DB and backup directory) is created automatically by
systemd's `StateDirectory=wohnung` on `wohnung.service` and
`wohnung-backup.service`, owned by `wohnung:wohnung` — `DEPLOY_USER` has no
access to it directly, see "Backups" below.

## 2. Environment file

```sh
sudo cp .env.example /etc/wohnung.env
sudo sh -c 'sed -i "s/^INGEST_TOKEN=.*/INGEST_TOKEN=$(openssl rand -hex 32)/" /etc/wohnung.env'
sudo "$EDITOR" /etc/wohnung.env   # set COOKIE_SECURE=true, TRUST_PROXY=true, HOST=127.0.0.1, DB_PATH=/var/lib/wohnung/wohnung.sqlite
sudo chown root:wohnung /etc/wohnung.env
sudo chmod 640 /etc/wohnung.env
```

The token is generated inside `sudo sh -c '…'` so it is never part of the
command line `sudo` logs to the journal/auth log.

## 3. Install the systemd units

```sh
sudo cp ops/systemd/wohnung.service /etc/systemd/system/
sudo cp ops/systemd/wohnung-restart.path /etc/systemd/system/
sudo cp ops/systemd/wohnung-restart.service /etc/systemd/system/
sudo cp ops/systemd/wohnung-backup.service /etc/systemd/system/
sudo cp ops/systemd/wohnung-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable wohnung.service   # the first deploy starts it (section 5)
sudo systemctl enable --now wohnung-restart.path
sudo systemctl enable --now wohnung-backup.timer
```

`wohnung-restart.path` watches `/opt/wohnung/wohnung` and restarts
`wohnung.service` on change — no SSH session needed for restarts after the
first deploy. `wohnung-backup.timer` runs a daily `VACUUM INTO` snapshot to
`/var/lib/wohnung/backup.sqlite` (03:30).

## 4. The CLI wrapper

```sh
sudo cp ops/wohnung-cli /usr/local/bin/wohnung-cli
sudo chmod 755 /usr/local/bin/wohnung-cli
```

`wohnung-cli` runs the binary as the `wohnung` user/group with
`/etc/wohnung.env` via a transient `systemd-run` unit (it does not source the
env file as shell — that file uses systemd's `KEY=value` syntax, not shell
syntax).

## 5. First deploy

From your workstation (not the server), put `DEPLOY_HOST` and `DEPLOY_USER`
in a gitignored `deploy.mk` (`DEPLOY_HOST := your.server.ip`, `DEPLOY_USER :=
alex`) or pass them inline:

```sh
make deploy DEPLOY_HOST=your.server.ip DEPLOY_USER=alex
```

This builds the binary, uploads it over sftp **as `DEPLOY_USER`**, `chmod
755`s it, then atomically renames it into place; `wohnung-restart.path`
notices and (re)starts the service (running as `wohnung`), on this first
deploy and every later one. No sudo needed for this step — `DEPLOY_USER`
already owns `/opt/wohnung`.

## 6. Create the first users

From your workstation:

```sh
make remote-cli ARGS="user add alex"
make remote-cli ARGS="user add sam"
```

This runs `ssh -t $(DEPLOY_USER)@$(DEPLOY_HOST) 'sudo wohnung-cli $(ARGS)'`
(without `sudo` when `DEPLOY_USER` is `root`) — the
`-t` allocates a real terminal, so `wohnung-cli` detects it and prompts for
the password itself, hidden, twice ("Passwort:" / "Wiederholen:"); `sudo`'s
own password prompt (if your `sudo` isn't `NOPASSWD`) works through the same
TTY. Passwords must be at least 12 characters.

## 7. Caddy (reverse proxy + automatic TLS)

```sh
sudo cp ops/Caddyfile.example /etc/caddy/Caddyfile
sudo "$EDITOR" /etc/caddy/Caddyfile   # confirm the domain (wohnung.example.com)
sudo systemctl reload caddy
```

The example forwards the real client IP via `X-Forwarded-For`, which the app
only trusts when `TRUST_PROXY=true` is set in `/etc/wohnung.env`.

## 8. Backups, status, logs, and the remote CLI

```sh
make backup                        # download the latest daily snapshot into ./backups/
make status                        # systemctl is-active + last 20 journal lines (+ HTTP check if DOMAIN is set)
make logs                          # journalctl -u wohnung -f
make remote-cli ARGS="user list"   # any wohnung-cli subcommand
```

(`DEPLOY_HOST`/`DEPLOY_USER` as before, from `deploy.mk` or inline.)

`make backup`'s snapshot (`/var/lib/wohnung/backup.sqlite`, written daily by
`wohnung-backup.timer`) is `0600 wohnung:wohnung` — `DEPLOY_USER` cannot sftp
it directly. `make backup` instead runs `ssh -t ... sudo install -m 0600 -o
$(DEPLOY_USER) /var/lib/wohnung/backup.sqlite wohnung-backup.sqlite` (a
privileged copy-with-new-ownership into `DEPLOY_USER`'s home, prompting for
the `sudo` password if needed), then fetches that copy over `sftp` as
`DEPLOY_USER` and removes the temporary file. If you back up often enough
that the interactive `sudo` prompt gets old, add a narrowly scoped
`NOPASSWD` sudoers rule for exactly that `install` invocation.

`make status` and `make logs` read the systemd journal, which usually also
needs `sudo` unless `DEPLOY_USER` is in the `systemd-journal` group — both
targets use `ssh -t` so that prompt works too. With `DEPLOY_USER := root`
every remote target drops `sudo` automatically.

---

## NixOS snippet

The service user/group and systemd unit below are unaffected by sections
1–8, which are Debian-specific (`useradd`, `apt`, raw systemd unit files). If
you still deploy the binary with `make deploy` against a NixOS host (rather
than building it into the system closure), apply the same `/opt/wohnung`
ownership from section 1: owned by `DEPLOY_USER`, mode `755`, so the
`wohnung` user below can read and execute it without being its owner.

```nix
{
  users.users.wohnung = {
    isSystemUser = true;
    group = "wohnung";
    home = "/var/lib/wohnung";
    createHome = false;
  };
  users.groups.wohnung = {};

  systemd.services.wohnung = {
    description = "wohnung-finden server";
    after = [ "network.target" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      User = "wohnung";
      Group = "wohnung";
      StateDirectory = "wohnung";
      StateDirectoryMode = "0700";
      WorkingDirectory = "/opt/wohnung";
      ExecStart = "/opt/wohnung/wohnung serve";
      EnvironmentFile = "/etc/wohnung.env";
      Restart = "on-failure";
      RestartSec = 2;

      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      PrivateDevices = true;
      ProtectKernelTunables = true;
      ProtectKernelModules = true;
      ProtectControlGroups = true;
      RestrictSUIDSGID = true;
      RestrictRealtime = true;
      RestrictNamespaces = true;
      LockPersonality = true;
      # Not MemoryDenyWriteExecute: Bun/JSC's JIT needs W+X memory pages.
      SystemCallArchitectures = "native";
      SystemCallFilter = [ "@system-service" ];
      SystemCallErrorNumber = "EPERM";
      RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
      ProtectClock = true;
      ProtectHostname = true;
      ProtectKernelLogs = true;
      ProtectProc = "invisible";
      ProcSubset = "pid";
      RemoveIPC = true;
      UMask = "0077";
      MemoryMax = "512M";
      TasksMax = 64;
      CapabilityBoundingSet = "";
      AmbientCapabilities = "";
    };
  };

  systemd.paths.wohnung-restart = {
    pathConfig.PathChanged = "/opt/wohnung/wohnung";
    unitConfig.Unit = "wohnung-restart.service";
    wantedBy = [ "multi-user.target" ];
  };

  systemd.services.wohnung-restart = {
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "/run/current-system/sw/bin/systemctl restart wohnung.service";
    };
  };

  services.caddy = {
    enable = true;
    virtualHosts."wohnung.example.com".extraConfig = ''
      reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-For {remote_host}
      }
      request_body {
        max_size 8MB
      }
    '';
  };
}
```
