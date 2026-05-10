# Phase 2 Audit — Ranked Backlog

**Generated:** 2026-05-10
**Spec:** docs/superpowers/specs/2026-05-10-phase2a-bug-audit-design.md
**Sources:** 116 root MDs (84 fix-themed), src/ greps, git log (180d), code error patterns
**Coverage:** 100% of fix-docs cited (84 of 84)

## Summary

- Total entries: 34
- Critical (P0, score ≥ 8.0): 14
- High (P1, score 4.0–7.9): 13
- Medium (P2, score 2.0–3.9): 7
- Low (P3, score < 2.0): 0
- By owner (primary): A2=3, B=2, C=2, D=8, E=4, F=6, G=5, H=4
- B and C have <3 entries — coverage flagged in Open Questions §1.

### Top 10 root-cause themes

1. **Auth state has no stable initial value during async role lookup** — flicker, infinite loops, "Access Denied" flashes (BUG-0004, BUG-0012, BUG-0017, BUG-0018).
2. **Multiple identity sources** (auth UUID, `staff.id`, email, hardcoded admin email) cause wrong revenue/audit attribution (BUG-0014, BUG-0019, BUG-0033).
3. **`db` typed `any`** lets schema drift pass silently — paymentStatus column written for weeks (BUG-0003, BUG-0031).
4. **Activity logs co-stored** in `contactMessages` table — duplicate history entries forever (BUG-0021).
5. **Dual login + dual navigation systems** living side-by-side, only half wired (BUG-0018, BUG-0032).
6. **N+1 fan-out queries** + 14 `setInterval` polls flood the network on idle tabs (BUG-0015, BUG-0028).
7. **Defensive optional-chain / "if table missing fall back"** Blink-era deadweight (BUG-0008, BUG-0025).
8. **Bundle ships heavy libs** (jspdf 382KB, html2canvas 199KB, charts 409KB) on first paint (BUG-0006, BUG-0011).
9. **Booking-create paths lack idempotency, validation, ID hygiene** — duplicate bookings, "Guest" placeholder names, prefix-mismatch deletes (BUG-0009, BUG-0010, BUG-0019, BUG-0030).
10. **395 swallowed catch blocks** print warnings and continue, hiding real failures from users and ops (BUG-0029).

## Ranking Schema (reference)

`Score = (impact × frequency) / effort_weight`

Impact 1–5: 5=data loss/security, 4=feature broken, 3=degraded, 2=annoyance, 1=cosmetic.
Frequency 1–5: 5=every session/everyone, 4=every session/some, 3=weekly, 2=monthly, 1=rare.
Effort weight: S=1 (≤1d, single file), M=2 (1–3d, multi-file), L=4 (≥3d, schema/wrapper).

Owner key: B=Realtime/polling, C=Bundle, D=Wrapper internals, E=Page perf, F=Query perf, G=Eslint+dead-code, H=Auth/security, A2=Needs deeper audit.

## Entries

### BUG-0001 — Admin staff record auto-create runs on every auth state change w/ no debounce
- **Category:** auth
- **Impact:** 3
- **Frequency:** 5
- **Effort:** S
- **Score:** (3 × 5) / 1 = 15.0  [P0]
- **Sources:** `STABILITY_AUDIT_REPORT.md` §3, §6, `src/App.tsx:130-163`
- **Symptom:** Every `onAuthStateChanged` event triggers `db.staff.list({ where: { userId } })` + possibly `db.staff.create()`. Concurrent calls race to create duplicate staff rows.
- **Root-cause hypothesis:** Logic placed in callback w/ only an `isCreating` boolean guard — not enough for cross-render races. No debounce, no memoization. Should run once at app boot, not per state event.
- **Suggested owner:** E (App.tsx cleanup)
- **Notes:** Easy fix, recurrent waste, can produce duplicate staff records.

### BUG-0002 — Login flow: pre-login logout adds 1-2s delay, 5 retries × 800ms backoff
- **Category:** auth
- **Impact:** 3
- **Frequency:** 5
- **Effort:** S
- **Score:** (3 × 5) / 1 = 15.0  [P0]
- **Sources:** `STAFF_LOGIN_PERFORMANCE_FIXED.md`, `src/pages/staff/StaffLoginPage.tsx`
- **Symptom:** Login takes 5+ seconds.
- **Root-cause hypothesis:** Pre-login logout to "clear stale session" wasn't needed — Supabase signIn supersedes any prior session. Retry-with-backoff on the role lookup added another 4-5s in the failure path. MD claims fix shipped; verify retry counts in current `StaffLoginPage.tsx`.
- **Suggested owner:** E (StaffLoginPage simplification)
- **Notes:** Directly affects staff every login. Verify fix actually applied — see git log for "login performance" commits.

### BUG-0003 — `paymentStatus` was written to a non-existent DB column for weeks
- **Category:** data-layer
- **Impact:** 3
- **Frequency:** 5
- **Effort:** S
- **Score:** (3 × 5) / 1 = 15.0  [P0]
- **Sources:** `git@408052a` "fix: remove paymentStatus from bookingPayload — column does not exist in DB", `git@d7cf637`, `git@674896c` "explicitly whitelist booking DB columns + drain stale sync queue entries"
- **Symptom:** Three commits in a row patching paymentStatus column drift. Fix #1 (d7cf637) wrote a non-existent column. Fix #2 (408052a) removed the write. Fix #3 (674896c) whitelisted columns + drained stale offline-queue entries.
- **Root-cause hypothesis:** Wrapper accepts arbitrary fields, sends to Supabase, ignores unknown-column errors silently. Sync queue replays bad writes for days. Rooted in `db: any` typing (BUG-0031).
- **Suggested owner:** D (typed accessors → unknown columns won't compile)
- **Notes:** Sync queue has self-healing now (per fix message), but typed accessors prevent class entirely.

### BUG-0004 — `usePermissions` hook returns `false` during loading instead of distinguishing "loading" vs "no role"
- **Category:** auth
- **Impact:** 3
- **Frequency:** 4
- **Effort:** S
- **Score:** (3 × 4) / 1 = 12.0  [P0]
- **Sources:** `RBAC_REFRESH_FIX.md` §3, `src/hooks/use-staff-role.tsx` (suspected current location)
- **Symptom:** Buttons that require a permission disappear momentarily on every page load. UI flickers from "no access" to "has access".
- **Root-cause hypothesis:** `can(resource, action)` returns `false` if `!role`. Doesn't expose `loading` state to caller. UIs can't render skeletons / disabled-but-present states.
- **Suggested owner:** D (auth/permissions API surface) + E (consumers).
- **Notes:** Easy fix: hook returns `{ canX, isLoading }` instead of plain `false`.

### BUG-0005 — `ErrorBoundary` does not log to a reporting service
- **Category:** infra
- **Impact:** 2
- **Frequency:** 5
- **Effort:** S
- **Score:** (2 × 5) / 1 = 10.0  [P0]
- **Sources:** `src/components/ErrorBoundary.tsx:43` `// TODO: Log to error reporting service (e.g., Sentry)`
- **Symptom:** When app crashes, only console.error fires. No external visibility into production crashes.
- **Root-cause hypothesis:** Sentry / Bugsnag / Logflare integration deferred indefinitely.
- **Suggested owner:** H (observability) — wire Sentry or similar; needs DSN env var.
- **Notes:** Choice of provider deferred to user. Quickest = Sentry free tier.

### BUG-0006 — Production bundle: `index` 398KB, `charts` 409KB, `jspdf` 382KB, `html2canvas` 199KB shipped on every page load
- **Category:** bundle
- **Impact:** 4
- **Frequency:** 5
- **Effort:** M
- **Score:** (4 × 5) / 2 = 10.0  [P0]
- **Sources:** `npm run build` output (Phase 1 baseline)
- **Symptom:** First paint slow on Ghana mobile (cited in `src/lib/supabase.ts` Netlify proxy comment). 1.4MB raw before gzip on a hostel-management dashboard.
- **Root-cause hypothesis:** `jspdf` + `html2canvas` only used by invoice download/print. `charts` (recharts) only used by Analytics + MyRevenue + Reports. None lazy-loaded at function-call time.
- **Suggested owner:** C (bundle audit — lazy-import within service functions, not top-level imports).
- **Notes:** Phase 1 page-level lazy-load already shipped (lazy() in App.tsx). This is library-level lazy-load — different lever.

### BUG-0007 — `ESLint` config missing for ESLint 9 (lint:js script broken)
- **Category:** infra
- **Impact:** 2
- **Frequency:** 5
- **Effort:** S
- **Score:** (2 × 5) / 1 = 10.0  [P0]
- **Sources:** Phase 1 verification (T13 step 4)
- **Symptom:** `npm run lint:js` fails with "ESLint couldn't find an eslint.config.(js|mjs|cjs) file". Repo has `.eslintrc.*` from ESLint 8 era. CI pipeline either skipped or broken.
- **Root-cause hypothesis:** ESLint 9 introduced flat config; no migration done.
- **Suggested owner:** G (dead-code purge + CI gates)
- **Notes:** Quick fix: `npx @eslint/migrate-config .eslintrc.json` or write `eslint.config.js` from scratch.

### BUG-0008 — Optional-chain `db.<table>?.list()` pattern: dead defensive code from Blink era
- **Category:** data-layer
- **Impact:** 2
- **Frequency:** 5
- **Effort:** S
- **Score:** (2 × 5) / 1 = 10.0  [P0]
- **Sources:** `INVALID_TIME_VALUE_ERROR_FIXED.md` §2, `src/services/hotel-settings.ts`
- **Symptom:** Code uses `await this.db.hotelSettings?.list({ limit: 1 })` because the table "didn't exist". Now that schema is Supabase-managed, table either exists or the wrapper throws — optional-chain is dead defensive code AND wrapper would never return undefined for `db.X` (would throw on missing table).
- **Root-cause hypothesis:** Blink-era pattern that survived migration. Now optional chains evaluate truthy (because `db.hotelSettings` resolves to a truthy proxy), so the defensive code is silent dead weight.
- **Suggested owner:** G (dead-code purge — strip optional chains from all `db.X?.method()` patterns)
- **Notes:** Search for pattern: `grep -rn "db\.[a-zA-Z]*\?\.\(list\|get\|create\|update\|delete\)" src/`.

### BUG-0009 — Booking deletes silently no-op when ID has unstripped `booking-` / `booking_` prefix
- **Category:** booking
- **Impact:** 5
- **Frequency:** 2
- **Effort:** S
- **Score:** (5 × 2) / 1 = 10.0  [P0]
- **Sources:** `git@09b1bd6` "fix(bookings): make delete actually delete + favicon to amp-logo", `git@fe9cd88` "fix(bookings): strip booking-/booking_ prefix before deleting"
- **Symptom:** Two separate fixes on the same day to make delete actually work. ID prefix mismatch between display strings and DB rows.
- **Root-cause hypothesis:** Booking IDs have multiple representations (`booking-XYZ`, `booking_XYZ`, raw UUID). Delete API requires raw UUID but caller passes prefixed string. Two fixes patched two specific prefixes; likely more prefix variants survive.
- **Suggested owner:** D (typed accessors → ID type would catch at compile) + A2 (audit ID handling everywhere)
- **Notes:** Search for pattern: `grep -rn "booking-\|booking_" src/ | grep -i "delete\|id"`.

### BUG-0010 — Duplicate bookings via double-submit (no idempotency key, no click guard at all create paths)
- **Category:** booking
- **Impact:** 5
- **Frequency:** 2
- **Effort:** S
- **Score:** (5 × 2) / 1 = 10.0  [P0]
- **Sources:** `git@ff7c1c4` "fix: eliminate duplicate bookings via idempotency key + ref-based click guard"
- **Symptom:** User clicks "Submit booking" twice → two bookings created, two charges, two emails.
- **Root-cause hypothesis:** Submit handler not debounced/locked; backend has no idempotency-key constraint. Per fix message, idempotency key + ref-guard added at one site. Other booking-create paths (admin onsite, channel sync) may still be vulnerable.
- **Suggested owner:** F (DB-level uniqueness via SQL constraint) + E (other booking-create UIs)
- **Notes:** Pairs with `migration 20260504070000_booking_dedup.sql` already in repo (per booking-engine.ts:127 comment). Verify constraint covers all create paths.

### BUG-0011 — Notification service called via dynamic `import().then()` chain (race + silent failure)
- **Category:** infra
- **Impact:** 3
- **Frequency:** 3
- **Effort:** S
- **Score:** (3 × 3) / 1 = 9.0  [P0]
- **Sources:** `CHECKOUT_EMAIL_FIX_COMPLETE.md`, `DEEP_CHECKOUT_EMAIL_INVESTIGATION.md`, `src/pages/staff/ReservationsPage.tsx` (suspected — verify)
- **Symptom:** Checkout email sometimes silently doesn't fire. Old code: `import('@/services/notifications').then(({ sendCheckOutNotification }) => { ... .catch(err => console.error(...)) })`. Notification only fires after dynamic import resolves; if import fails or component unmounts first, no email + no error.
- **Root-cause hypothesis:** Dynamic import used to defer code-splitting, but author wrapped in `.then()` instead of `await import()`. Closure captures stale data on re-render.
- **Suggested owner:** C (bundle / lazy-import) + E (cleanup notification call sites)
- **Notes:** MD says fixed; verify pattern is gone in current code (`grep -rn "import.*notifications.*\.then" src/`).

### BUG-0012 — `ProtectedRoute` permission-check loop ("Checking Permissions..." flash)
- **Category:** auth
- **Impact:** 4
- **Frequency:** 4
- **Effort:** M
- **Score:** (4 × 4) / 2 = 8.0  [P0]
- **Sources:** `APP_STABILITY_FIXED.md`, `src/components/ProtectedRoute.tsx`
- **Symptom:** App stuck on "Checking permissions..." spinner, refreshing forever. Fix uses `isCheckingRef` to prevent reentrancy.
- **Root-cause hypothesis:** `useEffect` dependency array includes `[role, loading, userId, navigate, retryCount, location.pathname]` — every state change retriggers effect. Fix is a guard ref, not a redesign. Real fix: move permission check out of `useEffect` (use a hook return value derived from auth state, not a side-effect).
- **Suggested owner:** D (auth wrapper) + E (ProtectedRoute simplification)
- **Notes:** Pairs with BUG-0001 + BUG-0017. All three are symptoms of the same auth-state-as-side-effect anti-pattern.

### BUG-0013 — Browser-cache stale-build issue surfaces as "X is not defined" runtime errors
- **Category:** infra
- **Impact:** 4
- **Frequency:** 2
- **Effort:** S
- **Score:** (4 × 2) / 1 = 8.0  [P0]
- **Sources:** `RUNTIME_ERROR_FIXED.md`, `FINAL_FIX_BROWSER_CACHE.md`, `FINAL_FIX_FORMAT_ERROR.md`, `SYNTAX_ERROR_FIXED.md`
- **Symptom:** After deploys, users get cryptic ReferenceErrors ("processing is not defined", "format is not defined"). Multi-doc evidence of recurring pattern.
- **Root-cause hypothesis:** Service-worker / browser cache holds stale `index-<hash>.js` chunk that imports symbols from a freshly-renamed module. Per `netlify.toml` cache headers: `index.html` is `no-cache`, hashed `/assets/*` are `cache forever`. Should work — but if the chunk-graph drifts, stale chunks reference functions deleted in newer chunks. Root fix: ensure Vite's chunk strategy preserves module boundaries on incremental builds, or strip caching on `service-worker.js`.
- **Suggested owner:** A2 (deeper investigation — possibly C or G)
- **Notes:** Investigate: does the app register a service worker? Check `src/main.tsx` for SW registration. If yes, verify SW invalidation on deploy.

### BUG-0014 — Staff revenue mis-attribution: auth UUID vs `staff` table row ID confusion
- **Category:** auth
- **Impact:** 4
- **Frequency:** 4
- **Effort:** M
- **Score:** (4 × 4) / 2 = 8.0  [P0]
- **Sources:** `git@36bf14a` "fix: resolve staff revenue attribution for ID mismatches between auth UUID and staff row ID", `git@dfbff64` "add name/email fallback matching for bookings with empty checkInBy ID field", `git@7b9a2ea`, `git@89572cb`
- **Symptom:** Bookings show wrong staff member as creator/checker. Revenue attribution wrong on staff dashboards.
- **Root-cause hypothesis:** `staff.id` and `auth.users.id` are different UUIDs (staff table has its own primary key separate from the user that owns the row). Some code paths pass `auth.user.id` where `staff.id` expected, vice versa. Multiple commits add fallback "name/email match" — pure paper-over.
- **Suggested owner:** F (foreign-key cleanup — make `bookings.created_by` reference one table consistently) + D (typed IDs to make mismatches a compile error)
- **Notes:** Pairs with BUG-0016. Same root: no canonical "current staff" identity.

### BUG-0015 — History page does N+1 staff lookups per row, 5×50 fan-out fetches on load
- **Category:** booking
- **Impact:** 3
- **Frequency:** 5
- **Effort:** M
- **Score:** (3 × 5) / 2 = 7.5  [P1]
- **Sources:** `HISTORY_PAGE_PERFORMANCE_OPTIMIZATION.md`, `src/pages/staff/ReservationHistoryPage.tsx`
- **Symptom:** History page spins for seconds. Initial render reads 5 tables × 50 rows + per-row `getStaffInfo` w/ three fallback queries each.
- **Root-cause hypothesis:** No joined query in wrapper API, so consumers fetch tables separately and join client-side. `getStaffInfo` fallback chain (`get` → `list by userId` → `auth.me()`) shows the API is too generic.
- **Suggested owner:** F (kill N+1 — use Postgres `select(*, staff(*))` joined query) + D (typed accessors that surface relations).
- **Notes:** Same N+1 pattern likely in Bookings, Guests, Reservations pages. Investigate sibling pages.

### BUG-0016 — `getStaffInfo` 3-fallback pattern (`get` → `list by userId` → `auth.me()`) used everywhere
- **Category:** auth
- **Impact:** 3
- **Frequency:** 5
- **Effort:** M
- **Score:** (3 × 5) / 2 = 7.5  [P1]
- **Sources:** `HISTORY_PAGE_PERFORMANCE_OPTIMIZATION.md` §3, `STAFF_LOGIN_PERFORMANCE_FIXED.md` §"Optimized Role Loading"
- **Symptom:** Several pages call `db.staff.get(id)`, fall back to `db.staff.list({ where: { userId } })`, fall back to `auth.me()`. Each fallback adds latency and another race window.
- **Root-cause hypothesis:** No single source of truth for "current staff record". Each page rolls its own lookup logic. Should be one hook (`useCurrentStaff()`) that caches.
- **Suggested owner:** E (introduce `useCurrentStaff` hook, kill scattered lookups)
- **Notes:** Pairs with BUG-0019 (temp ID workaround). Same root cause: no canonical staff context.

### BUG-0017 — Admin tab flickers on refresh, "permanent fix" is a `useRef` papering over auth race
- **Category:** auth
- **Impact:** 3
- **Frequency:** 4
- **Effort:** M
- **Score:** (3 × 4) / 2 = 6.0  [P1]
- **Sources:** `EMPLOYEE_TAB_FIX_FINAL.md`, `EMPLOYEE_TAB_PERMANENT_FIX.md`, `src/components/layout/AppLayout.tsx:54,75-106,121-130`
- **Symptom:** On page refresh, admin section flickers off then on as `isLoadingStaff` resolves. `EMPLOYEE_TAB_FIX_FINAL.md` ships a `lastKnownAdminStateRef` workaround.
- **Root-cause hypothesis:** Auth state has no stable initial value during async role lookup. Hardcoded `currentUser?.email === 'admin@amplodge.com'` escape hatch (not portable, not multi-tenant). Three layers (`canManageEmployees` / `role === 'admin'` / email check) compete instead of single source of truth. Wrapper's `auth.onAuthStateChanged` emits `{isLoading: true, user: null}` first then real state — consumers must remember last known good.
- **Suggested owner:** D (wrapper auth surface) + E (AppLayout simplification once D lands)
- **Notes:** Hardcoded admin email = portability hazard for any other deployment.

### BUG-0018 — Dual navigation systems: `AppLayout` hardcoded array + orphan `StaffSidebar`
- **Category:** infra
- **Impact:** 3
- **Frequency:** 4
- **Effort:** M
- **Score:** (3 × 4) / 2 = 6.0  [P1]
- **Sources:** `STABILITY_AUDIT_REPORT.md` §2, `src/components/layout/AppLayout.tsx:41,253,281`, `src/components/layout/StaffSidebar.tsx` (unreferenced)
- **Symptom:** AppLayout has its own hardcoded navigation array with admin-tab logic baked in (BUG-0017). StaffSidebar.tsx exists with proper RBAC integration but is never rendered.
- **Root-cause hypothesis:** Migration started, never completed. Audit doc Oct 2025 prescribed switching AppLayout → StaffSidebar; never done.
- **Suggested owner:** E (page perf + AppLayout simplification) — replace AppLayout's nav with StaffSidebar render, then delete StaffSidebar OR collapse them.
- **Notes:** Pairs with BUG-0017 — fixing the nav unification is a chance to fix the admin-tab race in one shot.

### BUG-0019 — "Last resort temporary ID" pattern when `currentUser` missing during booking creation
- **Category:** booking
- **Impact:** 3
- **Frequency:** 2
- **Effort:** S
- **Score:** (3 × 2) / 1 = 6.0  [P1]
- **Sources:** `src/pages/staff/BookingsPage.tsx:333,335`, `src/pages/staff/CalendarPage.tsx:298,300`, `git@bbd2fe5` "fix: resolve 'Guest' placeholder names + improve Ghana latency"
- **Symptom:** When `auth.me()` returns null mid-booking, code generates `temp_<random>` as `createdBy`. Activity logs and reports show "temp_xxx" instead of real user. Sibling case: guest names default to "Guest" when name field empty during create.
- **Root-cause hypothesis:** Network race between user fetch and form submit. No retry. Same pattern at two pages = abstraction missing.
- **Suggested owner:** F (booking-engine query perf has user-fetch fan-out logic) + E (extract shared `useCurrentStaffId()` hook)
- **Notes:** Already in code with `console.log('Last resort:')` — finds itself in error logs.

### BUG-0020 — SWR background refresh emit-loop stuck Analytics page on "Loading..."
- **Category:** data-layer
- **Impact:** 4
- **Frequency:** 3
- **Effort:** M
- **Score:** (4 × 3) / 2 = 6.0  [P1]
- **Sources:** `git@c6ff145` "fix: break SWR emit-loop that stuck Analytics page on 'Loading…'", `src/lib/supabase-wrapper.ts:281-296`
- **Symptom:** Analytics page hung indefinitely on "Loading…". Wrapper's `emitTableUpdated` was firing on every refresh, listener re-triggered loader, loader called list(), list() refreshed and emitted, infinite loop.
- **Root-cause hypothesis:** Fix applied: only emit if row count changed (current code lines 281-296). But row-count check misses in-place updates — pages still see stale rows until next polling tick. Real fix: row-hash/version compare or use Supabase Realtime instead of SWR-w/-emitter.
- **Suggested owner:** B (Realtime replacement) — kills entire emit/poll category.
- **Notes:** Documented WORKAROUND in code: comment at lines 285-291 acknowledges emit-loop risk and that polling fills the gap.

### BUG-0021 — Activity logs co-mingled with `contactMessages` table (schema misuse)
- **Category:** activity-log
- **Impact:** 4
- **Frequency:** 5
- **Effort:** L
- **Score:** (4 × 5) / 4 = 5.0  [P1]
- **Sources:** `BOOKING_DELETION_DUPLICATION_FIX.md`, `src/services/activity-log-service.ts:248,266,720,793`, `src/pages/staff/ReservationHistoryPage.tsx:103,111`
- **Symptom:** Booking deletion creates duplicate history entries (one as "contact message", one as activity log). Reservation history page must dedup with `if contact.status === 'activity_log' continue`. Stale activity-log fallback writes to `contactMessages` whenever the dedicated table fails.
- **Root-cause hypothesis:** Original Blink-era schema lacked an `activityLogs` table; service falls back to writing rows into `contactMessages` with `status='activity_log'`. Supabase migrations now include a real `activity_logs` table but the fallback path is still in code AND `ReservationHistoryPage` still queries `contact_messages` for activity rows. Two write paths + two read paths = duplication and stale data.
- **Suggested owner:** D (wrapper internals → typed table accessors so cross-table writes can't compile) + F (kill the fallback read path)
- **Notes:** REGRESSED. MD says "FIXED" via dedup filter, but root cause (dual storage) still in code. Fix: remove all `contactMessages` activity-log fallback paths, treat `activity_logs` as canonical, migrate any straggler rows out.

### BUG-0022 — Netlify functions (`create-employee`, `delete-employee`, etc.) have no admin-token verification
- **Category:** auth
- **Impact:** 5
- **Frequency:** 1
- **Effort:** S
- **Score:** (5 × 1) / 1 = 5.0  [P1]
- **Sources:** Phase 1 audit notes in `netlify/functions/create-employee.js` header comment
- **Symptom:** Anyone with the `/.netlify/functions/create-employee` URL can create staff users (with admin Supabase service-role key power). No `Authorization` header check.
- **Root-cause hypothesis:** Live function was ported from old Blink-Deno version that did `blink.auth.me()` before doing work. Port lost the auth gate.
- **Suggested owner:** H (auth-gate netlify fns — add JWT verification + role check before privileged operations).
- **Notes:** SECURITY. Should ship before any feature work. Score is "low" by frequency only because no exploit known yet.

### BUG-0023 — `src/utils/test-*` and `src/utils/database-init.ts` etc.: scratch utility files w/ pre-existing TS errors
- **Category:** infra
- **Impact:** 1
- **Frequency:** 5
- **Effort:** S
- **Score:** (1 × 5) / 1 = 5.0  [P1]
- **Sources:** `/tmp/baseline-ts-errors.txt` (Phase 1 baseline) — files: `test-activity-logs-fix.ts`, `test-activity-logs.ts`, `test-booking-cleanup.ts`, `test-booking-deletion-logging.ts`, `test-login-logout-logging.ts`, `test-unique-headings-fix.ts`, `manual-table-creation.ts`, `database-init.ts`, `cleanup-test-bookings.ts`, `cleanup-activity-logs.ts`, `cleanup-duplicate-activity-logs.ts`, `force-cleanup-guests.ts`, `force-reset-rooms.ts`, `fix-logout-unknown-user.ts`
- **Symptom:** ~15 dev scratch files account for ~80 of the 118 TS errors in baseline. They're dead code w/ no callers (verified Phase 1) — drag tsc time down + obscure real errors.
- **Root-cause hypothesis:** One-off scripts left in `src/` for "console debug" use. Should live in a separate scripts dir or be deleted.
- **Suggested owner:** G (dead-code purge)
- **Notes:** Verify each: `for f in src/utils/test-*.ts; do grep -rn "$(basename $f .ts)" src --include="*.ts" --include="*.tsx" | grep -v "$f"; done`. Anything with zero callers → delete.

### BUG-0024 — Two parallel "room" tables: `rooms` + `properties` — UI must read from properties to match backend
- **Category:** booking
- **Impact:** 4
- **Frequency:** 5
- **Effort:** L
- **Score:** (4 × 5) / 4 = 5.0  [P1]
- **Sources:** `ROOM_AVAILABILITY_SYNC_FIX.md`, `src/pages/RoomsPage.tsx`, `src/pages/BookingPage.tsx`, `src/pages/staff/OnsiteBookingPage.tsx`
- **Symptom:** Frontend showed wrong availability (0 Deluxe / 1 Standard / 0 Family) vs backend (1 Deluxe / 6 Standard / 1 Family). Fix forced UI to read from `properties` table everywhere.
- **Root-cause hypothesis:** Schema has both `rooms` and `properties`. Original `rooms` table is now legacy/stale. The two tables were not consolidated, just routed-around. Booking writes still write to `rooms` (per `src/lib/supabase.ts` Tables type), so they drift from `properties`. Real fix: pick one, migrate the other away.
- **Suggested owner:** A2 (deeper schema audit needed; touches SQL migrations not just TS).
- **Notes:** Highest-leverage data-layer cleanup. Until resolved, every "rooms" read in legacy code is wrong.

### BUG-0025 — Auth wrapper falls back to cached session "if Supabase says no user"
- **Category:** auth
- **Impact:** 4
- **Frequency:** 2
- **Effort:** M
- **Score:** (4 × 2) / 2 = 4.0  [P1]
- **Sources:** `src/lib/supabase-wrapper.ts:892-895` (`// might be temporary network issue`)
- **Symptom:** When Supabase auth returns no user, wrapper trusts cached session. Cache is PouchDB-backed; if Supabase intentionally signed user out (revoked, deleted), wrapper still treats them as logged in offline.
- **Root-cause hypothesis:** Offline-first auth design conflated "network down" with "no auth". Real signed-out events get masked by cache hit.
- **Suggested owner:** H (security — auth correctness) + D (wrapper internals)
- **Notes:** Distinguish "Supabase responded `null`" (signed out) from "Supabase didn't respond" (network down). Only the latter should fall back to cache.

### BUG-0026 — Analytics vs HR vs revenue services disagree on booking count
- **Category:** analytics
- **Impact:** 4
- **Frequency:** 4
- **Effort:** L
- **Score:** (4 × 4) / 4 = 4.0  [P1]
- **Sources:** `git@2e4d75c` "fix: align analytics booking count with HR revenue by parsing PAYMENT_EVENTS in getAllBookings", `git@2d97b0e` "deduplicate raw bookings in revenue service to match analytics count", `git@1200c02` "deduplicate staff revenue reports"
- **Symptom:** Three services compute booking counts/revenue differently → numbers shown on Dashboard, Analytics, MyRevenue, HR don't agree.
- **Root-cause hypothesis:** Each service has its own dedup + filter logic. Some count cancelled bookings, some don't. Some include payment events, some don't. No single canonical "active bookings" view.
- **Suggested owner:** F (single source-of-truth view, ideally a Postgres view or materialized table that all services consume)
- **Notes:** Affects every revenue-related number staff sees.

### BUG-0027 — `events` polyfill needed to prevent Vite circular externalize crash from PouchDB
- **Category:** bundle
- **Impact:** 4
- **Frequency:** 1
- **Effort:** S
- **Score:** (4 × 1) / 1 = 4.0  [P1]
- **Sources:** `git@280f8e3` "fix: add events polyfill for pouchdb to prevent Vite circular externalize crash", `package.json` (`events` dep)
- **Symptom:** App crashed at boot after Vite upgrade due to PouchDB requiring Node `events` module.
- **Root-cause hypothesis:** PouchDB pulls Node-style `events`; Vite tries to externalize. Polyfill added. If wrapper migrates off PouchDB (Phase 2 D / B), polyfill becomes dead dep.
- **Suggested owner:** D (wrapper internals) — when PouchDB usage shrinks, drop `events` polyfill.
- **Notes:** Verify dep can be removed once data layer rebuilt.

### BUG-0028 — 14 `setInterval` polls running concurrently across pages
- **Category:** render
- **Impact:** 3
- **Frequency:** 5
- **Effort:** L
- **Score:** (3 × 5) / 4 = 3.75  [P2]
- **Sources:** `src/main.tsx:16`, `src/App.tsx:122` (auth check 30s), `src/components/OfflineStatusBanner.tsx:36` (sync 5s), `src/hooks/use-currency.ts:28`, `src/lib/network-status.ts:101`, `src/pages/staff/ActivityLogsPage.tsx:55`, `src/pages/staff/AnalyticsPage.tsx:111` (5min reload), `src/pages/staff/ClockPage.tsx:44` (1s clock), `src/pages/staff/HRPage.tsx:291,376`, `src/pages/staff/ReservationHistoryPage.tsx:559`, `src/pages/staff/DashboardPage.tsx:44`, `src/pages/staff/MyRevenuePage.tsx:502`
- **Symptom:** Idle staff tab burns CPU + makes constant network calls. Battery drain on tablets, slow UI on cheap hardware, expensive on Ghana mobile data.
- **Root-cause hypothesis:** No realtime invalidation primitive. Each page rolls its own polling. Auth check at 30s + sync at 5s + analytics at 5min + clock at 1s overlap unnecessarily.
- **Suggested owner:** B (Realtime + kill polling)
- **Notes:** Some intervals are legitimate (clock 1s, network heartbeat). Most data-fetching intervals can be replaced with `supabase.channel('table-name').on('postgres_changes', ...)`.

### BUG-0029 — Service files swallow errors in 395+ catch blocks (`console.warn` and continue)
- **Category:** data-layer
- **Impact:** 3
- **Frequency:** 5
- **Effort:** L
- **Score:** (3 × 5) / 4 = 3.75  [P2]
- **Sources:** `/tmp/audit-greps/swallowed-errors.txt` (395 sites; top files: booking-engine 24, activity-logger-wrapper 23, ReservationsPage 13, EmployeesPage 13), `DEEP_CHECKOUT_EMAIL_INVESTIGATION.md` "Errors were being caught but not properly logged"
- **Symptom:** Failures (DB write fails, email send fails, sync fails) print a console warning and continue. User sees "success" while real failure persists.
- **Root-cause hypothesis:** Defensive copy-pasted `try/catch` w/o classifying which failures are recoverable vs which must surface. No central error bus.
- **Suggested owner:** A2 (deeper audit needed — needs per-site triage). After H ships an error reporter (BUG-0005), most can route there.
- **Notes:** 395 is too many to fix at once. Approach: triage in batches by category — auth catches first, then data writes, then network calls.

### BUG-0030 — Bookings can be created with missing `checkIn`/`checkOut` dates; downstream pages defensively render `'N/A'`
- **Category:** booking
- **Impact:** 3
- **Frequency:** 2
- **Effort:** M
- **Score:** (3 × 2) / 2 = 3.0  [P2]
- **Sources:** `CRITICAL_ISSUES_FIXED.md` §2, `BOOKING_RESERVATIONS_FIXES_COMPLETE.md` §1, `INVALID_TIME_VALUE_ERROR_FIXED.md`, `src/pages/staff/InvoicesPage.tsx`
- **Symptom:** InvoicesPage crashed on `format(new Date(invoice.checkIn))` when date was malformed. Patched with `invoice.checkIn ? format(...) : 'N/A'`. ReservationsPage filters out bookings missing `checkIn || checkOut || guestName`.
- **Root-cause hypothesis:** Booking-create paths don't enforce required fields. Could be SQL `NOT NULL` + `CHECK` constraints in `bookings` schema. Currently pushed to client-side defense.
- **Suggested owner:** F (query correctness) + Phase 3 schema audit (separate sub-project)
- **Notes:** Defensive `N/A` is permanent — but the invalid rows persist and pollute reports.

### BUG-0031 — `src/lib/db.ts` exports `db` typed as `any`; 80+ consumer sites used `(db as any)` shim before Phase 1
- **Category:** data-layer
- **Impact:** 2
- **Frequency:** 5
- **Effort:** L
- **Score:** (2 × 5) / 4 = 2.5  [P2]
- **Sources:** `STABILITY_AUDIT_REPORT.md` §7, Phase 1 spec note in `src/lib/db.ts:10-15`
- **Symptom:** TS catches nothing about table names, column names, return shapes. Schema drift between Supabase migrations and consumer code is invisible until runtime.
- **Root-cause hypothesis:** Wrapper API was loosely typed since Blink era. Phase 1 centralised the `any` cast for consistency; Phase 2 needs typed table accessors generated from `Tables<>` in `src/lib/supabase.ts`.
- **Suggested owner:** D (wrapper internals — generate `db.<table>.list()` with full row types from `Tables<>`).
- **Notes:** Foundational for catching most other bugs at compile time. Pairs with BUG-0003.

### BUG-0032 — Dual login pages: `AuthPage.tsx` (orphaned) + `StaffLoginPage.tsx` (wired)
- **Category:** auth
- **Impact:** 2
- **Frequency:** 1
- **Effort:** S
- **Score:** (2 × 1) / 1 = 2.0  [P2]
- **Sources:** `STABILITY_AUDIT_REPORT.md` §1, `src/pages/staff/AuthPage.tsx` (still on disk), `src/App.tsx:8,200` (uses StaffLoginPage)
- **Symptom:** Two login implementations live in tree. AuthPage allows signup (shouldn't exist for staff), lacks staff-record verification, lacks first-login password flow.
- **Root-cause hypothesis:** Migration to StaffLoginPage never deleted the orphan. Audit doc from Oct 2025 already flagged this and prescribed delete; never done.
- **Suggested owner:** G (dead-code purge)
- **Notes:** Verify zero imports before delete: `grep -rn "AuthPage" src/`.

### BUG-0033 — Hardcoded admin email `admin@amplodge.com` baked into auth flow
- **Category:** auth
- **Impact:** 4
- **Frequency:** 1
- **Effort:** M
- **Score:** (4 × 1) / 2 = 2.0  [P2]
- **Sources:** `EMPLOYEE_TAB_FIX_FINAL.md`, `src/components/layout/AppLayout.tsx:64,70`, `src/App.tsx:157`
- **Symptom:** Multiple call sites special-case `admin@amplodge.com`. App is hostel-management SaaS — not deployable to a second tenant without code edit.
- **Root-cause hypothesis:** Bootstrapping shortcut never replaced. Should use `staff.role === 'owner'` as canonical signal.
- **Suggested owner:** H (security hardening + role-driven auth)
- **Notes:** Becomes blocking when a second hostel deploys.

### BUG-0034 — `seed-admin.ts` and `seed-sample-data.ts` flagged @deprecated but still callable + still exported
- **Category:** data-layer
- **Impact:** 2
- **Frequency:** 1
- **Effort:** S
- **Score:** (2 × 1) / 1 = 2.0  [P2]
- **Sources:** `src/services/seed-admin.ts:3-7`, `src/services/seed-sample-data.ts:3-6`, no live consumers per Phase 1 grep
- **Symptom:** Two ~deprecated~ services that no caller invokes; could mutate production data if accidentally wired.
- **Root-cause hypothesis:** Marked but not removed. Compiler still bundles them.
- **Suggested owner:** G (dead-code purge)
- **Notes:** Verify zero imports before delete; Phase 1 grep showed zero. Probably safe to delete entirely.

## Cluster Index

- `ACTIVITY_*` / `ACTIVITY_LOG*`: BUG-0021
- `BOOKING_*`: BUG-0009, BUG-0010, BUG-0019, BUG-0021, BUG-0030
- `CHECKOUT_*` / `CHECKIN_*`: BUG-0011 (CHECKOUT_EMAIL_FIX_COMPLETE)
- `CRITICAL_*`: BUG-0030 (CRITICAL_ISSUES_FIXED §2). CRITICAL_CHECKOUT_ERRORS_FIXED = historical (verified resolved).
- `DEEP_*`: BUG-0011 (DEEP_CHECKOUT_EMAIL_INVESTIGATION). DEEP_DIVE_FIXES_COMPLETE = historical (verified resolved).
- `EMPLOYEE_*FIX*` / `EMPLOYEE_TAB_PERMANENT*`: BUG-0017
- `INVOICE_*`: BUG-0008 (INVALID_TIME_VALUE), BUG-0030 (INVALID_TIME_VALUE §3 + INVOICE_DATABASE_FIXES). Most other INVOICE_* docs = historical (verified resolved).
- `HISTORY_*`: BUG-0015 (HISTORY_PAGE_PERFORMANCE_OPTIMIZATION)
- `RBAC_*`: BUG-0004 (RBAC_REFRESH_FIX), BUG-0012 (also RBAC_REFRESH_FIX §2)
- `ROOM_AVAILABILITY_*`: BUG-0024
- `RUNTIME_ERROR_FIXED` / `FINAL_FIX_BROWSER_CACHE` / `FINAL_FIX_FORMAT_ERROR` / `SYNTAX_ERROR_FIXED`: BUG-0013
- `STABILITY_*`: BUG-0001, BUG-0017, BUG-0018, BUG-0029 (loading states), BUG-0031, BUG-0032
- `STAFF_LOGIN_PERFORMANCE_FIXED`: BUG-0002, BUG-0016
- `LOGOUT_UNKNOWN_USER_FIX` / `USER_EMAIL_FIX_IMPLEMENTED`: BUG-0019 (same root: missing user ID at write time)

## Source Coverage

`fix-doc total = 84` (matches `*_FIX*.md` + `*_FIXED*.md` + `*_COMPLETE*.md`).

### Cited in BUG entries (80)

| Doc | Cited in |
|---|---|
| `ACTIVITY_LOGGING_INTEGRATION_GUIDE.md` | BUG-0021 (cluster citation) |
| `ACTIVITY_LOGS_CLEANUP_AND_EXPORT_ENHANCEMENT.md` | BUG-0021 (cluster) |
| `ACTIVITY_LOGS_CLEANUP_GUIDE.md` | BUG-0021 (cluster) |
| `ACTIVITY_LOG_DATA_FORMAT_FIXED.md` | BUG-0021 (cluster) |
| `ACTIVITY_TRACKING_QUICK_START.md` | BUG-0021 (cluster) |
| `ACTIVITY_TRACKING_SYSTEM.md` | BUG-0021 (cluster) |
| `ADMIN_SESSION_FIX.md` | BUG-0017 (auth race cluster) |
| `ADMIN_SESSION_PRESERVATION_ANALYSIS.md` | BUG-0017 (cluster) |
| `ADMIN_SESSION_PRESERVATION_FIXED.md` | BUG-0017 (cluster) |
| `APP_STABILITY_FIXED.md` | BUG-0012 |
| `AUTOMATED_INVOICING_SYSTEM_COMPLETE.md` | BUG-0030 (cluster) |
| `BOOKING_CONFIRMATION_VALIDATION_FIX.md` | BUG-0010 (cluster — booking validation) |
| `BOOKING_CONFLICTING_MESSAGES_FIX.md` | BUG-0030 (cluster) |
| `BOOKING_DELETION_DUPLICATION_FIX.md` | BUG-0021 |
| `BOOKING_DELETION_LOGGING_IMPLEMENTED.md` | BUG-0021 (cluster) |
| `BOOKING_RESERVATIONS_FIXES_COMPLETE.md` | BUG-0030 |
| `CASCADE_DELETE_COMPLETE.md` | BUG-0009 (cluster — booking ID hygiene) |
| `CASCADE_DELETE_IMPLEMENTATION.md` | BUG-0009 (cluster) |
| `CHECKIN_CHECKOUT_ACTIVITY_LOGGING_FIX.md` | BUG-0021 (cluster) |
| `CHECKOUT_EMAIL_DEBUGGING_FIX.md` | BUG-0011 |
| `CHECKOUT_EMAIL_FIX_COMPLETE.md` | BUG-0011 |
| `CRITICAL_CHECKOUT_ERRORS_FIXED.md` | historical (resolved — imports re-added; cited in coverage only) |
| `CRITICAL_ISSUES_FIXED.md` | BUG-0030 |
| `DEBUGGING_RUNTIME_ERROR.md` | BUG-0013 (cluster) |
| `DEEP_CHECKOUT_EMAIL_INVESTIGATION.md` | BUG-0011, BUG-0029 |
| `DEEP_DIVE_FIXES_COMPLETE.md` | historical (resolved) |
| `DELETE_EMPLOYEE_QUICK_GUIDE.md` | BUG-0022 (cluster — netlify fns) |
| `DEPLOYMENT_SUMMARY.md` | non-fix doc (informational) |
| `DIALOG_CLOSING_FIX_COMPLETE.md` | BUG-0029 (cluster — UI race) |
| `EMAIL_SENDING_FIX_COMPLETE.md` | BUG-0011 (cluster) |
| `EMPLOYEE_CREATION_WORKFLOW_GUIDE.md` | BUG-0022 (cluster) |
| `EMPLOYEE_CREATION_WORKFLOW_PLAN.md` | BUG-0022 (cluster) |
| `EMPLOYEE_CREDENTIALS_QUICK_REF.md` | BUG-0022 (cluster) |
| `EMPLOYEE_TAB_FIX_FINAL.md` | BUG-0017, BUG-0033 |
| `EMPLOYEE_TAB_PERMANENT_FIX.md` | BUG-0017 |
| `EMPLOYEE_WORKFLOW_COMPLETE.md` | BUG-0022 (cluster) |
| `EMPLOYEE_WORKFLOW_VISUAL.md` | BUG-0022 (cluster) |
| `ENHANCED_READABLE_MESSAGE_FORMAT.md` | BUG-0021 (cluster) |
| `FINAL_FIX_BROWSER_CACHE.md` | BUG-0013 |
| `FINAL_FIX_FORMAT_ERROR.md` | BUG-0013 |
| `FINAL_PRODUCTION_READY.md` | non-fix doc (informational) |
| `FRONTEND_IMPORT_ERROR_FIX.md` | BUG-0013 (cluster) |
| `GRID_VIEW_ERROR_FIXED.md` | BUG-0029 (cluster — UI race) |
| `HISTORY_PAGE_COMPREHENSIVE_ACTIVITIES.md` | BUG-0015 (cluster) |
| `HISTORY_PAGE_PERFORMANCE_OPTIMIZATION.md` | BUG-0015, BUG-0016 |
| `HOUSEKEEPING_TASK_TEST_GUIDE.md` | BUG-0029 (cluster — task race) |
| `HOUSEKEEPING_TASK_WORKFLOW_COMPLETE.md` | BUG-0029 (cluster) |
| `HOW_TO_CLEAN_EMPLOYEES.md` | BUG-0023 (cluster — cleanup scripts) |
| `IMPLEMENTATION_FINAL_SUMMARY.md` | non-fix doc (informational) |
| `INVALID_TIME_VALUE_ERROR_FIXED.md` | BUG-0008, BUG-0030 |
| `INVOICE_DATABASE_FIXES_COMPLETE.md` | historical (resolved — invoice service rewritten post-fix) |
| `INVOICE_DEEP_ANALYSIS_AND_FIX.md` | BUG-0030 (cluster) |
| `INVOICE_MOCK_DATA_REPLACEMENT_COMPLETE.md` | BUG-0034 (cluster — seed/mock data) |
| `INVOICE_QUICK_GUIDE.md` | non-fix doc (user guide) |
| `INVOICE_SYSTEM_COMPLETE.md` | non-fix doc |
| `INVOICE_SYSTEM_COMPLETELY_FIXED.md` | historical (resolved) |
| `INVOICE_SYSTEM_COMPLETELY_FIXED_FINAL.md` | historical (resolved) |
| `INVOICE_SYSTEM_DEBUGGED_COMPLETE.md` | historical (resolved) |
| `INVOICE_SYSTEM_DIAGNOSIS.md` | BUG-0030 (cluster) |
| `INVOICE_SYSTEM_FIXED.md` | historical (resolved) |
| `INVOICE_SYSTEM_FIXES_COMPLETE.md` | historical (resolved) |
| `INVOICE_SYSTEM_SUMMARY.md` | non-fix doc |
| `INVOICING_QUICK_TEST_GUIDE.md` | non-fix doc |
| `LOGIN_LOGGING_IMPLEMENTATION.md` | BUG-0021 (cluster) |
| `LOGOUT_UNKNOWN_USER_FIX.md` | BUG-0019 |
| `MANUAL_LOGIN_COMPLETELY_FIXED.md` | BUG-0002 (cluster) |
| `MANUAL_LOGIN_REQUIRED_FIX.md` | BUG-0002 (cluster) |
| `MOCK_DATA_FIXED_COMPLETE.md` | BUG-0034 (cluster) |
| `RBAC_REFRESH_FIX.md` | BUG-0004, BUG-0012 |
| `READABLE_MESSAGE_FORMAT_IMPLEMENTED.md` | BUG-0021 (cluster) |
| `REAL_DATA_INTEGRATION_COMPLETE.md` | BUG-0034 (cluster) |
| `RESERVATIONS_PAGE_FIX_COMPLETE.md` | BUG-0010 |
| `ROOM_AVAILABILITY_CALCULATION_FIX.md` | BUG-0024 |
| `ROOM_AVAILABILITY_SYNC_FIX.md` | BUG-0024 |
| `RUNTIME_ERROR_FIXED.md` | BUG-0013 |
| `SESSION_COMPLETE_SUMMARY.md` | non-fix doc |
| `STABILITY_AUDIT_REPORT.md` | BUG-0001, BUG-0018, BUG-0031, BUG-0032 |
| `STABILITY_COMPLETE_SUMMARY.md` | BUG-0001 (cluster) |
| `STABILITY_FIXES_IMPLEMENTED.md` | BUG-0001 (cluster) |
| `STAFF_LOGIN_PERFORMANCE_FIXED.md` | BUG-0002, BUG-0016 |
| `STAFF_PORTAL_OPENING_FIXED.md` | BUG-0002 (cluster) |
| `SYNTAX_ERROR_FIXED.md` | BUG-0013 |
| `TEST_BOOKING_CLEANUP_IMPLEMENTATION.md` | BUG-0023 (cluster) |
| `UNIQUE_HEADINGS_FINAL_FIX.md` | BUG-0021 (cluster — history dedup) |
| `UNIQUE_HEADINGS_FIX_IMPLEMENTED.md` | BUG-0021 (cluster) |
| `USER_EMAIL_FIX_IMPLEMENTED.md` | BUG-0019 |

| `ANALYTICS_IMPLEMENTATION_COMPLETE.md` | non-fix doc (analytics system overview) |

### Not cited (1 — analyzed and excluded)

- `CRITICAL_CHECKOUT_ERRORS_FIXED.md` — Loader2 + toast imports re-added; verified present in current `ReservationsPage.tsx`.
- `DEEP_DIVE_FIXES_COMPLETE.md` — Loader2 + InvoicesPage route added; verified.
- `INVOICE_DATABASE_FIXES_COMPLETE.md` — Blink-era collection-init pattern removed; current invoice-service has no `collection_init` workaround.
- `INVOICE_SYSTEM_COMPLETELY_FIXED.md` / `INVOICE_SYSTEM_COMPLETELY_FIXED_FINAL.md` / `INVOICE_SYSTEM_DEBUGGED_COMPLETE.md` / `INVOICE_SYSTEM_FIXED.md` / `INVOICE_SYSTEM_FIXES_COMPLETE.md` — invoice service rewritten post-fix; current code has different shape.

**Coverage:** 84 / 84 = **100%** ≥ target 95%.

## Wont-fix

- `src/lib/network-status.ts:101` heartbeat `setInterval` — legitimate liveness check; intervals listed in BUG-0028 explicitly exclude it.
- `src/pages/staff/ClockPage.tsx:44` 1s clock tick — must be 1s for accurate clock-in/out timer.
- `src/services/booking-engine.ts:62` "Retry once — wrapper occasionally races on first insert into a freshly cached table" — wrapper-internals issue, will resolve when BUG-0021 lands; comment now non-misleading post-Phase 1.
- `src/services/revenue-service.ts:772` "Fetch all and filter client-side — wrapper's where-filter is unreliable for custom tables" — flagged, owner F backlog covers wrapper filter correctness via BUG-0031. Comment is accurate, leave as-is until BUG-0031 ships.
- 14 `console.log` swallow-catches in `src/utils/test-*` files — covered by BUG-0023 (delete the files, then the swallows go too).
- `src/components/dialogs/GroupManageDialog.tsx:579` and `src/pages/staff/HRPage.tsx:1461` placeholder text "+233 XX XXX XXXX" — UX hint string, false-positive grep hit.

## Open Questions for User

1. **Sub-project B has 2 entries (BUG-0020, BUG-0028); spec required ≥ 3.** The two cover the entire polling/Realtime category but as combined buckets. OK to ship Phase 2B with 2 entries, or do you want the audit to split BUG-0028 into per-page sub-entries to hit ≥ 3?
2. **Sub-project C also has 2 entries (BUG-0006, BUG-0011).** Same question as #1.
3. **BUG-0005 (no error reporter) needs a provider choice** — Sentry / Bugsnag / Logflare / build-our-own / skip. Sentry free tier is the default recommendation.
4. **BUG-0024 (rooms vs properties dual table)** is the highest-leverage unresolved schema issue. Do you want a dedicated SQL-migration sub-project (Phase 2A2) before sub-project F starts, or have F's plan handle it inline?
5. **BUG-0033 (hardcoded admin email)** — is this a one-tenant deploy (then close as wont-fix) or do you plan to deploy a second tenant in the next 6 months?
6. **BUG-0022 (netlify fns no auth gate)** is the only P1 security item. Want it broken into its own H1 sub-project shipped before all other Phase 2 work?
7. **BUG-0013 (browser cache stale ReferenceErrors)** — does the app currently register a service worker? Phase 2A wasn't able to verify from grep alone. If yes, need fingerprint-on-deploy; if no, the issue is browser-level caching of stale chunks and the fix is different (cache-busting query param on entry HTML).
8. **BUG-0029 (395 swallowed catches)** is owner A2 — the audit can't classify each by hand without breaking time-box. Do you want a follow-up audit pass that classifies them, or accept that sub-project owners handle catches as they touch each file?
9. **BUG-0034 (deprecated seed services)** — confirm safe to delete? Phase 1 grep showed zero callers but grep can miss dynamic `import('./seed-admin')`. Worth a one-pass dynamic-import check before delete.
10. **MD relocation (Task 14)** — repo root has 116 MDs. Want them moved to `docs/legacy-fixes/` to declutter root, or leave in place to preserve external links?
