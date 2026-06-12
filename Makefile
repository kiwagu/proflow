SHELL := /bin/bash

SUPABASE ?= supabase
SUPABASE_CMD ?= $(shell if command -v $(SUPABASE) >/dev/null 2>&1; then echo "$(SUPABASE)"; elif command -v bunx >/dev/null 2>&1; then echo "bunx supabase"; fi)
# Supabase CLI >= ~2.9x reads ~/.supabase/profile for an access token on startup and aborts
# (NotFound / LegacyPlatformAuthRequiredError) when it is missing — even for self-hosted
# --db-url / --local commands that never call the platform. Any non-empty token satisfies the
# guard; the DB connection uses --db-url, not this token. Real `supabase login` token (or a CI
# secret) is honored when present in the environment (?= keeps it); placeholder unblocks local.
SUPABASE_ACCESS_TOKEN ?= sbp_local_selfhosted_unused
export SUPABASE_ACCESS_TOKEN
SUPABASE_STACK_DIR ?= infra/dev/supabase
COMPOSE_PROJECT_NAME ?= proflow
PROJECT_REF ?=
NAME ?=
# Self-hosted Postgres: POSTGRES_DIRECT_PORT -> postgres@loopback (Supabase CLI runs migration SQL as postgres after SET SESSION ROLE). Pooler: postgres.<POOLER_TENANT_ID>.
# db-push: docker exec as supabase_admin fixes public.profiles owner when SUPABASE_DB_CONTAINER is running (CLI cannot ALTER objects owned by supabase_admin).
SUPABASE_DB_CONTAINER ?= supabase-db
SELF_HOSTED_DB_HOST ?= 127.0.0.1
# Optional full URL (password must be percent-encoded). When set, overrides host/port/user from .env.
SELF_HOSTED_DB_URL ?=
# Local self-hosted pooler is plain TCP; Supabase CLI often ignores ?sslmode= in --db-url, so we set PGSSLMODE for the child process.
SELF_HOSTED_DB_SSLMODE ?= disable
# Repository root (Makefile lives at repo root)
PROFLOW_ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
URLENCODE_STDIN := $(PROFLOW_ROOT)/scripts/urlencode-stdin.py
# Must match infra/dev/supabase/docker-compose.yml → functions → IDENTITY_INTERNAL_INGEST_SECRET (Postgres triggers use DB copy via db-sync-identity-secret).
DEV_IDENTITY_INTERNAL_INGEST_SECRET ?= dev_proflow_identity_internal_ingest

.PHONY: help supabase-check docker-check stack-help stack-up stack-recreate stack-recreate-clean dev-nginx-ssl db-status mcp-test db-diff db-new db-link db-push db-types db-push-refresh-types db-pull db-push-cloud db-diff-linked db-pull-cloud db-sync-identity-secret

help:
	@echo "ProFlow DB tasks (Supabase CLI)"
	@echo ""
	@echo "Usage:"
	@echo "  make <target> [NAME=...] [PROJECT_REF=...] [SELF_HOSTED_DB_HOST=...] [SELF_HOSTED_DB_URL=...] [SELF_HOSTED_DB_SSLMODE=...] [SUPABASE_DB_CONTAINER=...]"
	@echo ""
	@echo "Targets:"
	@echo "  supabase-check   Check local Supabase CLI availability"
	@echo "  docker-check     Check Docker and Compose availability"
	@echo "  stack-help       Print direct docker compose commands"
	@echo "  stack-up         Upsert Mongo + Maildev + Nginx + Supabase services"
	@echo "  dev-nginx-ssl    Generate self-signed TLS for infra/dev nginx (proflow.local + api.proflow.local)"
	@echo "  stack-recreate        Recreate Mongo + Maildev + Nginx + Supabase (FORCE_CLEAN=1 for deep clean)"
	@echo "  stack-recreate-clean  Same as: make stack-recreate FORCE_CLEAN=1 (do not pass --force-clean to make)"
	@echo "                        After force-clean: waits for DB, then make db-push (SKIP_STACK_DB_PUSH=1 to skip)"
	@echo "                        RECREATE_YES=1 skips the Proceed? prompt (non-interactive)"
	@echo "  mcp-test         Test local Supabase MCP initialize endpoint"
	@echo "  db-status        Show infra/dev/supabase services status"
	@echo "  db-diff          Diff migrations vs self-hosted Postgres (SUPABASE_STACK_DIR/.env); CLI uses shadow DB (see supabase/config.toml [db].shadow_port if bind fails)"
	@echo "  db-diff-linked   Diff vs Supabase Cloud project (requires supabase link)"
	@echo "  db-new           Create migration file (requires NAME)"
	@echo "  db-link          Link CLI to Supabase Cloud (requires PROJECT_REF, 20-char ref)"
	@echo "  db-push          Push migrations to self-hosted Postgres; then db-sync-identity-secret"
	@echo "  db-types         Generate packages/db/src/database.types.ts from self-hosted Postgres"
	@echo "  db-push-refresh-types  Run db-push, then regenerate packages/db/src/database.types.ts"
	@echo "  db-push-cloud    Push migrations to linked Supabase Cloud project"
	@echo "  db-pull          Pull schema from self-hosted Postgres into a migration"
	@echo "  db-pull-cloud    Pull schema from linked Supabase Cloud project"
	@echo "  db-sync-identity-secret  Set identity_sync.outbound_config.internal_secret to DEV_IDENTITY_INTERNAL_INGEST_SECRET (matches compose; runs after db-push)"
	@echo ""
	@echo "Self-hosted db-push/db-diff/db-pull: POSTGRES_DIRECT_PORT (e.g. 54322) -> postgres on loopback; db-push pre-fixes public.profiles owner via docker (SUPABASE_DB_CONTAINER)."
	@echo "  SELF_HOSTED_DB_URL overrides both. See infra/dev/supabase/.env.example."
	@echo "  SELF_HOSTED_DB_SSLMODE=disable by default; exported as PGSSLMODE for CLI (required — sslmode in URL alone is not always honored)."
	@echo ""
	@echo "Examples:"
	@echo "  make stack-help"
	@echo "  make stack-up"
	@echo "  make stack-up FROM_SCRATCH=1"
	@echo "  make stack-up FORCE_RECREATE=1"
	@echo "  make stack-up COMPOSE_PROJECT_NAME=proflow"
	@echo "  make stack-recreate"
	@echo "  make stack-recreate FORCE_CLEAN=1"
	@echo "  make stack-recreate-clean RECREATE_YES=1   # non-interactive; auto db-push unless SKIP_STACK_DB_PUSH=1"
	@echo "  make stack-recreate COMPOSE_PROJECT_NAME=proflow"
	@echo "  make stack-recreate SUPABASE_DEV_SERVICES='studio kong auth rest realtime storage imgproxy meta functions analytics db vector supavisor'"
	@echo "  make db-status"
	@echo "  make mcp-test"
	@echo "  make db-new NAME=create_lms_assignments"
	@echo "  make db-push"
	@echo "  make db-push SELF_HOSTED_DB_URL='postgresql://postgres.TENANT:ENCODED@127.0.0.1:5432/postgres'  # TENANT = POOLER_TENANT_ID"
	@echo "  make db-link PROJECT_REF=abcdefghijklmnopqrst"
	@echo "  make db-push-cloud   # after link"

supabase-check:
	@[ -n "$(SUPABASE_CMD)" ] || { \
		echo "Supabase CLI not found (neither binary nor bunx fallback)."; \
		echo "Install: https://supabase.com/docs/guides/cli"; \
		echo "macOS: brew install supabase/tap/supabase"; \
		echo "Linux: see install script in docs, or install Bun for bunx fallback."; \
		exit 1; \
	}
	@echo "Using: $(SUPABASE_CMD)"
	@$(SUPABASE_CMD) --version

docker-check:
	@command -v docker >/dev/null 2>&1 || { \
		echo "Docker is not installed or not in PATH."; \
		exit 1; \
	}
	@docker compose version >/dev/null 2>&1 || { \
		echo "Docker Compose plugin is unavailable."; \
		exit 1; \
	}
	@[ -f "$(SUPABASE_STACK_DIR)/docker-compose.yml" ] || { \
		echo "Missing $(SUPABASE_STACK_DIR)/docker-compose.yml"; \
		exit 1; \
	}

stack-help: docker-check
	@echo "Run stack commands directly:"
	@echo "  cd $(SUPABASE_STACK_DIR)"
	@echo "  docker compose up -d"
	@echo "  docker compose down"
	@echo "  ./reset.sh"
	@echo ""
	@echo "No stack-mutating shortcuts are provided in Makefile on purpose."

stack-up: docker-check
	@COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME) SUPABASE_DEV_SERVICES="$(SUPABASE_DEV_SERVICES)" ./infra/dev/stack-up.sh $(if $(FROM_SCRATCH),--from-scratch,) $(if $(FORCE_RECREATE),--force-recreate,)

dev-nginx-ssl:
	@bash ./infra/dev/nginx/generate-ssl.sh

stack-recreate: docker-check
	@COMPOSE_PROJECT_NAME=$(COMPOSE_PROJECT_NAME) SUPABASE_DEV_SERVICES="$(SUPABASE_DEV_SERVICES)" SKIP_STACK_DB_PUSH="$(SKIP_STACK_DB_PUSH)" ./infra/dev/recreate-stack.sh $(if $(FORCE_CLEAN),--force-clean,) $(if $(RECREATE_YES),-y,)

# GNU Make treats `--force-clean` after the target as a Make flag, not script args. Use FORCE_CLEAN=1 or this target.
stack-recreate-clean: FORCE_CLEAN := 1
stack-recreate-clean: stack-recreate

db-status: docker-check
	@cd "$(SUPABASE_STACK_DIR)" && docker compose -p "$(COMPOSE_PROJECT_NAME)" ps

mcp-test:
	@curl -sS "http://localhost:8000/mcp" \
		-X POST \
		-H "Content-Type: application/json" \
		-H "Accept: application/json, text/event-stream" \
		-H "MCP-Protocol-Version: 2025-06-18" \
		-d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"elicitation":{}},"clientInfo":{"name":"make-mcp-test","title":"Make MCP Test","version":"1.0.0"}}}'

db-new: supabase-check
	@if [ -z "$(NAME)" ]; then \
		echo "NAME is required. Example: make db-new NAME=create_profiles"; \
		exit 1; \
	fi
	@$(SUPABASE_CMD) migration new $(NAME)

db-link: supabase-check
	@if [ -z "$(PROJECT_REF)" ]; then \
		echo "PROJECT_REF is required (20-char Supabase Cloud ref). Example: make db-link PROJECT_REF=abcdefghijklmnopqrst"; \
		exit 1; \
	fi
	@$(SUPABASE_CMD) link --project-ref $(PROJECT_REF)

# Required for auth.users INSERT/DELETE -> pg_net -> identity_lifecycle_fanout (must match compose functions.IDENTITY_INTERNAL_INGEST_SECRET).
db-sync-identity-secret: docker-check
	@bash -euo pipefail -c '\
	ENV_FILE="$(SUPABASE_STACK_DIR)/.env"; \
	[ -f "$$ENV_FILE" ] || { echo "Missing $$ENV_FILE"; exit 1; }; \
	POSTGRES_PASSWORD=$$(grep -E "^POSTGRES_PASSWORD=" "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_DB=$$(grep -E "^POSTGRES_DB=" "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_DB=$${POSTGRES_DB:-postgres}; \
	: $${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD}; \
	docker ps --format "{{.Names}}" | grep -qx "$(SUPABASE_DB_CONTAINER)" || { echo "Container $(SUPABASE_DB_CONTAINER) not running"; exit 1; }; \
	docker exec -e PGPASSWORD="$$POSTGRES_PASSWORD" "$(SUPABASE_DB_CONTAINER)" \
		psql -U supabase_admin -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 \
		-c "UPDATE identity_sync.outbound_config SET internal_secret = '"'"'"$(DEV_IDENTITY_INTERNAL_INGEST_SECRET)"'"'"' WHERE id = 1;"; \
	echo "OK: identity_sync.outbound_config.internal_secret = DEV_IDENTITY_INTERNAL_INGEST_SECRET (see Makefile)" \
	'

# Push migrations to self-hosted stack: read POSTGRES_* from SUPABASE_STACK_DIR/.env via grep (do not `source` — compose .env allows unquoted spaces).
# On success, runs db-sync-identity-secret. SELF_HOSTED_DB_URL-only pushes skip the sync step unless you run it manually on the target.
db-push: supabase-check
	@bash -euo pipefail -c '\
	if [ -n "$(strip $(SELF_HOSTED_DB_URL))" ]; then \
		PGSSLMODE=$(SELF_HOSTED_DB_SSLMODE) $(SUPABASE_CMD) db push --db-url "$(SELF_HOSTED_DB_URL)" --yes; \
	else \
		[ -f "$(SUPABASE_STACK_DIR)/.env" ] || { echo "Missing $(SUPABASE_STACK_DIR)/.env (copy from .env.example)"; exit 1; }; \
		ENV_FILE="$(SUPABASE_STACK_DIR)/.env"; \
		POSTGRES_PASSWORD=$$(grep -E '^POSTGRES_PASSWORD=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POSTGRES_PORT=$$(grep -E '^POSTGRES_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POSTGRES_DB=$$(grep -E '^POSTGRES_DB=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POOLER_TENANT_ID=$$(grep -E '^POOLER_TENANT_ID=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POSTGRES_DIRECT_PORT=$$(grep -E '^POSTGRES_DIRECT_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "[:space:]"); \
		POSTGRES_PORT=$${POSTGRES_PORT:-5432}; \
		POSTGRES_DB=$${POSTGRES_DB:-postgres}; \
		: $${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in $(SUPABASE_STACK_DIR)/.env}; \
		command -v python3 >/dev/null 2>&1 || { echo "python3 is required (scripts/urlencode-stdin.py) for supabase --db-url"; exit 1; }; \
		if [ -n "$$POSTGRES_DIRECT_PORT" ] && command -v docker >/dev/null 2>&1; then \
			if docker ps --format "{{.Names}}" | grep -qx "$(SUPABASE_DB_CONTAINER)"; then \
				docker exec -e PGPASSWORD="$$POSTGRES_PASSWORD" "$(SUPABASE_DB_CONTAINER)" \
					psql -U supabase_admin -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "ALTER TABLE IF EXISTS public.profiles OWNER TO postgres;" \
					|| echo "Warning: pre-push ALTER OWNER on public.profiles failed (ok if table missing)." >&2; \
			fi; \
		fi; \
		ENC_PASS=$$(printf '%s' "$$POSTGRES_PASSWORD" | python3 "$(URLENCODE_STDIN)"); \
		if [ -n "$$POSTGRES_DIRECT_PORT" ]; then \
			PG_USER="postgres"; \
			CLI_PORT="$$POSTGRES_DIRECT_PORT"; \
		else \
			if [ -n "$$POOLER_TENANT_ID" ]; then PG_USER="postgres.$$POOLER_TENANT_ID"; else PG_USER="postgres"; fi; \
			CLI_PORT="$$POSTGRES_PORT"; \
		fi; \
		ENC_USER=$$(printf '%s' "$$PG_USER" | python3 "$(URLENCODE_STDIN)"); \
		HOST="$(SELF_HOSTED_DB_HOST)"; DB="$$POSTGRES_DB"; \
		DBURL="postgresql://$$ENC_USER:$$ENC_PASS@$$HOST:$$CLI_PORT/$$DB?sslmode=$(SELF_HOSTED_DB_SSLMODE)"; \
		PGSSLMODE=$(SELF_HOSTED_DB_SSLMODE) $(SUPABASE_CMD) db push --db-url "$$DBURL" --yes; \
	fi \
	'
	@if [ -n "$(strip $(SELF_HOSTED_DB_URL))" ]; then \
		echo "Skipping db-sync-identity-secret (SELF_HOSTED_DB_URL set — run make db-sync-identity-secret locally if this DB is supabase-db)."; \
	else \
		$(MAKE) db-sync-identity-secret; \
	fi

db-types: supabase-check
	@bash -euo pipefail -c '\
	if [ -n "$(strip $(SELF_HOSTED_DB_URL))" ]; then \
		DBURL="$(SELF_HOSTED_DB_URL)"; \
	else \
		[ -f "$(SUPABASE_STACK_DIR)/.env" ] || { echo "Missing $(SUPABASE_STACK_DIR)/.env (copy from .env.example)"; exit 1; }; \
		ENV_FILE="$(SUPABASE_STACK_DIR)/.env"; \
		POSTGRES_PASSWORD=$$(grep -E '^POSTGRES_PASSWORD=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POSTGRES_PORT=$$(grep -E '^POSTGRES_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POSTGRES_DB=$$(grep -E '^POSTGRES_DB=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POOLER_TENANT_ID=$$(grep -E '^POOLER_TENANT_ID=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
		POSTGRES_DIRECT_PORT=$$(grep -E '^POSTGRES_DIRECT_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "[:space:]"); \
		POSTGRES_PORT=$${POSTGRES_PORT:-5432}; \
		POSTGRES_DB=$${POSTGRES_DB:-postgres}; \
		: $${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in $(SUPABASE_STACK_DIR)/.env}; \
		command -v python3 >/dev/null 2>&1 || { echo "python3 is required (scripts/urlencode-stdin.py) for supabase --db-url"; exit 1; }; \
		ENC_PASS=$$(printf '%s' "$$POSTGRES_PASSWORD" | python3 "$(URLENCODE_STDIN)"); \
		if [ -n "$$POSTGRES_DIRECT_PORT" ]; then \
			PG_USER="postgres"; \
			CLI_PORT="$$POSTGRES_DIRECT_PORT"; \
		else \
			if [ -n "$$POOLER_TENANT_ID" ]; then PG_USER="postgres.$$POOLER_TENANT_ID"; else PG_USER="postgres"; fi; \
			CLI_PORT="$$POSTGRES_PORT"; \
		fi; \
		ENC_USER=$$(printf '%s' "$$PG_USER" | python3 "$(URLENCODE_STDIN)"); \
		HOST="$(SELF_HOSTED_DB_HOST)"; \
		DBURL="postgresql://$$ENC_USER:$$ENC_PASS@$$HOST:$$CLI_PORT/$$POSTGRES_DB?sslmode=$(SELF_HOSTED_DB_SSLMODE)"; \
	fi; \
	PGSSLMODE=$(SELF_HOSTED_DB_SSLMODE) $(SUPABASE_CMD) gen types typescript --db-url "$$DBURL" > packages/db/src/database.types.ts \
	'
	@echo "OK: packages/db/src/database.types.ts regenerated"

db-push-refresh-types: db-push db-types

db-push-cloud: supabase-check
	@$(SUPABASE_CMD) db push --yes

# Diff local migration files against self-hosted database
db-diff: supabase-check
	@bash -euo pipefail -c '\
	if [ -n "$(strip $(SELF_HOSTED_DB_URL))" ]; then \
		PGSSLMODE=$(SELF_HOSTED_DB_SSLMODE) exec $(SUPABASE_CMD) db diff --db-url "$(SELF_HOSTED_DB_URL)"; \
	fi; \
	[ -f "$(SUPABASE_STACK_DIR)/.env" ] || { echo "Missing $(SUPABASE_STACK_DIR)/.env"; exit 1; }; \
	ENV_FILE="$(SUPABASE_STACK_DIR)/.env"; \
	POSTGRES_PASSWORD=$$(grep -E '^POSTGRES_PASSWORD=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_PORT=$$(grep -E '^POSTGRES_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_DB=$$(grep -E '^POSTGRES_DB=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POOLER_TENANT_ID=$$(grep -E '^POOLER_TENANT_ID=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_DIRECT_PORT=$$(grep -E '^POSTGRES_DIRECT_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "[:space:]"); \
	POSTGRES_PORT=$${POSTGRES_PORT:-5432}; \
	POSTGRES_DB=$${POSTGRES_DB:-postgres}; \
	: $${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in $(SUPABASE_STACK_DIR)/.env}; \
	command -v python3 >/dev/null 2>&1 || { echo "python3 is required (scripts/urlencode-stdin.py) for supabase --db-url"; exit 1; }; \
	ENC_PASS=$$(printf '%s' "$$POSTGRES_PASSWORD" | python3 "$(URLENCODE_STDIN)"); \
	if [ -n "$$POSTGRES_DIRECT_PORT" ]; then \
		PG_USER="postgres"; \
		CLI_PORT="$$POSTGRES_DIRECT_PORT"; \
	else \
		if [ -n "$$POOLER_TENANT_ID" ]; then PG_USER="postgres.$$POOLER_TENANT_ID"; else PG_USER="postgres"; fi; \
		CLI_PORT="$$POSTGRES_PORT"; \
	fi; \
	ENC_USER=$$(printf '%s' "$$PG_USER" | python3 "$(URLENCODE_STDIN)"); \
	HOST="$(SELF_HOSTED_DB_HOST)"; DB="$$POSTGRES_DB"; \
	DBURL="postgresql://$$ENC_USER:$$ENC_PASS@$$HOST:$$CLI_PORT/$$DB?sslmode=$(SELF_HOSTED_DB_SSLMODE)"; \
	PGSSLMODE=$(SELF_HOSTED_DB_SSLMODE) exec $(SUPABASE_CMD) db diff --db-url "$$DBURL" \
	'

db-diff-linked: supabase-check
	@$(SUPABASE_CMD) db diff --linked

# Pull schema from self-hosted DB into a new migration (non-interactive)
db-pull: supabase-check
	@bash -euo pipefail -c '\
	if [ -n "$(strip $(SELF_HOSTED_DB_URL))" ]; then \
		PGSSLMODE=$(SELF_HOSTED_DB_SSLMODE) exec $(SUPABASE_CMD) db pull --db-url "$(SELF_HOSTED_DB_URL)" --yes; \
	fi; \
	[ -f "$(SUPABASE_STACK_DIR)/.env" ] || { echo "Missing $(SUPABASE_STACK_DIR)/.env"; exit 1; }; \
	ENV_FILE="$(SUPABASE_STACK_DIR)/.env"; \
	POSTGRES_PASSWORD=$$(grep -E '^POSTGRES_PASSWORD=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_PORT=$$(grep -E '^POSTGRES_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_DB=$$(grep -E '^POSTGRES_DB=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POOLER_TENANT_ID=$$(grep -E '^POOLER_TENANT_ID=' "$$ENV_FILE" | head -1 | cut -d= -f2-); \
	POSTGRES_DIRECT_PORT=$$(grep -E '^POSTGRES_DIRECT_PORT=' "$$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "[:space:]"); \
	POSTGRES_PORT=$${POSTGRES_PORT:-5432}; \
	POSTGRES_DB=$${POSTGRES_DB:-postgres}; \
	: $${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in $(SUPABASE_STACK_DIR)/.env}; \
	command -v python3 >/dev/null 2>&1 || { echo "python3 is required (scripts/urlencode-stdin.py) for supabase --db-url"; exit 1; }; \
	ENC_PASS=$$(printf '%s' "$$POSTGRES_PASSWORD" | python3 "$(URLENCODE_STDIN)"); \
	if [ -n "$$POSTGRES_DIRECT_PORT" ]; then \
		PG_USER="postgres"; \
		CLI_PORT="$$POSTGRES_DIRECT_PORT"; \
	else \
		if [ -n "$$POOLER_TENANT_ID" ]; then PG_USER="postgres.$$POOLER_TENANT_ID"; else PG_USER="postgres"; fi; \
		CLI_PORT="$$POSTGRES_PORT"; \
	fi; \
	ENC_USER=$$(printf '%s' "$$PG_USER" | python3 "$(URLENCODE_STDIN)"); \
	HOST="$(SELF_HOSTED_DB_HOST)"; DB="$$POSTGRES_DB"; \
	DBURL="postgresql://$$ENC_USER:$$ENC_PASS@$$HOST:$$CLI_PORT/$$DB?sslmode=$(SELF_HOSTED_DB_SSLMODE)"; \
	PGSSLMODE=$(SELF_HOSTED_DB_SSLMODE) exec $(SUPABASE_CMD) db pull --db-url "$$DBURL" --yes \
	'

db-pull-cloud: supabase-check
	@$(SUPABASE_CMD) db pull --yes
