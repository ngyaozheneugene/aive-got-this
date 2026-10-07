#!/usr/bin/env bash
# Redeploys the box to the latest main. Run on the Lightsail instance:
#
#   cd ~/aive-got-this && git pull --ff-only && bash scripts/redeploy.sh
#
# Stops at the first failure. In particular a failed image build stops here,
# instead of recreating the containers on the old image, which is how a
# broken deploy once looked like a successful one.
#
# Touches only `app` and `optimizer`. Caddy (and its certificate) and Postgres
# (and its volume) are left alone. Never run `docker compose down -v`.
set -euo pipefail

cd "$(dirname "$0")/.."

say() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

say "Updating to the latest main"
git checkout main
git pull --ff-only
COMMIT="$(git rev-parse --short HEAD)"

# The product runs on Postgres. Make sure .env says so (adds it if missing).
if grep -q '^USE_MEMORY_DB=' .env; then
  sed -i 's/^USE_MEMORY_DB=.*/USE_MEMORY_DB=false/' .env
else
  echo 'USE_MEMORY_DB=false' >> .env
fi

say "Building app and optimizer at $COMMIT (a few minutes)"
docker compose build app optimizer || die "Build failed. Nothing was restarted; the site still runs the previous build."

say "Restarting app and optimizer on the new images"
# --force-recreate: `up --build` has left containers on the old image before.
docker compose up -d --force-recreate app optimizer

say "Waiting for the app to answer"
HEALTH=""
for _ in $(seq 1 30); do
  HEALTH="$(docker compose exec -T app wget -qO- http://127.0.0.1:8080/health 2>/dev/null || true)"
  case "$HEALTH" in *'"databaseOk":true'*) break ;; esac
  sleep 2
done
case "$HEALTH" in
  *'"databaseOk":true'*) ;;
  *) die "App is up but not healthy: ${HEALTH:-no answer}. See: docker compose logs --tail 50 app" ;;
esac

docker compose ps --format '{{.Name}}  {{.Image}}  {{.Status}}'
say "Deployed $COMMIT. Health: $HEALTH"
