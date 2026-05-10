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
