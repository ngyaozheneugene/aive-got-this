#!/usr/bin/env bash
# Runs the Dispatch Coordinator desk locally, end to end.
#
#   scripts/run.sh               deps, env, optimizer + Postgres (if Docker is up), desk, browser
#   scripts/run.sh --no-docker   skip the containers (plans then come from the quick fallback; the demo needs the optimizer)
#   scripts/run.sh --no-open     don't open the browser
#   scripts/run.sh --port 3001   serve on another port
#
# Ctrl-C stops the desk. Containers keep running; stop them with `npm run db:down`.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
USE_DOCKER=1
OPEN_BROWSER=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-docker) USE_DOCKER=0 ;;
    --no-open) OPEN_BROWSER=0 ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Node
command -v node >/dev/null || die "Node.js is not installed. Install Node 22 or newer."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node $(node -v) found; this project needs Node 22 or newer."

# 2. Dependencies: install when missing or when the lockfile changed since the last install.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing dependencies (npm ci)…"
  npm ci --no-audit --no-fund
else
  say "Dependencies up to date."
fi

# 3. Environment
if [ ! -f .env.local ] && [ ! -f .env ]; then
  cp .env.example .env.local
  say "Created .env.local from .env.example (in-memory Eastwind data)."
fi
ENV_FILE=".env.local"; [ -f "$ENV_FILE" ] || ENV_FILE=".env"
if ! grep -Eq '^LLM_GATEWAY_API_KEY=.+' "$ENV_FILE"; then
  warn "LLM_GATEWAY_API_KEY is empty in $ENV_FILE. The desk loads, but finding options needs the key."
fi

# 4. Optimizer + Postgres
if [ "$USE_DOCKER" -eq 1 ]; then
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    say "Starting optimizer + Postgres containers…"
    npm run --silent db:up
  else
    warn "Docker isn't running, so the optimizer is off. Every event falls back to a quick estimate; the demo numbers need the optimizer."
    warn "Start Docker Desktop and re-run, or pass --no-docker to hide this."
  fi
fi

# What the running desk reports about the optimizer and the gateway key.
report_health() {
  local h
  h="$(curl -fsS "http://localhost:${PORT}/health" 2>/dev/null)" || return 0
  if printf '%s' "$h" | grep -q '"optimizer":{"ok":true'; then say "Optimizer: connected"
  else warn "Optimizer: not reachable (plans fall back to a quick estimate)"; fi
  printf '%s' "$h" | grep -q '"gatewayConfigured":true' || warn "Gateway: no API key configured"
}

# 5. Desk. Next 16 allows one dev server per folder, so reuse one that is already up.
if curl -fsS -o /dev/null "http://localhost:${PORT}/health" 2>/dev/null; then
  say "The desk is already running at http://localhost:${PORT}/desk"
  report_health
  [ "$OPEN_BROWSER" -eq 1 ] && command -v open >/dev/null && open "http://localhost:${PORT}/desk"
  exit 0
fi

if [ "$OPEN_BROWSER" -eq 1 ]; then
  (
    for _ in $(seq 1 60); do
      if curl -fsS -o /dev/null "http://localhost:${PORT}/health" 2>/dev/null; then
        printf '\n'; say "Desk ready: http://localhost:${PORT}/desk"
        report_health
        if command -v open >/dev/null; then open "http://localhost:${PORT}/desk"
        elif command -v xdg-open >/dev/null; then xdg-open "http://localhost:${PORT}/desk" >/dev/null 2>&1
        fi
        exit 0
      fi
      sleep 1
    done
    warn "The desk didn't answer within 60s; check the output above."
  ) &
fi

say "Starting the desk on http://localhost:${PORT}/desk (Ctrl-C to stop)…"
PORT="$PORT" exec npm run dev
