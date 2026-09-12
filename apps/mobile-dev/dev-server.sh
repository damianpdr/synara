#!/bin/zsh
# Headless Synara test server for mobile-app development.
# Isolated from the user's live Synara (~/.synara on port 3773) by using a
# separate home dir and port. Never touch ~/.synara from here.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/damian/workspace/synara}"
HOME_DIR="${HOME_DIR:-$HOME/.synara-mobile-dev}"
# 3774 is occupied by an unrelated `node /tmp/synara-proxy.js`, so default to 3775.
PORT="${PORT:-3775}"
# NOTE: do not use $HOST -- it is a read-only-ish special zsh parameter (the hostname).
BIND_HOST="${BIND_HOST:-$(tailscale ip -4 | head -1)}"
RUN_DIR="${RUN_DIR:-/tmp/synara-mobile-dev}"
LOG="$RUN_DIR/server.log"
PID_FILE="$RUN_DIR/server.pid"
URL_FILE="$RUN_DIR/pairing-url.txt"
TOKEN_FILE="$HOME_DIR/.auth-token"

mkdir -p "$HOME_DIR" "$RUN_DIR"

# Persistent auth token: generated once, reused across restarts.
if [[ ! -s "$TOKEN_FILE" ]]; then
  openssl rand -hex 24 > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"
TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"

SERVER_JS="$REPO_ROOT/apps/server/dist/index.mjs"
if [[ ! -f "$SERVER_JS" ]]; then
  echo "Missing $SERVER_JS -- run: cd $REPO_ROOT && bun run build --filter=@synara/cli" >&2
  exit 1
fi

if lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use; set PORT=<free port> and retry." >&2
  exit 1
fi

: > "$LOG"
# cd to the repo root: the server verifies its migration-runtime identity
# against cwd at startup.
cd "$REPO_ROOT"
node "$SERVER_JS" \
  --no-browser \
  --home-dir "$HOME_DIR" \
  --host "$BIND_HOST" \
  --port "$PORT" \
  --auth-token "$TOKEN" \
  --allow-insecure-remote \
  >> "$LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
echo "synara mobile-dev server pid=$SERVER_PID  http://$BIND_HOST:$PORT  log=$LOG"

# Wait for the one-time startup pairing link to appear in the log.
PAIRING_URL=""
for _ in {1..120}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server exited during startup; see $LOG" >&2
    tail -30 "$LOG" >&2
    exit 1
  fi
  # Tolerant match: Effect's logger may render the field as pairingUrl=... or pairingUrl: '...'
  PAIRING_URL="$(grep -oE "http://[^'\"[:space:],}]+/pair#token=[^'\"[:space:],}]+" "$LOG" | head -1)" || true
  [[ -n "$PAIRING_URL" ]] && break
  sleep 0.5
done

if [[ -z "$PAIRING_URL" ]]; then
  echo "Timed out waiting for a pairing URL; see $LOG" >&2
  exit 1
fi

# The bind host is the Tailscale IP, so the URL should already be reachable.
# Wildcard/loopback binds render as localhost -- rewrite defensively.
PAIRING_URL="${PAIRING_URL//localhost/$BIND_HOST}"
PAIRING_URL="${PAIRING_URL//127.0.0.1/$BIND_HOST}"
printf '%s\n' "$PAIRING_URL" > "$URL_FILE"
chmod 600 "$URL_FILE"
echo "pairing url (one-time): $PAIRING_URL"
echo "saved to: $URL_FILE"

wait "$SERVER_PID"
