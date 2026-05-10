# Phase 1 — Strip "Blink" Alias Layer

**Date:** 2026-05-10
**Status:** Approved (sections 1–8) — pending spec review
**Owner:** TBD
**Branch:** `phase1-strip-blink` (to be created)

## Context

The codebase descends from a prototype built on the now-deprecated **Blink SDK** (`@blinkdotnew/sdk`). Migration to Supabase happened in stages: a wrapper at `src/lib/supabase-wrapper.ts` (980 lines) provides a Blink-compatible API on top of Supabase + PouchDB offline cache + sync queue.

The migration left a layer of legacy debris:

- `src/blink/` directory contains 7 files. Only `client.ts` is live; it merely re-exports from `supabase-wrapper.ts`.
- The other 6 files (`blink-config.ts`, `blink-database.ts`, `database-config.ts`, `database-schema.ts`, `database.ts`, `schema.ts`) total **~2175 lines** of dead initialization code that calls non-existent old SDK methods. They are imported by `App.tsx` and a handful of utility files but their runtime side effects do nothing useful.
- `functions/booking-engine/` and `functions/create-employee/` contain Deno edge functions still using `npm:@blinkdotnew/sdk`. These are **never deployed** — `netlify.toml` points at `netlify/functions/` (all `.js`, no Blink). The top-level `functions/` directory is orphaned.
- 78 import sites across `src/` import the `blink` symbol and call `blink.db.X` (211 calls) or `blink.auth.X` (65 calls). Zero calls to `blink.storage`, `blink.ai`, or `blink.realtime` — the dependency surface is shallow.

## Goal

Remove every reference to "Blink" from the codebase and migrate consumers to a clean `db` / `auth` surface backed by the existing Supabase wrapper. Zero behavior change.

## Non-Goals (deferred to Phase 2/3)

- Refactoring `supabase-wrapper.ts` internals
- Performance work (queries, bundle, render)
- UI changes
- New features
- Bug fixes (audit happens in Phase 2)

## Success Criteria

- `grep -ri "blink" src/` → 0 hits
- `grep -ri "blink" functions/ scripts/` → 0 hits (or directories removed entirely)
- `npm run lint:types` clean
- `npm run lint:js` clean
- `npm run build` clean
- App boots, login works, every page renders, CRUD probe passes (see §Verification)
- Offline → online cycle drains sync queue normally

## Architecture

### Before
```
src/blink/client.ts ──re-exports──> src/lib/supabase-wrapper.ts ──> src/lib/supabase.ts
src/blink/{blink-config,blink-database,database-config,database-schema,database,schema}.ts (DEAD)
functions/{booking-engine,create-employee}/index.ts ──> npm:@blinkdotnew/sdk (ORPHANED)
scripts/clean-employees-now.js ──> ../src/blink/client.ts (DEAD)
```

### After
```
src/lib/db.ts ──re-exports──> src/lib/supabase-wrapper.ts ──> src/lib/supabase.ts
(everything else deleted)
```

### Public Surface — `src/lib/db.ts`

```ts
export { db, auth, onTableUpdated } from './supabase-wrapper'
export { getNetworkOnline as isOnline } from './network-status'
export {
  enqueue, processQueue, clearQueue,
  getPendingEntries as getAll,
  getSyncState, onSyncStateChange,
} from './sync-queue'

import * as sq from './sync-queue'
export const syncQueue = {
  add: sq.enqueue,
  process: sq.processQueue,
  clear: sq.clearQueue,
  getAll: sq.getPendingEntries,
}
```

### Wrapper Change — `src/lib/supabase-wrapper.ts`

Add named exports `db` and `auth`:

```ts
export const db = blink.db
export const auth = blink.auth
```

`blink` export removed in step 8 once consumers migrated.

## File Operations

### Delete
- `src/blink/blink-config.ts`
- `src/blink/blink-database.ts`
- `src/blink/database-config.ts`
- `src/blink/database-schema.ts`
- `src/blink/database.ts`
- `src/blink/schema.ts`
- `src/blink/client.ts` (replaced by `src/lib/db.ts`)
- `src/blink/` (empty directory after above)
- `functions/booking-engine/` (orphan)
- `functions/create-employee/` (orphan)
- `functions/` (empty directory after above)
- `scripts/clean-employees-now.js`
- `check_duplicates.ts` (top-level cruft)
- `cleanup_database_script.ts` (top-level cruft)

### Create
- `src/lib/db.ts` (per surface above)
- `scripts/codemod-blink.js` (one-shot rewrite tool)

### Modify
- `src/lib/supabase-wrapper.ts` — add `db` + `auth` named exports, remove `blink` export at end
- `src/App.tsx` — drop `initializeDatabaseSchema` import + call
- 78 consumer files — codemod (see §Codemod)

## Codemod

`scripts/codemod-blink.js` (Node, uses `glob`):

| Pattern | Replacement |
|---|---|
| `import { blink } from '@/blink/client'` | `import { db, auth } from '@/lib/db'` |
| `import { blink } from '../blink/client'` | `import { db, auth } from '@/lib/db'` |
| `import { blink } from '../../blink/client'` | `import { db, auth } from '@/lib/db'` |
| `import { blink, X } from '@/blink/client'` | `import { db, auth, X } from '@/lib/db'` |
| `import { blink, X, Y } from '../blink/client'` | `import { db, auth, X, Y } from '@/lib/db'` |
| `import { initializeDatabaseSchema, … } from '@/blink/{schema,database-schema}'` | (remove line) |
| `import { … } from '@/blink/blink-config'` | (remove line) |
| `blink.db.` | `db.` |
| `blink.auth.` | `auth.` |
| `(blink.db as any)` | `(db as any)` (keep cast) |
| `blinkManaged` | `db` (verify zero hits first) |

Pre-flight greps before delete:
- `blink\[` and `blink\.db\[` — dynamic table access (manual fix if any)
- `blinkManaged` — confirm zero external uses
- `initBlinkDB`, `testBlinkTable`, `forceCreateBlinkTable` window globals — confirm only used in console debugging

## Data Flow (Unchanged)

```
Component
  → db.<table>.list(opts)
    → supabase-wrapper.createTableWrapper.list
      ├─ read PouchDB cache (instant return if hit)
      └─ background fetch from supabase.from(table).select()
         → on success: writeOne / warmTable in cache
         → emitTableUpdated(table) if row count changed
Component subscribes via onTableUpdated(table, cb) → re-runs loader
```

Mutations:
```
Component
  → db.<table>.create / update / delete
    → write to PouchDB optimistically
    → if online: supabase.from(table).insert/update/delete + reconcile cache
    → if offline: enqueue in sync-queue (replayed on reconnect)
```

## Error Handling

No new error paths. Existing wrapper handles:
- Network errors → fall back to cache
- Cache miss + offline → empty result + warn
- Sync queue replay failures → kept in queue for retry

Removing `initializeDatabaseSchema` cannot break startup — function only ran `db.<table>.list({ limit: 1 })` against tables it expected to exist. If a table was missing, the function logged a warning and continued (the `create` fallback inside it called non-existent SDK methods and always failed). Net effect: noisy console output during boot, removed.

## Verification

### Static
1. `grep -ri "blink" src/ functions/ scripts/ check_duplicates.ts cleanup_database_script.ts 2>/dev/null` → 0 hits
2. `grep -r "from.*blink" src/` → 0 hits
3. `npm run lint:types`
4. `npm run lint:js`
5. `npm run build`

### Runtime smoke (manual)
1. `rm -rf node_modules/.vite dist` then `npm run dev` — boots without console errors
2. Login as admin → dashboard loads, sidebar populated
3. Visit each route in order:
   - `/staff/dashboard`, `/staff/calendar`, `/staff/properties`, `/staff/bookings`, `/staff/onsite`, `/staff/reservations`, `/staff/reservations/history`, `/staff/guests`, `/staff/housekeeping`, `/staff/employees`, `/staff/invoices`, `/staff/channels`, `/staff/reports`, `/staff/analytics`, `/staff/activity-logs`, `/staff/email-diagnostics`, `/staff/set-prices`, `/staff/settings`, `/staff/reviews`, `/staff/marketing`, `/staff/requests`, `/staff/hr`, `/staff/my-revenue`, `/staff/inventory`, `/staff/inventory/transactions`
4. Public site: `/`, `/rooms`, `/gallery`, `/contact`, `/booking`, `/virtual-tour`
5. CRUD probe — Bookings page: create booking → edit → delete. Confirm row present in Supabase dashboard + PouchDB cache.
6. Offline test: DevTools → Network → Offline. Cached pages still render. Create a booking → toast shows queued. Reconnect. Verify queue drains and row lands in Supabase.
7. Logout → login → refresh → session restored.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Codemod misses dynamic `blink.db[tableName]` access | Low | Med | Pre-grep `blink\[` and `blink\.db\[`. Hand-fix if found. |
| `initializeDatabaseSchema` removal breaks first-run | Low | Low | Function relied on tables existing already. SQL migrations in `supabase/` create the schema. |
| `as any` casts mask real type errors after rename | Med | Low | Keep casts in Phase 1. Phase 2 introduces typed table accessors. |
| `blinkManaged` consumed by code missed in grep | Low | Med | Re-grep `blinkManaged` before delete. Add `export const blinkManaged = db` shim if any hit appears. |
| Page lazy-load chunks hold stale references after delete | Low | Low | `rm -rf node_modules/.vite dist` before build. |
| `netlify/functions/create-employee.js` lacks behavior present in deleted `functions/create-employee/index.ts` | Low | Med | Diff old vs new before delete. Port any missing logic to the `.js` version. |
| Top-level `.ts` cruft files referenced by some build step | Very Low | Low | Grep for filenames in `vite.config.ts`, `package.json`, `tsconfig.json`. |

## Rollback

Single `git revert <commit>` restores everything. No DB migrations, no env changes, no external state mutated.

## Sequenced Build Order

1. Create branch `phase1-strip-blink`. Baseline: `npm run lint:types && npm run build` green.
2. Diff `netlify/functions/create-employee.js` vs old `functions/create-employee/index.ts`. Port missing behavior.
3. Add `db` + `auth` exports to `supabase-wrapper.ts` (additive).
4. Create `src/lib/db.ts` with new public surface.
5. Run codemod across `src/`. 78 import sites rewritten.
6. Drop `initializeDatabaseSchema` import + call from `App.tsx`.
7. Delete dead files (`src/blink/`, `functions/`, `scripts/clean-employees-now.js`, `check_duplicates.ts`, `cleanup_database_script.ts`).
8. Drop `blink` export from `supabase-wrapper.ts`.
9. Run static + runtime verification (§Verification).
10. Squash commit: `refactor: strip blink alias layer, migrate to direct db/auth surface`.

## Out of Scope — Reserved for Phase 2

- `supabase-wrapper.ts` internals refactor (split file, kill `any`, single camel↔snake mapper)
- Replace polling intervals with Supabase Realtime subscriptions
- Bundle audit (current size, code splitting wins)
- Bug + workaround audit (root-cause the churn evident in 100+ MD docs)

## Out of Scope — Reserved for Phase 3

- UI facelift, new components, UX improvements
