# Phase 2G — ESLint Restoration + Dead-Code Purge + MD Relocation

**Date:** 2026-05-10
**Status:** Draft — pending user approval
**Owner:** TBD
**Branch:** `phase2g-eslint-deadcode` (to be created)
**Predecessor:** Phase 2A audit (PR #2, `phase2a-bug-audit`)
**Closes audit entries:** BUG-0007, BUG-0008, BUG-0023, BUG-0032, BUG-0034 (5 of 34)

## Context

Phase 2A audit produced a 34-entry ranked backlog. Sub-project G is the lowest-risk, highest-leverage starting point — it restores `npm run lint:js` (currently broken since the ESLint 9 upgrade), removes ~17 verified-dead source files, strips 12 Blink-era optional-chain defenses, and relocates 84 historical fix-MDs out of the repo root.

The work is mechanical. Each change is independently verifiable. Total LOC delta: roughly −2000 source LOC + 84 file moves + 1 new config file.

## Goal

Restore working `npm run lint:js`. Delete every dead source file the audit verified. Strip optional-chain defenses left over from the Blink-era schema-inference SDK. Relocate 84 fix-themed MDs to `docs/legacy-fixes/` to declutter repo root.

## Non-Goals

- No new lint rules beyond what makes existing code pass cleanly.
- No fixes to wrapper internals (Phase 2D).
- No changes to functional code beyond the optional-chain → plain `db.X.method()` rewrites.
- No service-worker changes (deferred to Phase 2A2; investigation noted in audit OQ #7 — confirmed SW is registered at `src/main.tsx:8-10`).
- No new tests.

## Success Criteria

- `npm run lint:js` exits 0 (warnings allowed, errors not).
- `npm run lint:types` returns ≤ 118 errors (Phase 1 baseline). Expected ~38 after scratch-util deletes.
- `npm run lint` (full pipeline) returns 0.
- `npm run build` clean.
- `grep -rn "db\.[a-zA-Z]\+?\.\(list\|get\|create\|update\|delete\)" src/` returns 0 hits.
- `ls src/utils/test-* src/utils/cleanup-* src/utils/force-* src/utils/manual-* src/utils/fix-* src/utils/database-init.ts 2>/dev/null` returns empty.
- `ls src/services/seed-admin.ts src/services/seed-sample-data.ts src/pages/staff/AuthPage.tsx 2>/dev/null` returns empty.
- `ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null` at repo root returns empty.
- `ls docs/legacy-fixes/ | wc -l` returns 84.
- Audit doc source-coverage section cites moved docs as `docs/legacy-fixes/<file>`.

## Architecture

Single-PR refactor. No module boundaries change. No new abstractions. New top-level config file (`eslint.config.js`). One new directory (`docs/legacy-fixes/`). Net `−2000 LOC` source + 84 file moves + 1 new config + 1 new docs README.

## File Operations

### Created

| Path | Responsibility |
|---|---|
| `eslint.config.js` | ESLint 9 flat config (TS + React 19 + react-hooks + react-refresh) |
| `docs/legacy-fixes/README.md` | One-line index for moved docs + pointer to current audit |

### Modified

| Path | Change |
|---|---|
| `package.json` | Add `@eslint/js` to devDependencies (only new dep) |
| `docs/superpowers/audit/2026-05-10-phase2-audit.md` | Source-coverage citations: `<file>.md` → `docs/legacy-fixes/<file>.md` |
| 12 source files containing `db.X?.method()` | Strip optional chain → `db.X.method()` |

### Deleted (17 source files)

| Path | Reason |
|---|---|
| `src/services/seed-admin.ts` | @deprecated; zero callers; PRODUCTION_ADMIN_SETUP.md covers bootstrapping |
| `src/services/seed-sample-data.ts` | @deprecated; zero callers |
| `src/pages/staff/AuthPage.tsx` | Orphaned login page; `StaffLoginPage` is wired in App.tsx |
| `src/utils/test-activity-logs.ts` | Console-debug scratch; zero callers |
| `src/utils/test-activity-logs-fix.ts` | Console-debug scratch; zero callers |
| `src/utils/test-booking-cleanup.ts` | Console-debug scratch; zero callers |
| `src/utils/test-booking-deletion-logging.ts` | Console-debug scratch; zero callers |
| `src/utils/test-login-logout-logging.ts` | Console-debug scratch; zero callers |
| `src/utils/test-unique-headings-fix.ts` | Console-debug scratch; zero callers |
| `src/utils/cleanup-activity-logs.ts` | One-off cleanup; zero callers |
| `src/utils/cleanup-duplicate-activity-logs.ts` | One-off cleanup; zero callers |
| `src/utils/cleanup-test-bookings.ts` | One-off cleanup; zero callers |
| `src/utils/force-cleanup-guests.ts` | One-off cleanup; zero callers |
| `src/utils/force-reset-rooms.ts` | One-off cleanup; zero callers |
| `src/utils/manual-table-creation.ts` | Blink-era table-init; zero callers |
| `src/utils/database-init.ts` | Blink-era init; zero callers |
| `src/utils/fix-logout-unknown-user.ts` | One-off fix; zero callers |

Pre-flight verification commands embedded in plan: each file gets `grep -rn` audit before delete, build catches stragglers.

### Moved (84 files)

All files at repo root matching `*_FIX*.md`, `*_FIXED*.md`, `*_COMPLETE*.md` → `docs/legacy-fixes/`.

`git mv` per file preserves history. Exclusions (current reference docs, do **not** match the patterns anyway): `APP_OVERVIEW.md`, `ARCHITECTURE.md`, `DESIGN.md`, `DESIGN_SYSTEM.md`, `README.md`, `TESTING.md`, `BUILD_AND_DEPLOY.md`, `BOOKING_ENGINE_README.md`, `STABILITY_AUDIT_REPORT.md`, `IMPLEMENTATION_FINAL_SUMMARY.md`, `SESSION_COMPLETE_SUMMARY.md` (last one matches `_COMPLETE` — explicit exclusion needed; flagged in plan).

## `eslint.config.js` Design

Flat config matching existing `package.json` script (`eslint . --ext ts,tsx --report-unused-disable-directives`):

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
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
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
      ...reactHooks.configs.recommended.rules,
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

Rationale for "loose":
- `db: any` everywhere (Phase 1 spec — Phase 2D resolves)
- 395 swallowed-catch sites (BUG-0029 — Phase 2A2 classifies)
- Project goal: restore working lint, not introduce 1000-error regression

Phase 2D and the Phase 2A2 follow-up audit will tighten rules once the underlying issues are fixed.

## Optional-chain Cleanup

12 sites of `db.X?.method()` left over from Blink era when wrapper might return `undefined` for unknown tables. Current Supabase wrapper proxies always return a truthy table object or throw — optional-chain never short-circuits. Stripped is no-op behaviorally.

Find:
```bash
grep -rn "db\.[a-zA-Z]\+?\." src --include="*.ts" --include="*.tsx"
```

Replace via sed:
```bash
grep -rl "db\.[a-zA-Z]\+?\." src --include="*.ts" --include="*.tsx" | \
  xargs sed -i '' -E 's/(\bdb\.[a-zA-Z_]+)\?\./\1./g'
```

Word-boundary `\b` anchor prevents false positives on `mydb.foo?.bar`.

## MD Relocation

```bash
mkdir -p docs/legacy-fixes
for f in $(ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null); do
  # Skip explicit exclusions
  case "$f" in
    SESSION_COMPLETE_SUMMARY.md|IMPLEMENTATION_FINAL_SUMMARY.md|FINAL_PRODUCTION_READY.md)
      continue ;;
  esac
  git mv "$f" "docs/legacy-fixes/$f"
done
```

Then update audit doc citations:
```bash
sed -i '' -E 's/`([A-Z_0-9]+_(FIX|FIXED|COMPLETE)[A-Z_0-9]*\.md)`/`docs\/legacy-fixes\/\1`/g' \
  docs/superpowers/audit/2026-05-10-phase2-audit.md
```

`docs/legacy-fixes/README.md` content:
```markdown
# Legacy Fix Documentation

Historical bug-fix narratives from the Blink era and early Supabase migration. Moved here from repo root in Phase 2G (2026-05-10) to declutter.

For current bug status, scoring, and ownership see:
- `docs/superpowers/audit/2026-05-10-phase2-audit.md` (ranked backlog)

These docs are kept for context; do not rely on them as source of truth for the current codebase.
```

## Verification

```bash
# 1. Lint:js works (target: exit 0)
npm run lint:js

# 2. Lint:types ≤ baseline (118)
npm run lint:types 2>&1 | grep -c "error TS"

# 3. Full lint pipeline
npm run lint

# 4. Clean build
rm -rf node_modules/.vite dist
npm run build

# 5. Optional-chain gone
grep -rn "db\.[a-zA-Z]\+?\." src --include="*.ts" --include="*.tsx" | wc -l
# expect: 0

# 6. Dead files gone
ls src/utils/test-* src/utils/cleanup-* src/utils/force-* src/utils/manual-* src/utils/fix-* src/utils/database-init.ts 2>/dev/null | wc -l
ls src/services/seed-admin.ts src/services/seed-sample-data.ts src/pages/staff/AuthPage.tsx 2>/dev/null | wc -l
# both expect: 0

# 7. MDs relocated
ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null | wc -l
# expect: 0 (or only 3 explicit exclusions)
ls docs/legacy-fixes/*.md | wc -l
# expect: ≥ 81 (84 moved minus 3 exclusions)

# 8. Audit doc references updated
grep -c "docs/legacy-fixes/" docs/superpowers/audit/2026-05-10-phase2-audit.md
# expect: ≥ 80
```

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Flat config silently overrides expected behavior | Med | Low | Inspect first 20 hits manually post-config to confirm rules apply where expected |
| `sed` optional-chain replacement matches false positive (e.g. `mydb.foo?.list`) | Low | Low | Pattern anchors to `\bdb\.` word-boundary; 12 verified hits; review diff before commit |
| Scratch util has hidden caller via dynamic import | Low | Med | Per-file `grep -rn "<basename>"` audit before each delete; build catches missing-module errors |
| MD relocation breaks external links (Notion, blog, docs site) | Low | Low | `docs/legacy-fixes/README.md` index added; user opted in (audit OQ #10) |
| AuthPage delete breaks lazy-load chunk that nothing imports | Very Low | Low | Build catches it; Phase 1 grep confirmed no `lazy(() => import('./pages/staff/AuthPage'))` |
| `eslint.config.js` runs on itself + breaks | Low | Low | `*.config.js` in `ignores` array |
| `seed-admin.ts` deletion blocks future first-deploy bootstrap | Med | Low | PROD branch in code already returns early; bootstrap docs at `PRODUCTION_ADMIN_SETUP.md` (NOT moved — doesn't match patterns); reversible via `git revert` |
| Audit doc sed pattern double-applies after relocation re-run | Low | Low | sed pattern matches bare filenames only — already-prefixed `docs/legacy-fixes/X.md` won't match again (no leading bare filename) |
| `SESSION_COMPLETE_SUMMARY.md` accidentally moved | Med | Low | Explicit `case` exclusion in move loop; verified before commit |

## Rollback

Single squash. `git revert <merge-commit>` restores all 17 source files, restores 84 MDs to root, removes `eslint.config.js`, removes `docs/legacy-fixes/`. No DB migration, no env change, no external state mutated.

## Sequenced Build Order

(Detailed task plan generated by `writing-plans` skill — this section just lists phase-level steps.)

1. Branch from Phase 2A audit branch (or main once both ahead PRs merge).
2. Pre-flight greps confirm zero callers for delete list.
3. Add `@eslint/js` devdep + write `eslint.config.js`.
4. Run `npm run lint:js` — fix any unexpected errors before further delete passes.
5. Strip optional-chains (sed pass + verify).
6. Delete deprecated services (3 files).
7. Delete scratch utils (14 files).
8. Build + lint:types check (expect ~38 errors after scratch removal).
9. Move 84 MDs via `git mv` loop with exclusions.
10. Update audit doc citations via sed.
11. Add `docs/legacy-fixes/README.md`.
12. Final verification per §Verification.
13. Squash commit, push, open PR against `phase2a-bug-audit` (current dependency chain).

## Out of Scope — reserved for later sub-projects

- **Phase 2D** — typed `db.<table>` accessors (would let us tighten ESLint rules above warn-level)
- **Phase 2A2** — service-worker investigation (BUG-0013), swallowed-catch classification (BUG-0029)
- **Phase 2H** — security hardening + Sentry wiring (BUG-0005, BUG-0022, BUG-0025, BUG-0033)
- **Phase 2E/F** — page perf, query perf, dual-nav fix
- **Phase 2B/C** — Realtime + bundle lazy-load
