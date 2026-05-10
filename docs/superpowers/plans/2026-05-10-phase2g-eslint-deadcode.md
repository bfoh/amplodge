# Phase 2G — ESLint + Dead-Code + MD Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore working `npm run lint:js`, delete 17 verified-dead source files, strip 12 Blink-era optional-chain defenses, relocate 84 fix-MDs to `docs/legacy-fixes/`.

**Architecture:** Mechanical refactor. New `eslint.config.js` flat config matching project conventions. Sed pass strips `db.X?.method()` → `db.X.method()`. `git rm` per dead file. `git mv` per relocated MD. One sed pass updates audit doc citations. No source-code logic changes.

**Tech Stack:** ESLint 9 (flat config), `@eslint/js`, `typescript-eslint` v8 (already installed), `eslint-plugin-react-hooks` (already installed), `eslint-plugin-react-refresh` (already installed), `globals` (already installed). Node + bash + sed + git for file ops.

**Repo state at plan time:**
- Branch base = `phase2a-bug-audit` (Phase 2A audit PR #2)
- Phase 1 PR #1 still pending merge to main
- Phase 2G plan + spec live on `phase2a-bug-audit` branch (cherry-picked into new branch by Task 1)

---

## File Structure

### Files Created

| Path | Responsibility |
|---|---|
| `eslint.config.js` | ESLint 9 flat config (TS + React 19 + react-hooks + react-refresh + loose rules matching baseline) |
| `docs/legacy-fixes/README.md` | One-line index pointing to current audit doc |
| `docs/legacy-fixes/` | Destination dir for 84 moved fix-MDs |

### Files Modified

| Path | Change |
|---|---|
| `package.json` | Add `@eslint/js` to devDependencies |
| `docs/superpowers/audit/2026-05-10-phase2-audit.md` | Source-coverage citations: `<file>.md` → `docs/legacy-fixes/<file>.md` |
| `src/pages/staff/ReservationsPage.tsx` | Strip `db.bookingCharges?.listAll()` → `db.bookingCharges.listAll()` (4 sites) |
| `src/services/channel-service.ts` | Strip `this.db.X?.method()` → `this.db.X.method()` (3 sites) |
| `src/services/hotel-settings.ts` | Strip `this.db.hotelSettings?.method()` → `this.db.hotelSettings.method()` (5 sites) |

### Files Deleted (17 source files)

**Deprecated services (3):**
- `src/services/seed-admin.ts`
- `src/services/seed-sample-data.ts`
- `src/pages/staff/AuthPage.tsx`

**Scratch utilities (14):**
- `src/utils/test-activity-logs.ts`
- `src/utils/test-activity-logs-fix.ts`
- `src/utils/test-booking-cleanup.ts`
- `src/utils/test-booking-deletion-logging.ts`
- `src/utils/test-login-logout-logging.ts`
- `src/utils/test-unique-headings-fix.ts`
- `src/utils/cleanup-activity-logs.ts`
- `src/utils/cleanup-duplicate-activity-logs.ts`
- `src/utils/cleanup-test-bookings.ts`
- `src/utils/force-cleanup-guests.ts`
- `src/utils/force-reset-rooms.ts`
- `src/utils/manual-table-creation.ts`
- `src/utils/database-init.ts`
- `src/utils/fix-logout-unknown-user.ts`

### Files Moved (84 → 75 after exclusions)

All repo-root files matching `*_FIX*.md` / `*_FIXED*.md` / `*_COMPLETE*.md` → `docs/legacy-fixes/`.

**Explicit exclusions** (matched-glob but kept at root because they are non-fix overviews / current-reference docs):
- `SESSION_COMPLETE_SUMMARY.md` (session work summary)
- `STABILITY_COMPLETE_SUMMARY.md` (overview doc)
- `ANALYTICS_IMPLEMENTATION_COMPLETE.md` (analytics system overview)
- `INVOICE_SYSTEM_COMPLETE.md` (invoice impl overview)
- `EMPLOYEE_WORKFLOW_COMPLETE.md` (workflow ref doc)
- `HOUSEKEEPING_TASK_WORKFLOW_COMPLETE.md` (workflow ref doc)
- `AUTOMATED_INVOICING_SYSTEM_COMPLETE.md` (system overview)
- `REAL_DATA_INTEGRATION_COMPLETE.md` (milestone doc)
- `CASCADE_DELETE_COMPLETE.md` (feature implementation doc)

(75 files actually move; 9 explicit exclusions stay at root. Plan tasks reference 75 moves.)

---

### Task 1: Branch + cherry-pick spec/plan

**Files:** none (git ops)

- [ ] **Step 1: Confirm working tree clean**

```bash
cd /Users/ebenezerbarning/Desktop/projectamp/amplodge
git status --short
```

Expected: empty (or untracked work outside scope). If pending changes appear, stash:

```bash
git stash push -u -m "pre-phase2g stash"
```

- [ ] **Step 2: Branch off `phase2a-bug-audit`**

```bash
git checkout phase2a-bug-audit
git pull origin phase2a-bug-audit
git checkout -b phase2g-eslint-deadcode
```

Expected: `Switched to a new branch 'phase2g-eslint-deadcode'`. Spec + plan already on tree (no cherry-pick needed since `phase2a-bug-audit` is the base).

- [ ] **Step 3: Baseline snapshots**

```bash
npm run lint:types 2>&1 | grep -c "error TS" > /tmp/2g-baseline-ts.txt
cat /tmp/2g-baseline-ts.txt
```

Expected: `118` (Phase 1 baseline). Record so post-refactor diff is verifiable.

```bash
npm run build 2>&1 | tail -3 > /tmp/2g-baseline-build.txt
cat /tmp/2g-baseline-build.txt
```

Expected: `✓ built in <N>s`. Record bundle sizes for comparison.

---

### Task 2: Pre-flight delete safety check

**Files:** none (read-only audit)

- [ ] **Step 1: Confirm zero callers for each deletion target**

```bash
for f in \
  src/services/seed-admin.ts \
  src/services/seed-sample-data.ts \
  src/pages/staff/AuthPage.tsx \
  src/utils/test-activity-logs.ts \
  src/utils/test-activity-logs-fix.ts \
  src/utils/test-booking-cleanup.ts \
  src/utils/test-booking-deletion-logging.ts \
  src/utils/test-login-logout-logging.ts \
  src/utils/test-unique-headings-fix.ts \
  src/utils/cleanup-activity-logs.ts \
  src/utils/cleanup-duplicate-activity-logs.ts \
  src/utils/cleanup-test-bookings.ts \
  src/utils/force-cleanup-guests.ts \
  src/utils/force-reset-rooms.ts \
  src/utils/manual-table-creation.ts \
  src/utils/database-init.ts \
  src/utils/fix-logout-unknown-user.ts; do
  base=$(basename "$f" .ts); base=$(basename "$base" .tsx)
  hits=$(grep -rln "$base" src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "^$f$" | wc -l | tr -d ' ')
  echo "$base: $hits external refs"
done
```

Expected: every line ends `: 0 external refs`. If any > 0, **STOP** and inspect — file has live callers; remove from delete list and revise plan.

- [ ] **Step 2: Confirm zero dynamic imports**

```bash
for name in seed-admin seed-sample-data AuthPage test-activity-logs database-init manual-table-creation; do
  echo "=== $name ==="
  grep -rn "import.*['\"].*$name" src --include="*.ts" --include="*.tsx" 2>/dev/null
done
```

Expected: no output (no dynamic imports). If any output appears, the file has a runtime caller — STOP and inspect.

- [ ] **Step 3: No commit (read-only)**

---

### Task 3: Add `@eslint/js` devdep

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@eslint/js`**

```bash
npm install --save-dev @eslint/js
```

Expected: package added to devDependencies; lockfile updated; no other dep changes.

- [ ] **Step 2: Verify dependency tree**

```bash
node -e "const v=require('@eslint/js/package.json').version; console.log('@eslint/js:', v)"
```

Expected: prints version, no error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @eslint/js for flat-config support"
```

---

### Task 4: Write `eslint.config.js`

**Files:**
- Create: `eslint.config.js`

- [ ] **Step 1: Write config**

Create `eslint.config.js` with this exact content:

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  // Ignored paths
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'netlify/functions/node_modules/**',
      '*.config.js',
      'scripts/**',
      'supabase/**',
      'resend/**',
      'docs/**',
    ],
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (non-type-checked — fast)
  ...tseslint.configs.recommended,

  // Project rules
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks
      ...reactHooks.configs.recommended.rules,

      // React Refresh
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Loose rules — match Phase 1 baseline. Strict mode arrives in Phase 2D.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-async-promise-executor': 'warn',
    },
  },
)
```

- [ ] **Step 2: Run lint:js**

```bash
npm run lint:js 2>&1 | tail -40
```

Expected one of:
- Exit 0, only warnings (acceptable).
- Errors present — read first 5, classify:
  - Plugin loading error → check ignore pattern includes the offending file.
  - React-hooks rule error in real source → fix the source (rare — would mean baseline already broken).
  - Unrecognized rule → typo in config; correct.

If errors are introduced by config typos, fix and re-run. If errors are real source bugs, **STOP** — out of Phase 2G scope. File issue and proceed to next task with config baseline noted.

- [ ] **Step 3: Record warning count**

```bash
npm run lint:js 2>&1 | grep -E "warning|error" | wc -l > /tmp/2g-lint-warnings.txt
cat /tmp/2g-lint-warnings.txt
```

Expected: a number. Record for verification.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "feat(lint): add eslint.config.js (flat config) — restores npm run lint:js"
```

---

### Task 5: Strip `db.X?.method()` optional chains

**Files (modified by sed):**
- `src/pages/staff/ReservationsPage.tsx` (4 sites: lines 239, 911, 935, 955)
- `src/services/channel-service.ts` (3 sites: lines 20, 93, 150)
- `src/services/hotel-settings.ts` (5 sites: lines 75, 96, 133, 139, 146)

- [ ] **Step 1: List sites before**

```bash
grep -rn "db\.[a-zA-Z]\+?\." src --include="*.ts" --include="*.tsx" 2>/dev/null
```

Expected: 12 hits across the 3 files above. If different count, STOP and re-evaluate (new sites added since plan).

- [ ] **Step 2: Apply sed**

```bash
grep -rl "db\.[a-zA-Z]\+?\." src --include="*.ts" --include="*.tsx" 2>/dev/null \
  | xargs sed -i '' -E 's/(\bdb\.[a-zA-Z_]+)\?\./\1./g'
```

Note: `\b` word-boundary ensures `mydb.foo?.bar` is NOT matched. macOS sed needs `-i ''` (empty backup suffix); on Linux use `-i` (no quoted arg).

- [ ] **Step 3: Verify zero hits remain**

```bash
grep -rn "db\.[a-zA-Z]\+?\." src --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' '
```

Expected: `0`.

- [ ] **Step 4: Inspect diff**

```bash
git diff src/pages/staff/ReservationsPage.tsx src/services/channel-service.ts src/services/hotel-settings.ts | head -60
```

Expected: only `?.` removed, no other changes. Spot-check the 12 changes look correct.

- [ ] **Step 5: Type-check**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
```

Expected: ≤ 118 (no new errors introduced).

- [ ] **Step 6: Commit**

```bash
git add src/pages/staff/ReservationsPage.tsx src/services/channel-service.ts src/services/hotel-settings.ts
git commit -m "refactor: strip db.X?.method() optional chains (Blink-era dead defense)"
```

---

### Task 6: Delete deprecated services + orphan AuthPage

**Files deleted:**
- `src/services/seed-admin.ts`
- `src/services/seed-sample-data.ts`
- `src/pages/staff/AuthPage.tsx`

- [ ] **Step 1: Final caller check (re-run Task 2)**

```bash
for f in src/services/seed-admin.ts src/services/seed-sample-data.ts src/pages/staff/AuthPage.tsx; do
  base=$(basename "$f" .ts); base=$(basename "$base" .tsx)
  hits=$(grep -rln "$base" src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "^$f$" | wc -l | tr -d ' ')
  echo "$base: $hits"
done
```

Expected: all `0`.

- [ ] **Step 2: Delete**

```bash
git rm src/services/seed-admin.ts src/services/seed-sample-data.ts src/pages/staff/AuthPage.tsx
```

Expected: 3 files staged for deletion.

- [ ] **Step 3: Type-check + build**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
npm run build 2>&1 | tail -3
```

Expected: TS errors ≤ 118 (likely lower since dead files no longer parsed). Build green.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete deprecated services + orphan AuthPage (BUG-0032, BUG-0034)"
```

---

### Task 7: Delete 14 scratch utility files

**Files deleted:** see list under "Scratch utilities (14)" in §File Structure.

- [ ] **Step 1: Final caller check (re-run Task 2)**

```bash
for f in src/utils/test-activity-logs.ts src/utils/test-activity-logs-fix.ts \
         src/utils/test-booking-cleanup.ts src/utils/test-booking-deletion-logging.ts \
         src/utils/test-login-logout-logging.ts src/utils/test-unique-headings-fix.ts \
         src/utils/cleanup-activity-logs.ts src/utils/cleanup-duplicate-activity-logs.ts \
         src/utils/cleanup-test-bookings.ts src/utils/force-cleanup-guests.ts \
         src/utils/force-reset-rooms.ts src/utils/manual-table-creation.ts \
         src/utils/database-init.ts src/utils/fix-logout-unknown-user.ts; do
  base=$(basename "$f" .ts)
  hits=$(grep -rln "$base" src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "^$f$" | wc -l | tr -d ' ')
  echo "$base: $hits"
done
```

Expected: all `0`.

- [ ] **Step 2: Delete**

```bash
git rm \
  src/utils/test-activity-logs.ts \
  src/utils/test-activity-logs-fix.ts \
  src/utils/test-booking-cleanup.ts \
  src/utils/test-booking-deletion-logging.ts \
  src/utils/test-login-logout-logging.ts \
  src/utils/test-unique-headings-fix.ts \
  src/utils/cleanup-activity-logs.ts \
  src/utils/cleanup-duplicate-activity-logs.ts \
  src/utils/cleanup-test-bookings.ts \
  src/utils/force-cleanup-guests.ts \
  src/utils/force-reset-rooms.ts \
  src/utils/manual-table-creation.ts \
  src/utils/database-init.ts \
  src/utils/fix-logout-unknown-user.ts
```

Expected: 14 files staged for deletion.

- [ ] **Step 3: Type-check (expect big drop)**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
```

Expected: substantially less than 118 (Phase 1 noted ~80 of 118 errors lived in these files). Target: ≤ 60.

- [ ] **Step 4: Build**

```bash
rm -rf node_modules/.vite dist
npm run build 2>&1 | tail -5
```

Expected: clean build. Bundle slightly smaller (these files were tree-shaken anyway, but their import-time globals are gone).

- [ ] **Step 5: Lint:js still clean**

```bash
npm run lint:js
```

Expected: exit 0 (nothing in the deleted files to lint).

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: delete 14 scratch utility files (BUG-0023)"
```

---

### Task 8: Move 75 fix-MDs to `docs/legacy-fixes/`

**Files moved:** 75 (84 matched — 9 explicit exclusions).

- [ ] **Step 1: Create destination dir**

```bash
mkdir -p docs/legacy-fixes
```

- [ ] **Step 2: Build move list w/ exclusions**

```bash
ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null | sort -u > /tmp/2g-md-candidates.txt
wc -l /tmp/2g-md-candidates.txt
```

Expected: 84.

```bash
cat > /tmp/2g-md-exclusions.txt <<'EOF'
SESSION_COMPLETE_SUMMARY.md
STABILITY_COMPLETE_SUMMARY.md
ANALYTICS_IMPLEMENTATION_COMPLETE.md
INVOICE_SYSTEM_COMPLETE.md
EMPLOYEE_WORKFLOW_COMPLETE.md
HOUSEKEEPING_TASK_WORKFLOW_COMPLETE.md
AUTOMATED_INVOICING_SYSTEM_COMPLETE.md
REAL_DATA_INTEGRATION_COMPLETE.md
CASCADE_DELETE_COMPLETE.md
EOF

grep -vFf /tmp/2g-md-exclusions.txt /tmp/2g-md-candidates.txt > /tmp/2g-md-to-move.txt
wc -l /tmp/2g-md-to-move.txt
```

Expected: 75.

- [ ] **Step 3: Move via `git mv`**

```bash
while read -r f; do
  git mv "$f" "docs/legacy-fixes/$f"
done < /tmp/2g-md-to-move.txt
```

Expected: 75 file moves staged.

- [ ] **Step 4: Verify root cleared + dest populated**

```bash
ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null | wc -l | tr -d ' '
ls docs/legacy-fixes/*.md 2>/dev/null | wc -l | tr -d ' '
```

Expected: root = 9 (exclusions); dest = 75.

- [ ] **Step 5: Commit**

```bash
git commit -m "docs: relocate 75 fix-themed MDs to docs/legacy-fixes/ (audit OQ #10)"
```

---

### Task 9: Add `docs/legacy-fixes/README.md` index

**Files:**
- Create: `docs/legacy-fixes/README.md`

- [ ] **Step 1: Write README**

Create `docs/legacy-fixes/README.md` with this exact content:

```markdown
# Legacy Fix Documentation

Historical bug-fix narratives from the Blink era and early Supabase migration. Moved here from repo root in Phase 2G (2026-05-10) to declutter.

For current bug status, scoring, and ownership see:
- `docs/superpowers/audit/2026-05-10-phase2-audit.md` (ranked backlog)

These docs are kept for context; do **not** rely on them as source of truth for the current codebase. Many describe attempted fixes that did not stick — the audit cross-references which ones survived and which regressed.

## Index

The 75 docs in this directory are auto-listed by name. Use the audit doc's "Cluster Index" and "Source Coverage" sections to find the BUG-XXXX entry that cites each file.

## Excluded from move (kept at repo root)

These files matched the move-pattern but are non-fix overviews / reference docs:

- `SESSION_COMPLETE_SUMMARY.md`
- `STABILITY_COMPLETE_SUMMARY.md`
- `ANALYTICS_IMPLEMENTATION_COMPLETE.md`
- `INVOICE_SYSTEM_COMPLETE.md`
- `EMPLOYEE_WORKFLOW_COMPLETE.md`
- `HOUSEKEEPING_TASK_WORKFLOW_COMPLETE.md`
- `AUTOMATED_INVOICING_SYSTEM_COMPLETE.md`
- `REAL_DATA_INTEGRATION_COMPLETE.md`
- `CASCADE_DELETE_COMPLETE.md`
```

- [ ] **Step 2: Commit**

```bash
git add docs/legacy-fixes/README.md
git commit -m "docs(legacy-fixes): add index README pointing to current audit"
```

---

### Task 10: Update audit doc citations to `docs/legacy-fixes/` paths

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Snapshot current citation count**

```bash
file=docs/superpowers/audit/2026-05-10-phase2-audit.md
grep -oE "\\\`[A-Z_0-9]+_(FIX|FIXED|COMPLETE)[A-Z_0-9]*\\.md\\\`" $file | sort -u | wc -l | tr -d ' '
```

Expected: a number ≥ 75.

- [ ] **Step 2: Apply sed to prefix bare filenames w/ docs/legacy-fixes/**

```bash
file=docs/superpowers/audit/2026-05-10-phase2-audit.md
# Build exclusion regex (these stay at root)
exclusions='SESSION_COMPLETE_SUMMARY|STABILITY_COMPLETE_SUMMARY|ANALYTICS_IMPLEMENTATION_COMPLETE|INVOICE_SYSTEM_COMPLETE|EMPLOYEE_WORKFLOW_COMPLETE|HOUSEKEEPING_TASK_WORKFLOW_COMPLETE|AUTOMATED_INVOICING_SYSTEM_COMPLETE|REAL_DATA_INTEGRATION_COMPLETE|CASCADE_DELETE_COMPLETE'

# sed: match `<NAME>.md` only when NAME does not match exclusions list
# Strategy: do all replacements, then revert exclusions
sed -i '' -E 's|`([A-Z_0-9]+_(FIX|FIXED|COMPLETE)[A-Z_0-9]*\.md)`|`docs/legacy-fixes/\1`|g' "$file"

# Revert excluded ones
for excl in SESSION_COMPLETE_SUMMARY STABILITY_COMPLETE_SUMMARY ANALYTICS_IMPLEMENTATION_COMPLETE \
            INVOICE_SYSTEM_COMPLETE EMPLOYEE_WORKFLOW_COMPLETE HOUSEKEEPING_TASK_WORKFLOW_COMPLETE \
            AUTOMATED_INVOICING_SYSTEM_COMPLETE REAL_DATA_INTEGRATION_COMPLETE CASCADE_DELETE_COMPLETE; do
  sed -i '' "s|docs/legacy-fixes/${excl}.md|${excl}.md|g" "$file"
done
```

- [ ] **Step 3: Verify**

```bash
file=docs/superpowers/audit/2026-05-10-phase2-audit.md
echo "Cites docs/legacy-fixes/: $(grep -c 'docs/legacy-fixes/' $file)"
echo "Bare cites (should be only excluded ones):"
grep -oE "\\\`[A-Z_0-9]+_(FIX|FIXED|COMPLETE)[A-Z_0-9]*\\.md\\\`" $file | sort -u
```

Expected: `Cites docs/legacy-fixes/` ≥ 80; bare cites list = only the 9 exclusions (or fewer if not all referenced).

- [ ] **Step 4: Spot-check audit doc still parses**

```bash
head -50 docs/superpowers/audit/2026-05-10-phase2-audit.md
```

Expected: Markdown intact, no broken refs visible in header/Summary/first entries.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "docs(audit): update fix-doc citations to docs/legacy-fixes/ paths"
```

---

### Task 11: Final verification

**Files:** none (read-only)

- [ ] **Step 1: Lint:js exits 0**

```bash
npm run lint:js
echo "Exit: $?"
```

Expected: `Exit: 0` (warnings allowed, errors not).

- [ ] **Step 2: Lint:types ≤ baseline**

```bash
npm run lint:types 2>&1 | grep -c "error TS"
```

Expected: < 118. Target ≤ 60.

- [ ] **Step 3: Full lint pipeline**

```bash
npm run lint
```

Expected: exit 0 across `lint:types`, `lint:js`, `lint:css`, `check:css-vars`, `check:css-classes`. If `lint:css` or `check:*` fail, that's pre-existing — note in PR description, do not fix here (out of scope).

- [ ] **Step 4: Build clean**

```bash
rm -rf node_modules/.vite dist
npm run build 2>&1 | tail -10
```

Expected: `✓ built in <N>s`. Bundle size unchanged or smaller than Phase 1 baseline.

- [ ] **Step 5: Optional-chain gone**

```bash
grep -rn "db\.[a-zA-Z]\+?\." src --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' '
```

Expected: `0`.

- [ ] **Step 6: Dead files gone**

```bash
ls src/utils/test-* src/utils/cleanup-* src/utils/force-* src/utils/manual-* src/utils/fix-* src/utils/database-init.ts 2>/dev/null | wc -l | tr -d ' '
ls src/services/seed-admin.ts src/services/seed-sample-data.ts src/pages/staff/AuthPage.tsx 2>/dev/null | wc -l | tr -d ' '
```

Expected: both `0`.

- [ ] **Step 7: MDs relocated**

```bash
echo "Root fix-MDs (expect 9 exclusions): $(ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "docs/legacy-fixes/ files (expect 76 = 75 moved + 1 README): $(ls docs/legacy-fixes/*.md 2>/dev/null | wc -l | tr -d ' ')"
```

Expected:
- Root fix-MDs = **9** (the explicit exclusions kept at root)
- `docs/legacy-fixes/*.md` = **76** (75 moved fix-docs + the new README)

- [ ] **Step 8: Audit doc citations updated**

```bash
grep -c "docs/legacy-fixes/" docs/superpowers/audit/2026-05-10-phase2-audit.md
```

Expected: ≥ 75.

- [ ] **Step 9: No commit (verification step)**

---

### Task 12: Push branch + open PR

**Files:** none (git ops)

- [ ] **Step 1: Verify clean working tree**

```bash
git status --short
```

Expected: empty.

- [ ] **Step 2: Review commit log**

```bash
git log --oneline phase2a-bug-audit..HEAD
```

Expected: ~10 commits (one per task that committed).

- [ ] **Step 3: Push branch**

```bash
git push -u origin phase2g-eslint-deadcode
```

Expected: branch pushed; PR URL printed.

- [ ] **Step 4: Open PR against `phase2a-bug-audit`**

```bash
gh pr create --base phase2a-bug-audit --title "Phase 2G: ESLint restoration + dead-code purge + MD relocation" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-05-10-phase2g-eslint-deadcode-design.md.
Plan: docs/superpowers/plans/2026-05-10-phase2g-eslint-deadcode.md.

> Base = phase2a-bug-audit (PR #2). Merge order: PR #1 → main, PR #2 → main, this PR → main.

## Closes audit entries (5 of 34)
- BUG-0007 — ESLint config missing for ESLint 9 (lint:js script broken)
- BUG-0008 — `db.X?.method()` optional-chain dead defense (12 sites)
- BUG-0023 — `src/utils/test-*` scratch files w/ pre-existing TS errors
- BUG-0032 — Dual login pages (AuthPage orphan)
- BUG-0034 — Deprecated `seed-admin.ts` + `seed-sample-data.ts` still callable

## What

- Add `eslint.config.js` (flat config matching project conventions). One new devdep: `@eslint/js`.
- Strip 12 `db.X?.method()` Blink-era optional-chain defenses (sed pass).
- Delete 17 source files: 3 deprecated services + 14 scratch utilities. All verified zero callers.
- Move 75 fix-themed MDs from repo root to `docs/legacy-fixes/`. 9 non-fix overview docs explicitly excluded.
- Add `docs/legacy-fixes/README.md` index pointing to current audit.
- Update audit doc citations: `<file>.md` → `docs/legacy-fixes/<file>.md`.

## Verification

| Check | Baseline | Result |
|---|---|---|
| `npm run lint:js` | broken (no config) | exit 0 |
| `npm run lint:types` errors | 118 | ~38 (target ≤ 60) |
| Optional-chain `db.X?.` sites | 12 | 0 |
| Dead source files | 17 | 0 |
| Repo-root fix-MDs | 84 | 9 (exclusions only) |
| `docs/legacy-fixes/` content | n/a | 76 (75 moved + README) |
| Audit doc citations updated | n/a | ≥ 75 |

## Reviewer asks

1. Sanity-check the 9 MD exclusions — any others that shouldn't have been moved?
2. ESLint rules in flat config are intentionally loose (matches Phase 1 baseline). Phase 2D will tighten once `db: any` resolves.
3. Approve to merge once base PRs (#1, #2) land.
EOF
)"
```

Expected: PR URL printed.

---

## What's NOT in this plan (deferred)

- **Phase 2D** — typed `db.<table>` accessors; tighten ESLint rules above warn-level
- **Phase 2A2** — service-worker investigation (BUG-0013), swallowed-catch classification (BUG-0029)
- **Phase 2H** — security hardening + Sentry wiring
- **Phase 2E/F** — page perf, query perf, dual-nav fix
- **Phase 2B/C** — Realtime + bundle lazy-load
