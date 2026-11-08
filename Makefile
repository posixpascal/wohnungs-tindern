# Server operations over SSH (needs make + ssh: macOS, Linux or WSL).
# Local tasks are Bun scripts that run on every platform: see package.json (bun run <script>).

.DEFAULT_GOAL := help

BUN ?= bun
DIST_BIN := dist/wohnung

# DEPLOY_USER is an admin SSH account with sudo (or root) - not the "wohnung"
# service user, which is never logged into directly. See ops/SETUP.md.
DEPLOY_HOST ?=
DEPLOY_USER ?=
DEPLOY_PATH ?= /opt/wohnung
SSH_PORT ?= 22
REMOTE_SNAPSHOT_PATH ?= /var/lib/wohnung/backup.sqlite
BACKUP_DIR ?= backups
# Optional: enables an HTTP check in `make status`.
DOMAIN ?=

# Optional local overrides (gitignored), e.g. DEPLOY_HOST := 1.2.3.4
-include deploy.mk

# Remote commands run via sudo, except as root (minimal images often lack sudo).
# Recursive (=) on purpose: evaluated after deploy.mk / command-line values.
REMOTE_SUDO = $(if $(filter root,$(DEPLOY_USER)),,sudo)
SSH = ssh -t -p $(SSH_PORT) $(DEPLOY_USER)@$(DEPLOY_HOST)

.PHONY: help build deploy backup status logs remote-cli check-deploy-host check-deploy-user

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the single-file binary (dist/wohnung, linux-x64)
	$(BUN) run build

check-deploy-host:
	@test -n "$(DEPLOY_HOST)" || { \
		echo "DEPLOY_HOST is not set. Pass it on the command line (make deploy DEPLOY_HOST=1.2.3.4)" >&2; \
		echo "or create a gitignored deploy.mk with: DEPLOY_HOST := 1.2.3.4" >&2; \
		exit 1; \
	}

check-deploy-user:
	@test -n "$(DEPLOY_USER)" || { \
		echo "DEPLOY_USER is not set. It is an admin SSH user with sudo (or root), see ops/SETUP.md." >&2; \
		echo "Pass it on the command line (make deploy DEPLOY_USER=alex) or put it in deploy.mk: DEPLOY_USER := alex" >&2; \
		exit 1; \
	}

deploy: check-deploy-host check-deploy-user build ## Build and upload the binary via sftp as DEPLOY_USER, then atomically replace it
	printf 'put %s %s/wohnung.new\nchmod 755 %s/wohnung.new\nrename %s/wohnung.new %s/wohnung\n' \
		"$(DIST_BIN)" "$(DEPLOY_PATH)" "$(DEPLOY_PATH)" "$(DEPLOY_PATH)" "$(DEPLOY_PATH)" \
		| sftp -b - -P $(SSH_PORT) $(DEPLOY_USER)@$(DEPLOY_HOST)
	@echo "Uploaded. wohnung-restart.path watches the binary and restarts the service automatically (no SSH needed)."

backup: check-deploy-host check-deploy-user ## Download the latest daily DB snapshot (wohnung-backup.timer, 03:30) into backups/
	@mkdir -p $(BACKUP_DIR)
	$(SSH) '$(REMOTE_SUDO) install -m 0600 -o $(DEPLOY_USER) $(REMOTE_SNAPSHOT_PATH) wohnung-backup.sqlite'
	printf 'get wohnung-backup.sqlite %s/wohnung-%s.sqlite\nrm wohnung-backup.sqlite\n' \
		"$(BACKUP_DIR)" "$$(date +%Y%m%d-%H%M%S)" \
		| sftp -b - -P $(SSH_PORT) $(DEPLOY_USER)@$(DEPLOY_HOST)

status: check-deploy-host check-deploy-user ## Service status, last 20 log lines, and an HTTP check if DOMAIN is set
	$(SSH) 'systemctl is-active wohnung; $(REMOTE_SUDO) journalctl -u wohnung -n 20 --no-pager'
	@if [ -n "$(DOMAIN)" ]; then \
		printf 'HTTP https://%s/: ' "$(DOMAIN)"; \
		curl -fsS -o /dev/null -w '%{http_code}\n' "https://$(DOMAIN)/" || true; \
	fi

logs: check-deploy-host check-deploy-user ## Tail server logs over SSH (Ctrl-C to stop)
	$(SSH) '$(REMOTE_SUDO) journalctl -u wohnung -f'

remote-cli: check-deploy-host check-deploy-user ## Run the app CLI on the server: make remote-cli ARGS="user list"
	@test -n "$(ARGS)" || { echo 'Usage: make remote-cli ARGS="user list"' >&2; exit 1; }
	$(SSH) '$(REMOTE_SUDO) wohnung-cli $(ARGS)'
