# QA Review Report

**Scope:** `docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md` and 7 related code files
**Date:** 2026-03-22
**Mode:** Spec Compliance Review
**Engines:** Claude + Codex (dual-engine, all 5 specialists completed)

## Executive Summary

5 specialists reviewed the spec against the actual codebase. 10 findings total: 0 critical, 3 high, 4 medium, 3 low. All findings were spec clarity/accuracy issues — no code bugs, security vulnerabilities, or performance regressions. The spec has been updated to address all actionable findings.

## Cross-Engine Analysis

### Agreed (both engines flagged — highest confidence)

| # | Finding | Severity | Engines |
|---|---------|----------|---------|
| 1 | Missing `Modal` import removal from `BusinessHoursManager.tsx` — will cause lint failure | High | Codex (Bug Hunter, Spec Compliance) + Claude (Standards) |
| 2 | `scheduleConfig` state retention needs explicit protection — spec said "independent" but persistence flows through shared state | High | Codex (Bug Hunter, Spec Compliance) + Claude (Performance) |
| 3 | Risk ratings "None" too aggressive — should be "Low" for booking validation, Sunday Lunch, API | Medium | Codex (Bug Hunter, Spec Compliance) |

### Codex-Only Findings

| # | Finding | Severity |
|---|---------|----------|
| 4 | Missing `SpecialHoursCalendar.tsx` copy update — still says "adjust service slots" | Medium |
| 5 | Sunday Lunch persistence in `BusinessHoursManager` not explicitly protected | High |
| 6 | "Unused" label for service_slots infrastructure is inaccurate — should say "legacy, non-authoritative" | Low |
| 7 | "Nobody has ever used this" is unverifiable from code alone | Low |

### Claude-Only Findings

| # | Finding | Severity |
|---|---------|----------|
| 8 | Complexity score XS should be S (4 files touched now) | Low |
| 9 | No DoD verification gate in spec | Low |
| 10 | Add inline comments to retained `setScheduleConfig` calls | Low |

## Security Assessment

No findings. Write endpoints remain gated by `requireSettingsManagePermission()`. No new attack surface introduced. Two pre-existing medium/low issues noted (malformed config validation on the public API, and `created_by` metadata exposure) — both out of scope for this change.

## Performance Assessment

Net positive change. Bundle size reduction (~1-2 KB gzipped from eliminating 3 lucide icons and the component module), fewer React state slots, simpler render cycle in `BusinessHoursManager`. No regressions introduced.

## Spec Amendments Applied

All 10 findings have been addressed in the updated spec:

1. `Modal` import added to `BusinessHoursManager.tsx` removal list
2. Discovery summary reworded — "completely independent" changed to "visually separate but shares the schedule_config data path"
3. Risk ratings changed from "None" to "Low" with expanded rationale
4. `SpecialHoursCalendar.tsx` added to modification list (copy update)
5. Explicit "Must preserve" note added to `BusinessHoursManager` changes for Sunday Lunch persistence paths
6. "Unused" reworded to "legacy, non-authoritative for booking validation"
7. Removed unverifiable "never been modified through the UI" claim
8. Complexity changed from XS to S, file count updated to 4+1
9. Verification section added with lint/typecheck/build gates and regression checks
10. Inline comment instruction added to `SpecialHoursModal` change description
