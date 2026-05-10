# Phase 1 — Strip "Blink" Alias Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dead "Blink" SDK debris and migrate 78 import sites to a clean `db` / `auth` surface backed by the existing Supabase wrapper, with zero behavior change.

**Architecture:** Real Blink SDK already removed; `src/blink/client.ts` is a thin re-export of `src/lib/supabase-wrapper.ts` (980 LOC PouchDB-cached SWR wrapper). Six other `src/blink/*` files (~2175 LOC) are dead init scripts referencing non-existent SDK methods. Plan: add `db`/`auth` named exports to the wrapper, create `src/lib/db.ts` as the new public surface, codemod 78 consumer files, then delete the dead modules and orphaned `functions/` Deno code.

**Tech Stack:** Vite, React 19, TypeScript 5.8, Supabase JS v2, PouchDB, Node 22, Vitest (none installed — verification is grep + lint + build + manual smoke), npm.

**Repo state at plan time:**
- `amplodge/` is a git repo on `main`, up-to-date with `origin/main`
- Uncommitted: `supabase/migrations/20260507_cascade_booking_fks.sql` (M), `docs/superpowers/` (??)
- Spec for this plan: `docs/superpowers/specs/2026-05-10-phase1-strip-blink-design.md`

---

## File Structure

### Files Created
| Path | Responsibility |
|---|---|
| `src/lib/db.ts` | New public data-layer entrypoint. Re-exports `db`, `auth`, `onTableUpdated`, `isOnline`, sync-queue helpers. The single import path consumers depend on. |
| `scripts/codemod-blink.js` | One-shot Node script. Rewrites all `blink` imports + symbol references across `src/`. Discarded after use (committed for audit trail). |

### Files Modified
| Path | Change |
|---|---|
| `src/lib/supabase-wrapper.ts` | Add `export const db = blink.db` and `export const auth = blink.auth` near top of public exports. Later step removes the `blink` export. |
| `src/App.tsx` | Drop `import { initializeDatabaseSchema } from './blink/database-schema'`. Drop the `await initializeDatabaseSchema()` call inside `initializeApp`. |
| 78 files under `src/` | Codemod-rewritten: import path → `@/lib/db`, symbol `blink.db.X` → `db.X`, `blink.auth.X` → `auth.X`. List enumerated by Task 6 dry-run. |

### Files Deleted
| Path | Reason |
|---|---|
| `src/blink/blink-config.ts` | Dead init script, calls non-existent SDK |
| `src/blink/blink-database.ts` | Same |
| `src/blink/database-config.ts` | Same |
| `src/blink/database-schema.ts` | Same |
| `src/blink/database.ts` | Same |
| `src/blink/schema.ts` | Same |
| `src/blink/client.ts` | Replaced by `src/lib/db.ts` |
| `src/blink/` (dir) | Empty after the above |
| `functions/booking-engine/index.ts` | Orphaned Deno fn using real Blink SDK; not deployed (`netlify.toml` deploys `netlify/functions/`) |
| `functions/create-employee/index.ts` | Same; live equivalent is `netlify/functions/create-employee.js` |
| `functions/` (dir) | Empty after the above |
| `scripts/clean-employees-now.js` | One-off cleanup that imports `../src/blink/client.ts` |
| `check_duplicates.ts` | Top-level cruft, imports blink |
| `cleanup_database_script.ts` | Same |

---

### Task 1: Branch from clean baseline

**Files:** none (git ops + sanity baseline)

- [ ] **Step 1: Stash uncommitted work**

```bash
cd /Users/ebenezerbarning/Desktop/projectamp/amplodge
git stash push -u -m "pre-phase1-strip-blink stash" -- supabase/migrations/20260507_cascade_booking_fks.sql
```

Expected: stash entry created. `docs/superpowers/` is left untracked in the working tree (we keep it visible during implementation).

- [ ] **Step 2: Confirm working tree clean enough to branch**

```bash
git status --short
```

Expected output (only the untracked docs dir):

```
?? docs/superpowers/
```

- [ ] **Step 3: Create + check out work branch**

```bash
git checkout -b phase1-strip-blink
```

Expected: `Switched to a new branch 'phase1-strip-blink'`.

- [ ] **Step 4: Commit the spec + plan first so the branch starts with the design captured**

```bash
git add docs/superpowers/
git commit -m "docs: add phase 1 strip-blink spec + plan"
```

Expected: commit hash printed.

- [ ] **Step 5: Baseline build must be green before any refactor**

```bash
npm run lint:types
```

Expected: exit 0, no output beyond `tsc` warmup. If errors appear, fix or document them BEFORE starting refactor — otherwise we can't tell which errors we caused.

- [ ] **Step 6: Baseline production build**

```bash
npm run build
```

Expected: `vite build` completes, `dist/` populated, no errors. Record total bundle size from output for later comparison.

---

### Task 2: Diff orphan edge function vs live counterpart

**Files:**
- Read: `functions/create-employee/index.ts`
- Read: `netlify/functions/create-employee.js`
- Read: `functions/booking-engine/index.ts`
- Read all `netlify/functions/{submit-booking,create-booking,check-availability,rooms-availability,get-booking-details,get-booking-token}.js`

- [ ] **Step 1: Diff create-employee**

```bash
diff <(cat functions/create-employee/index.ts) <(cat netlify/functions/create-employee.js) | head -100
```

Read the diff. For every Blink-side branch that has no `.js` equivalent, port the logic into `netlify/functions/create-employee.js` using `@supabase/supabase-js` (the package is already in `netlify/functions/package.json`). Specifically check:

- Admin token verification (`blink.auth.setToken` + `blink.auth.me()` in old)
- Admin staff record check (`blink.db.staff.list` w/ `userId`, `role: 'admin'`)
- New-user creation flow (`blink.db.users.update`)
- Activity log write (`blink.db.activityLogs.create`)

If the live `.js` already covers each of these via Supabase calls, no port needed. Document the comparison result in a comment block at the top of `netlify/functions/create-employee.js`:

```js
// Verified against legacy functions/create-employee/index.ts on 2026-05-10:
// - admin verification:   covered (lines NN-NN)
// - admin staff check:    covered
// - new-user creation:    covered
// - activity log write:   covered
// Legacy file removed in phase1-strip-blink.
```

- [ ] **Step 2: Confirm booking-engine fully covered by netlify/functions**

```bash
ls netlify/functions/ | grep -E '(booking|availability|rooms)'
```

Expected: `check-availability.js`, `create-booking.js`, `get-booking-details.js`, `get-booking-token.js`, `rooms-availability.js`, `submit-booking.js`. Read each. Cross-reference the route handlers inside `functions/booking-engine/index.ts` (multiple endpoints in one file). Each must have a live `.js` counterpart. If anything is missing, port it before deletion in Task 10.

- [ ] **Step 3: Run any live edge function locally to sanity check**

If `netlify dev` is set up:

```bash
npx netlify dev --dir=dist --no-open &
sleep 5
curl -s http://localhost:8888/.netlify/functions/check-availability?check_in=2026-06-01\&check_out=2026-06-03 | head
kill %1
```

Expected: JSON response (may be empty array depending on data). Confirms the live functions still build + run. Skip this step if `netlify dev` isn't configured locally.

- [ ] **Step 4: Commit if any porting was required**

```bash
git add netlify/functions/
git commit -m "chore(functions): port residual blink-only logic to live netlify functions"
```

Skip the commit if Step 1+2 found no gaps — leave a note in the next commit message instead.

---

### Task 3: Verify wrapper already exports `db` + `auth`

**Files:**
- Read: `src/lib/supabase-wrapper.ts`

The audit confirmed `src/lib/supabase-wrapper.ts` already declares all three exports:
- `export const db = { ... }` at line 760
- `export const auth = { ... }` at line 829
- `export const blink = { db, auth }` at line 979 (the legacy shim — removed in Task 12)

This task is verification-only; no code change.

- [ ] **Step 1: Confirm the three exports exist**

```bash
grep -n "^export const db\|^export const auth\|^export const blink" src/lib/supabase-wrapper.ts
```

Expected output:
```
760:export const db = {
829:export const auth = {
979:export const blink = { db, auth }
```

If line numbers drift, the substance must still match: a `db` const exported, an `auth` const exported, and a `blink` shim that bundles both.

- [ ] **Step 2: Confirm zero internal `blink.` usage inside the wrapper**

```bash
grep -n "blink\." src/lib/supabase-wrapper.ts
```

Expected: zero hits. (If hits appear, Task 12 step 2 must convert `blink` to a non-exported `const` instead of deleting the line outright.)

- [ ] **Step 3: No commit (verification step)**

---

### Task 4: Create `src/lib/db.ts` public surface

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Write the new entrypoint**

Create `src/lib/db.ts` with this exact content:

```ts
/**
 * Data-layer entrypoint.
 *
 * `db`   — table-CRUD wrapper (Supabase + PouchDB SWR cache + sync queue).
 * `auth` — Supabase Auth surface (signInWithEmail, signUp, me, logout, onAuthStateChanged).
 *
 * Both come from src/lib/supabase-wrapper.ts. Phase 2 may rewrite that file;
 * consumers stay on this stable surface.
 */

export { db, auth, onTableUpdated } from './supabase-wrapper'

// Network status
export { getNetworkOnline as isOnline } from './network-status'

// Offline sync queue — named exports
export {
  enqueue,
  processQueue,
  clearQueue,
  getPendingEntries as getAll,
  getSyncState,
  onSyncStateChange,
} from './sync-queue'

// Legacy-compatible `syncQueue` object — preserved because a handful of call
// sites use `syncQueue.add(...)` style. Keep until Phase 2 migrates them.
import * as sq from './sync-queue'
export const syncQueue = {
  add: sq.enqueue,
  process: sq.processQueue,
  clear: sq.clearQueue,
  getAll: sq.getPendingEntries,
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint:types
```

Expected: clean. The file only re-exports symbols already exported elsewhere.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): add src/lib/db.ts public data-layer entrypoint"
```

---

### Task 5: Pre-flight greps for codemod safety

**Files:** none (read-only scans)

- [ ] **Step 1: Confirm no dynamic table access via `blink[...]`**

```bash
grep -rn "blink\[\|blink\.db\[" src/
```

Expected: zero hits. If any hit appears, stop and hand-fix that file before running the codemod (the regex in Task 6 is string-level and won't catch dynamic computed access).

- [ ] **Step 2: Confirm `blinkManaged` has zero external callers**

```bash
grep -rn "blinkManaged" src/
```

Expected: zero hits (it's exported by `src/blink/client.ts` but unused). If any consumer is found, the codemod table in Task 6 must add `blinkManaged → db` to its rules.

- [ ] **Step 3: Confirm window globals only used in console debugging**

```bash
grep -rn "initBlinkDB\|testBlinkTable\|forceCreateBlinkTable\|createBlinkSampleLogs" src/
```

Expected: only matches inside the files we are about to delete (`src/blink/blink-database.ts`, etc.). Any match in a consumer file means a real runtime dependency that must be deleted manually.

- [ ] **Step 4: Build the canonical list of files the codemod will touch**

```bash
grep -rln "from .*['\"].*blink" src/ > /tmp/blink-import-files.txt
wc -l /tmp/blink-import-files.txt
```

Expected: ~78 lines (per audit). Save this file — Task 6 reads it.

- [ ] **Step 5: No commit (read-only step)**

---

### Task 6: Write the codemod script

**Files:**
- Create: `scripts/codemod-blink.js`

- [ ] **Step 1: Write the script**

Create `scripts/codemod-blink.js` with this exact content:

```js
#!/usr/bin/env node
/**
 * One-shot codemod: rewrite Blink imports + symbol references to the new
 * src/lib/db.ts surface.
 *
 * Usage:
 *   node scripts/codemod-blink.js --dry        # preview changes
 *   node scripts/codemod-blink.js --apply      # write changes
 *
 * Scope: src/**\/*.{ts,tsx}, excluding src/blink/ itself (deleted later).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { glob } from 'glob'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const DRY = args.has('--dry') || !APPLY

// Files to delete entirely (no rewrite — they are removed in Task 9).
const DELETE_DIR_PREFIX = path.join(SRC, 'blink') + path.sep

// Import-line rewrites. Each rule: regex → replacement function.
const importRules = [
  // import { initializeDatabaseSchema, ... } from '@/blink/{schema,database-schema}'
  {
    pattern: /^import\s*\{[^}]*\}\s*from\s*['"](?:@\/|\.\.?\/)+blink\/(schema|database-schema|blink-config|blink-database|database-config|database)['"];?\s*\n/gm,
    replace: () => '', // drop entire line
  },
  // import { blink, X, Y } from '...blink/client'
  {
    pattern: /import\s*\{\s*blink\s*(?:,\s*([^}]+?))?\s*\}\s*from\s*['"](?:@\/|\.\.?\/)+blink\/client['"];?/g,
    replace: (_m, rest) => {
      const extras = (rest || '').trim()
      const symbols = extras ? `db, auth, ${extras}` : `db, auth`
      return `import { ${symbols} } from '@/lib/db'`
    },
  },
]

// Symbol rewrites applied to the rest of the file.
const symbolRules = [
  { pattern: /\bblink\.db\b/g, replace: () => 'db' },
  { pattern: /\bblink\.auth\b/g, replace: () => 'auth' },
  { pattern: /\bblinkManaged\b/g, replace: () => 'db' },
]

async function main() {
  const files = await glob('src/**/*.{ts,tsx}', { cwd: ROOT, absolute: true })
  const changed = []

  for (const file of files) {
    if (file.startsWith(DELETE_DIR_PREFIX)) continue // skip files we'll delete
    const before = await fs.readFile(file, 'utf8')
    let after = before

    for (const rule of importRules) after = after.replace(rule.pattern, rule.replace)
    for (const rule of symbolRules) after = after.replace(rule.pattern, rule.replace)

    if (after !== before) {
      changed.push(path.relative(ROOT, file))
      if (APPLY) await fs.writeFile(file, after, 'utf8')
    }
  }

  console.log(`${DRY ? '[DRY]' : '[APPLY]'} ${changed.length} files would be modified:`)
  changed.forEach(f => console.log(`  ${f}`))
}

main().catch(err => {
  console.error('codemod failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Make it discoverable + executable**

```bash
chmod +x scripts/codemod-blink.js
```

- [ ] **Step 3: Verify glob is installed**

```bash
node -e "import('glob').then(m => console.log(typeof m.glob))"
```

Expected: `function`. (`glob` is already in devDependencies per `package.json`.)

- [ ] **Step 4: Dry run**

```bash
node scripts/codemod-blink.js --dry
```

Expected: `[DRY] 78 files would be modified:` followed by paths. Skim the list. Cross-check count against `wc -l /tmp/blink-import-files.txt` from Task 5 step 4 — must match within ±1 (the ±1 allowance covers `App.tsx`, which is hit by both an import-rule deletion and an import-rule rewrite).

If the count is off by more than 1, stop and inspect — likely a pattern miss.

- [ ] **Step 5: Commit the script**

```bash
git add scripts/codemod-blink.js
git commit -m "tools: add one-shot codemod-blink.js"
```

---

### Task 7: Apply the codemod

**Files:** all files listed by Task 6 step 4 dry run

- [ ] **Step 1: Apply**

```bash
node scripts/codemod-blink.js --apply
```

Expected: `[APPLY] 78 files would be modified:` followed by the same paths as the dry run.

- [ ] **Step 2: Spot-check three different files**

```bash
grep -n "from '@/lib/db'" src/services/activity-log-service.ts | head -3
grep -n "from '@/lib/db'" src/components/CalendarGridView.tsx | head -3
grep -n "from '@/lib/db'" src/pages/staff/BookingsPage.tsx | head -3
```

Expected: each shows the new import line. No file should still have `from '@/blink/client'` or `from '../blink/client'`.

- [ ] **Step 3: Verify no stray `blink.` references remain in rewritten files**

```bash
grep -rn "\bblink\." src/ --include="*.ts" --include="*.tsx" | grep -v "src/blink/"
```

Expected: zero hits. If any hit appears, fix it manually (likely a multi-line import the regex missed).

- [ ] **Step 4: Type-check the codemodded tree**

```bash
npm run lint:types
```

Expected: clean. If TS errors appear, they will most likely point to:
- A file the codemod missed (fix manually, re-run dry+apply)
- A `blinkManaged` reference unique to that file (rare; manual rename)
- A type expecting the old `blink.db.X.list(...)` return shape (unchanged by codemod — flag as a separate bug)

- [ ] **Step 5: Lint JS**

```bash
npm run lint:js
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A src/
git commit -m "refactor: codemod blink.* call sites to db/auth direct imports"
```

---

### Task 8: Drop `initializeDatabaseSchema` from `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Locate the import + call site**

```bash
grep -n "initializeDatabaseSchema" src/App.tsx
```

Expected: two matches — the import line and the `await initializeDatabaseSchema()` inside `initializeApp`.

- [ ] **Step 2: Remove the import**

In `src/App.tsx`, delete the line:

```ts
import { initializeDatabaseSchema } from './blink/database-schema'
```

- [ ] **Step 3: Remove the call**

In `src/App.tsx` `initializeApp` function, delete these three lines:

```ts
console.log('🔧 Initializing database schema...')
await initializeDatabaseSchema()
console.log('✅ Database schema initialized')
```

The first `console.log('🚀 App running with Supabase backend')` stays. The block below it (activity log service init) stays.

- [ ] **Step 4: Type-check**

```bash
npm run lint:types
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(app): drop runtime database-schema bootstrap (handled by SQL migrations)"
```

---

### Task 9: Delete dead `src/blink/` directory

**Files:**
- Delete: `src/blink/blink-config.ts`
- Delete: `src/blink/blink-database.ts`
- Delete: `src/blink/database-config.ts`
- Delete: `src/blink/database-schema.ts`
- Delete: `src/blink/database.ts`
- Delete: `src/blink/schema.ts`
- Delete: `src/blink/client.ts`
- Delete: `src/blink/` (directory)

- [ ] **Step 1: Final reference check**

```bash
grep -rn "from .*blink" src/ --include="*.ts" --include="*.tsx"
```

Expected: zero hits. If any hit appears, fix the file before deletion.

- [ ] **Step 2: Remove the directory**

```bash
git rm -r src/blink
```

Expected: 7 files staged for deletion.

- [ ] **Step 3: Type-check**

```bash
npm run lint:types
```

Expected: clean.

- [ ] **Step 4: Build**

```bash
rm -rf node_modules/.vite dist
npm run build
```

Expected: clean build. `dist/` populated. Bundle size should be slightly smaller than the Task 1 baseline (the 2175 dead lines were tree-shaken anyway, but their import-time side effects gone now means a few KB shaved).

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: delete dead src/blink/ legacy SDK init scripts"
```

---

### Task 10: Delete orphaned top-level `functions/` directory

**Files:**
- Delete: `functions/booking-engine/index.ts`
- Delete: `functions/create-employee/index.ts`
- Delete: `functions/` (directory)

- [ ] **Step 1: Confirm netlify deploys from `netlify/functions/` not `functions/`**

```bash
grep "functions" netlify.toml
```

Expected: `functions = "netlify/functions"` (and similar). Confirms top-level `functions/` is never deployed.

- [ ] **Step 2: Confirm Task 2 verification was done**

Re-read `netlify/functions/create-employee.js`. It must contain the verification comment block written in Task 2 step 1, OR you must verify the gaps now before deletion.

- [ ] **Step 3: Remove the directory**

```bash
git rm -r functions
```

Expected: 2 files (and any package.json/tsconfig in there) staged for deletion.

- [ ] **Step 4: Confirm deploy still builds**

```bash
cd netlify/functions && npm install --silent && cd ../..
npm run build
```

Expected: clean. (Per `netlify.toml` the netlify build command is `npm run build && cd netlify/functions && npm install`.)

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: delete orphaned top-level functions/ (replaced by netlify/functions/)"
```

---

### Task 11: Delete top-level scripts + cruft

**Files:**
- Delete: `scripts/clean-employees-now.js`
- Delete: `check_duplicates.ts`
- Delete: `cleanup_database_script.ts`

- [ ] **Step 1: Confirm none of them are referenced from build config**

```bash
grep -n "clean-employees-now\|check_duplicates\|cleanup_database_script" \
  package.json vite.config.ts tsconfig.json netlify.toml 2>/dev/null
```

Expected: zero hits. If any match appears, fix the config before deletion.

- [ ] **Step 2: Remove the files**

```bash
git rm scripts/clean-employees-now.js check_duplicates.ts cleanup_database_script.ts
```

Expected: 3 files staged for deletion.

- [ ] **Step 3: Type-check**

```bash
npm run lint:types
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete one-off cleanup scripts that depended on blink"
```

---

### Task 12: Drop the `blink` export from `supabase-wrapper.ts`

**Files:**
- Modify: `src/lib/supabase-wrapper.ts`

- [ ] **Step 1: Confirm no consumer still imports `blink` from the wrapper**

```bash
grep -rn "blink" src/ --include="*.ts" --include="*.tsx"
```

Expected: zero hits across `src/`. (The wrapper itself may still use `blink` as a local variable name internally — that's fine; only the exported binding gets removed.)

- [ ] **Step 2: Delete the legacy `blink` shim**

In `src/lib/supabase-wrapper.ts`, find the last line of the file (line 979 per Task 3 verification):

```ts
export const blink = { db, auth }
```

Delete this line entirely. `db` and `auth` remain exported individually from earlier in the file (lines 760 and 829), and Task 3 step 2 confirmed nothing internal references `blink`.

If Task 3 step 2 found any internal `blink.` usage, instead change the line to:

```ts
const blink = { db, auth }
```

(drop only the `export` keyword) so internal references still compile.

- [ ] **Step 3: Type-check**

```bash
npm run lint:types
```

Expected: clean.

- [ ] **Step 4: Build**

```bash
rm -rf node_modules/.vite dist
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase-wrapper.ts
git commit -m "refactor(db): remove public blink export — db + auth are the surface now"
```

---

### Task 13: Static verification — name fully gone

**Files:** none (read-only scans)

- [ ] **Step 1: No `blink` symbol anywhere in `src/`**

```bash
grep -rin "blink" src/ --include="*.ts" --include="*.tsx"
```

Expected: zero hits.

- [ ] **Step 2: No `blink` references in scripts or top-level cruft**

```bash
grep -rin "blink" scripts/ functions/ check_duplicates.ts cleanup_database_script.ts 2>/dev/null
```

Expected: zero hits (most paths return "No such file or directory", which is fine).

- [ ] **Step 3: No `from '.*blink'` import paths anywhere**

```bash
grep -rn "from .*blink" .  --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | grep -v node_modules
```

Expected: zero hits.

- [ ] **Step 4: Lint everything**

```bash
npm run lint
```

Expected: every linter (`lint:types`, `lint:js`, `lint:css`, `check:css-vars`, `check:css-classes`) returns clean. If css linters fail, that is unrelated to this refactor — note it but don't fix here.

- [ ] **Step 5: Production build**

```bash
rm -rf node_modules/.vite dist
npm run build
```

Expected: clean. Compare bundle size to Task 1 baseline. Modest reduction expected; no growth permitted.

- [ ] **Step 6: No commit (verification step)**

---

### Task 14: Manual smoke test runbook

**Files:** none (manual)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Expected: Vite reports `Local: http://localhost:5173/` (or configured port). Open the URL.

- [ ] **Step 2: Login**

Navigate to `/staff/login`. Sign in as the admin user. Expected: redirected to `/staff/dashboard`. No console errors.

- [ ] **Step 3: Walk every staff route in order**

Visit each, in this order, and watch the browser console:

```
/staff/dashboard
/staff/calendar
/staff/properties
/staff/bookings
/staff/onsite
/staff/reservations
/staff/reservations/history
/staff/guests
/staff/housekeeping
/staff/employees
/staff/invoices
/staff/channels
/staff/reports
/staff/analytics
/staff/activity-logs
/staff/email-diagnostics
/staff/set-prices
/staff/settings
/staff/reviews
/staff/marketing
/staff/requests
/staff/hr
/staff/my-revenue
/staff/inventory
/staff/inventory/transactions
```

Expected: each page renders. No red console errors. Warnings about missing env vars or missing data are pre-existing and not in scope.

- [ ] **Step 4: Walk the public routes**

```
/
/rooms
/gallery
/contact
/booking
/virtual-tour
```

Expected: each renders. No console errors.

- [ ] **Step 5: CRUD probe — Bookings**

On `/staff/bookings`:
1. Click "New booking", fill required fields, save. Expected: booking appears in the list.
2. Open the row, edit guest name or notes, save. Expected: row updates.
3. Delete the row. Expected: row vanishes.

Open the Supabase dashboard. Confirm the row went through full create → update → delete in the `bookings` table.

- [ ] **Step 6: Offline cycle**

DevTools → Network → throttling: **Offline**.
1. Reload `/staff/guests`. Expected: page renders from PouchDB cache.
2. Create a guest. Expected: toast indicates queued for sync (or no error).
3. Switch back to **Online**. Wait 5–10s.
4. Reload. Expected: the guest is now persisted in Supabase (visible in dashboard).

- [ ] **Step 7: Auth lifecycle**

Logout from the avatar menu. Expected: redirected to `/staff/login`. Reload — no auto-relogin. Login again. Refresh the page after login. Expected: session persists.

- [ ] **Step 8: Stop dev server**

```bash
# Ctrl-C in the terminal running `npm run dev`
```

- [ ] **Step 9: Tag a smoke-test pass commit**

```bash
git commit --allow-empty -m "test: phase 1 manual smoke pass"
```

---

### Task 15: Restore stashed work + finalize

**Files:** none (git ops)

- [ ] **Step 1: Pop the pre-refactor stash**

```bash
git stash pop
```

Expected: the SQL migration file reappears as modified. If a merge conflict occurs (none expected — the refactor doesn't touch `supabase/`), resolve manually.

- [ ] **Step 2: Confirm working tree state**

```bash
git status --short
```

Expected:
```
 M supabase/migrations/20260507_cascade_booking_fks.sql
```

- [ ] **Step 3: Push the branch**

```bash
git push -u origin phase1-strip-blink
```

Expected: branch pushed, PR URL printed.

- [ ] **Step 4: Open a PR**

```bash
gh pr create --title "Phase 1: strip blink alias layer" \
  --body "Implements docs/superpowers/specs/2026-05-10-phase1-strip-blink-design.md. Zero behavior change; verification per docs/superpowers/plans/2026-05-10-phase1-strip-blink.md Task 13 + 14."
```

Expected: PR URL printed. Review the diff one more time — should be the codemod plus the file deletes.

---

## What's NOT in this plan (deferred)

- **Phase 2** — wrapper internals refactor, kill `any` casts, replace polling with Supabase Realtime, bundle audit, root-cause the bug churn
- **Phase 3** — UI facelift, new components, UX improvements

Phase 2 starts as a fresh brainstorm against the cleaned-up codebase produced by this plan.
