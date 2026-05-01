# Adversarial Review: Multi-Frequency Recurring Charges

**Date:** 2026-04-22
**Mode:** C (Spec Compliance)
**Scope:** `tasks/recurring-charge-frequency-spec.md`
**Pack:** `tasks/codex-qa-review/2026-04-22-recurring-charge-frequency-review-pack.md`

## Executive Summary

Four Codex reviewers (Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Spec Trace Auditor) reviewed the spec. The majority of findings (16/19) flagged the absence of implementation — expected and discarded, since this is a pre-implementation spec review. **Three material spec defects** were identified by the Spec Trace Auditor that require resolution before implementation.

## What Appears Solid

- Backwards compatibility via `DEFAULT 'monthly'` — all existing charges continue unchanged
- Quarterly/annual due-date logic aligned with existing monthly cron model
- Keeping weekly and custom intervals out of scope is architecturally sound
- Reusing `period_yyyymm` with frequency-specific labels avoids schema sprawl
- The unique constraint `(vendor_id, recurring_charge_id, period_yyyymm)` still prevents duplicates

## Spec Defects

### SPEC-006 (Medium, Blocking Decision) — Mid-period charge creation is ambiguous

The spec says a quarterly charge created in February will first bill for Q1 (in the April run). This means billing for the full quarter including January, before the charge existed. Since pro-rating is out of scope, the spec needs an explicit business decision:

**Options:**
- A) Bill the full containing period regardless of creation date (simplest, spec currently implies this)
- B) Only bill from the next complete period (charge created Feb → first bills for Q2)
- C) Use a configurable `effective_from` date

**Recommendation:** Option A is simplest and matches how monthly charges already work (a monthly charge created mid-month still generates an instance for that full month). Document this explicitly.

### SPEC-007 (Medium, Blocking Decision) — Frequency change creates double-billing risk

If a charge is changed from monthly to quarterly mid-quarter, the same calendar days could be billed under both `2026-01` (monthly instance) and `2026-Q1` (quarterly instance). The unique constraint only prevents duplicate period *labels*, not duplicate *date ranges*.

**Options:**
- A) Frequency changes take effect from the next unopened period only
- B) Check for overlapping date ranges when generating instances
- C) Accept as admin responsibility (manual cleanup if needed)

**Recommendation:** Option A — simplest and safest. When generating instances, use the frequency stored at generation time. If frequency was changed, the next period uses the new frequency. Past instances remain as-is.

### SPEC-008 (Low) — Invoice period display is assumed, not verified

The spec says invoice line items will show the period via existing `period_start`/`period_end` fields. This needs verification that the invoice renderer actually displays these fields for recurring charge instances. Add an acceptance criterion.

## Minor Observations

- The cap warning logic (`recurringChargesIncVat > cap`) will show warnings every month for quarterly charges, even in months when they're not due. The spec acknowledges this but doesn't address it. Low priority — cosmetic.
- No test coverage is specified for the period determination logic, which is the highest-risk area.
