#!/usr/bin/env bash
# Verification harness for the Settle consumer app (assistant/, practice mode).
# Usage: verify.sh up | doctor | pw <playwright-cli args...> | evidence <name> | down
# Runs Git Bash on Windows; also works on macOS/Linux bash.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STATE="$ROOT/.verify/run"
EVIDENCE_ROOT="$ROOT/.verify/evidence"
PORT="${VERIFY_PORT:-5199}"
BASE="http://127.0.0.1:$PORT"
SESSION="verify-settle-$PORT"

pid_alive() { [ -f "$STATE/pid" ] && kill -0 "$(cat "$STATE/pid")" 2>/dev/null; }

# Windows PID of the listener on $PORT, or empty.
port_owner() {
  if command -v netstat >/dev/null && netstat -ano >/dev/null 2>&1 && [ -n "${WINDIR:-}" ]; then
    netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $4 == "LISTENING" {print $5; exit}'
  elif command -v lsof >/dev/null; then
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
  fi
}

# OS PID of the server listener, recorded by `up` once the port (free before launch) came up.
our_os_pid() { cat "$STATE/os_pid"; }

cmd_up() {
  if pid_alive; then echo "already up: $BASE (run id $(cat "$STATE/run_id"))"; return 0; fi
  if [ -n "$(port_owner)" ]; then echo "port $PORT is taken by pid $(port_owner); set VERIFY_PORT to a free port" >&2; exit 1; fi
  [ -d "$ROOT/assistant/node_modules" ] || (cd "$ROOT/assistant" && npm install)
  mkdir -p "$STATE"
  local run_id; run_id="$(date +%Y%m%d-%H%M%S)"
  echo "$run_id" > "$STATE/run_id"
  mkdir -p "$EVIDENCE_ROOT/$run_id"
  # LEDGER_URL points at a dead port so the app stays in in-memory practice mode;
  # LLM keys are unset so Ask uses the deterministic read-only fallback.
  (cd "$ROOT/assistant" && env -u GEMINI_API_KEY -u OPENROUTER_API_KEY -u ANTHROPIC_API_KEY \
    LEDGER_URL=http://127.0.0.1:9 LLM_PROVIDER=openrouter \
    node node_modules/vite/bin/vite.js --port "$PORT" --strictPort --host 127.0.0.1 \
    > "$STATE/vite.log" 2>&1 & echo $! > "$STATE/pid")
  for _ in $(seq 1 90); do
    if curl -sf "$BASE/api/health" >/dev/null && curl -sf "$BASE/" >/dev/null; then
      port_owner > "$STATE/os_pid"
      echo "ready: $BASE  run id $run_id  evidence $EVIDENCE_ROOT/$run_id"; return 0
    fi
    pid_alive || { echo "vite exited:" >&2; cat "$STATE/vite.log" >&2; exit 1; }
    sleep 1
  done
  echo "timed out waiting for $BASE" >&2; cat "$STATE/vite.log" >&2; exit 1
}

cmd_doctor() {
  local ok=1
  pid_alive && echo "ok   process $(cat "$STATE/pid") alive" || { echo "FAIL no instance started by this harness (run: verify.sh up)"; ok=0; }
  if pid_alive; then
    local owner; owner="$(port_owner)"
    [ "$owner" = "$(our_os_pid)" ] && echo "ok   port $PORT owned by our server pid $owner" || { echo "FAIL port $PORT owner '$owner' is not our server pid $(our_os_pid)"; ok=0; }
  fi
  curl -sf "$BASE/api/health" | grep -q '"ok"' && echo "ok   $BASE/api/health" || { echo "FAIL /api/health"; ok=0; }
  local boot; boot="$(curl -sf "$BASE/api/bootstrap" || true)"
  echo "$boot" | grep -q '"live":false' && echo "ok   practice mode (live=false)" || { echo "FAIL bootstrap not practice mode: ${boot:0:120}"; ok=0; }
  echo "$boot" | grep -q '"configured":false' && echo "ok   chat uses ledger fallback (no LLM key)" || echo "warn chat provider is configured; Ask answers are non-deterministic"
  echo "info build $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet || echo ' +dirty')"
  [ -f "$STATE/run_id" ] && echo "info evidence $EVIDENCE_ROOT/$(cat "$STATE/run_id")"
  [ "$ok" = 1 ]
}

# playwright-cli bound to this run's browser session. Run from the evidence dir
# so snapshots/screenshots with relative --filename land there.
cmd_pw() {
  local dir="$EVIDENCE_ROOT/$(cat "$STATE/run_id")"
  cd "$dir" && playwright-cli -s="$SESSION" "$@"
}

cmd_evidence() { echo "$EVIDENCE_ROOT/$(cat "$STATE/run_id")"; }

cmd_down() {
  playwright-cli -s="$SESSION" close >/dev/null 2>&1 || true
  if [ -f "$STATE/os_pid" ]; then
    local os; os="$(our_os_pid)"
    if [ -n "${WINDIR:-}" ]; then taskkill //PID "$os" //T //F >/dev/null || true; else kill "$os" 2>/dev/null || true; fi
    kill "$(cat "$STATE/pid")" 2>/dev/null || true
    echo "stopped server pid $os"
  fi
  [ -f "$STATE/run_id" ] && echo "evidence kept: $EVIDENCE_ROOT/$(cat "$STATE/run_id")"
  rm -rf "$STATE"
}

case "${1:-}" in
  up) cmd_up ;;
  doctor) cmd_doctor ;;
  pw) shift; cmd_pw "$@" ;;
  evidence) cmd_evidence ;;
  down) cmd_down ;;
  *) echo "usage: verify.sh up|doctor|pw <args>|evidence|down" >&2; exit 2 ;;
esac
