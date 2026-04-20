# Claude Hand-Off Brief: Events Domain Remediation

**Generated:** 2026-04-13
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Critical — D06 is actively corrupting live data

## DO NOT REWRITE
- D01/D02/D03 diagnoses — all confirmed correct
- D05 duplication analysis — verified accurate
- D08/D16/D17/D18 diagnoses — all confirmed
- The sync_event_start_datetime trigger — working correctly
- Implementation priority ordering (D03 → D01/D02 → structural → polish)
- Out of Scope section — appropriate boundaries

## EMERGENCY HOTFIX (before spec revision)
- [ ] **HOTFIX-1:** Remove `capacity: null` from `prepareEventDataFromFormData()` at `src/app/actions/events.ts:142`. Change to only include capacity in the payload if the form actually sends a value. Currently every event edit silently erases capacity for 29 live events. Same fix needed for the SEO preview payload at `EventFormGrouped.tsx:329`.
- [ ] **HOTFIX-2:** Same pattern for `payment_mode` — do not send it in the update payload unless the admin explicitly sets it. 17 events have `cash_only` set via direct DB edits and will lose it on any admin edit.

## SPEC REVISION REQUIRED

- [ ] **REV-1:** Elevate D06 from High to **Critical/Tier 1**. The bug is not "capacity not editable" — it's "capacity actively erased on every edit." The hotfix is: stop sending capacity/payment_mode in the update payload unless changed. The full fix adds UI fields.

- [ ] **REV-2:** D03 reschedule SMS must be **async**, not synchronous. Use `waitUntil` or a background job. Add deduplication: if date changed twice within 5 minutes, only send the latest. Add batch throttling: 20 SMS per second max. Spec currently proposes `Promise.allSettled` in batches with 1-second delays — this is correct but must be inside an async context, not blocking the save action response.

- [ ] **REV-3:** D09 recovery must include **capacity check**. Replace auto-revival with: accept payment → check capacity → if seats available, confirm → if not, mark `requires_manual_review` + auto-refund via Stripe. The spec currently proposes unconditional recovery which can overbook.

- [ ] **REV-4:** D01 refund handling must cover **multi-charge bookings**. `processEventRefund()` only targets the latest charge. Add: query all `payments` for the booking with `status = 'succeeded'`, refund each. Define whether partial refunds are possible (e.g., seat-increase charge refunded but original not).

- [ ] **REV-5:** D03 must require **fresh manage-booking token generation** for reschedule SMS, not "include if available." Existing tokens may have expired.

- [ ] **REV-6:** D03 hold recalculation must update **both** `bookings.hold_expires_at` AND `booking_holds.expires_at`. Also update payment guest token expiry if it diverges from the new hold deadline.

- [ ] **REV-7:** D11 — note that a DB trigger `check_event_date_not_past()` already exists. The fix is surfacing its error in the app layer and fixing the Zod refine, not adding new validation from scratch.

- [ ] **REV-8:** D15 — change the validator approach. Current `getPublishValidationIssues()` returns `string[]`. Either change to `{ errors: string[], warnings: string[] }` or keep blocking-only and drop the capacity warning (NULL = unlimited by design). Remove contradiction with D06.

- [ ] **REV-9:** D07 — add `payment_mode` to the hand-written `Event` type in `src/types/database.ts` as a required change in the Files Affected section.

- [ ] **REV-10:** D05 — replace "refactor to delegate" with a phased approach. Phase 1: align SMS behaviour (shared template, sms_status check). Phase 2: align token creation order. Phase 3: align error handling. Phase 4: delegate to service. Each phase is independently shippable.

- [ ] **REV-11:** D03/D01 — specify that new SMS templates (reschedule, cancellation) go in `src/lib/sms/templates.ts` which must be created first. The file is referenced but doesn't exist.

- [ ] **REV-12:** D04 — specify that a new data loader is needed on the edit page to fetch booking count. Either: (a) add booking count to the edit page's server component data fetch, or (b) add a client-side API call. Option (a) is simpler and follows the existing detail page pattern.

## IMPLEMENTATION CHANGES REQUIRED (immediate)

- [ ] **IMPL-1:** `src/app/actions/events.ts:142` — remove `capacity: null` hardcode. Only include `capacity` in payload if form sends a value.
- [ ] **IMPL-2:** `src/components/features/events/EventFormGrouped.tsx:329` — remove `capacity: null` from SEO preview payload.
- [ ] **IMPL-3:** Same pattern for any field the form doesn't expose (payment_mode, booking_mode) — strip from update payload to prevent silent overwrites.

## ADDITIONAL SPEC REVISIONS (from Security Review)

- [ ] **REV-13:** D02 — add DB-level deletion safeguard (trigger) in addition to app-level check. RLS allows `DELETE` to authenticated users with `events:delete`, so app-only safeguards are bypassable.

- [ ] **REV-14:** Reorder D04 before D01 in the implementation plan. The mass-cancel/refund cascade must not ship without a confirmation UX. Alternatively, add a built-in safeguard to the cancel action itself (e.g., require event name confirmation).

- [ ] **REV-15:** D09 — fix the recovery SQL. The spec checks `cancelled_at` but the cron writes `expired_at`. Also add abuse protection: don't auto-recover if the checkout session was created more than 30 minutes before hold expiry.

- [ ] **REV-16:** D01 — add DB uniqueness constraint on refund rows (keyed by source payment ID) to prevent duplicate local records from concurrent cancel attempts.

- [ ] **REV-17:** D03 — expand SMS idempotency metadata to include the new event date, so a date-change-then-revert doesn't suppress the corrective SMS.

- [ ] **REV-18:** D07 — add Zod enum validation for `payment_mode` values (`free`, `cash_only`, `prepaid`) in the form data preparation.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** D01 — auto-refund all charges or admin chooses? → Ask product owner
- [ ] **ASM-2:** D13 — is 24h reminder intentionally disabled? → Check with ops team
- [ ] **ASM-3:** D03 — auto-notify on date save or manual "Notify" button? → Ask product owner (spec recommends async auto with dedup)
- [ ] **ASM-4:** D09 — if late payment arrives and no seats available, auto-refund or manual review? → Ask product owner
- [ ] **ASM-5:** D06 — 29 events have capacity set. Verify these values are still correct before adding the UI field → Check with venue manager

## REPO CONVENTIONS TO PRESERVE
- Server actions return `{ success?: boolean; error?: string }`
- SMS sent via `sendSMS()` from `@/lib/twilio` (handles link shortening, opt-out checks)
- `getSmartFirstName()` for all customer greetings
- `createAdminClient()` for service-role operations
- `logAuditEvent()` for all mutations
- `revalidatePath()` after successful updates
- Conventional commits: `feat:`, `fix:`, `chore:`

## RE-REVIEW REQUIRED AFTER FIXES
- [ ] **HOTFIX-1/2:** Verify live events retain capacity/payment_mode values after admin edits
- [ ] **D01:** Verify multi-charge refunds process correctly
- [ ] **D03:** Verify async dispatch doesn't duplicate SMS on repeated edits
- [ ] **D09:** Verify recovery path respects capacity limits and doesn't overbook

## REVISION PROMPT

```
You are revising the Events Domain Remediation spec at
docs/superpowers/specs/2026-04-13-events-remediation-design.md
based on an adversarial review.

Apply these changes in order:

1. EMERGENCY: Add HOTFIX section at top for D06 capacity erasure
   (IMPL-1, IMPL-2, IMPL-3 — stop sending null values for fields
   the form doesn't expose)

2. Spec revisions REV-1 through REV-12:
   - Elevate D06 to Critical/Tier 1
   - D03 reschedule must be async with dedup
   - D09 recovery must check capacity
   - D01 refund must handle multi-charge
   - D03 must mint fresh manage tokens
   - D03 must update both hold tables + payment tokens
   - D11 note existing DB trigger
   - D15 fix validator architecture
   - D07 add type system change
   - D05 use phased approach
   - D03/D01 specify templates.ts creation
   - D04 specify new data loader

3. Preserve: all diagnoses, priority ordering, out-of-scope items

4. Flag for human: ASM-1 through ASM-5

After applying, confirm:
- [ ] D06 hotfix is in Tier 0 (emergency)
- [ ] D03 specifies async dispatch
- [ ] D09 includes capacity check
- [ ] D01 covers multi-charge refunds
- [ ] No sound diagnoses were overwritten
```
