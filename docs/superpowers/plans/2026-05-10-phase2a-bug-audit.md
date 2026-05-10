# Phase 2A — Bug-Audit Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a single ranked-backlog markdown enumerating every known bug, workaround, and root-cause hypothesis in the codebase, scored by impact × frequency / effort, with each entry routed to one of the seven later Phase-2 sub-projects (B–H).

**Architecture:** Read-only audit. Mechanical scans (greps + git log) feed structured input into `/tmp/audit-greps/`; manual MD reading clusters fix-docs by filename prefix; entries get appended to one output file at `docs/superpowers/audit/2026-05-10-phase2-audit.md`. No source code changes.

**Tech Stack:** Bash + grep + awk + git CLI for mechanical scans. Manual reading + Markdown writing for the rest. No new tooling installed. No tests (the deliverable IS the artifact; verification commands check schema completeness, not behavior).

**Repo state at plan time:**
- `amplodge/` is a git repo on branch `phase1-strip-blink` (Phase 1 PR #1 awaiting review)
- This plan branches off **`main`** so Phase 2A can ship independently of Phase 1
- 116 total `.md` files at repo root; **84** match `*_FIX*.md` / `*_FIXED*.md` / `*_COMPLETE*.md` (the audit-relevant subset)
- Spec for this plan: `docs/superpowers/specs/2026-05-10-phase2a-bug-audit-design.md`

---

## File Structure

### Files Created (audit deliverables)

| Path | Responsibility |
|---|---|
| `docs/superpowers/audit/2026-05-10-phase2-audit.md` | The single output artifact. Sections: Summary, Entries (BUG-XXXX), Cluster Index, Source Coverage, Wont-fix, Open Questions for User. |

### Files Created (transient — local only, NOT committed)

| Path | Responsibility |
|---|---|
| `/tmp/audit-greps/tags.txt` | TODO/FIXME/HACK/workaround grep hits |
| `/tmp/audit-greps/notes.txt` | `// NOTE:` and `// WHY:` hits |
| `/tmp/audit-greps/swallowed-errors.txt` | Catch blocks that warn-and-continue without rethrow |
| `/tmp/audit-greps/git-fixes.txt` | Fix-themed commits last 180d |
| `/tmp/audit-greps/git-reverts.txt` | Revert chains last 180d |
| `/tmp/audit-greps/git-multi-attempt.txt` | Commit subjects with "again", "really", "finally", "permanent" |
| `/tmp/audit-clusters/<prefix>.txt` | One file per MD cluster prefix (BOOKING, ACTIVITY, EMPLOYEE, etc.) |
| `/tmp/audit-clusters/_summary.txt` | Cluster name → file count, sorted descending |

### Files Modified
None. (One opt-in exception in Task 14 — relocate MDs into `docs/legacy-fixes/` if user approves at PR-review time.)

### Files Deleted
None.

---

### Task 1: Branch from main

**Files:** none (git ops + sanity baseline)

- [ ] **Step 1: Confirm working tree clean enough to branch**

```bash
cd /Users/ebenezerbarning/Desktop/projectamp/amplodge
git status --short
```

If anything beyond untracked `docs/superpowers/` or expected uncommitted SQL migration appears, stop and ask. Otherwise stash any working changes:

```bash
git stash push -u -m "pre-phase2a stash"
```

(Skip if there's nothing to stash.)

- [ ] **Step 2: Branch off main**

```bash
git fetch origin main
git checkout -b phase2a-bug-audit origin/main
```

Expected: `Switched to a new branch 'phase2a-bug-audit'`. The Phase 1 spec/plan artifacts won't appear on this branch (they live on `phase1-strip-blink`); the Phase 2A spec needs to be cherry-picked across.

- [ ] **Step 3: Cherry-pick the Phase 2A spec onto this branch**

```bash
git log phase1-strip-blink --oneline -- docs/superpowers/specs/2026-05-10-phase2a-bug-audit-design.md
```

Expected: one commit hash printed (the spec commit, e.g. `79d7a32`).

```bash
git cherry-pick <that-hash>
```

Expected: `[phase2a-bug-audit <new-hash>] docs: add phase 2a bug-audit spec`. If it conflicts (it shouldn't — file is new on this branch), resolve in favor of the incoming version.

- [ ] **Step 4: Cherry-pick this plan**

After this plan file is written and committed (Task 16), it will need cherry-picking the same way. Note the requirement here so the implementor remembers.

---

### Task 2: Create skeleton output file

**Files:**
- Create: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Create the audit directory**

```bash
mkdir -p docs/superpowers/audit
```

- [ ] **Step 2: Write the skeleton**

Create `docs/superpowers/audit/2026-05-10-phase2-audit.md` with this exact content:

```markdown
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

## Cluster Index

<!-- Filled in Task 11. Maps cluster prefix → BUG-XXXX list. -->

## Source Coverage

<!-- Filled in Task 11. Lists every MD file → cited-in-BUG-XXXX or no-entry-because. -->

## Wont-fix

<!-- Filled in Task 11. Workaround tags / catch blocks that are intentional. -->

## Open Questions for User

<!-- Filled in Task 12. Items where audit hit ambiguity needing human decision. -->
```

- [ ] **Step 3: Commit the skeleton**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: scaffold phase 2 ranked backlog"
```

Expected: commit hash printed.

---

### Task 3: Mechanical grep scans

**Files:** `/tmp/audit-greps/*.txt` (transient)

- [ ] **Step 1: Create scratch dir**

```bash
mkdir -p /tmp/audit-greps
```

- [ ] **Step 2: Workaround tags**

```bash
grep -rn "TODO\|FIXME\|XXX\|HACK\|workaround\|broken\|temporary" \
  src --include="*.ts" --include="*.tsx" \
  > /tmp/audit-greps/tags.txt
wc -l /tmp/audit-greps/tags.txt
```

Expected: a non-zero count. Earlier audit during brainstorming saw ~4 hits, but the tag pattern was narrower then; this expanded set will likely return more.

- [ ] **Step 3: Context comments**

```bash
grep -rn "// NOTE:\|// WHY:\|// HACK:" \
  src --include="*.ts" --include="*.tsx" \
  > /tmp/audit-greps/notes.txt
wc -l /tmp/audit-greps/notes.txt
```

These are the codebase's convention for explaining non-obvious decisions; they often sit on top of workarounds.

- [ ] **Step 4: Swallowed-error blocks**

```bash
grep -rn "} catch" src --include="*.ts" --include="*.tsx" -A4 \
  | grep -B2 -E "console\.warn|console\.error|console\.log" \
  | grep -B4 -v "throw " \
  > /tmp/audit-greps/swallowed-errors.txt
wc -l /tmp/audit-greps/swallowed-errors.txt
```

Approximate filter — re-read each hit in Task 8 to confirm it's a real swallow.

- [ ] **Step 5: Defensive-comment patterns**

```bash
grep -rn "// Don't fail\|// Continue\|// Non-critical\|// Skip\|// fall through\|// for some reason\|// sometimes\|// occasionally" \
  src --include="*.ts" --include="*.tsx" \
  >> /tmp/audit-greps/swallowed-errors.txt
wc -l /tmp/audit-greps/swallowed-errors.txt
```

(Append; second source feeds the same investigation.)

- [ ] **Step 6: No commit (transient files)**

---

### Task 4: Mechanical git-log scans

**Files:** `/tmp/audit-greps/git-*.txt` (transient)

- [ ] **Step 1: Fix-themed commits last 180d**

```bash
git log --since="180.days.ago" --pretty="%h|%ad|%s" --date=short \
  | grep -iE "fix|hotfix|patch|workaround" \
  > /tmp/audit-greps/git-fixes.txt
wc -l /tmp/audit-greps/git-fixes.txt
```

- [ ] **Step 2: Revert chains last 180d**

```bash
git log --since="180.days.ago" --pretty="%h|%ad|%s" --date=short \
  | grep -iE "^[a-f0-9]+\|.*\|.*revert" \
  > /tmp/audit-greps/git-reverts.txt
wc -l /tmp/audit-greps/git-reverts.txt
```

- [ ] **Step 3: Multi-attempt commit patterns**

```bash
git log --since="180.days.ago" --pretty="%h|%ad|%s" --date=short \
  | grep -iE "again|really|finally|permanent|actual|truly|definitely" \
  > /tmp/audit-greps/git-multi-attempt.txt
wc -l /tmp/audit-greps/git-multi-attempt.txt
```

These commit subjects ("really fix X", "actually working now", "permanent fix") are strong signals of root-cause-not-found bugs.

- [ ] **Step 4: No commit (transient)**

---

### Task 5: Cluster MD files by prefix

**Files:** `/tmp/audit-clusters/*.txt` (transient)

- [ ] **Step 1: Create scratch dir**

```bash
mkdir -p /tmp/audit-clusters
```

- [ ] **Step 2: Build cluster summary**

```bash
ls *.md | awk -F'_' '{print $1}' | sort | uniq -c | sort -rn \
  > /tmp/audit-clusters/_summary.txt
cat /tmp/audit-clusters/_summary.txt
```

Expected: a list like `12 BOOKING`, `10 ACTIVITY`, `9 ANALYTICS`, etc. Sanity-check the top entries match the cluster table in the spec (§Sources).

- [ ] **Step 3: Per-cluster file lists**

```bash
for prefix in $(awk '{print $2}' /tmp/audit-clusters/_summary.txt); do
  ls "${prefix}_"*.md 2>/dev/null > "/tmp/audit-clusters/${prefix}.txt"
done
ls /tmp/audit-clusters/
```

Expected: one `<PREFIX>.txt` per cluster.

- [ ] **Step 4: Identify must-read-in-full files**

```bash
ls CRITICAL_*.md DEEP_*.md *_FIX_FINAL.md *_PERMANENT_FIX*.md *_PERMANENT_*.md 2>/dev/null \
  > /tmp/audit-clusters/_must-read-full.txt
wc -l /tmp/audit-clusters/_must-read-full.txt
cat /tmp/audit-clusters/_must-read-full.txt
```

These get full reads in Task 6 step 1.

- [ ] **Step 5: No commit (transient)**

---

### Task 6: MD reading — full-read clusters

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md` (append BUG entries)

- [ ] **Step 1: Read every must-read-full file**

For each file in `/tmp/audit-clusters/_must-read-full.txt`:

```bash
cat <file>
```

For every distinct bug found, append to the audit file under `## Entries`:

```markdown
### BUG-XXXX — <short title>
- **Category:** <one of: booking, guest, invoice, auth, activity-log, hr, inventory, reservations, housekeeping, analytics, infra, bundle, render, data-layer>
- **Impact:** <1-5>
- **Frequency:** <1-5>
- **Effort:** <S | M | L>
- **Score:** <calculated>
- **Sources:** `<MD-filename>`
- **Symptom:** <what user sees>
- **Root-cause hypothesis:** <why it happens>
- **Suggested owner:** <B | C | D | E | F | G | H | A2>
- **Notes:** <ambiguity flags or empty>
```

Use sequential ids (BUG-0001, BUG-0002, …) — they're renumbered by score in Task 11.

- [ ] **Step 2: Read also `HOUSEKEEPING_*`, `HR_*`, `INVENTORY_*`, `MARKETING_*` in full**

Per spec these clusters have ≤ 6 docs each — cheap to read fully.

```bash
ls HOUSEKEEPING_*.md HR_*.md INVENTORY_*.md MARKETING_*.md 2>/dev/null
```

For each, `cat` and append BUG entries as in Step 1.

- [ ] **Step 3: Commit progress so far**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: read CRITICAL/DEEP/FINAL/PERMANENT clusters + small clusters"
```

---

### Task 7: MD reading — sampled clusters

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: For each large cluster, sample 3 files (first / middle / last in alphabetical order)**

```bash
for prefix in BOOKING ACTIVITY EMPLOYEE INVOICE; do
  echo "=== $prefix ==="
  files=$(cat /tmp/audit-clusters/${prefix}.txt 2>/dev/null)
  [ -z "$files" ] && { echo "(no files)"; continue; }
  count=$(echo "$files" | wc -l | tr -d ' ')
  mid=$(( count / 2 ))
  [ "$mid" -lt 1 ] && mid=1
  echo "$files" | sed -n "1p;${mid}p;${count}p"
done
```

This prints three-file picks per cluster (deduped if cluster < 3 files). Read each:

```bash
cat <file>
```

Append BUG entries. Time-box each cluster to 10 minutes — overrun = log in Open Questions and move on.

- [ ] **Step 2: For 2-sample clusters (CHECKOUT/CHECKIN, EMAIL, ANALYTICS, RESERVATION)**

```bash
for prefix in CHECKOUT CHECKIN EMAIL ANALYTICS RESERVATION; do
  files=$(cat /tmp/audit-clusters/${prefix}.txt 2>/dev/null)
  [ -z "$files" ] && continue
  count=$(echo "$files" | wc -l | tr -d ' ')
  echo "=== $prefix ($count files) ==="
  echo "$files" | sed -n "1p;${count}p"
done
```

Read each pick. Append BUG entries.

- [ ] **Step 3: Title-skim all remaining MDs**

```bash
ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md \
  | grep -vFf <(cat /tmp/audit-clusters/_must-read-full.txt) \
  | while read f; do
      head -3 "$f" | tr '\n' ' ' | sed "s|^|$f: |"
      echo
    done
```

Look for novel keywords not seen in earlier clusters. For each surprise, full-read that file and add a BUG entry.

- [ ] **Step 4: Commit progress**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: sample-read large clusters, title-skim remaining MDs"
```

---

### Task 8: Code-comment grep walk

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Walk `tags.txt`**

```bash
cat /tmp/audit-greps/tags.txt
```

For each hit:
1. Open `<file>` at `<line>`, read ±15 lines.
2. If it's a real workaround/bug: either append a new BUG entry citing `file:line`, OR add the citation to an existing matching entry from MD reads.
3. If it's intentional documentation (e.g. "// NOTE: this list is intentionally unsorted"), skip.

- [ ] **Step 2: Walk `notes.txt`** (`// NOTE:` / `// WHY:`)

Same procedure as Step 1. These often explain the *why* behind a workaround. Useful for the **Root-cause hypothesis** field of nearby entries.

- [ ] **Step 3: Walk `swallowed-errors.txt`**

For each hit:
1. Read context.
2. If the catch silently logs and continues on a code path users hit → BUG entry, category `data-layer` or appropriate area.
3. If the catch is genuinely non-critical (e.g. background analytics ping that fails closed) → add to `## Wont-fix` with one-line rationale.

- [ ] **Step 4: Commit progress**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: walk grep hits, add code-cited BUG entries"
```

---

### Task 9: Git-log walk

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Walk `git-multi-attempt.txt`**

```bash
cat /tmp/audit-greps/git-multi-attempt.txt
```

These are the highest-signal git entries. For each commit:

```bash
git show <hash> --stat
git show <hash> -- <file_of_interest>   # if needed
```

Identify the bug being patched. If not yet in backlog → add BUG entry. If already there → append `git@<hash>` to its `Sources` line and bump the **Frequency** score by 1 (capped at 5) — multi-attempt fixes prove recurrence.

- [ ] **Step 2: Walk `git-reverts.txt`**

For each revert:
1. Find the original commit it reverts (`git show <revert-hash>` shows the reverted hash in body).
2. The original commit was a fix that was rolled back → the underlying bug is unresolved.
3. Add or update BUG entry; mark **Notes** as "Reverted prior fix `<orig-hash>` — root cause still open."

- [ ] **Step 3: Spot-check `git-fixes.txt`**

This list is the largest. Don't walk every entry. Instead: skim subjects, pull any that mention a topic NOT yet covered by audit, full-read those commits.

- [ ] **Step 4: Commit progress**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: walk git log for revert chains + multi-attempt fixes"
```

---

### Task 10: Service-file deep skim

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Skim large service files for paper-overs**

For each of:
- `src/services/booking-engine.ts` (1883 LOC)
- `src/services/analytics-service.ts` (1138 LOC)
- `src/services/revenue-service.ts` (1040 LOC)
- `src/services/activity-log-service.ts` (882 LOC)

Run this targeted grep first:

```bash
grep -n "retry\|attempt\|fallback\|coerce\|normalize\|/* HACK\|// HACK\|sometimes\|occasionally" \
  <file>
```

For each hit, read ±20 lines. If the surrounding logic is a bug paper-over (retry to mask race condition, fallback to mask missing data, coercion to mask schema mismatch), add BUG entry.

- [ ] **Step 2: Look at error-handling sections specifically**

```bash
grep -n "} catch" <file>
```

Visit each catch block. If it papers over a real bug → BUG entry with `Sources` citing the line range.

- [ ] **Step 3: Commit progress**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: deep-skim large service files for paper-overs"
```

---

### Task 11: Cross-link, dedup, sort, renumber

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Walk every BUG entry, ensure 2+ source citations**

For each entry where `Sources` lists only one item: search greps + git log for second corroboration.

```bash
# Example: search for keyword from Symptom field
grep -rn "<keyword>" /tmp/audit-greps/
```

Add citation if found. If genuinely unique-source, add `Notes: single-source — verify before fixing`.

- [ ] **Step 2: Dedup near-duplicates**

Read entries top-to-bottom looking for same root cause expressed in different surfaces. Merge: pick the higher-impact entry as canonical, fold the other's `Sources` into it, delete the duplicate.

- [ ] **Step 3: Compute scores**

For each entry, fill the `Score` field per formula:

```
score = (impact * frequency) / effort_weight
where effort_weight = 1 (S), 2 (M), 4 (L)
```

- [ ] **Step 4: Sort entries by score desc, renumber BUG ids**

This is the only edit that touches every entry's id. Use editor capable of ordered list manipulation. Renumber sequentially starting at `BUG-0001`.

After renumbering, double-check that any cross-references inside `Notes` fields (e.g. "duplicate of BUG-0042") have been updated to the new ids.

- [ ] **Step 5: Fill Cluster Index**

Walk each entry. Group its first MD source by cluster prefix. Append to `## Cluster Index`:

```markdown
- `BOOKING_*`: BUG-0001, BUG-0007, BUG-0019, …
- `ACTIVITY_*`: BUG-0003, BUG-0011, …
…
```

- [ ] **Step 6: Fill Source Coverage**

Walk every MD file in repo root. For each, list:

```markdown
- `BOOKING_DELETION_DUPLICATION_FIX.md` → BUG-0001
- `ACTIVITY_LOG_DATA_FORMAT_FIXED.md` → BUG-0003, BUG-0044
- `BOOKING_ENGINE_README.md` → no entry (architecture doc, not a fix)
- `APP_OVERVIEW.md` → no entry (overview doc)
```

Compute coverage percentage:

```bash
total=$(ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null | wc -l)
cited=$(grep -E "_FIX.*\.md|_FIXED\.md|_COMPLETE\.md" docs/superpowers/audit/2026-05-10-phase2-audit.md | sort -u | wc -l)
echo "scale=1; $cited * 100 / $total" | bc
```

Update the **Coverage** line in the audit file's header. Must be ≥ 95.0.

- [ ] **Step 7: Fill Wont-fix section**

Walk grep hits not picked up as BUG entries — add each to `## Wont-fix` with file:line and one-line rationale.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: dedup, score, sort, renumber, fill index + coverage"
```

---

### Task 12: Open-questions sweep

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Walk every entry's Notes field**

Collect every BUG whose `Notes` mentions ambiguity, uncertain score, single-source, or "needs user input." For each, append to `## Open Questions for User`:

```markdown
- **BUG-0042 — <title>**: <one-line ambiguity statement>. <One-sentence ask of user>.
```

- [ ] **Step 2: Cap at 10 items**

If more than 10 collected, prioritize by:
1. Highest-impact entries first
2. Then highest-frequency
3. Demote the rest into a `### Lower-priority open questions` subsection

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: open-questions sweep"
```

---

### Task 13: Fill Summary section

**Files:**
- Modify: `docs/superpowers/audit/2026-05-10-phase2-audit.md`

- [ ] **Step 1: Compute counts**

```bash
file=docs/superpowers/audit/2026-05-10-phase2-audit.md

total=$(grep -c "^### BUG-" $file)
echo "Total: $total"

# Score band counts — read scores per entry
grep -oE "^- \*\*Score:\*\* [0-9.]+" $file | awk '{print $NF}' \
  | awk '
      $1 >= 8.0    { p0++ }
      $1 >= 4.0 && $1 < 8.0 { p1++ }
      $1 >= 2.0 && $1 < 4.0 { p2++ }
      $1 < 2.0     { p3++ }
      END { printf "P0=%d P1=%d P2=%d P3=%d\n", p0, p1, p2, p3 }
    '

# Owner distribution
grep "^- \*\*Suggested owner:\*\*" $file | awk '{print $NF}' | sort | uniq -c
```

- [ ] **Step 2: Identify top-10 root-cause themes**

Read the top-20 entries by score. Group by recurring root-cause hypothesis (e.g. "race in PouchDB-Supabase reconcile", "camel↔snake mismatch", "no admin auth on netlify fn"). List the top 10 in the Summary.

- [ ] **Step 3: Edit the Summary section**

Replace each `TBD` in the Summary with the computed value. Coverage line already updated in Task 11 step 6.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audit/2026-05-10-phase2-audit.md
git commit -m "audit: fill summary with counts + top-10 root-cause themes"
```

---

### Task 14: Optional — relocate fix-MDs (opt-in by user)

**Files:**
- Move: every `*_FIX*.md`, `*_FIXED*.md`, `*_COMPLETE*.md` from repo root → `docs/legacy-fixes/`

**Skip this entire task unless the user explicitly opts in at PR review time.**

- [ ] **Step 1: Confirm user opt-in**

Wait for explicit "yes, relocate" from user. If not given, skip the task.

- [ ] **Step 2: Create destination dir**

```bash
mkdir -p docs/legacy-fixes
```

- [ ] **Step 3: Move files individually (case-by-case)**

```bash
# Use git mv so history is preserved.
git mv BOOKING_DELETION_DUPLICATION_FIX.md docs/legacy-fixes/
git mv ACTIVITY_LOG_DATA_FORMAT_FIXED.md docs/legacy-fixes/
# … one per file. Don't bulk-move with a glob — some `*_FIXED.md` titles are
# overview docs that should stay at root (e.g. APP_STABILITY_FIXED.md if it
# contains current architecture context). Inspect each before moving.
```

Files NOT to move (decide by reading title + first paragraph): `APP_OVERVIEW.md`, `ARCHITECTURE.md`, `DESIGN.md`, `DESIGN_SYSTEM.md`, `README.md`, `TESTING.md`, `BUILD_AND_DEPLOY.md`, `BOOKING_ENGINE_README.md`, anything that's a current reference doc.

- [ ] **Step 4: Update Source Coverage section**

Source citations now point to `docs/legacy-fixes/<file>` instead of bare filename. Find/replace in audit file:

```bash
sed -i '' "s|^- \`\\([A-Z_0-9]*_FIX[A-Z_0-9]*\\.md\\)\`|- \`docs/legacy-fixes/\1\`|g" \
  docs/superpowers/audit/2026-05-10-phase2-audit.md
# Inspect the diff before committing — sed may need adjustment per actual filenames.
git diff docs/superpowers/audit/2026-05-10-phase2-audit.md | head -40
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(docs): relocate legacy fix-docs into docs/legacy-fixes/"
```

---

### Task 15: Verification pass

**Files:** none (read-only checks)

- [ ] **Step 1: Coverage**

```bash
file=docs/superpowers/audit/2026-05-10-phase2-audit.md
total=$(ls *_FIX*.md *_FIXED*.md *_COMPLETE*.md 2>/dev/null | wc -l)
# After Task 14 (if executed) the moved files live in docs/legacy-fixes/
[ "$total" -eq 0 ] && total=$(ls docs/legacy-fixes/*_FIX*.md docs/legacy-fixes/*_FIXED*.md docs/legacy-fixes/*_COMPLETE*.md 2>/dev/null | wc -l)
cited=$(grep -oE "[A-Z_0-9]+_(FIX|FIXED|COMPLETE)[A-Z_0-9]*\\.md" $file | sort -u | wc -l)
echo "Coverage: $cited / $total = $(echo "scale=1; $cited * 100 / $total" | bc)%"
```

Expected: ≥ 95.0.

- [ ] **Step 2: Field completeness**

```bash
file=docs/superpowers/audit/2026-05-10-phase2-audit.md
entries=$(grep -c "^### BUG-" $file)
score=$(grep -c "^- \*\*Score:\*\*" $file)
root=$(grep -c "^- \*\*Root-cause hypothesis:\*\*" $file)
owner=$(grep -c "^- \*\*Suggested owner:\*\*" $file)
echo "Entries: $entries, Score: $score, Root: $root, Owner: $owner"
```

Expected: all four numbers identical.

- [ ] **Step 3: Owner distribution**

```bash
grep "^- \*\*Suggested owner:\*\*" docs/superpowers/audit/2026-05-10-phase2-audit.md \
  | awk '{print $NF}' | sort | uniq -c
```

Expected: each of B, C, D, E, F, G, H has ≥ 3 entries. If any owner has < 3, either audit missed entries in that area OR the sub-project isn't needed (note in PR description).

- [ ] **Step 4: TBD scan**

```bash
grep -n "TBD" docs/superpowers/audit/2026-05-10-phase2-audit.md \
  | grep -v "^- \*\*Notes:\*\*"
```

Expected: zero hits outside the Notes field. Any other `TBD` is a plan failure — go back and fill it in.

- [ ] **Step 5: Open-questions cap**

```bash
awk '/^## Open Questions for User/,/^## /' docs/superpowers/audit/2026-05-10-phase2-audit.md \
  | grep -c "^- \*\*BUG-"
```

Expected: ≤ 10 (anything past 10 is in `### Lower-priority open questions` — count only the top section).

- [ ] **Step 6: No commit (read-only)**

---

### Task 16: Push branch + open PR

**Files:** none (git ops)

- [ ] **Step 1: Verify clean working tree**

```bash
git status --short
```

Expected: empty.

- [ ] **Step 2: Cherry-pick this plan onto the branch**

The plan file itself was written on `phase1-strip-blink`. Bring it across:

```bash
git log phase1-strip-blink --oneline -- docs/superpowers/plans/2026-05-10-phase2a-bug-audit.md
```

Cherry-pick the printed hash. (Skip if running in a fresh session where the plan was committed directly to this branch.)

- [ ] **Step 3: Push branch**

```bash
git push -u origin phase2a-bug-audit
```

Expected: branch pushed, PR URL printed.

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "Phase 2A: bug-audit ranked backlog" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-05-10-phase2a-bug-audit-design.md.
Plan: docs/superpowers/plans/2026-05-10-phase2a-bug-audit.md.

## What
Read-only audit pass producing a ranked backlog of every known bug,
workaround, and root-cause hypothesis in the codebase. Drives every
later Phase 2 sub-project (B, C, D, E, F, G, H).

Output: docs/superpowers/audit/2026-05-10-phase2-audit.md

## Verification
- Coverage of fix-themed MDs: <fill in from Task 15 step 1>
- Total entries: <fill in>
- Field completeness: <fill in from Task 15 step 2>
- Open questions for reviewer: <fill in from Task 15 step 5>

## Reviewer asks
1. Spot-check 5 random entries — do impact/frequency scores feel right?
2. Walk the Open Questions section, answer each.
3. Approve or request the optional MD relocation (Task 14).
EOF
)"
```

- [ ] **Step 5: Update PR body counts**

After Task 15 numbers are known, edit the PR description and replace the `<fill in>` placeholders with actual values.

```bash
gh pr edit --body "$(<final body text>)"
```

---

## What's NOT in this plan (deferred)

This audit produces only the backlog file. It does **not**:
- Fix any bug (even one-line)
- Add tests
- Refactor code
- Move source files (only opt-in MD doc relocation in Task 14)

Sub-projects B, C, D, E, F, G, H consume this backlog and ship the actual fixes.
