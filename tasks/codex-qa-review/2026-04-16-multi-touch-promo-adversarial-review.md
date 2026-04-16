# Adversarial Review: Multi-Touch Cross-Promo Sequence

**Date:** 2026-04-16
**Mode:** Adversarial Challenge (Mode A)
**Engines:** Claude + Codex
**Scope:** Spec review — `docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md`

## Executive Summary

The multi-touch sequence concept is sound, but **three critical spec defects** need revision: (1) stage ordering contradicts the "follow-ups win" priority, (2) marketing consent is not re-checked for follow-ups, and (3) cancelled events can still trigger follow-up messages. All are fixable without changing the design approach.

## What Appears Solid

- `promo_sequence` table design — clean, focused, no PII (stores customer_id not phone)
- Unique constraint on (customer_id, event_id) — prevents duplicate sequences
- 3d only requires 14d (not 7d) — resilient to missed intermediate touches
- Follow-ups insert into `sms_promo_context` — keeps reply-to-book working
- Unified follow-up copy (no category/general split) — simpler, appropriate

## Critical Risks

### CR-1: Stage order contradicts follow-up priority (AB-001, AB-004, WF-001)
**Severity: High | All reviewers flagged**

The spec says "follow-ups win over new intros" but runs 14d before 7d/3d. With a daily limit of 1, a new 14d intro consumes the slot before the higher-value follow-up runs.

**Fix:** Reverse stage order to `3d → 7d → 14d`. This ensures follow-ups get priority.

### CR-2: Marketing consent not re-checked for follow-ups (AB-003, SD-001, SD-002)
**Severity: High | All reviewers flagged**

Follow-ups query `promo_sequence`, not the RPC. If a customer opts out of marketing SMS after the 14d touch, `sendSMS` won't catch it — it only checks `sms_opt_in`, not `marketing_sms_opt_in`.

**Fix:** Follow-up queries must JOIN `customers` and re-check `marketing_sms_opt_in = TRUE`, `sms_opt_in = TRUE`, active SMS status, and valid phone.

### CR-3: Cancelled events still trigger follow-ups (AB-006, WF-005)
**Severity: High | Both reviewers flagged**

The spec's stop condition only checks bookings. If an event is cancelled after the 14d touch, follow-ups fire for a cancelled event.

**Fix:** Follow-up stages must re-check `events.event_status = 'scheduled'` AND `events.booking_open = TRUE` before sending.

## Spec Defects

### SP-1: Stage order must be reversed
Change from `14d → 7d → 3d` to `3d → 7d → 14d`. (CR-1)

### SP-2: Follow-up queries need consent + event status re-checks
Add to 7d/3d stage logic: JOIN customers for consent, JOIN events for status/bookability. (CR-2, CR-3)

### SP-3: "14d" window needs tightening (AB-005, WF-008)
Current 14d stage loads events 0-14 days away. A customer could receive a "14d intro" for an event 7 days away, then immediately qualify for 7d follow-up. Fix by requiring intro eligibility is 12-14 days (or adding a minimum gap between 14d sent_at and follow-up eligibility, e.g., `touch_14d_sent_at <= NOW() - 3 days` for 7d).

### SP-4: promo_sequence cleanup not specified (SD-003)
Add retention: delete rows where event date + 14 days has passed (same cleanup stage as sms_promo_context).

### SP-5: London calendar-day helper needed (AB-002)
The daily limit needs a "start of London day as UTC instant" helper. One exists in short-link analytics but isn't exported. Spec should note this needs to be extracted/shared.

## Workflow & Failure-Path Defects

### WF-002: promo_sequence insert failure strands sequence
If the 14d send succeeds but `promo_sequence` insert fails, the customer never gets follow-ups. Pre-existing pattern (sms_promo_context inserts are also best-effort). Consider treating sequence insert failure more seriously — retry or alert.

### WF-003: Multiple active reply windows per customer/event
The 7d touch creates a new `sms_promo_context` row with a fresh 48h window alongside the (possibly still active) 14d row. Reply-to-book picks the newest. Same event = correct booking, but attribution is wrong. Consider closing prior active contexts for the same customer/event when a new touch is sent.

### WF-004: Three promo stages risk cron timeout
The cron currently doesn't pass `startTime` to `sendCrossPromoForEvent`. Three promo stages multiply timeout risk. Pass a shared run deadline into all promo senders and share `MAX_EVENT_PROMOS_PER_RUN` budget across all stages.

## Recommended Fix Order

1. **CR-1** — Reverse stage order to 3d → 7d → 14d
2. **CR-2** — Add consent re-checks to follow-up queries
3. **CR-3** — Add event status/bookability checks to follow-up stages
4. **SP-3** — Tighten 14d intro window or add minimum gap for follow-up eligibility
5. **SP-4** — Add promo_sequence cleanup to retention stage
6. **SP-5** — Extract/share London calendar-day helper
7. **WF-004** — Share run deadline and promo budget across stages
