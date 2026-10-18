#!/bin/zsh
# Pull origin/main. Restart the shop only when server.py changed and it is already running.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
PORT="${PORT:-8787}"
LOG="$ROOT/.auto-pull.log"

if ! mkdir "$ROOT/.auto-pull.lock" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$ROOT/.auto-pull.lock" 2>/dev/null || true' EXIT

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "skip: this checkout has uncommitted changes"
  exit 0
fi

if ! git fetch --quiet origin main; then
  log "skip: git fetch failed"
  exit 0
fi

local_rev="$(git rev-parse HEAD)"
remote_rev="$(git rev-parse origin/main)"
if [[ "$local_rev" == "$remote_rev" ]]; then
  exit 0
fi

before_server="$(git hash-object server.py 2>/dev/null || true)"
if ! git merge --ff-only origin/main; then
  log "skip: cannot fast-forward"
  exit 0
fi
log "updated ${local_rev:0:7} -> ${remote_rev:0:7}"

after_server="$(git hash-object server.py 2>/dev/null || true)"
if [[ "$before_server" == "$after_server" ]]; then
  exit 0
fi

pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -z "$pid" ]]; then
  log "server.py changed; shop was not running"
  exit 0
fi
command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
if [[ "$command" != *"server.py"* ]]; then
  log "server.py changed; port $PORT is not server.py"
  exit 0
fi

kill "$pid"
sleep 0.4
if [[ -f "$ROOT/.env" ]]; then
  set -a
  source "$ROOT/.env"
  set +a
fi
nohup python3 "$ROOT/server.py" >"$ROOT/.server.log" 2>&1 &
echo "$!" >"$ROOT/.server.pid"
log "restarted server.py"
