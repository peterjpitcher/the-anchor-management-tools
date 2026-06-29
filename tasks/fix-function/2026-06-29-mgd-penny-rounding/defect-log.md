# MGD — penny rounding remediation (2026-06-29)

Base commit: `33e774f396eef6cf949ed8406198a065d439f572`

Symptom: the MGD payment figure is rounded up; the user wants the exact amount to the penny.

## Perimeter mapped
- DB: `mgd_collections.mgd_amount NUMERIC(10,2) GENERATED ALWAYS AS (net_take * 0.20)` and `mgd_returns.total_*` (SUM) — **exact to the penny, no rounding.** ✓
- CSV export `src/lib/receipts/export/mgd-csv.ts` — uses `.toFixed(2)` / 2dp `formatCurrency` — **exact.** ✓
- UI `MgdClient.tsx` / `CollectionForm.tsx` — `Intl.NumberFormat` GBP 2dp — **exact.** ✓
- HMRC Format modal → `src/lib/mgd/hmrcFormat.ts` — **rounds every £ figure to whole pounds.** ✗ ← root cause

## Defects

| ID | Type | Sev | Conf | Evidence | Fix | Bucket |
|----|------|-----|------|----------|-----|--------|
| FF-001 | Bug | High | High | `hmrcFormat.ts:13-18` `wholePounds = Math.round(...)`, `fmtWhole = £{whole}.00`. Box 8 "Duty payable" + Box 12 "Net duty payable" (the amount paid to HMRC) shown rounded to nearest whole pound (up to 99p wrong). | Format to 2dp of the actual value; stop whole-pound rounding. | Safe fix |
| FF-002 | Latent bug exposed by FF-001 | Medium | High | Rate band split divides `mgd/netTake` and compares to exact `0.05`/`0.20`. With true penny amounts a genuine 20% return's ratio can drift just above `0.20` → pushed from standard boxes (4/5) into higher boxes (2/3). | Add 0.005 tolerance (real MGD bands are ~15pp apart, so this can't blur bands) so band placement stays stable while amounts stay exact. | Safe fix |
| FF-003 | Semantic/business | Low | Med | `hmrcFormat.ts:24` Box 1 "Number of machines available for play at end of period" is populated from `collection_count` (count of cash collections), not the number of dutiable machines. Unrelated to rounding. | Needs business confirmation — likely should be a configured machine count, not collection count. | Out of scope (flagged) |

## Status
- FF-001 — fixed + verified
- FF-002 — fixed + verified
- FF-003 — RESOLVED: Box 1 now reads a real per-return `machine_count` (see feature below).

## Follow-up feature (machine count, requested after first pass)
Replaces the FF-003 collection-count hack with a settable per-return machine count.
- Migration `supabase/migrations/20260713000000_mgd_machine_count.sql` — `mgd_returns.machine_count INTEGER NOT NULL DEFAULT 1 CHECK (>=0)`. Applied live; 32 existing rows defaulted to 1.
- `updateReturnMachineCount` action (RBAC manage, int>=0 validation, submitted/paid lock, audit log).
- `MgdHmrcReturnSummary.machine_count` → HMRC Box 1.
- `MachineCountField` editor on the return card (read-only when locked).

### Adversarial review (workflow wf_b4f81777-ac9, 5 dimensions + refute pass)
Verdict: SAFE TO SHIP. One confirmed defect:
- FF-004 (Medium) — `updateReturnMachineCount` had no test despite an existing mirror harness. **Fixed**: added 5 cases to `tests/actions/mgd.test.ts` (happy path + audit, submitted/paid lock ×2, negative + non-integer validation).
No `schema.sql` exists in this repo, so no schema sync needed.

## Verification (final)
- Tests: 10/10 pass (`tests/actions/mgd.test.ts` + `src/lib/mgd/__tests__/hmrcFormat.test.ts`)
- Typecheck: clean · Lint: clean · Production build: clean (after clearing stale `.next`)
