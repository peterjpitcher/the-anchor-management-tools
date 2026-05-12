# Adversarial Review: Private Bookings Remediation Spec

**Date:** 2026-05-11
**Mode:** C (Spec Compliance)
**Scope:** `tasks/private-bookings-review/remediation-spec.md` — 24-defect remediation covering mutations, payments, contract, cron, queries, permissions
**Pack:** `tasks/codex-qa-review/2026-05-11-pb-remediation-spec-review-pack.md`
**Reviewers:** Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk, Spec Trace Auditor

## Executive Summary

The remediation spec correctly identifies root causes and proposes structurally sound fixes for the majority of the 24 defects. Three areas have genuine gaps that would produce bugs if implemented as written: (1) status changes via the edit form would skip cancellation/completion side effects, (2) the Date-TBD SMS detection relies on a fragile note check instead of the `date_tbd` field, and (3) the D4/D12 acceptance criteria contradict each other. Five additional items need tightening before implementation.

## What Appears Solid

- **D4 server-side transition validation** — Correctly moves ALLOWED_TRANSITIONS enforcement into `updateBooking()` rather than relying on UI dropdown filtering alone. Shared constant extraction is the right call. (AB, WF, SPEC concur)
- **D1 hold_expiry = null for TBD** — Correctly decouples TBD bookings from the expire-holds cron by nulling the field rather than storing a fake date-derived expiry. (AB, WF, SPEC concur)
- **D13 deposit guard extension** — Blocking both cancelled and completed is correct and closes a real gap. (AB, WF, SEC, SPEC concur)
- **D12 server-side immutability** — Adding the guard inside `updateBooking()` rather than only at the UI layer is correct. (SPEC confirms)
- **Implementation ordering** — Foundational status guards before downstream SMS/contract/revalidation is the right dependency structure.

---

## Critical Risks

### CR-1: Status change via edit form skips cancellation/completion side effects
**Severity:** High | **Confidence:** High | **Blocking:** Yes
**Sources:** WF-001, SEC-002, ARCH-003

The spec validates the transition in `updateBooking()` but still applies the status directly via a DB update. When a user changes a confirmed booking to "cancelled" through the edit form, the transition is accepted — but `cancelBooking()` is never called. This means:
- No cancellation SMS is sent
- No pending SMS is cancelled (D10)
- No calendar event is deleted
- No financial outcome is resolved
- No audit trail records the cancellation

The same gap exists for transitions to "completed" — the completion SMS and side effects only fire through `updateBookingStatus()`.

**Recommendation:** When `updateBooking()` detects a status transition to `cancelled`, it must delegate to `cancelBooking()` for the full side-effect chain. When transitioning to `completed`, delegate to the completion handler. The edit form should not be a "silent" status change path.

---

### CR-2: TBD SMS detection checks only internal_notes, not date_tbd field
**Severity:** High | **Confidence:** High | **Blocking:** Yes
**Sources:** WF-002, SEC-005, SPEC-003, AB-003

The spec prose says "when the booking has `date_tbd` or its `internal_notes` contain `DATE_TBD_NOTE`", but the proposed code only checks `booking.internal_notes?.includes(DATE_TBD_NOTE)`. If a TBD booking's notes are edited to remove the marker, the customer receives an SMS with the fake stored event date. The `date_tbd` field exists on the table — it should be the primary signal.

**Recommendation:** Select `date_tbd` in the `sendCreationSms()` query. Check `booking.date_tbd === true` first, with the notes check as a fallback for existing records that might lack the field.

---

### CR-3: D4 and D12 acceptance criteria contradict each other
**Severity:** Medium | **Confidence:** High | **Blocking:** Yes
**Sources:** SPEC-002, AB-002

D4 says: "Edit form for a completed booking shows only Completed (no transitions out)." D12 says: "Navigating to `/private-bookings/{id}/edit` for a cancelled booking redirects to the detail page." Since D12 redirects away from the edit page for completed/cancelled bookings, the D4 acceptance criterion about what the edit form shows for completed bookings is unreachable.

Additionally, D4 allows `cancelled → draft` but D12 redirects cancelled bookings away from the edit page. The spec says "status transitions on cancelled bookings still work via the detail page's status action" — this needs verification that the detail page actually has that control.

**Recommendation:** Remove the D4 acceptance criterion for completed bookings. Confirm the detail page exposes a status-change control for cancelled bookings. Clarify that D12's redirect is the canonical behaviour.

---

## Implementation Defects

### ID-1: TBD balance_due_date not forced to null
**Severity:** Medium | **Confidence:** High
**Sources:** WF-003, SPEC-004

The D1 code says `balanceDueDate = balanceDueDate || null`, which preserves any submitted `input.balance_due_date`. A stale form or direct API call could attach a real payment deadline to a booking with no real event date.

**Recommendation:** Force `balanceDueDate = null` (not `|| null`) in the TBD branch. If manual due dates for TBD bookings are intentionally allowed, document that exception.

---

### ID-2: Immutable-booking guard rejects harmless keys
**Severity:** Medium | **Confidence:** Medium
**Sources:** AB-006, SPEC-005

The guard uses `Object.keys(input).filter(k => k !== 'status')` to reject non-status fields. If `updateBooking()` receives fields set to `undefined` or values identical to the current booking, the guard fires incorrectly. This could break the edit form if it submits a full payload with unchanged fields.

**Recommendation:** Filter out keys where the value is `undefined` or matches the current booking value. Only reject keys that would actually change non-status data.

---

### ID-3: TBD event_date consumers not fully enumerated
**Severity:** Medium | **Confidence:** Medium
**Sources:** AB-004, ARCH-002

The D1 fix covers `createBooking()`, `sendCreationSms()`, and the cron — but other consumers of `event_date` are not listed. The contract template, calendar sync, detail page display, scheduled SMS, balance reminders, and payment emails all format `event_date` and could show the fake date for TBD bookings.

**Recommendation:** Add a subsection to D1 listing every `event_date` consumer in the private-bookings section and noting whether each needs TBD handling. At minimum: contract generation, calendar view, scheduled SMS preview, payment emails, balance reminder cron.

---

## Architecture & Integration Defects

### AI-1: ALLOWED_TRANSITIONS location
**Severity:** Low | **Confidence:** Medium
**Sources:** ARCH-001, AB-005

The spec puts `ALLOWED_TRANSITIONS` in `types.ts`, which some reviewers flag as placing business rules in a type module. However, `types.ts` already contains domain constants (`STANDARD_HOLD_DAYS`, `SHORT_NOTICE_HOLD_DAYS`, `computeHoldExpiry`), so this matches existing convention.

**Recommendation:** No change needed. The concern is valid in principle but the file already serves as a domain constants + types module.

---

## Unproven Assumptions

| # | Assumption | What would confirm | What breaks if wrong |
|---|---|---|---|
| U-1 | Both manual and PayPal deposit flows go through `finalizeDepositPaymentWithClient()` | Trace the PayPal capture webhook/action to confirm | Completed bookings could still accept deposits via PayPal |
| U-2 | The detail page has a status-change control for cancelled bookings | Check `PrivateBookingDetailClient.tsx` for a status action on cancelled bookings | `cancelled → draft` transition is server-supported but user-unreachable |
| U-3 | `updateBookingStatus()` is the only other status-change entry point | Grep for `.update({status:` across all actions/mutations | A third path could bypass both transition guards |
| U-4 | The `sendCreationSms()` booking object includes (or can include) `date_tbd` | Check the query/type in `sendCreationSms()` | Falls back to notes-only TBD detection |

---

## Recommended Fix Order

1. **CR-1** — Status change side effects (amend Group A spec before implementation)
2. **CR-2** — TBD SMS detection (amend Group B spec)
3. **CR-3** — Acceptance criteria conflict (amend spec, confirm detail page control)
4. **ID-1** — Force null balance_due_date for TBD (amend Group B spec)
5. **ID-2** — Immutable guard key filtering (amend Group A spec)
6. **ID-3** — Enumerate TBD event_date consumers (amend Group B spec)
7. **U-1 through U-4** — Verify before implementation begins

---

## Minor Observations

- The pack was truncated to 200 lines of the 953-line spec, so reviewers could not inspect Groups C–L. A follow-up review after implementation should cover the full scope.
- Multiple reviewers flagged the lack of a diff — expected for a pre-implementation spec review; will resolve when code changes land.
- Cron route auth (`CRON_SECRET`) and PayPal webhook signature verification were not reviewable from the pack but are confirmed present in existing code.
