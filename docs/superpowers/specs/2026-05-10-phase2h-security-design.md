# Phase 2H — Security Hardening + Sentry + Role-Based Admin

**Date:** 2026-05-10
**Status:** Draft — pending user approval
**Owner:** TBD
**Branch:** `phase2h-security` (to be created)
**Predecessor:** Phase 2G dead-code purge (PR #3, `phase2g-eslint-deadcode`)
**Closes audit entries:** BUG-0005, BUG-0022, BUG-0025, BUG-0033 (4 of 34)

## Context

Phase 2A audit identified one critical security gap (BUG-0022 — netlify functions exposed without auth verification) and three lower-but-real risks (no observability, auth cache masking sign-outs, hardcoded admin email blocking multi-tenant). Per audit OQ #6 the user requested H ship before any other Phase 2 work. Phase 2G already shipped foundational cleanup (eslint, dead code, MD relocation); Phase 2H now hardens what remains.

Reconnaissance confirmed:
- 11 of 26 netlify functions are privileged (admin-power Supabase service-role key) but have **zero** `Authorization` header verification.
- Zero error reporting beyond `console.error`. ErrorBoundary has a `// TODO: Log to error reporting service (e.g., Sentry)` from initial scaffolding.
- Auth wrapper in `src/lib/supabase-wrapper.ts:892-895` falls back to cached session on any failure including real signed-out responses, masking server-side signouts.
- 12 source-code sites hardcode `admin@amplodge.com` as escape-hatch admin check, blocking any multi-tenant deployment.

Per user OQs answered before Phase 2H started:
- OQ #3 (Sentry): YES, browser-only.
- OQ #5 (multi-tenant ready): YES, fix admin email.
- OQ #6 (H1 ships first): YES, before all other feature work.

## Goal

Add admin-token gate to 11 privileged netlify functions. Wire Sentry browser SDK to ErrorBoundary. Strip 12 hardcoded admin email checks → role-based check via new `useIsAdmin()` hook. Fix auth wrapper cache fallback to distinguish "signed out" from "network down".

## Non-Goals

- Server-side Sentry in netlify functions (deferred — Netlify's own logs cover server crashes; revisit in Phase 2A2 if needed).
- Custom API keys (Supabase JWT handles all admin auth).
- Audit/redesign of public netlify fns (booking, guest portal — those stay open by design).
- New auth UI / login flow changes (Phase 2E).
- Migration of `admin@amplodge.com` references in MD docs (already in `docs/legacy-fixes/` from Phase 2G — historical, no effect on runtime).
- Audit of Supabase RLS policies for hardcoded email (separate Phase 2A2 scope).

## Success Criteria

- 11 privileged netlify fns reject requests without valid `Authorization: Bearer <jwt>` header → return HTTP 401.
- Same 11 fns reject non-admin tokens → return HTTP 403.
- 1 privileged fn (`text-to-speech`) accepts any staff token (no admin requirement).
- 2 cron fns (`sync-channels`, `scheduled-promo`) accept either Netlify cron header OR admin token.
- `npm run build` clean.
- `grep -rn "admin@amplodge\.com" src/` returns 0 hits.
- `npm run lint:js` exits 0; `npm run lint:types` ≤ 52 (Phase 2G baseline).
- Sentry captures a manually-thrown error in dev (smoke test).
- Auth wrapper signs out user when Supabase responds `null` (not when network unreachable).
- One new env var: `VITE_SENTRY_DSN` (optional — Sentry no-ops if unset).
- One new env var requirement on netlify: `SUPABASE_SERVICE_ROLE_KEY` (already required per existing `create-employee.js`; verify present).

## Architecture

Single-PR refactor with atomic commits per concern. Three new files (auth-gate lib, frontend api helper, useIsAdmin hook). One new browser dep (`@sentry/react`). 11 netlify fns gain auth-gate import. ~12 source files lose `admin@amplodge.com` literal. Auth wrapper `me()` and `onAuthStateChanged()` get error-type-aware refactor.

No schema changes. No new env vars required (only one optional `VITE_SENTRY_DSN`).

## File Operations

### Created (3 source + 1 hook)

| Path | Responsibility |
|---|---|
| `netlify/functions/_lib/auth.js` | Shared auth-gate primitives: `requireAdmin`, `requireStaff`, `requireCron`, `tryAuth`, `jsonResponse`, `handleCors`, `cors` |
| `src/lib/api.ts` | Frontend `callFunction(name, init)` helper that injects `Authorization: Bearer <session.access_token>` |
| `src/hooks/use-is-admin.ts` | `useIsAdmin()` hook returning `{ isAdmin, isLoading }` derived from `useStaffRole()` |

### Modified

| Path | Change |
|---|---|
| `package.json` | Add `@sentry/react` to dependencies (only new dep) |
| `src/main.tsx` | Init Sentry at top of file (guarded on `VITE_SENTRY_DSN`) |
| `src/components/ErrorBoundary.tsx` | Replace TODO at line 43 with `Sentry.captureException(error, { contexts: { react: { componentStack } } })` |
| `src/lib/supabase-wrapper.ts:892-958` | `me()` and `onAuthStateChanged()` distinguish AuthApiError from network errors; clear cache on real signout, fall back on network only |
| `src/pages/staff/MealsPage.tsx:8` | Drop `email="admin@amplodge.com"` prop on `<StaffSidebar>` |
| `src/pages/staff/LocalTaxPage.tsx:9` | Same |
| `src/pages/staff/AdditionalServicesPage.tsx:8` | Same |
| `src/pages/staff/CleanupToolPage.tsx:225,231` | `staff.email === 'admin@amplodge.com'` → `staff.role === 'admin' \|\| staff.role === 'owner'` |
| `src/services/clean-employees.ts:46,53,161,166` | Same role-based check (4 sites) |
| `src/services/clean-employees.ts:7` | Update comment from "Preserves admin@amplodge.com" → "Preserves admin/owner role staff" |
| `src/services/fix-admin-staff.ts:5,143` | Verify file is dead first; if dead, delete; if live, replace literal with `staff.role` check |
| `src/components/layout/StaffSidebar.tsx` | If `email` prop is unused inside, drop from `interface Props`; otherwise leave |
| `netlify/functions/create-employee.js` | Wrap handler with `requireAdmin` (currently has 1 partial check; replace) |
| `netlify/functions/delete-employee.js` | Wrap with `requireAdmin` |
| `netlify/functions/apply-guest-request-fix.js` | Wrap with `requireAdmin` |
| `netlify/functions/backfill-guest-tokens.js` | Wrap with `requireAdmin` |
| `netlify/functions/debug-booking-status.js` | Wrap with `requireAdmin` |
| `netlify/functions/generate-marketing-copy.js` | Wrap with `requireAdmin` |
| `netlify/functions/send-email.js` | Wrap with `requireAdmin` |
| `netlify/functions/send-sms.js` | Wrap with `requireAdmin` |
| `netlify/functions/text-to-speech.js` | Wrap with `requireStaff` |
| `netlify/functions/sync-channels.js` | Wrap with `requireCron`-or-admin |
| `netlify/functions/scheduled-promo.js` | Same |
| `netlify/functions/trigger-campaign.js` | Audit existing auth check; replace with `requireAdmin` if insufficient |

### Updated frontend callers

Every `fetch('/.netlify/functions/<priv>', ...)` call site in `src/` → `callFunction('<priv>', ...)` from `src/lib/api.ts`. Pre-flight grep enumerates exact list during plan execution.

### Files Deleted (conditional)

`src/services/fix-admin-staff.ts` — delete if zero callers (similar to Phase 2G's seed-admin removal). Verify in plan.

`src/pages/staff/MealsPage.tsx`, `LocalTaxPage.tsx`, `AdditionalServicesPage.tsx` — delete if unrouted. These look orphan-shaped (similar to Phase 2G's AdminPanelPage). Verify in plan; delete if confirmed.

## Auth-Gate Module Design

`netlify/functions/_lib/auth.js` exports:

```js
// Returns { user, staff } or null. No throw. For optional-auth endpoints.
export async function tryAuth(event)

// Throws { status: 401|403, body: {error} } if auth fails.
export async function requireStaff(event)
export async function requireAdmin(event)

// For cron-only endpoints. Accepts either x-netlify-cron header OR admin token.
export async function requireCron(event)

// Response helpers
export function jsonResponse(status, body)
export function handleCors(event)
export const cors  // CORS headers object
```

Implementation uses Supabase admin client (service-role key) to verify JWT and query `staff` table for role. Throws structured errors so callers can `try/catch` and return appropriate response.

Per-fn integration pattern:

```js
import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'

export const handler = async function (event) {
  const cors = handleCors(event); if (cors) return cors

  let ctx
  try {
    ctx = await requireAdmin(event)
  } catch (e) {
    return jsonResponse(e.status, e.body)
  }

  // ctx.user (Supabase user) and ctx.staff (staff table row) available
  // ... existing handler logic
}
```

## Function Classification

| Class | Auth | Functions |
|---|---|---|
| Public — no auth | none | check-availability, submit-booking, submit-review, guest-login, verify-guest, submit-guest-request, rooms-availability, get-booking-token, export-ical, get-guest-requests, get-booking-details, get-invoice-data |
| Privileged — admin only | `requireAdmin` | create-employee, delete-employee, apply-guest-request-fix, backfill-guest-tokens, debug-booking-status, generate-marketing-copy, send-email, send-sms |
| Privileged — staff only | `requireStaff` | text-to-speech |
| Cron / system | `requireCron` (or admin) | sync-channels, scheduled-promo |
| Special | manual review | trigger-campaign (existing partial auth — verify), supabase-proxy (own JWT pass-through, leave) |

## Sentry Browser SDK

New devdep: `@sentry/react`.

New env: `VITE_SENTRY_DSN` (optional). When unset, init no-ops — preserves dev/preview parity.

Init at top of `src/main.tsx` (before `React.createRoot`):

```ts
import * as Sentry from '@sentry/react'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip Supabase JWT from breadcrumbs / request data
      if (event.request?.headers?.Authorization) {
        event.request.headers.Authorization = '[REDACTED]'
      }
      return event
    },
  })
}
```

ErrorBoundary integration replaces existing TODO at `src/components/ErrorBoundary.tsx:43`:

```ts
import * as Sentry from '@sentry/react'

componentDidCatch(error: Error, errorInfo: ErrorInfo) {
  console.error('ErrorBoundary caught:', error, errorInfo)
  Sentry.captureException(error, {
    contexts: { react: { componentStack: errorInfo.componentStack } },
  })
}
```

Defer `Sentry.ErrorBoundary` HOC wrapping (would conflict with existing class boundary).

## Admin-Email Replacement

New `src/hooks/use-is-admin.ts`:

```ts
import { useStaffRole } from './use-staff-role'

export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { role, loading } = useStaffRole()
  return {
    isAdmin: role === 'admin' || role === 'owner',
    isLoading: loading,
  }
}
```

Per-site rewrites enumerated in §File Operations table above.

`StaffSidebar.tsx` `email` prop investigation:
- Read `StaffSidebar.tsx` to see if prop is read internally.
- If unused (just a passthrough relic), drop from `interface Props`.
- If used, leave prop and update consumers to pass real `currentUser.email`.

## Auth Cache Fallback Fix

`src/lib/supabase-wrapper.ts` `me()` rewrite:

```ts
async me(): Promise<User | null> {
  let supabaseError: unknown = null
  let supabaseUser: User | null = null

  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) {
      supabaseError = error
    } else {
      supabaseUser = user
    }
  } catch (networkErr) {
    supabaseError = networkErr
  }

  // Case 1: Supabase responded with a user → trust it, refresh cache.
  if (supabaseUser) {
    cacheAuthSession(supabaseUser)
    return supabaseUser
  }

  // Case 2: Supabase responded successfully with NO user → real signed-out.
  // Do NOT fall back to cache.
  if (!supabaseError) {
    clearCachedAuthSession()
    return null
  }

  // Case 3: Network/server error → fall back to cache for offline tolerance.
  // Distinguish AuthApiError (real 4xx auth response) from network failures.
  const isAuthError = supabaseError && typeof supabaseError === 'object'
    && 'name' in supabaseError && (supabaseError as any).name === 'AuthApiError'
  if (isAuthError) {
    clearCachedAuthSession()
    return null
  }

  const cached = getCachedAuthSession()
  if (cached) {
    console.log('[SupabaseAuth] 📴 Network error — using cached session')
    return cached
  }
  return null
}
```

Same pattern in `onAuthStateChanged` initial `getSession()` call.

`onAuthStateChange` event handler (real auth events from Supabase) trusted as authoritative — no change needed.

## Verification

```bash
# 1. Build clean
npm run build

# 2. Lint
npm run lint:js
npm run lint:types 2>&1 | grep -c "error TS"   # ≤ 52 (Phase 2G baseline)

# 3. Hardcoded admin email gone from src
grep -rn "admin@amplodge\.com" src --include="*.ts" --include="*.tsx" | wc -l
# expect: 0

# 4. Auth-gate present in 11 privileged + 2 cron fns
for f in netlify/functions/{create-employee,delete-employee,apply-guest-request-fix,backfill-guest-tokens,debug-booking-status,generate-marketing-copy,send-email,send-sms,text-to-speech,sync-channels,scheduled-promo}.js; do
  grep -q "requireAdmin\|requireStaff\|requireCron" "$f" && echo "✓ $f" || echo "✗ $f"
done

# 5. Sentry init present
grep -n "Sentry.init" src/main.tsx
grep -n "Sentry.captureException" src/components/ErrorBoundary.tsx

# 6. Auth wrapper distinguishes error types
grep -n "AuthApiError\|clearCachedAuthSession" src/lib/supabase-wrapper.ts

# 7. Frontend callers use callFunction()
grep -rn "fetch.*['\"]\/\.netlify\/functions\/\(create-employee\|delete-employee\|generate-marketing\|send-email\|send-sms\|text-to-speech\|sync-channels\|backfill\|apply-guest-request\|debug-booking\|trigger-campaign\)" src/ | wc -l
# expect: 0  (all converted to callFunction)
```

### Smoke tests (manual)

```bash
# Auth-gate test (no token, expect 401)
curl -X POST http://localhost:8888/.netlify/functions/create-employee \
  -H 'Content-Type: application/json' \
  -d '{"email":"x"}'
# expect: HTTP 401, {"error":"Missing or invalid token"}

# Auth-gate test (non-admin user, expect 403)
TOKEN=<staff-non-admin-jwt>
curl -X POST http://localhost:8888/.netlify/functions/create-employee \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"x"}'
# expect: HTTP 403, {"error":"Admin role required"}

# Sentry smoke (browser console)
window.Sentry?.captureException(new Error('phase 2h smoke test'))
# expect: event in Sentry dashboard within 30s
```

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Frontend forgets `Authorization` header → priv fn returns 401 in production | Med | High | Plan grep enumerates all `fetch('/.netlify/functions/<priv>')` callers. All converted to `callFunction()`. |
| `staff.role` missing/null for legitimate user → `requireAdmin` fails | Low | High | Role check accepts `'admin' \|\| 'owner'`. Schema audit (Phase 2A2) ensures column has CHECK constraint. |
| `SUPABASE_SERVICE_ROLE_KEY` env var missing → all gated fns 500 | Low | High | Plan adds pre-deploy check. Fail-fast log at fn boot if missing. Already required by current `create-employee.js`. |
| Sentry SDK breaks build if DSN not set | Very Low | Low | Init wrapped in `if (VITE_SENTRY_DSN)` guard. No-ops when unset. |
| Sentry captures PII via Supabase request bodies | Med | Med | `sendDefaultPii: false` + `beforeSend` redacts Authorization header. |
| Auth cache fix kicks legitimate users on transient 5xx | Med | Med | Network errors still fall back to cache. Only `AuthApiError` (real 4xx auth response) clears cache. |
| `useIsAdmin` hook's `loading` state breaks pages w/o loading handling | Med | Low | Default consumers to `if (isLoading) return null` or skeleton. Per-page audit in plan. |
| `StaffSidebar` `email` prop drop breaks 3 orphan pages | Low | Low | Verify Meals/LocalTax/AdditionalServices routing first. If orphan, delete. If wired, sidebar already has internal auth hook. |
| Cron `x-netlify-cron` header spoofed | Low | Med | Netlify guarantees only cron sets internal headers. Add second-layer: `requireCron` also accepts admin token as fallback. |
| `admin@amplodge.com` references survive in netlify env vars / Supabase RLS | Med | Med | Phase 2H scope = src/ only. PR description flags Supabase RLS audit as separate task. |

## Rollback

Single squash. `git revert <merge-commit>` restores all 11 fns to no-auth state, removes auth-gate lib, removes Sentry init, restores hardcoded admin email checks, restores prior auth wrapper. No DB migration. No env changes (DSN var stays unused if DSN unset).

## Sequenced Build Order

(Detailed task plan generated by `writing-plans` skill — this section just lists phase-level steps.)

1. Branch from `phase2g-eslint-deadcode`.
2. Add `@sentry/react` devdep.
3. Create `netlify/functions/_lib/auth.js`.
4. Create `src/lib/api.ts` (callFunction helper).
5. Create `src/hooks/use-is-admin.ts`.
6. Wire Sentry in `src/main.tsx` + `ErrorBoundary.tsx`.
7. Fix auth wrapper `me()` + `onAuthStateChanged()`.
8. Strip 12 hardcoded admin emails (per-file).
9. Verify orphan pages (Meals/LocalTax/AdditionalServices/fix-admin-staff). Delete if dead.
10. Wrap 11 priv netlify fns with `requireAdmin`/`requireStaff`/`requireCron`.
11. Convert frontend `fetch('/.netlify/functions/<priv>')` callers to `callFunction()`.
12. Verify per §Verification.
13. Push branch + open PR against `phase2g-eslint-deadcode`.

## Out of Scope — reserved for later sub-projects

- **Phase 2A2** — server-side Sentry in netlify fns; Supabase RLS policy audit; service-worker cache fix
- **Phase 2D** — typed `db.<table>` accessors enabling tighter eslint
- **Phase 2E/F** — page perf, dual-nav, query perf
- **Phase 2B/C** — Realtime + bundle lazy-load
