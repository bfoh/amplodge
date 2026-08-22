#!/bin/bash
# Bundles an E2E scenario against the fake data layer.
SP="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SP/../.." && pwd)"
"$ROOT/node_modules/.bin/esbuild" "$1" --bundle --platform=node --format=esm --outfile="$2" \
  --alias:@/lib/db="$SP/fake-db.ts" \
  --alias:@/lib/supabase="$SP/fake-supabase.ts" \
  --alias:@/services/notifications="$SP/stubs.ts" \
  --alias:@/services/email-service="$SP/stubs.ts" \
  --alias:@/services/sms-service="$SP/stubs.ts" \
  --alias:@/services/task-notification-service="$SP/stubs.ts" \
  --alias:@="$ROOT/src" \
  --alias:react="$SP/react-shim.ts" \
  --alias:sonner="$SP/toast-shim.ts" \
  --define:import.meta.env.VITE_SUPABASE_URL='"http://x"' \
  --define:import.meta.env.VITE_SUPABASE_ANON_KEY='"anon"' \
  --define:import.meta.env.PROD=false --define:import.meta.env.DEV=false \
  --define:import.meta.env.MODE='"test"' --log-level=error
