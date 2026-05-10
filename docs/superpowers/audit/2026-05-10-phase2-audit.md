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
