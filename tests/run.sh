#!/bin/bash
# Runs every money test: unit suites against the real modules, end-to-end
# suites against the real services and hooks backed by an in-memory database.
#
#   ./tests/run.sh              # everything
#   ./tests/run.sh accounting   # one suite by name
#
# The production audit is separate and needs credentials:
#   env $(npx netlify env:list --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(f'{k}={v}' for k,v in d.items() if k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')))") \
#     ./tests/run.sh audit
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
ESBUILD="$ROOT/node_modules/.bin/esbuild"
filter="${1:-}"
fail=0

unit() {
  local name="$1"
  [[ -n "$filter" && "$name" != *"$filter"* ]] && return 0
  "$ESBUILD" "$ROOT/tests/$name.test.ts" --bundle --platform=node --format=esm --outfile="$OUT/$name.mjs" \
    --alias:@="$ROOT/src" \
    --define:import.meta.env.VITE_SUPABASE_URL='"http://localhost"' \
    --define:import.meta.env.VITE_SUPABASE_ANON_KEY='"anon"' \
    --define:import.meta.env.PROD=false --define:import.meta.env.DEV=true \
    --define:import.meta.env.MODE='"test"' --log-level=error || { echo "BUILD FAILED $name"; fail=1; return; }
  printf '%-18s ' "$name"
  node "$OUT/$name.mjs" | grep -E "^FAIL|ALL PASS|FAILURE" || { fail=1; node "$OUT/$name.mjs" | tail -20; }
}

e2e() {
  local name="$1"
  [[ -n "$filter" && "$name" != *"$filter"* ]] && return 0
  "$ROOT/tests/e2e/build.sh" "$ROOT/tests/e2e/$name.ts" "$OUT/$name.mjs" || { echo "BUILD FAILED $name"; fail=1; return; }
  printf '%-18s ' "$name"
  node "$OUT/$name.mjs" 2>/dev/null | grep -E "^FAIL|ALL PASS|FAILURE" || { fail=1; node "$OUT/$name.mjs" 2>/dev/null | grep -E "^(FAIL|ERROR)" ; }
}

# Suites that read the live database. Credentials required; read-only.
if [[ "$filter" == "audit" || "$filter" == "live" ]]; then
  if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required for the live suites."; exit 1
  fi
  "$ESBUILD" "$ROOT/tests/analytics-consistency.test.ts" --bundle --platform=node --format=esm --outfile="$OUT/ac.mjs" \
    --alias:@="$ROOT/src" --define:import.meta.env.VITE_SUPABASE_URL='"http://localhost"' \
    --define:import.meta.env.VITE_SUPABASE_ANON_KEY='"anon"' --define:import.meta.env.PROD=false \
    --define:import.meta.env.DEV=true --define:import.meta.env.MODE='"test"' --log-level=error
  printf '%-18s ' "analytics-vs-hr"
  node "$OUT/ac.mjs" | grep -E "^FAIL|ALL PASS|FAILURE" || fail=1

  "$ESBUILD" "$ROOT/tests/pagination.test.ts" --bundle --platform=node --format=esm --outfile="$OUT/pg.mjs" \
    --alias:@="$ROOT/src" --define:import.meta.env.VITE_SUPABASE_URL="\"$SUPABASE_URL\"" \
    --define:import.meta.env.VITE_SUPABASE_ANON_KEY="\"$SUPABASE_SERVICE_ROLE_KEY\"" --define:import.meta.env.PROD=false \
    --define:import.meta.env.DEV=true --define:import.meta.env.MODE='"test"' --log-level=error
  printf '%-18s ' "row-cap"
  node "$OUT/pg.mjs" | grep -E "^FAIL|ALL PASS|FAILURE" || fail=1
fi

if [[ "$filter" == "audit" ]]; then
  "$ESBUILD" "$ROOT/tests/audit-production.ts" --bundle --platform=node --format=esm --outfile="$OUT/audit.mjs" \
    --alias:@="$ROOT/src" --define:import.meta.env.VITE_SUPABASE_URL='"http://localhost"' \
    --define:import.meta.env.VITE_SUPABASE_ANON_KEY='"anon"' --define:import.meta.env.PROD=false \
    --define:import.meta.env.DEV=true --define:import.meta.env.MODE='"test"' --log-level=error
  node "$OUT/audit.mjs"
  exit $?
fi

echo "── unit"
for s in group-bookings accounting allocation cash-basis reservations-view; do unit "$s"; done
echo "── end-to-end"
for s in lifecycle groups-analytics charges-repeat all-write-paths; do e2e "$s"; done
rm -rf "$OUT"
[[ $fail -eq 0 ]] && echo "everything passed" || echo "FAILURES"
exit $fail
