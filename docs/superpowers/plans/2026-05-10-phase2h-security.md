# Phase 2H — Security + Sentry + Role-Based Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-token gate to 11 privileged netlify functions (BUG-0022), wire Sentry browser SDK to ErrorBoundary (BUG-0005), strip hardcoded admin email checks → role-based (BUG-0033), and fix auth wrapper cache fallback to distinguish "signed out" from "network down" (BUG-0025).

**Architecture:** Single-PR refactor. New `netlify/functions/_lib/auth.js` provides `requireAdmin`/`requireStaff`/`requireCron` primitives. New `src/lib/api.ts` provides `callFunction()` helper that injects `Authorization: Bearer <jwt>` header. New `src/hooks/use-is-admin.ts` returns role-based `{isAdmin, isLoading}`. `@sentry/react` wired in `src/main.tsx` + `ErrorBoundary.tsx`. Auth wrapper `me()` distinguishes `AuthApiError` from network errors. Atomic commits per BUG entry.

**Tech Stack:** `@sentry/react` (new dep, browser only), Supabase JS v2 (existing — used by auth-gate via service-role key), Netlify Functions (existing), TypeScript 5.8, ESLint 9 flat config (Phase 2G).

**Repo state at plan time:**
- Branch base = `phase2g-eslint-deadcode` (Phase 2G PR #3)
- Phase 2G + 2A + 1 PRs all stacked, awaiting merge to main
- Phase 2H spec lives on `phase2g-eslint-deadcode` branch (will be inherited by 2H branch via direct branch-from-HEAD)

**Recon-verified facts:**
- 12 frontend `fetch('/.netlify/functions/<priv>')` call sites enumerated below
- 3 hardcoded-admin-email pages (Meals/LocalTax/AdditionalServices) are orphans (zero routes) — delete
- `src/services/fix-admin-staff.ts` zero external callers — delete
- `StaffSidebar.tsx:83` uses `email === import.meta.env.VITE_ADMIN_EMAIL` (env-var version of BUG-0033) — refactor to role-based as bonus

---

## File Structure

### Files Created

| Path | Responsibility |
|---|---|
| `netlify/functions/_lib/auth.js` | Shared auth-gate primitives (`requireAdmin`, `requireStaff`, `requireCron`, `tryAuth`) + response helpers (`jsonResponse`, `handleCors`, `cors`). Single source of truth for token verification. |
| `src/lib/api.ts` | Frontend `callFunction(name, init)` helper that injects `Authorization: Bearer <session.access_token>` from `supabase.auth.getSession()`. |
| `src/hooks/use-is-admin.ts` | `useIsAdmin()` returning `{ isAdmin: boolean, isLoading: boolean }` derived from `useStaffRole()`. Replaces 12 hardcoded admin-email checks. |

### Files Modified

| Path | Change |
|---|---|
| `package.json` | Add `@sentry/react` to dependencies. |
| `src/main.tsx` | Init Sentry at top of file, guarded on `VITE_SENTRY_DSN`. |
| `src/components/ErrorBoundary.tsx` | Replace TODO with `Sentry.captureException(error, { contexts: { react: { componentStack } } })`. |
| `src/lib/supabase-wrapper.ts` | Refactor `me()` to distinguish AuthApiError vs network error; clear cache on real signout, fall back on network only. |
| `src/components/layout/StaffSidebar.tsx` | Drop dependency on `email === VITE_ADMIN_EMAIL`; use `useIsAdmin()` hook for admin-section visibility. Drop `email` prop (consumers stop passing it). |
| `src/pages/staff/CleanupToolPage.tsx:225,231` | `staff.email === 'admin@amplodge.com'` → `staff.role === 'admin' \|\| staff.role === 'owner'` (2 sites). |
| `src/services/clean-employees.ts:7,46,53,161,166` | Same role-based check (4 sites + 1 comment update). |
| `netlify/functions/create-employee.js` | Wrap handler with `requireAdmin`. Replace hand-rolled token check (lines 32-112) with auth-gate primitive. |
| `netlify/functions/delete-employee.js` | Wrap with `requireAdmin`. |
| `netlify/functions/apply-guest-request-fix.js` | Wrap with `requireAdmin`. |
| `netlify/functions/backfill-guest-tokens.js` | Wrap with `requireAdmin`. |
| `netlify/functions/debug-booking-status.js` | Wrap with `requireAdmin`. |
| `netlify/functions/generate-marketing-copy.js` | Wrap with `requireAdmin`. |
| `netlify/functions/send-email.js` | Wrap with `requireAdmin`. |
| `netlify/functions/send-sms.js` | Wrap with `requireAdmin`. |
| `netlify/functions/text-to-speech.js` | Wrap with `requireStaff` (any staff, not admin). |
| `netlify/functions/sync-channels.js` | Wrap with `requireCron` (cron header OR admin token). |
| `netlify/functions/scheduled-promo.js` | Same. |
| `netlify/functions/trigger-campaign.js` | Wrap with `requireAdmin` (replace existing partial check). |
| 12 frontend fetch sites (see §Frontend Conversion) | `fetch('/.netlify/functions/X', ...)` → `callFunction('X', ...)` |

### Files Deleted (orphans confirmed by recon)

| Path | Reason |
|---|---|
| `src/pages/staff/MealsPage.tsx` | Zero routes, zero refs (orphan, similar to Phase 2G's AdminPanelPage) |
| `src/pages/staff/LocalTaxPage.tsx` | Same |
| `src/pages/staff/AdditionalServicesPage.tsx` | Same |
| `src/services/fix-admin-staff.ts` | Zero callers; one-off migration script |

---

### Task 1: Branch + baseline

**Files:** none (git ops)

- [ ] **Step 1: Confirm working tree clean**

```bash
cd /Users/ebenezerbarning/Desktop/projectamp/amplodge
git status --short
```

Expected: empty (or untracked work outside scope).

- [ ] **Step 2: Branch off `phase2g-eslint-deadcode`**

```bash
git checkout phase2g-eslint-deadcode
git checkout -b phase2h-security
```

Expected: `Switched to a new branch 'phase2h-security'`. Spec already on tree (committed by brainstorm).

- [ ] **Step 3: Baseline snapshots**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
```

Expected: 52 (Phase 2G baseline). Record so post-refactor diff is verifiable.

```bash
npm run lint:js 2>&1 | tail -3
```

Expected: `0 errors`.

```bash
npm run build 2>&1 | tail -3
```

Expected: `✓ built in <N>s`.

---

### Task 2: Pre-flight orphan delete safety

**Files:** none (read-only)

- [ ] **Step 1: Confirm 4 orphan files have zero callers**

```bash
for f in src/pages/staff/MealsPage.tsx src/pages/staff/LocalTaxPage.tsx \
         src/pages/staff/AdditionalServicesPage.tsx src/services/fix-admin-staff.ts; do
  base=$(basename "$f" .ts); base=$(basename "$base" .tsx)
  hits=$(grep -rln "$base" src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "$f" | wc -l | tr -d ' ')
  echo "$base: $hits external refs"
done
```

Expected: all `0`. If any > 0, STOP and inspect.

- [ ] **Step 2: Confirm no dynamic imports**

```bash
for name in MealsPage LocalTaxPage AdditionalServicesPage fix-admin-staff; do
  hits=$(grep -rn "import.*['\"][^'\"]*$name" src --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' ')
  echo "$name dynamic imports: $hits"
done
```

Expected: all `0`.

- [ ] **Step 3: No commit (read-only)**

---

### Task 3: Add `@sentry/react` devdep

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install --save @sentry/react
```

Expected: package added to dependencies; lockfile updated.

- [ ] **Step 2: Verify version + React 19 compatibility**

```bash
node -e "const v=require('@sentry/react/package.json').version; console.log('@sentry/react:', v)"
```

Expected: prints version (≥ 9.x for React 19 support).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @sentry/react for browser error reporting (BUG-0005)"
```

---

### Task 4: Create auth-gate library

**Files:**
- Create: `netlify/functions/_lib/auth.js`

- [ ] **Step 1: Create directory**

```bash
mkdir -p netlify/functions/_lib
```

- [ ] **Step 2: Write `_lib/auth.js`**

Create `netlify/functions/_lib/auth.js` with this exact content:

```js
import { createClient } from '@supabase/supabase-js'

/**
 * Auth-gate primitives shared by all privileged netlify functions.
 * Verifies Supabase JWT from `Authorization: Bearer <token>` header,
 * then enforces role requirements via `staff.role`.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function adminClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase env vars (VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function unauthorized(msg = 'Missing or invalid token') {
  const err = new Error(msg)
  err.status = 401
  err.body = { error: msg }
  throw err
}

function forbidden(msg = 'Forbidden') {
  const err = new Error(msg)
  err.status = 403
  err.body = { error: msg }
  throw err
}

/**
 * Returns { user, staff } if Authorization header has a valid JWT and the
 * user has a staff record. Returns null if no header or token invalid.
 * Does NOT throw on missing token (use require* for that).
 */
export async function tryAuth(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null

  const sb = adminClient()
  const { data: { user }, error: uerr } = await sb.auth.getUser(token)
  if (uerr || !user) return null

  const { data: staff } = await sb
    .from('staff')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  return { user, staff }
}

/**
 * Throws 401 if no token / invalid token.
 * Throws 403 if no staff record.
 * Returns { user, staff }.
 */
export async function requireStaff(event) {
  const ctx = await tryAuth(event)
  if (!ctx) unauthorized()
  if (!ctx.staff) forbidden('Not a staff member')
  return ctx
}

/**
 * Throws 401 / 403 unless authenticated user has staff.role = admin or owner.
 * Returns { user, staff }.
 */
export async function requireAdmin(event) {
  const ctx = await requireStaff(event)
  const role = ctx.staff?.role
  if (role !== 'admin' && role !== 'owner') {
    forbidden('Admin role required')
  }
  return ctx
}

/**
 * For cron-only endpoints. Accepts EITHER:
 *   - x-netlify-cron header (Netlify sets it on scheduled invocations)
 *   - admin token (manual trigger)
 * Throws 401/403 otherwise.
 * Returns { user, staff } (null fields if cron-triggered).
 */
export async function requireCron(event) {
  const isCron = event.headers?.['x-netlify-cron'] || event.headers?.['X-Netlify-Cron']
  if (isCron) return { user: null, staff: null }
  return requireAdmin(event)
}

export function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...cors },
    body: JSON.stringify(body),
  }
}

export function handleCors(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' }
  }
  return null
}

export { cors }
```

- [ ] **Step 3: Smoke test imports**

```bash
node -e "import('./netlify/functions/_lib/auth.js').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'tryAuth', 'requireStaff', 'requireAdmin', 'requireCron', 'jsonResponse', 'handleCors', 'cors' ]`.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/_lib/auth.js
git commit -m "feat(netlify): add shared auth-gate library (BUG-0022)

Provides requireAdmin / requireStaff / requireCron / tryAuth primitives
plus jsonResponse / handleCors / cors helpers. All privileged functions
will use this; Phase 2H tasks 9-13 wire each function."
```

---

### Task 5: Create frontend `callFunction` helper

**Files:**
- Create: `src/lib/api.ts`

- [ ] **Step 1: Write helper**

Create `src/lib/api.ts` with this exact content:

```ts
import { supabase } from './supabase'

/**
 * Call a Netlify function with the current Supabase session token attached.
 *
 * Use this for any privileged netlify function that requires staff/admin auth.
 * For public endpoints (booking, guest portal) plain fetch() is fine.
 *
 * Example:
 *   const res = await callFunction('create-employee', {
 *     method: 'POST',
 *     body: JSON.stringify({ email, password }),
 *     headers: { 'Content-Type': 'application/json' },
 *   })
 */
export async function callFunction(name: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  return fetch(`/.netlify/functions/${name}`, { ...init, headers })
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
```

Expected: 52 (unchanged from baseline).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): add callFunction() helper that injects Supabase JWT

Frontend helper for any privileged netlify function call. Reads the
current Supabase session and attaches Authorization: Bearer header.
Phase 2H Task 14 converts existing fetch() callers to use this."
```

---

### Task 6: Create `useIsAdmin` hook

**Files:**
- Create: `src/hooks/use-is-admin.ts`

- [ ] **Step 1: Read existing `useStaffRole` to confirm shape**

```bash
grep -n "export.*useStaffRole" src/hooks/use-staff-role.tsx
head -30 src/hooks/use-staff-role.tsx
```

Confirm hook returns `{ role, loading, ... }`. If shape differs, adapt the hook below to match.

- [ ] **Step 2: Write hook**

Create `src/hooks/use-is-admin.ts` with this exact content:

```ts
import { useStaffRole } from './use-staff-role'

/**
 * Returns true when current staff has admin or owner role.
 * Replaces hardcoded `email === 'admin@amplodge.com'` checks (BUG-0033).
 *
 * Usage:
 *   const { isAdmin, isLoading } = useIsAdmin()
 *   if (isLoading) return <Skeleton />
 *   if (!isAdmin) return <NotAuthorized />
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { role, loading } = useStaffRole()
  return {
    isAdmin: role === 'admin' || role === 'owner',
    isLoading: loading,
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
```

Expected: 52.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-is-admin.ts
git commit -m "feat(hooks): add useIsAdmin() role-based check (BUG-0033)

Foundation for stripping hardcoded admin@amplodge.com literals.
Returns { isAdmin, isLoading } so callers can render skeletons
during role load, fixing the implicit BUG-0024-style flicker."
```

---

### Task 7: Wire Sentry browser SDK

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Read current `src/main.tsx` top**

```bash
head -30 src/main.tsx
```

Note current import order to insert Sentry init in correct location.

- [ ] **Step 2: Add Sentry init at top of `src/main.tsx`**

In `src/main.tsx`, add this block immediately after existing imports, before any `createRoot` or component render:

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
      // Strip Supabase JWT from breadcrumbs/request data to avoid leaking auth tokens
      if (event.request?.headers && 'Authorization' in event.request.headers) {
        event.request.headers.Authorization = '[REDACTED]'
      }
      return event
    },
  })
}
```

- [ ] **Step 3: Read current `src/components/ErrorBoundary.tsx`**

```bash
sed -n '1,60p' src/components/ErrorBoundary.tsx
```

Locate the `componentDidCatch` method and the `// TODO:` line at line 43.

- [ ] **Step 4: Update ErrorBoundary**

Add `import * as Sentry from '@sentry/react'` to the imports.

Replace the `componentDidCatch` body. Find:

```ts
componentDidCatch(error: Error, errorInfo: ErrorInfo) {
  console.error('ErrorBoundary caught an error:', error, errorInfo)
  // TODO: Log to error reporting service (e.g., Sentry)
}
```

Replace with:

```ts
componentDidCatch(error: Error, errorInfo: ErrorInfo) {
  console.error('ErrorBoundary caught an error:', error, errorInfo)
  Sentry.captureException(error, {
    contexts: {
      react: {
        componentStack: errorInfo.componentStack,
      },
    },
  })
}
```

(Adapt the exact `console.error` line to match what's actually there — the change is the TODO replacement.)

- [ ] **Step 5: Type-check**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
```

Expected: 52.

- [ ] **Step 6: Build**

```bash
npm run build 2>&1 | tail -3
```

Expected: clean build. Bundle gains a `sentry` chunk; should be ~80-100KB raw / ~30KB gzipped.

- [ ] **Step 7: Commit**

```bash
git add src/main.tsx src/components/ErrorBoundary.tsx
git commit -m "feat(observability): wire @sentry/react browser SDK (BUG-0005)

Init guarded on VITE_SENTRY_DSN — no-ops when env var unset, so dev
and preview builds don't need a DSN. ErrorBoundary now captures via
Sentry.captureException with React component stack. PII suppressed
via sendDefaultPii: false + beforeSend Authorization redaction."
```

---

### Task 8: Fix auth wrapper cache fallback

**Files:**
- Modify: `src/lib/supabase-wrapper.ts`

- [ ] **Step 1: Read current `me()` implementation**

```bash
sed -n '885,930p' src/lib/supabase-wrapper.ts
```

Confirm shape — should match the current "if (!user) check cache" pattern at lines 892-895.

- [ ] **Step 2: Replace `me()` with error-type-aware implementation**

In `src/lib/supabase-wrapper.ts`, find the existing `me()` method (around line 887). Replace its body with:

```ts
async me(): Promise<any | null> {
  let supabaseError: unknown = null
  let supabaseUser: any | null = null

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
  // Do NOT fall back to cache (would mask intentional logout / session revocation).
  if (!supabaseError) {
    clearCachedAuthSession()
    return null
  }

  // Case 3: Error happened. Distinguish AuthApiError (real 4xx auth response)
  // from network failures (timeout, fetch failure, 5xx).
  const isAuthError = supabaseError && typeof supabaseError === 'object'
    && 'name' in supabaseError
    && (supabaseError as any).name === 'AuthApiError'
  if (isAuthError) {
    clearCachedAuthSession()
    return null
  }

  // Network/server error → fall back to cache for offline tolerance.
  const cached = getCachedAuthSession()
  if (cached) {
    console.log('[SupabaseAuth] 📴 Network error — using cached session for offline access')
    return cached
  }
  return null
},
```

(Keep the trailing comma if it's part of an object literal; drop if it's a class method. Match existing surrounding syntax.)

- [ ] **Step 3: Read `onAuthStateChanged` `getSession()` initial call**

```bash
sed -n '938,970p' src/lib/supabase-wrapper.ts
```

Confirm the shape — should call `supabase.auth.getSession().then(...)` and `.catch(...)`.

- [ ] **Step 4: Update `onAuthStateChanged` initial-state path**

Find the `.then(({ data: { session } })...)` block in `onAuthStateChanged`. Replace its `.catch(() => { ... cached fallback })` arm with the same error-type discrimination:

```ts
supabase.auth.getSession().then(({ data: { session }, error }) => {
  if (error) {
    // Treat as network error — fall back to cache
    const cached = getCachedAuthSession()
    callback({ isLoading: false, user: cached })
    return
  }
  const user = session?.user
    ? { id: session.user.id, email: session.user.email }
    : null
  if (user) cacheAuthSession(user)
  else clearCachedAuthSession()  // explicit no-session = real signed out
  callback({ isLoading: false, user })
}).catch(() => {
  // Network error — try cache
  const cached = getCachedAuthSession()
  callback({ isLoading: false, user: cached })
})
```

The `.onAuthStateChange()` event listener (lines ~959-968) doesn't change — Supabase auth events are authoritative.

- [ ] **Step 5: Type-check + build**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
npm run build 2>&1 | tail -3
```

Expected: TS 52, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase-wrapper.ts
git commit -m "fix(auth): distinguish signed-out from network-down (BUG-0025)

Previously me() and onAuthStateChanged() fell back to the PouchDB-cached
session on ANY failure, masking real Supabase signouts. Now we treat:
- AuthApiError (real 4xx) → clear cache, return null (user is out)
- Network error / 5xx     → fall back to cache (offline tolerance)
- Successful null user    → clear cache, return null (real signout)
- Successful user         → return user, refresh cache"
```

---

### Task 9: Strip hardcoded admin email + delete orphan pages

**Files:**
- Delete: `src/pages/staff/MealsPage.tsx`
- Delete: `src/pages/staff/LocalTaxPage.tsx`
- Delete: `src/pages/staff/AdditionalServicesPage.tsx`
- Delete: `src/services/fix-admin-staff.ts`
- Modify: `src/pages/staff/CleanupToolPage.tsx`
- Modify: `src/services/clean-employees.ts`
- Modify: `src/components/layout/StaffSidebar.tsx`

- [ ] **Step 1: Final caller check (re-run Task 2)**

```bash
for f in src/pages/staff/MealsPage.tsx src/pages/staff/LocalTaxPage.tsx \
         src/pages/staff/AdditionalServicesPage.tsx src/services/fix-admin-staff.ts; do
  base=$(basename "$f" .ts); base=$(basename "$base" .tsx)
  hits=$(grep -rln "$base" src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "$f" | wc -l | tr -d ' ')
  echo "$base: $hits"
done
```

Expected: all `0`.

- [ ] **Step 2: Delete orphans**

```bash
git rm \
  src/pages/staff/MealsPage.tsx \
  src/pages/staff/LocalTaxPage.tsx \
  src/pages/staff/AdditionalServicesPage.tsx \
  src/services/fix-admin-staff.ts
```

- [ ] **Step 3: Update `CleanupToolPage.tsx`**

```bash
sed -n '220,235p' src/pages/staff/CleanupToolPage.tsx
```

Find the two `staff.email === 'admin@amplodge.com'` checks. Replace each:

Line 225 (current):
```ts
return staff.email === 'admin@amplodge.com' ||
```
becomes:
```ts
return staff.role === 'admin' || staff.role === 'owner' ||
```

Line 231 (current):
```ts
return staff.email !== 'admin@amplodge.com' &&
```
becomes:
```ts
return staff.role !== 'admin' && staff.role !== 'owner' &&
```

(Adjust the `||` / `&&` continuation to match surrounding clauses — re-read context first.)

- [ ] **Step 4: Update `clean-employees.ts`**

```bash
sed -n '40,60p' src/services/clean-employees.ts
sed -n '155,175p' src/services/clean-employees.ts
```

Find each of the 4 sites (lines 46, 53, 161, 166) and apply the same role-based replacement pattern as Step 3. Plus update the comment at line 7 from `// - Preserves admin@amplodge.com account` → `// - Preserves admin/owner role staff`.

- [ ] **Step 5: Update `StaffSidebar.tsx`**

```bash
sed -n '50,90p' src/components/layout/StaffSidebar.tsx
```

Find the prop signature + admin-section visibility logic. Apply these changes:

In `interface StaffSidebarProps`, drop the `email` field:
```ts
interface StaffSidebarProps {
  // (drop: email?: string | null)
  // any other props stay
}
```

In the function signature:
```ts
export function StaffSidebar(/* drop {email} param */) {
```

Add import + hook usage at top of function body:
```ts
import { useIsAdmin } from '@/hooks/use-is-admin'
// ... other imports

export function StaffSidebar() {
  const { isAdmin, isLoading: isLoadingStaff } = useIsAdmin()
  // ... rest
}
```

Replace the admin-section visibility check at line 83:
```ts
const visibleAdminItems = isLoadingStaff || isAdmin ? adminItems : []
```

(The previous code had `isLoadingStaff || !role || email === import.meta.env.VITE_ADMIN_EMAIL`. New version uses the hook.)

Replace the email display at line 123:
```ts
// Was: <p ...>{email || 'Staff'}</p>
// New: read currentUser email from auth context
import { auth } from '@/lib/db'
// ... in component:
const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
useEffect(() => {
  auth.me().then(u => setCurrentUserEmail(u?.email ?? null)).catch(() => setCurrentUserEmail(null))
}, [])
// ... in JSX:
<p ...>{currentUserEmail || 'Staff'}</p>
```

(If StaffSidebar is currently unused — Phase 2A audit BUG-0018 noted this — inspect its rendering site. If still unused, leave the prop drop but don't bother with email-display refactor.)

- [ ] **Step 6: Verify zero hardcoded admin email in src/**

```bash
grep -rn "admin@amplodge\.com" src --include="*.ts" --include="*.tsx"
```

Expected: 0 hits.

- [ ] **Step 7: Type-check + build**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
npm run build 2>&1 | tail -3
```

Expected: TS ≤ 52, build clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(auth): replace hardcoded admin email with role-based checks (BUG-0033)

- Delete 3 orphan pages (Meals/LocalTax/AdditionalServices, zero routes)
- Delete fix-admin-staff.ts (zero callers, similar to Phase 2G seed-* removal)
- CleanupToolPage: 2 sites email→role
- clean-employees.ts: 4 sites email→role + comment update
- StaffSidebar: use useIsAdmin() hook, drop email prop dependency

App is now multi-tenant deployable — no hardcoded admin@amplodge.com
literal in src/ runtime code."
```

---

### Task 10: Wrap 8 admin-only netlify functions with `requireAdmin`

**Files:**
- Modify: `netlify/functions/create-employee.js`
- Modify: `netlify/functions/delete-employee.js`
- Modify: `netlify/functions/apply-guest-request-fix.js`
- Modify: `netlify/functions/backfill-guest-tokens.js`
- Modify: `netlify/functions/debug-booking-status.js`
- Modify: `netlify/functions/generate-marketing-copy.js`
- Modify: `netlify/functions/send-email.js`
- Modify: `netlify/functions/send-sms.js`

For each file in this task, apply the same wrapping pattern:

- [ ] **Step 1: Wrap `create-employee.js`**

```bash
sed -n '1,30p' netlify/functions/create-employee.js
```

Add at top:
```js
import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'
```

Replace the existing handler body. The current `handler` function (after the verification comment block from Phase 1) starts with manual CORS + body parse. Replace its top with:

```js
export const handler = async function (event) {
  const corsResp = handleCors(event); if (corsResp) return corsResp

  let ctx
  try {
    ctx = await requireAdmin(event)
  } catch (e) {
    return jsonResponse(e.status, e.body)
  }

  // Existing handler body continues here. ctx.user (Supabase user) and ctx.staff
  // (staff row) are available for audit logging.
  // ...
```

Drop the existing manual `event.httpMethod !== 'POST'` 405 check if `requireAdmin` already handles auth; replace with method check after auth-gate.

- [ ] **Step 2: Wrap `delete-employee.js`**

Read first 30 lines:
```bash
sed -n '1,30p' netlify/functions/delete-employee.js
```

Add same import + wrap pattern as Step 1.

- [ ] **Step 3: Wrap `apply-guest-request-fix.js`**

Same pattern.

- [ ] **Step 4: Wrap `backfill-guest-tokens.js`**

Same pattern.

- [ ] **Step 5: Wrap `debug-booking-status.js`**

Same pattern.

- [ ] **Step 6: Wrap `generate-marketing-copy.js`**

Same pattern.

- [ ] **Step 7: Wrap `send-email.js`**

Same pattern.

- [ ] **Step 8: Wrap `send-sms.js`**

Same pattern.

- [ ] **Step 9: Verify all 8 have `requireAdmin`**

```bash
for f in netlify/functions/{create-employee,delete-employee,apply-guest-request-fix,backfill-guest-tokens,debug-booking-status,generate-marketing-copy,send-email,send-sms}.js; do
  grep -q "requireAdmin" "$f" && echo "✓ $f" || echo "✗ MISSING $f"
done
```

Expected: all `✓`.

- [ ] **Step 10: Build (smoke; netlify build script doesn't run on `npm run build` — checks Vite still works)**

```bash
npm run build 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add netlify/functions/
git commit -m "feat(netlify): gate 8 admin-only fns with requireAdmin (BUG-0022)

- create-employee, delete-employee
- apply-guest-request-fix, backfill-guest-tokens, debug-booking-status
- generate-marketing-copy
- send-email, send-sms

All return 401 for missing/invalid token, 403 for non-admin role."
```

---

### Task 11: Wrap `text-to-speech` with `requireStaff`

**Files:**
- Modify: `netlify/functions/text-to-speech.js`

- [ ] **Step 1: Read top of file**

```bash
sed -n '1,30p' netlify/functions/text-to-speech.js
```

- [ ] **Step 2: Wrap with `requireStaff`**

Add import:
```js
import { requireStaff, jsonResponse, handleCors } from './_lib/auth.js'
```

Wrap handler:
```js
export const handler = async function (event) {
  const corsResp = handleCors(event); if (corsResp) return corsResp

  try {
    await requireStaff(event)
  } catch (e) {
    return jsonResponse(e.status, e.body)
  }

  // ... existing handler body
}
```

- [ ] **Step 3: Verify**

```bash
grep -n "requireStaff" netlify/functions/text-to-speech.js
```

Expected: 2 hits (import + call).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/text-to-speech.js
git commit -m "feat(netlify): gate text-to-speech with requireStaff (any staff role)"
```

---

### Task 12: Wrap cron functions with `requireCron`

**Files:**
- Modify: `netlify/functions/sync-channels.js`
- Modify: `netlify/functions/scheduled-promo.js`

- [ ] **Step 1: Wrap `sync-channels.js`**

```bash
sed -n '1,30p' netlify/functions/sync-channels.js
```

Add import:
```js
import { requireCron, jsonResponse, handleCors } from './_lib/auth.js'
```

Wrap handler:
```js
export const handler = async function (event) {
  const corsResp = handleCors(event); if (corsResp) return corsResp

  try {
    await requireCron(event)
  } catch (e) {
    return jsonResponse(e.status, e.body)
  }

  // ... existing handler body (cron logic)
}
```

- [ ] **Step 2: Wrap `scheduled-promo.js`**

Same pattern.

- [ ] **Step 3: Verify**

```bash
grep -n "requireCron" netlify/functions/sync-channels.js netlify/functions/scheduled-promo.js
```

Expected: 4 hits total (import + call × 2 files).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/sync-channels.js netlify/functions/scheduled-promo.js
git commit -m "feat(netlify): gate cron fns with requireCron (BUG-0022)

requireCron accepts EITHER x-netlify-cron header (Netlify-set on
scheduled invocations) OR admin token (manual trigger from staff UI)."
```

---

### Task 13: Wrap `trigger-campaign` with `requireAdmin`

**Files:**
- Modify: `netlify/functions/trigger-campaign.js`

- [ ] **Step 1: Read existing auth check**

```bash
grep -n "Authorization\|authorization" netlify/functions/trigger-campaign.js
```

Existing partial check (1 hit per recon). Decide whether to keep or replace.

- [ ] **Step 2: Replace with `requireAdmin`**

Add import + wrap handler same as Task 10. Remove any existing manual Authorization header check (`requireAdmin` supersedes it).

- [ ] **Step 3: Verify**

```bash
grep -n "requireAdmin" netlify/functions/trigger-campaign.js
```

Expected: 2 hits.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/trigger-campaign.js
git commit -m "feat(netlify): gate trigger-campaign with requireAdmin (BUG-0022)

Replaces existing partial Authorization-header check with the canonical
auth-gate primitive. Now uniformly returns 401/403 like other priv fns."
```

---

### Task 14: Convert frontend fetch sites to `callFunction`

**Files (12 fetch sites across 8 files):**
- Modify: `src/components/marketing/QRCodeGenerator.tsx` (lines 76, 116)
- Modify: `src/components/voice-agent/useVoiceAgent.ts` (line 165)
- Modify: `src/pages/staff/ChannelsPage.tsx` (line 44)
- Modify: `src/pages/staff/MarketingPage.tsx` (lines 78, 104, 155)
- Modify: `src/services/email-service.ts` (line 40)
- Modify: `src/services/sms-service.ts` (line 63)
- Modify: `src/pages/staff/EmployeesPage.tsx` (lines 189, 421)

For each file:

- [ ] **Step 1: Add import**

At top of file, add (or merge into existing imports):
```ts
import { callFunction } from '@/lib/api'
```

- [ ] **Step 2: Replace fetch calls**

Pattern transform — find every site of:
```ts
const response = await fetch('/.netlify/functions/<name>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
```

Replace with:
```ts
const response = await callFunction('<name>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
```

(Same `init` object, just function name instead of full URL string. The `Authorization` header is auto-injected by `callFunction`.)

Apply to all 12 sites:
- `QRCodeGenerator.tsx:76` → `callFunction('send-email', ...)`
- `QRCodeGenerator.tsx:116` → `callFunction('send-sms', ...)`
- `useVoiceAgent.ts:165` → `callFunction('text-to-speech', ...)`
- `ChannelsPage.tsx:44` → `callFunction('sync-channels', { method: 'POST' })`
- `MarketingPage.tsx:78` → `callFunction('trigger-campaign', ...)`
- `MarketingPage.tsx:104` → `callFunction('trigger-campaign', ...)`
- `MarketingPage.tsx:155` → `callFunction('generate-marketing-copy', ...)`
- `email-service.ts:40` → `callFunction('send-email', ...)`
- `sms-service.ts:63` → `callFunction('send-sms', ...)`
- `EmployeesPage.tsx:189` → `callFunction('delete-employee', ...)`
- `EmployeesPage.tsx:421` → `callFunction('create-employee', ...)`

- [ ] **Step 3: Verify zero remaining priv fetches**

```bash
grep -rn "fetch.*['\"]\/\.netlify\/functions\/\(create-employee\|delete-employee\|generate-marketing\|send-email\|send-sms\|text-to-speech\|sync-channels\|backfill\|apply-guest-request\|debug-booking\|trigger-campaign\)" src/ --include="*.ts" --include="*.tsx"
```

Expected: 0 hits.

- [ ] **Step 4: Type-check + build**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
npm run build 2>&1 | tail -3
```

Expected: TS ≤ 52, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor(api): route 12 priv fetch sites through callFunction() (BUG-0022)

All privileged netlify function callers now go through the
Supabase-JWT-injecting helper. Zero bare fetch('/.netlify/functions/<priv>')
call sites remain in src/."
```

---

### Task 15: Final verification

**Files:** none (read-only)

- [ ] **Step 1: Build clean**

```bash
rm -rf node_modules/.vite dist
npm run build 2>&1 | tail -10
```

Expected: `✓ built in <N>s`. Bundle has new sentry chunk; total slightly larger.

- [ ] **Step 2: Lint clean**

```bash
npm run lint:js 2>&1 | tail -3
echo "TS errors: $(npm run lint:types 2>&1 | grep -c 'error TS')"
```

Expected: lint:js `0 errors`; TS errors ≤ 52.

- [ ] **Step 3: No hardcoded admin email in src**

```bash
grep -rn "admin@amplodge\.com" src --include="*.ts" --include="*.tsx" | wc -l | tr -d ' '
```

Expected: `0`.

- [ ] **Step 4: Auth-gate present in all 11+2 priv fns**

```bash
echo "=== Admin gate (8) ==="
for f in netlify/functions/{create-employee,delete-employee,apply-guest-request-fix,backfill-guest-tokens,debug-booking-status,generate-marketing-copy,send-email,send-sms,trigger-campaign}.js; do
  grep -q "requireAdmin" "$f" && echo "✓ $f" || echo "✗ $f"
done
echo "=== Staff gate (1) ==="
grep -q "requireStaff" netlify/functions/text-to-speech.js && echo "✓ text-to-speech.js" || echo "✗ text-to-speech.js"
echo "=== Cron gate (2) ==="
for f in netlify/functions/{sync-channels,scheduled-promo}.js; do
  grep -q "requireCron" "$f" && echo "✓ $f" || echo "✗ $f"
done
```

Expected: all `✓`.

- [ ] **Step 5: Sentry init + capture present**

```bash
grep -n "Sentry.init" src/main.tsx
grep -n "Sentry.captureException" src/components/ErrorBoundary.tsx
```

Expected: 1 hit each.

- [ ] **Step 6: Auth wrapper distinguishes error types**

```bash
grep -n "AuthApiError" src/lib/supabase-wrapper.ts
grep -n "clearCachedAuthSession" src/lib/supabase-wrapper.ts | wc -l | tr -d ' '
```

Expected: AuthApiError present; clearCachedAuthSession ≥ 2 calls (case 2 + case 3 of `me()`, plus initial getSession path).

- [ ] **Step 7: No bare priv fetch in src**

```bash
grep -rn "fetch.*['\"]\/\.netlify\/functions\/\(create-employee\|delete-employee\|generate-marketing\|send-email\|send-sms\|text-to-speech\|sync-channels\|backfill\|apply-guest-request\|debug-booking\|trigger-campaign\)" src/ --include="*.ts" --include="*.tsx" | wc -l | tr -d ' '
```

Expected: `0`.

- [ ] **Step 8: No commit (verification step)**

---

### Task 16: Push branch + open PR

**Files:** none (git ops)

- [ ] **Step 1: Verify clean working tree + commit log**

```bash
git status --short
git log --oneline phase2g-eslint-deadcode..HEAD
```

Expected: empty status; ~12 commits.

- [ ] **Step 2: Push branch**

```bash
git push -u origin phase2h-security
```

Expected: branch pushed; PR URL printed.

- [ ] **Step 3: Open PR against `phase2g-eslint-deadcode`**

```bash
gh pr create --base phase2g-eslint-deadcode --title "Phase 2H: Security hardening + Sentry + role-based admin" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-05-10-phase2h-security-design.md.
Plan: docs/superpowers/plans/2026-05-10-phase2h-security.md.

> Base = phase2g-eslint-deadcode (PR #3). Merge order: PR #1 → main, PR #2 → main, PR #3 → main, this PR → main.

## Closes audit entries (4 of 34)

- BUG-0005 (P0, score 10.0) — ErrorBoundary now logs to Sentry
- BUG-0022 (P1, score 5.0) — Netlify priv fns gated with admin/staff/cron auth
- BUG-0025 (P1, score 4.0) — Auth wrapper distinguishes signed-out vs network-down
- BUG-0033 (P2, score 2.0) — Hardcoded admin@amplodge.com replaced with role-based useIsAdmin()

## What

- New `netlify/functions/_lib/auth.js`: requireAdmin / requireStaff / requireCron / tryAuth + jsonResponse / handleCors / cors helpers
- New `src/lib/api.ts`: callFunction(name, init) helper that injects Supabase JWT
- New `src/hooks/use-is-admin.ts`: role-based admin check
- 11 privileged netlify fns wrapped: create-employee, delete-employee, apply-guest-request-fix, backfill-guest-tokens, debug-booking-status, generate-marketing-copy, send-email, send-sms, trigger-campaign (admin); text-to-speech (staff); sync-channels, scheduled-promo (cron-or-admin)
- 12 frontend fetch sites converted to `callFunction()`
- Sentry browser SDK wired in main.tsx + ErrorBoundary.tsx (guarded on VITE_SENTRY_DSN)
- Auth wrapper me() and onAuthStateChanged() distinguish AuthApiError from network errors
- 4 orphan files deleted (Meals/LocalTax/AdditionalServices pages + fix-admin-staff service)
- 12 hardcoded admin@amplodge.com sites stripped to role-based checks

## Verification

| Check | Baseline | Result |
|---|---|---|
| `npm run lint:js` errors | 0 | 0 |
| `npm run lint:types` errors | 52 | ≤ 52 |
| `npm run build` | green | green |
| Hardcoded admin@amplodge.com in src | 12 | 0 |
| Priv fns w/ auth gate | 0 | 11 (+ 2 cron) |
| Frontend bare priv fetch sites | 12 | 0 |
| Sentry init present | no | yes (guarded) |
| Auth wrapper AuthApiError handling | no | yes |

## Reviewer asks

1. Verify SUPABASE_SERVICE_ROLE_KEY env var present in Netlify (auth-gate fns 500 without it).
2. Optional: set VITE_SENTRY_DSN in Netlify env to enable error reporting in production. Without it, init no-ops.
3. Smoke test in preview deploy:
   - hit `/.netlify/functions/create-employee` without token → expect 401
   - hit with non-admin token → expect 403
   - hit with admin token → expect 200 (or 4xx for app reasons, NOT 401/403)
4. Phase 2A2 follow-ups noted: Supabase RLS policy audit, server-side Sentry, service-worker cache fix.
EOF
)"
```

Expected: PR URL printed.

---

## What's NOT in this plan (deferred)

- **Phase 2A2** — server-side Sentry in netlify fns; Supabase RLS policy audit (some policies may also use hardcoded `admin@amplodge.com`); service-worker stale-cache fix (BUG-0013)
- **Phase 2D** — typed `db.<table>` accessors enabling tighter eslint
- **Phase 2E/F** — page perf, dual-nav, query perf
- **Phase 2B/C** — Realtime + bundle lazy-load
