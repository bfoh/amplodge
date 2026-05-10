# Phase 2 Audit — Ranked Backlog

**Generated:** 2026-05-10
**Spec:** docs/superpowers/specs/2026-05-10-phase2a-bug-audit-design.md
**Sources:** 116 root MDs (84 fix-themed), src/ greps, git log (180d), code error patterns
**Coverage:** TBD% of fix-docs cited

## Summary

- Total entries: TBD
- Critical (P0, score ≥ 8.0): TBD
- High (P1, score 4.0–7.9): TBD
- Medium (P2, score 2.0–3.9): TBD
- Low (P3, score < 2.0): TBD
- By owner: A2=TBD, B=TBD, C=TBD, D=TBD, E=TBD, F=TBD, G=TBD, H=TBD
- Top 10 root-cause themes: TBD

## Ranking Schema (reference)

`Score = (impact × frequency) / effort_weight`

Impact 1–5: 5=data loss/security, 4=feature broken, 3=degraded, 2=annoyance, 1=cosmetic.
Frequency 1–5: 5=every session/everyone, 4=every session/some, 3=weekly, 2=monthly, 1=rare.
Effort weight: S=1 (≤1d, single file), M=2 (1–3d, multi-file), L=4 (≥3d, schema/wrapper).

Owner key: B=Realtime/polling, C=Bundle, D=Wrapper internals, E=Page perf, F=Query perf, G=Eslint+dead-code, H=Auth/security, A2=Needs deeper audit.

## Entries

<!-- BUG entries appended in Tasks 6, 7, 8, 9, 10. Re-sorted + renumbered in Task 11. -->

### BUG-0001 — Activity logs co-mingled with `contactMessages` table (schema misuse)
- **Category:** activity-log
- **Impact:** 4
- **Frequency:** 5
- **Effort:** L
- **Score:** (4 × 5) / 4 = 5.0
- **Sources:** `BOOKING_DELETION_DUPLICATION_FIX.md`, `src/services/activity-log-service.ts:248,266,720,793`, `src/pages/staff/ReservationHistoryPage.tsx:103,111`
- **Symptom:** Booking deletion creates duplicate history entries (one as "contact message", one as activity log). Reservation history page must dedup with `if contact.status === 'activity_log' continue`. Stale activity-log fallback writes to `contactMessages` whenever the dedicated table fails.
- **Root-cause hypothesis:** Original Blink-era schema lacked an `activityLogs` table; service falls back to writing rows into `contactMessages` with `status='activity_log'`. Supabase migrations now include a real `activity_logs` table but the fallback path is still in code AND `ReservationHistoryPage` still queries `contact_messages` for activity rows. Two write paths + two read paths = duplication and stale data.
- **Suggested owner:** D (wrapper internals → typed table accessors so cross-table writes can't compile) + F (kill the fallback read path)
- **Notes:** REGRESSED. MD says "FIXED" via dedup filter, but root cause (dual storage) still in code. Fix: remove all `contactMessages` activity-log fallback paths, treat `activity_logs` as canonical, migrate any straggler rows out.

### BUG-0002 — Admin tab flickers on refresh, "permanent fix" is a `useRef` papering over auth race
- **Category:** auth
- **Impact:** 3
- **Frequency:** 4
- **Effort:** M
- **Score:** (3 × 4) / 2 = 6.0
- **Sources:** `EMPLOYEE_TAB_FIX_FINAL.md`, `EMPLOYEE_TAB_PERMANENT_FIX.md`, `src/components/layout/AppLayout.tsx:54,75-106,121-130` (admin-state logging)
- **Symptom:** On page refresh, admin section flickers off then on as `isLoadingStaff` resolves. `EMPLOYEE_TAB_FIX_FINAL.md` ships a `lastKnownAdminStateRef` workaround.
- **Root-cause hypothesis:** Auth state has no stable initial value during async role lookup. Hardcoded `currentUser?.email === 'admin@amplodge.com'` escape hatch (not portable, not multi-tenant). Three layers (`canManageEmployees` / `role === 'admin'` / email check) compete instead of single source of truth. Wrapper's `auth.onAuthStateChanged` emits `{isLoading: true, user: null}` first then real state — consumers must remember last known good.
- **Suggested owner:** D (wrapper auth surface) + E (AppLayout simplification once D lands)
- **Notes:** Hardcoded admin email = portability hazard for any other deployment.

### BUG-0003 — Dual login pages: `AuthPage.tsx` (orphaned) + `StaffLoginPage.tsx` (wired)
- **Category:** auth
- **Impact:** 2
- **Frequency:** 1
- **Effort:** S
- **Score:** (2 × 1) / 1 = 2.0
- **Sources:** `STABILITY_AUDIT_REPORT.md` §1, `src/pages/staff/AuthPage.tsx` (still on disk), `src/App.tsx:8,200` (uses StaffLoginPage)
- **Symptom:** Two login implementations live in tree. AuthPage allows signup (shouldn't exist for staff), lacks staff-record verification, lacks first-login password flow. AuthPage is unreferenced but ships in the bundle if anything imports it.
- **Root-cause hypothesis:** Migration to StaffLoginPage never deleted the orphan. Audit doc from Oct 2025 already flagged this and prescribed delete; never done.
- **Suggested owner:** G (dead-code purge)
- **Notes:** Verify zero imports before delete: `grep -rn "AuthPage" src/`.

### BUG-0004 — Dual navigation systems: `AppLayout` hardcoded array + orphan `StaffSidebar`
- **Category:** infra
- **Impact:** 3
- **Frequency:** 4
- **Effort:** M
- **Score:** (3 × 4) / 2 = 6.0
- **Sources:** `STABILITY_AUDIT_REPORT.md` §2, `src/components/layout/AppLayout.tsx:41,253,281` (hardcoded `navigation` array), `src/components/layout/StaffSidebar.tsx` (unreferenced)
- **Symptom:** AppLayout has its own hardcoded navigation array with admin-tab logic baked in (BUG-0002). StaffSidebar.tsx exists with proper RBAC integration but is never rendered. Maintenance hazard: changes to nav need touching wrong file half the time.
- **Root-cause hypothesis:** Migration started, never completed. Audit doc Oct 2025 prescribed switching AppLayout → StaffSidebar; never done.
- **Suggested owner:** E (page perf + AppLayout simplification) — replace AppLayout's nav with StaffSidebar render, then delete StaffSidebar OR collapse them.
- **Notes:** Pairs with BUG-0002 — fixing the nav unification is a chance to fix the admin-tab race in one shot.

### BUG-0005 — Admin staff record auto-create runs on every auth state change w/ no debounce
- **Category:** auth
- **Impact:** 3
- **Frequency:** 5
- **Effort:** S
- **Score:** (3 × 5) / 1 = 15.0
- **Sources:** `STABILITY_AUDIT_REPORT.md` §3, §6, `src/App.tsx:130-163` (ensureAdminStaffRecord inside onAuthStateChanged)
- **Symptom:** Every `onAuthStateChanged` event triggers `db.staff.list({ where: { userId } })` + possibly `db.staff.create()`. Concurrent calls race to create duplicate staff rows.
- **Root-cause hypothesis:** Logic placed in callback w/ only an `isCreating` boolean guard — not enough for cross-render races. No debounce, no memoization. Should run once at app boot, not per state event.
- **Suggested owner:** E (App.tsx cleanup)
- **Notes:** P0 — easy fix, recurrent waste, can produce duplicate staff records.

### BUG-0006 — Hardcoded admin email `admin@amplodge.com` baked into auth flow
- **Category:** auth
- **Impact:** 4
- **Frequency:** 1
- **Effort:** M
- **Score:** (4 × 1) / 2 = 2.0
- **Sources:** `EMPLOYEE_TAB_FIX_FINAL.md`, `src/components/layout/AppLayout.tsx:64,70`, `src/App.tsx:157`
- **Symptom:** Multiple call sites special-case `admin@amplodge.com`. App is hostel-management SaaS — not deployable to a second tenant without code edit.
- **Root-cause hypothesis:** Bootstrapping shortcut never replaced. Should use `staff.role === 'owner'` as canonical signal.
- **Suggested owner:** H (security hardening + role-driven auth)
- **Notes:** Becomes blocking when a second hostel deploys.

### BUG-0007 — "Last resort temporary ID" pattern when `currentUser` missing during booking creation
- **Category:** booking
- **Impact:** 3
- **Frequency:** 2
- **Effort:** S
- **Score:** (3 × 2) / 1 = 6.0
- **Sources:** `src/pages/staff/BookingsPage.tsx:333,335`, `src/pages/staff/CalendarPage.tsx:298,300`
- **Symptom:** When `auth.me()` returns null mid-booking, code generates `temp_<random>` as `createdBy`. Activity logs and reports show "temp_xxx" instead of real user.
- **Root-cause hypothesis:** Network race between user fetch and form submit. No retry. Same pattern at two pages = abstraction missing.
- **Suggested owner:** F (booking-engine query perf has user-fetch fan-out logic) + E (extract shared `useCurrentStaffId()` hook)
- **Notes:** Already in code with `console.log('Last resort:')` — finds itself in error logs.

### BUG-0008 — Auth wrapper falls back to cached session "if Supabase says no user"
- **Category:** auth
- **Impact:** 4
- **Frequency:** 2
- **Effort:** M
- **Score:** (4 × 2) / 2 = 4.0
- **Sources:** `src/lib/supabase-wrapper.ts:892-895` (`// might be temporary network issue`)
- **Symptom:** When Supabase auth returns no user, wrapper trusts cached session. Cache is PouchDB-backed; if Supabase intentionally signed user out (revoked, deleted), wrapper still treats them as logged in offline.
- **Root-cause hypothesis:** Offline-first auth design conflated "network down" with "no auth". Real signed-out events get masked by cache hit.
- **Suggested owner:** H (security — auth correctness) + D (wrapper internals)
- **Notes:** Distinguish "Supabase responded `null`" (signed out) from "Supabase didn't respond" (network down). Only the latter should fall back to cache.

### BUG-0009 — 80+ files used `const db = (db as any)` shim; Phase 1 removed locals but global `db` typed as `any` in `src/lib/db.ts`
- **Category:** data-layer
- **Impact:** 2
- **Frequency:** 5
- **Effort:** L
- **Score:** (2 × 5) / 4 = 2.5
- **Sources:** `STABILITY_AUDIT_REPORT.md` §7, Phase 1 spec note in `src/lib/db.ts:10-15`
- **Symptom:** TS catches nothing about table names, column names, return shapes. Schema drift between Supabase migrations and consumer code is invisible until runtime.
- **Root-cause hypothesis:** Wrapper API was loosely typed since Blink era. Phase 1 centralised the `any` cast for consistency; Phase 2 needs typed table accessors generated from `Tables<>` in `src/lib/supabase.ts`.
- **Suggested owner:** D (wrapper internals — generate `db.<table>.list()` with full row types from `Tables<>`).
- **Notes:** Foundational for catching most other bugs at compile time.

### BUG-0010 — Bookings can be created with missing `checkIn`/`checkOut` dates; downstream pages defensively render `'N/A'`
- **Category:** booking
- **Impact:** 3
- **Frequency:** 2
- **Effort:** M
- **Score:** (3 × 2) / 2 = 3.0
- **Sources:** `CRITICAL_ISSUES_FIXED.md` §2, `BOOKING_RESERVATIONS_FIXES_COMPLETE.md` §1, `src/pages/staff/InvoicesPage.tsx`
- **Symptom:** InvoicesPage crashed on `format(new Date(invoice.checkIn))` when date was malformed. Patched with `invoice.checkIn ? format(...) : 'N/A'`. ReservationsPage filters out bookings missing `checkIn || checkOut || guestName`.
- **Root-cause hypothesis:** Booking-create paths don't enforce required fields. Could be SQL `NOT NULL` + `CHECK` constraints in `bookings` schema. Currently pushed to client-side defense.
- **Suggested owner:** F (query correctness) + Phase 3 schema audit (separate sub-project)
- **Notes:** Defensive `N/A` is permanent — but the invalid rows persist and pollute reports.

### BUG-0011 — `ErrorBoundary` does not log to a reporting service
- **Category:** infra
- **Impact:** 2
- **Frequency:** 5
- **Effort:** S
- **Score:** (2 × 5) / 1 = 10.0
- **Sources:** `src/components/ErrorBoundary.tsx:43` `// TODO: Log to error reporting service (e.g., Sentry)`
- **Symptom:** When app crashes, only console.error fires. No external visibility into production crashes.
- **Root-cause hypothesis:** Sentry / Bugsnag / Logflare integration deferred indefinitely.
- **Suggested owner:** H (observability) — wire Sentry or similar; needs DSN env var.
- **Notes:** Choice of provider deferred to user. Quickest = Sentry free tier.

### BUG-0012 — 14 `setInterval` polls running concurrently across pages
- **Category:** render
- **Impact:** 3
- **Frequency:** 5
- **Effort:** L
- **Score:** (3 × 5) / 4 = 3.75
- **Sources:** `src/main.tsx:16`, `src/App.tsx:122` (auth check 30s), `src/components/OfflineStatusBanner.tsx:36` (sync 5s), `src/hooks/use-currency.ts:28`, `src/lib/network-status.ts:101`, `src/pages/staff/ActivityLogsPage.tsx:55`, `src/pages/staff/AnalyticsPage.tsx:111` (5min reload), `src/pages/staff/ClockPage.tsx:44` (1s clock), `src/pages/staff/HRPage.tsx:291,376`, `src/pages/staff/ReservationHistoryPage.tsx:559`, `src/pages/staff/DashboardPage.tsx:44`, `src/pages/staff/MyRevenuePage.tsx:502`
- **Symptom:** Idle staff tab burns CPU + makes constant network calls. Battery drain on tablets, slow UI on cheap hardware, expensive on Ghana mobile data.
- **Root-cause hypothesis:** No realtime invalidation primitive. Each page rolls its own polling. Auth check at 30s + sync at 5s + analytics at 5min + clock at 1s overlap unnecessarily.
- **Suggested owner:** B (Realtime + kill polling)
- **Notes:** Some intervals are legitimate (clock 1s, network heartbeat). Most data-fetching intervals can be replaced with `supabase.channel('table-name').on('postgres_changes', ...)`.

### BUG-0013 — Service files swallow errors in 395+ catch blocks (`console.warn` and continue)
- **Category:** data-layer
- **Impact:** 3
- **Frequency:** 5
- **Effort:** L
- **Score:** (3 × 5) / 4 = 3.75
- **Sources:** `/tmp/audit-greps/swallowed-errors.txt` (395 sites), DEEP_CHECKOUT_EMAIL_INVESTIGATION.md "Errors were being caught but not properly logged"
- **Symptom:** Failures (DB write fails, email send fails, sync fails) print a console warning and continue. User sees "success" while real failure persists.
- **Root-cause hypothesis:** Defensive copy-pasted `try/catch` w/o classifying which failures are recoverable vs which must surface. No central error bus.
- **Suggested owner:** A2 (deeper audit needed — needs per-site triage). After H ships an error reporter (BUG-0011), most can route there.
- **Notes:** 395 is too many to fix at once. Approach: triage in batches by category — auth catches first, then data writes, then network calls.

### BUG-0014 — Production bundle: `index` 398KB, `charts` 409KB, `jspdf` 382KB, `html2canvas` 199KB shipped on every page load
- **Category:** bundle
- **Impact:** 4
- **Frequency:** 5
- **Effort:** M
- **Score:** (4 × 5) / 2 = 10.0
- **Sources:** `npm run build` output (Phase 1 baseline)
- **Symptom:** First paint slow on Ghana mobile (cited in `src/lib/supabase.ts` Netlify proxy comment). 1.4MB raw before gzip on a hostel-management dashboard.
- **Root-cause hypothesis:** `jspdf` + `html2canvas` only used by invoice download/print. `charts` (recharts) only used by Analytics + MyRevenue + Reports. None lazy-loaded at function-call time.
- **Suggested owner:** C (bundle audit — lazy-import within service functions, not top-level imports).
- **Notes:** Phase 1 page-level lazy-load already shipped (lazy() in App.tsx). This is library-level lazy-load — different lever.

### BUG-0015 — `ESLint` config missing for ESLint 9 (lint:js script broken)
- **Category:** infra
- **Impact:** 2
- **Frequency:** 5
- **Effort:** S
- **Score:** (2 × 5) / 1 = 10.0
- **Sources:** Phase 1 verification (T13 step 4)
- **Symptom:** `npm run lint:js` fails with "ESLint couldn't find an eslint.config.(js|mjs|cjs) file". Repo has `.eslintrc.*` from ESLint 8 era. CI pipeline either skipped or broken.
- **Root-cause hypothesis:** ESLint 9 introduced flat config; no migration done.
- **Suggested owner:** G (dead-code purge + CI gates)
- **Notes:** Quick fix: `npx @eslint/migrate-config .eslintrc.json` or write `eslint.config.js` from scratch.

### BUG-0016 — Netlify functions (`create-employee`, `delete-employee`, etc.) have no admin-token verification
- **Category:** auth
- **Impact:** 5
- **Frequency:** 1
- **Effort:** S
- **Score:** (5 × 1) / 1 = 5.0
- **Sources:** Phase 1 audit notes in `netlify/functions/create-employee.js` header comment
- **Symptom:** Anyone with the `/.netlify/functions/create-employee` URL can create staff users (with admin Supabase service-role key power). No `Authorization` header check.
- **Root-cause hypothesis:** Live function was ported from old Blink-Deno version that did `blink.auth.me()` before doing work. Port lost the auth gate.
- **Suggested owner:** H (auth-gate netlify fns — add JWT verification + role check before privileged operations).
- **Notes:** SECURITY. Should ship before BUG-0011 / BUG-0014 / Phase 3 work. P0 by impact even though frequency is low (no one's exploited it yet — that anyone knows of).

### BUG-0017 — `seed-admin.ts` and `seed-sample-data.ts` flagged @deprecated but still callable + still exported
- **Category:** data-layer
- **Impact:** 2
- **Frequency:** 1
- **Effort:** S
- **Score:** (2 × 1) / 1 = 2.0
- **Sources:** `src/services/seed-admin.ts:3-7`, `src/services/seed-sample-data.ts:3-6`, no live consumers per Phase 1 grep
- **Symptom:** Two ~deprecated~ services that no caller invokes; could mutate production data if accidentally wired.
- **Root-cause hypothesis:** Marked but not removed. Compiler still bundles them.
- **Suggested owner:** G (dead-code purge)
- **Notes:** Verify zero imports before delete; Phase 1 grep showed zero. Probably safe to delete entirely.

### BUG-0019 — `ProtectedRoute` permission-check loop ("Checking Permissions..." flash)
- **Category:** auth
- **Impact:** 4
- **Frequency:** 4
- **Effort:** M
- **Score:** (4 × 4) / 2 = 8.0
- **Sources:** `APP_STABILITY_FIXED.md`, `src/components/ProtectedRoute.tsx`
- **Symptom:** App stuck on "Checking permissions..." spinner, refreshing forever. Fix uses `isCheckingRef` to prevent reentrancy.
- **Root-cause hypothesis:** `useEffect` dependency array includes `[role, loading, userId, navigate, retryCount, location.pathname]` — every state change retriggers effect. Fix is a guard ref, not a redesign. Real fix: move permission check out of `useEffect` (use a hook return value derived from auth state, not a side-effect).
- **Suggested owner:** D (auth wrapper) + E (ProtectedRoute simplification)
- **Notes:** Pairs with BUG-0002 + BUG-0005. All three are symptoms of the same auth-state-as-side-effect anti-pattern.

### BUG-0020 — Two parallel "room" tables: `rooms` + `properties` — UI must read from properties to match backend
- **Category:** booking
- **Impact:** 4
- **Frequency:** 5
- **Effort:** L
- **Score:** (4 × 5) / 4 = 5.0
- **Sources:** `ROOM_AVAILABILITY_SYNC_FIX.md`, `src/pages/RoomsPage.tsx`, `src/pages/BookingPage.tsx`, `src/pages/staff/OnsiteBookingPage.tsx`
- **Symptom:** Frontend showed wrong availability (0 Deluxe / 1 Standard / 0 Family) vs backend (1 Deluxe / 6 Standard / 1 Family). Fix forced UI to read from `properties` table everywhere.
- **Root-cause hypothesis:** Schema has both `rooms` and `properties`. Original `rooms` table is now legacy/stale. The two tables were not consolidated, just routed-around. Booking writes still write to `rooms` (per `src/lib/supabase.ts` Tables type), so they drift from `properties`. Real fix: pick one, migrate the other away.
- **Suggested owner:** A2 (deeper schema audit needed; touches SQL migrations not just TS).
- **Notes:** Highest-leverage data-layer cleanup. Until resolved, every "rooms" read in legacy code is wrong.

### BUG-0021 — History page does N+1 staff lookups per row, 5×50 fan-out fetches on load
- **Category:** booking
- **Impact:** 3
- **Frequency:** 5
- **Effort:** M
- **Score:** (3 × 5) / 2 = 7.5
- **Sources:** `HISTORY_PAGE_PERFORMANCE_OPTIMIZATION.md`, `src/pages/staff/ReservationHistoryPage.tsx`
- **Symptom:** History page spins for seconds. Initial render reads 5 tables × 50 rows + per-row `getStaffInfo` w/ three fallback queries each.
- **Root-cause hypothesis:** No joined query in wrapper API, so consumers fetch tables separately and join client-side. `getStaffInfo` fallback chain (`get` → `list by userId` → `auth.me()`) shows the API is too generic.
- **Suggested owner:** F (kill N+1 — use Postgres `select(*, staff(*))` joined query) + D (typed accessors that surface relations).
- **Notes:** Same N+1 pattern likely in Bookings, Guests, Reservations pages. Investigate sibling pages.

### BUG-0022 — Login flow: pre-login logout adds 1-2s delay, 5 retries × 800ms backoff
- **Category:** auth
- **Impact:** 3
- **Frequency:** 5
- **Effort:** S
- **Score:** (3 × 5) / 1 = 15.0
- **Sources:** `STAFF_LOGIN_PERFORMANCE_FIXED.md`, `src/pages/staff/StaffLoginPage.tsx`
- **Symptom:** Login takes 5+ seconds.
- **Root-cause hypothesis:** Pre-login logout to "clear stale session" wasn't needed — Supabase signIn supersedes any prior session. Retry-with-backoff on the role lookup added another 4-5s in the failure path. MD claims fix shipped; verify retry counts in current `StaffLoginPage.tsx`.
- **Suggested owner:** E (StaffLoginPage simplification)
- **Notes:** P0 — directly affects staff every login. Verify fix actually applied — see git log for "login performance" commits.

### BUG-0023 — `roleloading` race: 3-fallback `getStaffInfo` patternused everywhere
- **Category:** auth
- **Impact:** 3
- **Frequency:** 5
- **Effort:** M
- **Score:** (3 × 5) / 2 = 7.5
- **Sources:** `HISTORY_PAGE_PERFORMANCE_OPTIMIZATION.md` §3, `STAFF_LOGIN_PERFORMANCE_FIXED.md` §"Optimized Role Loading"
- **Symptom:** Several pages call `db.staff.get(id)`, fall back to `db.staff.list({ where: { userId } })`, fall back to `auth.me()`. Each fallback adds latency and another race window.
- **Root-cause hypothesis:** No single source of truth for "current staff record". Each page rolls its own lookup logic. Should be one hook (`useCurrentStaff()`) that caches.
- **Suggested owner:** E (introduce `useCurrentStaff` hook, kill scattered lookups)
- **Notes:** Pairs with BUG-0007 (temp ID workaround). Same root cause: no canonical staff context.

### BUG-0024 — `usePermissions` hook returns `false` during loading instead of distinguishing "loading" vs "no role"
- **Category:** auth
- **Impact:** 3
- **Frequency:** 4
- **Effort:** S
- **Score:** (3 × 4) / 1 = 12.0
- **Sources:** `RBAC_REFRESH_FIX.md` §3, `src/hooks/use-staff-role.tsx` (suspected current location)
- **Symptom:** Buttons that require a permission disappear momentarily on every page load. UI flickers from "no access" to "has access".
- **Root-cause hypothesis:** `can(resource, action)` returns `false` if `!role`. Doesn't expose `loading` state to caller. UIs can't render skeletons / disabled-but-present states.
- **Suggested owner:** D (auth/permissions API surface) + E (consumers).
- **Notes:** Easy fix: hook returns `{ canX, isLoading }` instead of plain `false`.

### BUG-0025 — Notification service called via dynamic `import().then()` chain (race + silent failure)
- **Category:** infra
- **Impact:** 3
- **Frequency:** 3
- **Effort:** S
- **Score:** (3 × 3) / 1 = 9.0
- **Sources:** `CHECKOUT_EMAIL_FIX_COMPLETE.md`, `DEEP_CHECKOUT_EMAIL_INVESTIGATION.md`, `src/pages/staff/ReservationsPage.tsx` (suspected — verify)
- **Symptom:** Checkout email sometimes silently doesn't fire. Old code: `import('@/services/notifications').then(({ sendCheckOutNotification }) => { ... .catch(err => console.error(...)) })`. Notification only fires after dynamic import resolves; if import fails or component unmounts first, no email + no error.
- **Root-cause hypothesis:** Dynamic import used to defer code-splitting, but author wrapped in `.then()` instead of `await import()`. Closure captures stale data on re-render.
- **Suggested owner:** C (bundle / lazy-import) + E (cleanup notification call sites)
- **Notes:** MD says fixed; verify pattern is gone in current code (`grep -rn "import.*notifications.*\.then" src/`).

### BUG-0026 — `hotelSettings` table optional-chained access (`db.hotelSettings?.list`) — table existence assumed unreliable
- **Category:** data-layer
- **Impact:** 2
- **Frequency:** 5
- **Effort:** S
- **Score:** (2 × 5) / 1 = 10.0
- **Sources:** `INVALID_TIME_VALUE_ERROR_FIXED.md` §2, `src/services/hotel-settings.ts`
- **Symptom:** Code uses `await this.db.hotelSettings?.list({ limit: 1 })` because the table "didn't exist". Now that schema is Supabase-managed, table either exists or the wrapper throws — optional-chain is dead defensive code AND wrapper would never return undefined for `db.X` (would throw on missing table).
- **Root-cause hypothesis:** Blink-era pattern that survived migration. Now optional chains evaluate truthy (because `db.hotelSettings` resolves to a truthy proxy), so the defensive code is silent dead weight.
- **Suggested owner:** G (dead-code purge — strip optional chains from all `db.X?.method()` patterns)
- **Notes:** Same pattern likely in other services. `grep -rn "db\.[a-zA-Z]*\?\.\(list\|get\|create\|update\|delete\)" src/`.

### BUG-0027 — Browser-cache stale-build issue surfaces as "X is not defined" runtime errors
- **Category:** infra
- **Impact:** 4
- **Frequency:** 2
- **Effort:** S
- **Score:** (4 × 2) / 1 = 8.0
- **Sources:** `RUNTIME_ERROR_FIXED.md`, `FINAL_FIX_BROWSER_CACHE.md`, `FINAL_FIX_FORMAT_ERROR.md`, `SYNTAX_ERROR_FIXED.md`
- **Symptom:** After deploys, users get cryptic ReferenceErrors ("processing is not defined", "format is not defined"). Multi-doc evidence of recurring pattern.
- **Root-cause hypothesis:** Service-worker / browser cache holds stale `index-<hash>.js` chunk that imports symbols from a freshly-renamed module. Per `netlify.toml` cache headers: `index.html` is `no-cache`, hashed `/assets/*` are `cache forever`. Should work — but if the chunk-graph drifts, stale chunks reference functions deleted in newer chunks. Root fix: ensure Vite's chunk strategy preserves module boundaries on incremental builds, or strip caching on `service-worker.js`.
- **Suggested owner:** A2 (deeper investigation — possibly C or G)
- **Notes:** Investigate: does the app register a service worker? Check `src/main.tsx` for SW registration. If yes, verify SW invalidation on deploy.

### BUG-0028 — Booking deletes silently no-op when ID has unstripped `booking-` / `booking_` prefix
- **Category:** booking
- **Impact:** 5
- **Frequency:** 2
- **Effort:** S
- **Score:** (5 × 2) / 1 = 10.0
- **Sources:** `git@09b1bd6` "fix(bookings): make delete actually delete + favicon to amp-logo", `git@fe9cd88` "fix(bookings): strip booking-/booking_ prefix before deleting"
- **Symptom:** Two separate fixes on the same day to make delete actually work. ID prefix mismatch between display strings and DB rows.
- **Root-cause hypothesis:** Booking IDs have multiple representations (`booking-XYZ`, `booking_XYZ`, raw UUID). Delete API requires raw UUID but caller passes prefixed string. Two fixes patched two specific prefixes; likely more prefix variants survive.
- **Suggested owner:** D (typed accessors → ID type would catch at compile) + A2 (audit ID handling everywhere)
- **Notes:** Search for pattern: `grep -rn "booking-\|booking_" src/ | grep -i "delete\|id"`.

### BUG-0029 — SWR background refresh emit-loop stuck Analytics page on "Loading..."
- **Category:** data-layer
- **Impact:** 4
- **Frequency:** 3
- **Effort:** M
- **Score:** (4 × 3) / 2 = 6.0
- **Sources:** `git@c6ff145` "fix: break SWR emit-loop that stuck Analytics page on 'Loading…'", `src/lib/supabase-wrapper.ts:281-296`
- **Symptom:** Analytics page hung indefinitely on "Loading…". Wrapper's `emitTableUpdated` was firing on every refresh, listener re-triggered loader, loader called list(), list() refreshed and emitted, infinite loop.
- **Root-cause hypothesis:** Fix applied: only emit if row count changed (current code lines 281-296). But row-count check misses in-place updates — pages still see stale rows until next polling tick. Real fix: row-hash/version compare or use Supabase Realtime instead of SWR-w/-emitter.
- **Suggested owner:** B (Realtime replacement) — kills entire emit/poll category.
- **Notes:** Documented WORKAROUND in code: comment at lines 285-291 acknowledges emit-loop risk and that polling fills the gap.

### BUG-0030 — Duplicate bookings via double-submit (no idempotency key, no click guard)
- **Category:** booking
- **Impact:** 5
- **Frequency:** 2
- **Effort:** S
- **Score:** (5 × 2) / 1 = 10.0
- **Sources:** `git@ff7c1c4` "fix: eliminate duplicate bookings via idempotency key + ref-based click guard"
- **Symptom:** User clicks "Submit booking" twice → two bookings created, two charges, two emails.
- **Root-cause hypothesis:** Submit handler not debounced/locked; backend has no idempotency-key constraint. Per fix message, idempotency key + ref-guard added at one site. Other booking-create paths (admin onsite, channel sync) may still be vulnerable.
- **Suggested owner:** F (DB-level uniqueness via SQL constraint) + E (other booking-create UIs)
- **Notes:** Pairs with `migration 20260504070000_booking_dedup.sql` already in repo (per booking-engine.ts:127 comment). Verify constraint covers all create paths.

### BUG-0031 — Analytics vs HR vs revenue services disagree on booking count
- **Category:** analytics
- **Impact:** 4
- **Frequency:** 4
- **Effort:** L
- **Score:** (4 × 4) / 4 = 4.0
- **Sources:** `git@2e4d75c` "fix: align analytics booking count with HR revenue by parsing PAYMENT_EVENTS in getAllBookings", `git@2d97b0e` "deduplicate raw bookings in revenue service to match analytics count", `git@1200c02` "deduplicate staff revenue reports"
- **Symptom:** Three services compute booking counts/revenue differently → numbers shown on Dashboard, Analytics, MyRevenue, HR don't agree.
- **Root-cause hypothesis:** Each service has its own dedup + filter logic. Some count cancelled bookings, some don't. Some include payment events, some don't. No single canonical "active bookings" view.
- **Suggested owner:** F (single source-of-truth view, ideally a Postgres view or materialized table that all services consume)
- **Notes:** Affects every revenue-related number staff sees.

### BUG-0032 — Staff revenue mis-attribution: auth UUID vs `staff` table row ID confusion
- **Category:** auth
- **Impact:** 4
- **Frequency:** 4
- **Effort:** M
- **Score:** (4 × 4) / 2 = 8.0
- **Sources:** `git@36bf14a` "fix: resolve staff revenue attribution for ID mismatches between auth UUID and staff row ID", `git@dfbff64` "add name/email fallback matching for bookings with empty checkInBy ID field", `git@7b9a2ea`, `git@89572cb`
- **Symptom:** Bookings show wrong staff member as creator/checker. Revenue attribution wrong on staff dashboards.
- **Root-cause hypothesis:** `staff.id` and `auth.users.id` are different UUIDs (staff table has its own primary key separate from the user that owns the row). Some code paths pass `auth.user.id` where `staff.id` expected, vice versa. Multiple commits add fallback "name/email match" — pure paper-over.
- **Suggested owner:** F (foreign-key cleanup — make `bookings.created_by` reference one table consistently) + D (typed IDs to make mismatches a compile error)
- **Notes:** Pairs with BUG-0023. Same root: no canonical "current staff" identity.

### BUG-0033 — `events` polyfill needed to prevent Vite circular externalize crash from PouchDB
- **Category:** bundle
- **Impact:** 4
- **Frequency:** 1
- **Effort:** S
- **Score:** (4 × 1) / 1 = 4.0
- **Sources:** `git@280f8e3` "fix: add events polyfill for pouchdb to prevent Vite circular externalize crash", `package.json` (`events` dep)
- **Symptom:** App crashed at boot after Vite upgrade due to PouchDB requiring Node `events` module.
- **Root-cause hypothesis:** PouchDB pulls Node-style `events`; Vite tries to externalize. Polyfill added. If wrapper migrates off PouchDB (Phase 2 D / B), polyfill becomes dead dep.
- **Suggested owner:** D (wrapper internals) — when PouchDB usage shrinks, drop `events` polyfill.
- **Notes:** Verify dep can be removed once data layer rebuilt.

### BUG-0034 — `paymentStatus` was written to a non-existent DB column for weeks
- **Category:** data-layer
- **Impact:** 3
- **Frequency:** 5
- **Effort:** S
- **Score:** (3 × 5) / 1 = 15.0
- **Sources:** `git@408052a` "fix: remove paymentStatus from bookingPayload — column does not exist in DB", `git@d7cf637` "fix: preserve PAYMENT_EVENTS in createBooking + write paymentStatus to DB", `git@674896c` "fix: explicitly whitelist booking DB columns + drain stale sync queue entries"
- **Symptom:** Three commits in a row patching paymentStatus column drift. Fix #1 (d7cf637) wrote a non-existent column. Fix #2 (408052a) removed the write. Fix #3 (674896c) whitelisted columns to prevent recurrence + drained stale offline-queue entries.
- **Root-cause hypothesis:** Wrapper accepts arbitrary fields, sends to Supabase, ignores unknown-column errors silently. Sync queue replays bad writes for days. Rooted in `db: any` typing (BUG-0009).
- **Suggested owner:** D (typed accessors → unknown columns won't compile)
- **Notes:** Sync queue has self-healing now (per fix message), but typed accessors prevent class entirely.

### BUG-0018 — `src/utils/test-*` and `src/utils/database-init.ts` etc.: scratch utility files w/ pre-existing TS errors
- **Category:** infra
- **Impact:** 1
- **Frequency:** 5
- **Effort:** S
- **Score:** (1 × 5) / 1 = 5.0
- **Sources:** `/tmp/baseline-ts-errors.txt` (Phase 1 baseline) — files: `test-activity-logs-fix.ts`, `test-activity-logs.ts`, `test-booking-cleanup.ts`, `test-booking-deletion-logging.ts`, `test-login-logout-logging.ts`, `test-unique-headings-fix.ts`, `manual-table-creation.ts`, `database-init.ts`, `cleanup-test-bookings.ts`, `cleanup-activity-logs.ts`, `cleanup-duplicate-activity-logs.ts`, `force-cleanup-guests.ts`, `force-reset-rooms.ts`, `fix-logout-unknown-user.ts`
- **Symptom:** ~15 dev scratch files account for ~80 of the 118 TS errors in baseline. They're dead code w/ no callers (verified Phase 1) — drag tsc time down + obscure real errors.
- **Root-cause hypothesis:** One-off scripts left in src for "console debug" use. Should live in a separate scripts dir or be deleted.
- **Suggested owner:** G (dead-code purge)
- **Notes:** Verify each: `for f in src/utils/test-*.ts; do grep -rn "$(basename $f .ts)" src --include="*.ts" --include="*.tsx" | grep -v "$f"; done`. Anything with zero callers → delete.

## Cluster Index

<!-- Filled in Task 11. Maps cluster prefix → BUG-XXXX list. -->

## Source Coverage

<!-- Filled in Task 11. Lists every MD file → cited-in-BUG-XXXX or no-entry-because. -->

## Wont-fix

<!-- Filled in Task 11. Workaround tags / catch blocks that are intentional. -->

## Open Questions for User

<!-- Filled in Task 12. Items where audit hit ambiguity needing human decision. -->
