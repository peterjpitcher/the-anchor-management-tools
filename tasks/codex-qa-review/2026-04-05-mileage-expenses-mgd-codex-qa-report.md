# QA Review Report — Mileage, Expenses & MGD Design Spec

**Scope:** `docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md`
**Date:** 2026-04-05
**Mode:** Spec Compliance Review
**Engines:** Claude + Codex (dual-engine)
**Spec:** Design spec (pre-implementation review)

---

## Executive Summary

Five specialists reviewed the design spec across bug/logic, security, spec compliance, performance, and standards dimensions. **38 total findings** were identified: 5 Critical, 12 High, 12 Medium, 9 Low. The most significant themes are:

1. **Calendar quarter vs MGD quarter mismatch** in the export — flagged by 3 of 5 specialists
2. **RLS/auth model too permissive** — `authenticated` RLS + existing `receipts:export` permission leaks super_admin-only data
3. **OJ-Projects sync is under-specified** — leg model, entry_type transitions, backfill behaviour all need clarification
4. **HMRC rate threshold logic** has ordering ambiguity, display contradictions, and race condition risks
5. **File upload lacks server-side limits** — DoS risk and type validation gaps

The spec's data model, RBAC naming, nav structure, CSV formatting, and expense storage patterns are all well-aligned with existing codebase conventions.

---

## Critical Findings

### CRIT-01: Export quarter model conflicts with MGD quarter cycle
- **Source:** Bug Hunter (BUG-001), Spec Compliance (SPEC-001), Standards Enforcer (implicit)
- **Cross-engine:** Both Codex AND Claude identified this
- **Description:** The receipts export uses calendar quarters (Jan-Mar, Apr-Jun, etc.) but MGD uses HMRC quarters (Feb-Apr, May-Jul, Aug-Oct, Nov-Jan). Plugging MGD into the same Q/year selector produces incorrect or misleading date ranges for the MGD CSV.
- **Impact:** Q1 2026 bundle would show Jan-Mar receipts/mileage/expenses but Feb-Apr MGD data, or worse, query the wrong date range entirely.
- **Fix:** Include the MGD CSV using the *overlapping* HMRC quarter for the selected calendar quarter. E.g. Q1 (Jan-Mar) includes the MGD return that overlaps most with that period. Label the MGD CSV header clearly with its actual period dates. Add a note in the claim summary PDF showing the MGD period explicitly.

### CRIT-02: Export auth leaks super_admin data to non-super_admin users
- **Source:** Security Auditor (SEC-001), Spec Compliance (SPEC-002)
- **Cross-engine:** Codex only (Security + Compliance)
- **Description:** The enhanced export piggybacks on the existing `receipts:export` permission, which is granted beyond super_admin. The new finance data (mileage claims, expenses, MGD) would be accessible to anyone who can export receipts.
- **Impact:** Non-super_admin users could download the claim summary PDF with personal financial data.
- **Fix:** Add an explicit super_admin check in the export route when the bundle includes mileage/expenses/MGD data. Either require `super_admin` for the enhanced bundle or split into a separate endpoint.

### CRIT-03: `authenticated` RLS is too permissive for super_admin-only tables
- **Source:** Security Auditor (SEC-002)
- **Cross-engine:** Codex only
- **Description:** Section 10 says "a simple `authenticated` policy suffices" but these are super_admin-only modules. Any authenticated user could query these tables directly through the anon client.
- **Impact:** IDOR attacks — any logged-in staff member could read/modify mileage, expense, and MGD records.
- **Fix:** Use role-aware RLS: `public.is_super_admin(auth.uid())` or an equivalent permission-checking function. This matches the stated access model.

### CRIT-04: OJ-Projects sync trigger creates cross-module privilege escalation
- **Source:** Security Auditor (SEC-003), Spec Compliance (SPEC-003)
- **Cross-engine:** Both Codex AND Claude
- **Description:** The trigger writes directly into super_admin-only `mileage_trips` from `oj_entries`, which managers can also access. A manager creating OJ mileage entries indirectly creates finance claim records.
- **Impact:** Non-super_admin users can influence reimbursement amounts.
- **Fix:** The trigger should run as a trusted backend operation. Synced trips should be clearly marked and the mileage claim total should distinguish between manual and synced entries if needed. Consider whether the sync should only run for entries created by super_admin users.

### CRIT-05: OJ-Projects sync is not buildable as specified
- **Source:** Bug Hunter (BUG-005, BUG-006), Spec Compliance (SPEC-003)
- **Cross-engine:** Both Codex AND Claude
- **Description:** Multiple issues: (a) spec says "single-leg" but describes "Anchor → destination → Anchor" which is two legs; (b) `oj_entries` has no destination field, only miles; (c) entry_type transitions (time→mileage, mileage→time) are not handled; (d) no backfill strategy for existing entries.
- **Impact:** Developers cannot implement the sync without making assumptions.
- **Fix:** Define OJ-synced trips as leg-less summary rows (no child `mileage_trip_legs`). The route display shows "OJ Projects — [description]" instead of a destination chain. Handle entry_type transitions in the trigger (OLD vs NEW). Specify backfill: either migrate existing mileage entries on deployment or start fresh from trigger activation date.

---

## High Findings

### HIGH-01: Concurrent mileage mutations can corrupt HMRC rate calculations
- **Source:** Bug Hunter (BUG-002), Performance Analyst (PERF-003)
- **Cross-engine:** Both Codex AND Claude
- **Fix:** Use a shared SQL function with advisory lock on the tax year for all mileage mutations.

### HIGH-02: Same-day trip ordering is non-deterministic near the 10k threshold
- **Source:** Bug Hunter (BUG-003), Spec Compliance (SPEC-004)
- **Cross-engine:** Both Codex AND Claude
- **Fix:** Add `created_at` as tiebreaker: `ORDER BY trip_date, created_at`.

### HIGH-03: Trip date edits crossing tax year boundary leave old year stale
- **Source:** Bug Hunter (BUG-004)
- **Cross-engine:** Codex only
- **Fix:** On UPDATE, recalculate both old and new tax years if the date crosses 6 April.

### HIGH-04: NULL-based distance cache uniqueness is unenforceable in PostgreSQL
- **Source:** Bug Hunter (BUG-007)
- **Cross-engine:** Codex only
- **Fix:** Use a sentinel UUID for The Anchor instead of NULL, or use a partial unique index with COALESCE.

### HIGH-05: Multi-stop leg integrity is not enforceable by schema alone
- **Source:** Bug Hunter (BUG-008)
- **Cross-engine:** Codex only
- **Fix:** Save legs atomically (DELETE all + INSERT fresh set) in the server action. Validate contiguous ordering, first/last NULL rules, and chain continuity in the action, not via DB constraints.

### HIGH-06: Rate display contradicts amount_due for threshold-crossing trips
- **Source:** Bug Hunter (BUG-009), Spec Compliance (SPEC-004)
- **Cross-engine:** Both Codex AND Claude
- **Fix:** Add `miles_at_standard_rate` and `miles_at_reduced_rate` columns to `mileage_trips`. Display and export as split breakdown when a trip straddles the threshold.

### HIGH-07: File upload has no server-side size/count limits
- **Source:** Security Auditor (SEC-004)
- **Cross-engine:** Codex only
- **Fix:** Add server-side caps: max 20MB per file, max 10 files per expense, max 50 megapixels for images. Reject before processing.

### HIGH-08: File type validation is client-side only
- **Source:** Security Auditor (SEC-005)
- **Cross-engine:** Codex only
- **Fix:** Validate magic bytes server-side. Re-encode images via sharp (already planned). Serve stored files as attachments.

### HIGH-09: Server action contracts are not specified
- **Source:** Spec Compliance (SPEC-006), Standards Enforcer (STD-009)
- **Cross-engine:** Both Codex AND Claude
- **Fix:** Add action contract table per module listing each mutation with its permission, Zod schema, audit event, and revalidation path.

### HIGH-10: MGD return lifecycle lacks lock/edit rules
- **Source:** Spec Compliance (SPEC-005)
- **Cross-engine:** Codex only
- **Fix:** Lock collections within a submitted/paid return. Add `submitted_at`, `submitted_by` columns. Define reopen flow.

### HIGH-11: Seed/bootstrap section is incomplete
- **Source:** Spec Compliance (SPEC-008)
- **Cross-engine:** Codex only
- **Fix:** Expand to cover: RBAC permission seeding, storage bucket creation, OJ rate update migration, backfill decision.

### HIGH-12: Quarterly export timeout risk with hundreds of expense images
- **Source:** Performance Analyst (PERF-001)
- **Cross-engine:** Claude only
- **Fix:** Stream images into archiver (don't buffer), increase download concurrency for smaller files, batch processing.

---

## Medium Findings

| ID | Source | Summary | Fix |
|----|--------|---------|-----|
| MED-01 | BUG-010 | `total_miles` can drift from leg sum | Derive in transaction, or trigger-enforce |
| MED-02 | BUG-011 | Nov-Jan MGD period year boundary ambiguous | Add explicit month→period mapping table |
| MED-03 | SEC-006 | Storage bucket auth is all-or-nothing | Resolve by expense_files.id, never accept raw paths |
| MED-04 | SEC-007 | Input validation/DB constraints underspecified | Add CHECK constraints and Zod schemas |
| MED-05 | SPEC-007 | Export edge cases (zero data, filename collisions) | Specify always-include policy, collision-proof naming |
| MED-06 | SPEC-009 | Page loading/error/empty states not specified | Add per-page state table |
| MED-07 | PERF-002 | HMRC cascade should use CTE, not per-row | Use window function approach |
| MED-08 | PERF-003 | OJ trigger should be lightweight | Defer rate cascade to app layer |
| MED-09 | STD-001 | Missing fromDb/camelCase pattern | Note conversion requirement |
| MED-10 | STD-003 | Nav entries described in prose only | Add concrete TypeScript entries |
| MED-11 | STD-006 | No dateUtils/timezone reference | Note London TZ for tax year calcs |
| MED-12 | STD-007 | No UI state descriptions | Add per-page loading/error/empty |

---

## Low Findings

| ID | Source | Summary |
|----|--------|---------|
| LOW-01 | PERF-004 | Use pdfkit not @react-pdf/renderer |
| LOW-02 | PERF-005 | Process sharp uploads in parallel |
| LOW-03 | PERF-006 | Distance cache lookup is fine at scale |
| LOW-04 | PERF-007 | MGD trigger is fine at scale |
| LOW-05 | STD-002 | Must add modules to ModuleName type |
| LOW-06 | STD-004 | Bucket naming mismatch (acknowledged) |
| LOW-07 | STD-005 | Must use ui-v2 PageLayout pattern |
| LOW-08 | STD-008 | No testing requirements mentioned |
| LOW-09 | STD-009 | Server action contract detail |

Note: STD-002 and STD-005 were rated High by the Standards Enforcer but are implementation details that will naturally be addressed during development. They are Low risk to the *spec* itself.

---

## Cross-Engine Analysis

### Agreed (both Codex AND Claude flagged)
These are highest-confidence findings:
- **CRIT-01** — Calendar vs MGD quarter mismatch (3 specialists)
- **CRIT-04/05** — OJ-Projects sync issues (4 specialists across both engines)
- **HIGH-01** — Concurrent mileage race condition
- **HIGH-02** — Same-day ordering ambiguity
- **HIGH-06** — Rate display contradicts amount_due
- **HIGH-09** — Missing server action contracts

### Codex-Only Findings
- **CRIT-02/03** — Auth/RLS permissiveness (valid and important — Claude's Standards Enforcer didn't have security in scope)
- **HIGH-03** — Tax year boundary crossing on date edit
- **HIGH-04** — NULL uniqueness in PostgreSQL
- **HIGH-07/08** — File upload security (valid security concerns)

### Claude-Only Findings
- **HIGH-12** — Export timeout with many images (Performance Analyst had deeper knowledge of the existing export route's streaming pattern)

---

## Recommendations — Prioritised

### Must fix before implementation
1. **Auth model** (CRIT-02, CRIT-03) — Define proper RLS and export permissions
2. **MGD quarter mapping** (CRIT-01) — Resolve the calendar/HMRC quarter conflict
3. **OJ sync representation** (CRIT-05) — Define leg-less synced trips, entry_type transitions, backfill
4. **OJ sync auth** (CRIT-04) — Clarify the trust boundary

### Should fix before implementation
5. **HMRC rate threshold** (HIGH-01, 02, 03, 06) — Add ordering, split columns, lock, cross-year handling
6. **Distance cache sentinel** (HIGH-04) — Replace NULL with real row
7. **File upload limits** (HIGH-07, 08) — Add server-side caps and magic byte validation
8. **Server action contracts** (HIGH-09) — Add mutation table per module
9. **MGD return lifecycle** (HIGH-10) — Lock rules, submitted_at/by
10. **Seed/bootstrap** (HIGH-11) — Expand to full rollout checklist

### Can address during implementation
11. All Medium and Low findings — these are implementation details that a developer following existing codebase patterns will handle correctly, but documenting them reduces ambiguity.
