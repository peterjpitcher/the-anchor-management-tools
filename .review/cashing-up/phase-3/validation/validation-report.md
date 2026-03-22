# Phase 3 — Validation Report

**Date:** 2026-03-08
**Verdict: GO**

All 24 confirmed defects resolved. Zero regressions. Three residual items tracked.

---

## Defect-by-Defect Verdicts

| ID | Defect | Verdict |
|----|--------|---------|
| DEF-C01 | `setDailyTargetAction` checking `receipts/edit` instead of `cashing_up/edit` | GO |
| DEF-C04 | `lockSession` missing approved-status guard | GO |
| DEF-C05 | No compensating restore on child-replace failure | GO (full — both breakdowns and counts restored) |
| DEF-C06 | `upsertSession` update path not blocking locked sessions | GO |
| DEF-H01 | `getDailyTargetAction` missing permission check | GO |
| DEF-H02 | `getWeeklyProgressAction` missing permission check | GO |
| DEF-H03 | `weekly/page.tsx` missing permission check | GO |
| DEF-H04 | `getMissingCashupDatesAction` N+1 (728 queries/run) | GO |
| DEF-H05 | `cashup_targets` missing UPDATE RLS policy | GO |
| DEF-H06 | `setDailyTarget` INSERT causing duplicate key on re-entry | GO |
| DEF-H07 | Zero audit log calls in entire module | GO |
| DEF-H08 | `console.log` debug statement in production page | GO |
| DEF-M01 | Import date parsing UTC shift | GO |
| DEF-M02 | `toISOString().split('T')[0]` UTC shift in service | GO |
| DEF-M04 | "Total Variance" label should be "Cash Variance" | GO |
| DEF-M05 | Inconsistent server action return shapes | GO |
| DEF-S01 | `expectedDays: 28` hardcoded stub | GO |
| DEF-S02 | `siteName: 'Site'` hardcoded stub | GO |
| DEF-S03 | `paymentMix: []` empty stub | GO |
| DEF-S04 | `topSitesByVariance: []` empty stub | GO |
| DEF-S05 | `compliance: []` empty stub | GO |

Also fixed (out of stated scope, discovered during validation):
- UTC date shift in `weekly/page.tsx` default week calculation
- UTC date shift in `daily/page.tsx` default date fallback

---

## Status Guard Regression Check

No regressions on status machine transitions:

| Transition | Guard | Result |
|-----------|-------|--------|
| draft → submitted | `.eq('status', 'draft')` | Confirmed |
| submitted → approved | `.eq('status', 'submitted')` | Confirmed |
| approved → locked | `.eq('status', 'approved')` (new, DEF-C04) | Confirmed |
| locked → approved | `.eq('status', 'locked')` | Confirmed |

---

## Permission Coverage

All 13 exported actions in `cashing-up.ts` have permission checks. Full coverage confirmed.

---

## Type Conformance

Dashboard computed fields match `CashupDashboardData` interface:
- `paymentMix`: `{ paymentTypeCode, amount }[]` — matches
- `topSitesByVariance`: `{ siteId, siteName, totalVariance }[]` — matches
- `compliance`: `{ siteId, siteName, expectedDays, submittedDays, approvedDays }[]` — matches

---

## Remaining Tracked Items

None that block go-live. Items for future hygiene:

1. **N+1 in `getWeeklyData`** — `targetRows.find()` inside a `.map()` is O(n×m). Acceptable for the small dataset (7 rows × number of targets per day), but could be precomputed into a Map if scale increases.
2. **`as any[]` cast in `getDashboardData`** — justified by Supabase not narrowing nested join types; comment added.
