#!/usr/bin/env bash
# Deploys baec-sudoku-web on the VPS: pull the latest main, rebuild the image, restart only the
# sudoku-web container (the API, portfolio, Postgres and Caddy are not touched), then health-check.
#
# Install (on the server):   sudo install -m 0755 scripts/dpl-sudoku-web.sh /usr/local/bin/dpl-sudoku-web
# Run (from anywhere):       dpl-sudoku-web [--no-pull]
#
# Overridable through the environment:
#   SUDOKU_REPO_DIR     git checkout of baec-sudoku-web   (default ~/works/baec-sudoku-web)
#   PROJECTS_MANAGE_DIR folder holding docker-compose.yaml (default ~/works/projects-manage)
#   SERVICE             compose service name               (default sudoku-web)
#   SITE_URL            only printed at the end            (default https://sudous.baeclatant.com)
set -euo pipefail

REPO_DIR="${SUDOKU_REPO_DIR:-$HOME/works/baec-sudoku-web}"
COMPOSE_DIR="${PROJECTS_MANAGE_DIR:-$HOME/works/projects-manage}"
SERVICE="${SERVICE:-sudoku-web}"
SITE_URL="${SITE_URL:-https://sudous.baeclatant.com}"
PULL=1

for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Use sudo for docker only when the current user cannot talk to the daemon directly.
if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(sudo docker); fi

[ -d "$REPO_DIR/.git" ] || die "$REPO_DIR is not a git checkout"
[ -f "$COMPOSE_DIR/docker-compose.yaml" ] || die "no docker-compose.yaml in $COMPOSE_DIR"

# Everything below lives in a function, so bash has read the whole script before it runs.
main() {
  cd "$REPO_DIR"
  local before after
  before="$(git rev-parse --short HEAD)"

  if [ "$PULL" -eq 1 ]; then
    log "Pulling latest main ($REPO_DIR)"
    [ -z "$(git status --porcelain)" ] || die "working tree has local changes; commit or discard them first"
    git fetch --quiet origin
    git merge --ff-only --quiet origin/main || die "cannot fast-forward to origin/main (local history diverged)"
  else
    log "Skipping pull (--no-pull)"
  fi
  after="$(git rev-parse --short HEAD)"
  echo "commit: $before -> $after  ($(git log -1 --format=%s))"

  cd "$COMPOSE_DIR"
  log "Validating compose file"
  "${DOCKER[@]}" compose config -q

  log "Building and restarting $SERVICE only"
  "${DOCKER[@]}" compose up -d --build --no-deps "$SERVICE"

  log "Health check"
  # Resolve the container through compose: its container_name differs from the service name.
  local cid ok=0
  cid="$("${DOCKER[@]}" compose ps -q "$SERVICE")"
  [ -n "$cid" ] || die "no running container for service $SERVICE"
  for _ in $(seq 1 15); do
    if "${DOCKER[@]}" exec "$cid" wget -q -O /dev/null http://127.0.0.1/ 2>/dev/null; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" -eq 1 ] || { "${DOCKER[@]}" logs --tail 30 "$cid" >&2 || true; die "$SERVICE did not become healthy"; }

  "${DOCKER[@]}" ps --filter "id=$cid" --format 'container: {{.Names}}  {{.Status}}'
  echo "deployed $after -> $SITE_URL"
}

main
