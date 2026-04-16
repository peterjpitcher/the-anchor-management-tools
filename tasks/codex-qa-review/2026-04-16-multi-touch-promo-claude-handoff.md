# Claude Hand-Off Brief: Multi-Touch Promo Sequence

**Generated:** 2026-04-16
**Review mode:** Adversarial Challenge (Mode A)
**Overall risk assessment:** High (3 critical spec defects, all fixable)

## DO NOT REWRITE

- promo_sequence table design — clean, correct schema
- Unique constraint on (customer_id, event_id) — sound
- 3d only requires 14d, not 7d — resilient design
- Unified follow-up copy (no category/general split) — correct decision
- sms_promo_context insert for every touch — keeps reply-to-book working
- Daily limit concept (max 1 promo per customer per day) — correct safety mechanism

## SPEC REVISION REQUIRED

- [ ] **SP-1:** Reverse stage order from `14d → 7d → 3d` to `3d → 7d → 14d`. Follow-ups must run first to get daily limit priority over new intros.

- [ ] **SP-2:** Add to 7d/3d stage logic: "Follow-up queries must JOIN `customers` to re-check `marketing_sms_opt_in = TRUE`, `sms_opt_in = TRUE`, `sms_status IS NULL OR sms_status = 'active'`, and `mobile_e164 IS NOT NULL`. Must also JOIN `events` to verify `event_status = 'scheduled'` and `booking_open = TRUE`."

- [ ] **SP-3:** Tighten 14d intro eligibility. Either restrict to events 12-14 days away, or add a minimum gap for follow-up eligibility: `touch_14d_sent_at <= NOW() - INTERVAL '3 days'` for 7d, `touch_14d_sent_at <= NOW() - INTERVAL '7 days'` for 3d.

- [ ] **SP-4:** Add promo_sequence cleanup to the existing retention stage: "Delete promo_sequence rows where the event date + 14 days has passed."

- [ ] **SP-5:** Note that a shared `startOfLondonDayUtc()` helper needs to be extracted from `src/lib/short-link-insights-timeframes.ts` (or created in `dateUtils.ts`) for the daily limit check.

- [ ] **SP-6:** Add to cron section: "Pass a shared `startTime` and remaining promo budget into all three stages. The `MAX_EVENT_PROMOS_PER_RUN` budget is shared across 3d, 7d, and 14d stages."

- [ ] **SP-7:** Add to follow-up send logic: "Before inserting a new `sms_promo_context` row, close any prior active (unexpired, unbooked) contexts for the same customer + event by setting `reply_window_expires_at = NOW()`."

## IMPLEMENTATION CHANGES REQUIRED

None yet (spec-only review).

## ASSUMPTIONS TO RESOLVE

- [x] **ASM-1:** Stage ordering — **RESOLVED:** Reverse to 3d → 7d → 14d.
- [x] **ASM-2:** Marketing consent — **RESOLVED:** Re-check on every follow-up query.
- [x] **ASM-3:** Event cancellation — **RESOLVED:** Re-check event status before every follow-up send.

## REPO CONVENTIONS TO PRESERVE

- Template keys follow `event_<type>_<timing>` pattern
- RPC functions use `p_` prefix for parameters
- sms_promo_context insert pattern (best-effort with warning log) — keep for follow-ups but consider treating promo_sequence insert failure more seriously
- Cron stage pattern: guard check → load candidates → process loop → cleanup
- RLS enabled + REVOKE ALL FROM PUBLIC pattern for service-role-only tables

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] Re-review the actual follow-up query SQL to verify consent + event status joins
- [ ] Verify stage ordering in cron implementation matches 3d → 7d → 14d
- [ ] Verify daily limit uses London calendar day, not rolling 24h
