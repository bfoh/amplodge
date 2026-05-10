# Phase 2A — Bug-Audit Pass

**Date:** 2026-05-10
**Status:** Draft — pending user approval
**Owner:** TBD
**Branch:** `phase2a-bug-audit` (to be created)
**Predecessor:** Phase 1 (PR #1, `phase1-strip-blink`)

## Context

Phase 1 stripped the dead Blink alias layer and produced a clean `db` / `auth` data-layer surface. Phase 2 was decomposed into eight sub-projects (B–H plus this audit, A). This is sub-project A — a read-only audit pass that produces a ranked backlog file. Every later Phase 2 sub-project consumes that backlog.

Reconnaissance signals that motivated audit-first ordering:

- 116 `*_FIX*.md` / `*_FIXED*.md` / `*_COMPLETE*.md` docs at repo root
- Largest service file: `src/services/booking-engine.ts` (1883 LOC); largest page: `src/pages/staff/HRPage.tsx` (2091 LOC)
- 14 `setInterval` polling sites; 7 unbounded `.list({})` / `listAll` calls
- 12 `useMemo` usages, 0 `React.memo` — likely render-storms
- Wrapper publicly types `db` as `any` — TS catches nothing in 76 consumer files

The fix-doc volume strongly suggests recurring root causes never resolved. Audit deduplicates the symptoms, surfaces the root causes, and lines up the next seven sub-projects against actual issues instead of guesses.

## Goal

Produce a single ranked backlog markdown enumerating every known bug, workaround, and root-cause hypothesis in the codebase. Drives every later Phase 2 sub-project (B, C, D, E, F, G, H).

## Non-Goals

- Zero code changes. (One opt-in exception: relocating MD docs into `docs/legacy-fixes/` to declutter repo root — only if user approves §5.7.)
- No new tests.
- No fixes — even one-line fixes go in the backlog, not in this PR.
- No design proposals for individual fixes; later sub-project specs handle those.

## Success Criteria

- File exists at `docs/superpowers/audit/2026-05-10-phase2-audit.md`.
- Every entry has all required fields populated (id, title, source citations, category, impact, frequency, effort, score, root-cause hypothesis, suggested owner).
- ≥ 95% of `*_FIX*.md` / `*_FIXED*.md` / `*_COMPLETE*.md` docs cited at least once.
- Every grep-matchable workaround tag (TODO/FIXME/HACK/XXX) either has a BUG entry or is listed in a `## Wont-fix` section with a one-line rationale.
- Sub-projects B, C, D, E, F, G, H each own ≥ 3 backlog entries.
- Open-questions section has ≤ 10 items.

## Output Artifact

Path: `docs/superpowers/audit/2026-05-10-phase2-audit.md`.

Structure:

```markdown
# Phase 2 Audit — Ranked Backlog

**Generated:** 2026-05-10
**Sources:** 116 root MDs, src/ greps, git log (180d), code error patterns
**Coverage:** <X>% of fix-docs cited

## Summary
- Total entries: N
- Critical (score ≥ 8): N
- By owner: A=n, B=n, C=n, D=n, E=n, F=n, G=n, H=n
- Top 10 root causes

## Entries

### BUG-0001 — <short title>
- **Category:** booking | guest | invoice | auth | activity-log | hr | inventory |
                 reservations | housekeeping | analytics | infra | bundle |
                 render | data-layer
- **Impact:** 1–5  (1 cosmetic, 5 data-loss/security)
- **Frequency:** 1–5  (1 once-ever, 5 every session)
- **Effort:** S | M | L
- **Score:** (impact × frequency) / effort_weight  (S=1, M=2, L=4)
- **Sources:** `BOOKING_DELETION_DUPLICATION_FIX.md`,
              `src/services/booking-engine.ts:1234-1240`,
              `git@<sha>`
- **Symptom:** what the user sees / what breaks
- **Root-cause hypothesis:** why it happens
- **Suggested owner:** B | C | D | E | F | G | H | A2 (deeper audit needed)
- **Notes:** anything ambiguous or needing user input

## Cluster Index
Map cluster → entries (e.g. `ACTIVITY_LOG_*` → BUG-0007, BUG-0012, BUG-0033).

## Source Coverage
List every MD file → 'cited in BUG-XXXX' or 'no entries (resolved/duplicate of …)'.

## Wont-fix
Workaround tags / catch blocks that are intentional, with rationale.

## Open Questions for User
Items where the audit hit ambiguity needing human decision.
```

## Sources

### Source 1 — Fix-themed MDs at repo root

Cluster by filename prefix. Read mode per cluster:

| Cluster prefix | Est. count | Read mode |
|---|---|---|
| `ACTIVITY_*` / `ACTIVITY_LOG*` | ~10 | Sample 3, skim rest titles |
| `BOOKING_*` | ~12 | Sample 3 |
| `EMPLOYEE_*` | ~8 | Sample 3 |
| `CHECKOUT_*` / `CHECKIN_*` | ~6 | Sample 2 |
| `INVOICE_*` | ~8 | Sample 3 |
| `EMAIL_*` | ~5 | Sample 2 |
| `ANALYTICS_*` | ~9 | Sample 2 |
| `RESERVATION*` | ~5 | Sample 2 |
| `HOUSEKEEPING_*` | ~3 | Read all |
| `HR_*` / `INVENTORY_*` / `MARKETING_*` | ~6 | Read all |
| `CRITICAL_*` / `DEEP_*` | ~5 | **Read all in full** |
| `*_FIX_FINAL.md` / `*_PERMANENT_FIX*.md` | ~4 | **Read all in full** |
| Other (e.g. `APP_STABILITY_FIXED.md`, `BUILD_AND_DEPLOY.md`) | ~30 | Skim title; full read only if title hints at bug |

`CRITICAL_*`, `DEEP_*`, and `*_FIX_FINAL` get full reads because they are rare and dense — a fix needing a "FINAL" version means the earlier fixes failed (high signal).

### Source 2 — Code-comment greps

```bash
grep -rn "TODO\|FIXME\|XXX\|HACK\|workaround\|hack\|broken\|temporary" \
  src --include="*.ts" --include="*.tsx"
grep -rn "// NOTE:" src --include="*.ts" --include="*.tsx"
grep -rn "// WHY:" src --include="*.ts" --include="*.tsx"
```

`// NOTE:` and `// WHY:` are the codebase's convention for explaining non-obvious decisions; they often sit on top of workarounds.

### Source 3 — Git log (last 180d)

```bash
git log --since="180.days.ago" --oneline | grep -iE "fix|hotfix|patch|workaround|revert"
git log --since="180.days.ago" --grep="fix" --pretty="%h %s" | sort -u
git log --since="180.days.ago" --pretty="%h %s" | grep -iE "again|really|finally|permanent"
```

Look for revert chains, fix-on-fix sequences, multi-attempt patterns.

### Source 4 — Error-handling patterns

```bash
# Catch blocks that warn-and-continue (no rethrow)
grep -rn "} catch.*{" src --include="*.ts" --include="*.tsx" -A3 | \
  grep -B1 "console\.warn\|console\.error" | grep -v "throw"

grep -rn "// Don't fail\|// Continue\|// Non-critical\|// Skip\|// fall through" \
  src --include="*.ts" --include="*.tsx"
```

These find papered-over bugs disguised as defensive code.

### Cluster overlap

Entries from MDs cross-reference grep findings. If `ACTIVITY_LOG_DATA_FORMAT_FIXED.md` describes a bug AND `src/services/activity-log-service.ts:421` has a matching `// HACK:` comment, both cite the same `BUG-XXXX` entry.

## Ranking Schema

**Score formula:** `(impact × frequency) / effort_weight`

**Impact (1–5):**

| Score | Meaning |
|---|---|
| 5 | Data loss, data corruption, security breach, money lost (wrong invoice, double-charge, deleted booking, leaked PII) |
| 4 | Feature broken / unusable for affected user (can't check in guest, can't save form, page crashes) |
| 3 | Feature degraded but workable (slow, awkward UX, requires retry, wrong-but-fixable display) |
| 2 | Annoyance (confusing log, redundant click, misleading message) |
| 1 | Cosmetic (typo, off-by-1px, dev-console noise) |

**Frequency (1–5):**

| Score | Meaning |
|---|---|
| 5 | Every session for every user |
| 4 | Every session for some users / daily for many |
| 3 | Weekly for typical user |
| 2 | Monthly / specific scenarios |
| 1 | Rare / one-time edge case |

**Effort weight:**

| Label | Weight | Means |
|---|---|---|
| S | 1 | ≤ 1 day, single-file fix, no schema change |
| M | 2 | 1–3 days, multi-file, no schema change |
| L | 4 | ≥ 3 days, schema or wrapper change, cross-cutting |

**Score band → priority label:**

| Range | Priority |
|---|---|
| ≥ 8.0 | P0 critical |
| 4.0–7.9 | P1 high |
| 2.0–3.9 | P2 medium |
| < 2.0 | P3 low / nice-to-have |

**Worked example:**

- "Booking deletion creates duplicate" → impact 5, freq 3, effort M (weight 2)
- Score = (5 × 3) / 2 = **7.5** → **P1 high**

**Tie-break:** higher impact wins, then higher frequency, then earliest BUG-id.

## Workflow

### 5.1 — Setup (10 min)
1. `git checkout -b phase2a-bug-audit` off `main`
2. `mkdir -p docs/superpowers/audit/`
3. Initialize `2026-05-10-phase2-audit.md` with skeleton headers
4. Commit empty skeleton (audit trail)

### 5.2 — Mechanical scans (30 min)
1. Save grep results to `/tmp/audit-greps/`:
   - `tags.txt` (TODO/FIXME/HACK/workaround)
   - `notes.txt` (`// NOTE:` comments)
   - `swallowed-errors.txt` (silent catch blocks)
   - `git-fixes.txt` (fix-themed commits last 180d)
   - `git-reverts.txt` (revert chains)
2. Cluster MD files: `ls *.md | awk -F'_' '{print $1}' | sort | uniq -c | sort -rn`
3. Generate per-cluster file lists in `/tmp/audit-clusters/<prefix>.txt`

### 5.3 — MD reading (2–3 hours)
For each cluster:
1. Read all `CRITICAL_*`, `DEEP_*`, `*_FIX_FINAL*`, `*_PERMANENT_*` in full
2. Read 2–3 samples from rest (oldest + newest + one mid)
3. For remaining MDs: read title + first paragraph only
4. Per finding → append BUG entry to backlog
5. Time-box each cluster to 10 min; overrun → file as open question and move on

### 5.4 — Code reading (1–2 hours)
1. For each grep hit:
   - Open file, read ±15 lines context
   - If real bug → BUG entry citing `file:line`
   - If duplicate of MD-found bug → add citation to existing entry
2. For each suspicious large service (`booking-engine`, `analytics`, `revenue`):
   - Skim error-handling sections
   - Look for retry loops, fallback chains, data-shape coercion (signs of paper-overs)

### 5.5 — Cross-link + dedup (30 min)
1. Walk every BUG entry, ensure 2+ source citations where possible
2. Merge near-duplicates (same root, different surface) — collapse and combine citations
3. Compute scores
4. Sort entries by score desc, renumber `BUG-XXXX`
5. Fill cluster index + source-coverage section

### 5.6 — Open-questions sweep (15 min)
1. List items where audit hit ambiguity
2. List items where impact/frequency uncertain
3. Hand to user for triage before backlog locked

### 5.7 — Optional MD relocation (15 min, opt-in)
Only if user approves at PR-review time:
1. `mkdir docs/legacy-fixes/`
2. `git mv *_FIX*.md *_FIXED*.md *_COMPLETE*.md docs/legacy-fixes/` (case-by-case — leave non-fix docs alone)
3. Result: repo root drops from 116 → ~10 MDs

### 5.8 — Commit + PR (10 min)
1. Single commit: `audit: phase 2 ranked backlog`
2. Push branch, open PR (draft if user wants further triage before merge)

**Total:** ~5–6 hours of work, mostly reading.

## Verification

### Quantitative
1. Source-coverage section accounts for ≥ 95% of `ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md | wc -l`.
2. Backlog has ≥ 1 BUG entry per non-trivial cluster (every prefix with ≥ 3 MDs).
3. Every grep tag has either a BUG entry or a `## Wont-fix` row with rationale.
4. Every BUG entry has all required fields populated (no `TBD` allowed in entry body except in `Notes`).
5. Sum of source citations across entries ≥ MD file count.

### Qualitative
1. Top-10 P0 items are not surprising — they trace to the clusters with the most fix-docs.
2. Sub-projects B, C, D, E, F, G, H each own ≥ 3 BUG entries (validates earlier decomposition).
3. Open-questions section has ≤ 10 items (more = audit incomplete).

### Verification commands

```bash
# Coverage
total_md=$(ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null | wc -l)
cited=$(grep -oE "[A-Z_0-9]+\.md" docs/superpowers/audit/2026-05-10-phase2-audit.md | sort -u | wc -l)
echo "Coverage: $cited / $total_md"

# Field completeness — these counts should all match the entry count
grep -c "^### BUG-" docs/superpowers/audit/2026-05-10-phase2-audit.md
grep -c "^- \*\*Score:\*\*" docs/superpowers/audit/2026-05-10-phase2-audit.md
grep -c "^- \*\*Root-cause hypothesis:\*\*" docs/superpowers/audit/2026-05-10-phase2-audit.md
grep -c "^- \*\*Suggested owner:\*\*" docs/superpowers/audit/2026-05-10-phase2-audit.md

# Owner distribution
grep "^- \*\*Suggested owner:\*\*" docs/superpowers/audit/2026-05-10-phase2-audit.md \
  | awk '{print $NF}' | sort | uniq -c
```

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fix-docs are aspirational (describe attempted fix that didn't stick) | High | Med | Cross-reference w/ git log + current code. If MD says "FIXED" but matching workaround tag still in code, mark BUG entry as "REGRESSED" — high priority. |
| Sampling misses unique bug only documented in one skipped MD | Med | Low | Title-skim every MD. Anything with novel keyword (not in cluster summary) gets full read. |
| Same bug filed multiple times across docs | High | Low | Dedup pass in §5.5. Multiple MD citations on one entry = signal, not noise. |
| Audit reads fix-docs as ground truth when they reflect old architecture | Med | Med | Always check current code. If MD references `blink.X`, code is now `db.X` — check whether bug survived Phase 1 cleanup. |
| Subjective impact/frequency scores skew priorities | Med | Med | Rubric documented in §Ranking. Open-questions flags uncertain scores. User reviews top 20 before sub-project planning. |
| MD relocation breaks external links (other repos, Notion, etc) | Low | Low | §5.7 is opt-in. Default = leave files in place. |
| Grep tags miss real workarounds disguised as normal code | High | Med | Read service-file error blocks even without tags. Look for: retry loops, multiple fallback paths, comments with "for some reason" / "sometimes" / "occasionally". |
| Audit takes longer than 6h estimate | Med | Low | Time-box per cluster to 10 min. Overrun = file as open question, move on. |

## Rollback

Trivial. Single-commit PR that adds files only. `git revert` removes the audit doc and any moved MDs.

## Out of Scope — reserved for later Phase 2 sub-projects

- **B** — replace `setInterval` polling with Supabase Realtime
- **C** — bundle audit + lazy-load `jspdf` / `html2canvas` / `charts`
- **D** — `supabase-wrapper.ts` internals refactor, kill `db: any`
- **E** — page perf for top 5 (HRPage, ReservationsPage, EmployeesPage, AnalyticsPage, BookingsPage)
- **F** — query perf, kill N+1, replace `listAll` + client-side joins with Postgres joined queries
- **G** — fix ESLint 9 flat config + delete `src/utils/test-*` scratch + deprecated services
- **H** — auth-gate the Netlify functions (`create-employee`, `delete-employee`)
