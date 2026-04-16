# Claude Hand-Off Brief: Event Cross-Promo General Audience

**Generated:** 2026-04-16
**Review mode:** Adversarial Challenge (Mode A)
**Overall risk assessment:** High (4 spec defects, all fixable)

## DO NOT REWRITE

- Two-pool approach with category-match priority — sound
- Extending existing RPC rather than creating a new one — correct
- New message builder functions with warm tone — approved by user
- Same paid/free behaviour split — confirmed
- sms_promo_context table schema — no changes needed
- 7-day frequency cap logic — works cross-pool already
- Idempotency via template key + customer + event — naturally handles both pools

## SPEC REVISION REQUIRED

- [ ] **SP-1:** Remove "No changes to the cron orchestrator" claim. Add: "The `EVENT_PROMO_TEMPLATE_KEYS` constant in `event-guest-engagement/route.ts` must be extended with the two new general template keys so they count toward the promo-specific hourly guard."

- [ ] **SP-2:** Replace "No limits" with a soft cap strategy. Recommend: keep `p_max_recipients DEFAULT 200` in the RPC (or pass remaining run capacity). Add: "The send loop in `cross-promo.ts` should check elapsed time and abort if approaching cron timeout."

- [ ] **SP-3:** Prescribe the SQL dedup mechanism. Add to the RPC section: "The two pools are combined using a CTE pattern with `DISTINCT ON (customer_id)` ordered by `(priority ASC, last_attended_date DESC)` where category_match has priority 1 and general_recent has priority 2. This guarantees one row per customer with category-match taking precedence."

- [ ] **SP-4:** Add privilege management to the migration section: "The migration must include `REVOKE ALL ON FUNCTION public.get_cross_promo_audience FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience TO service_role;` to prevent anon/authenticated access to PII."

- [ ] **SP-5:** Add to the migration section: "The `last_event_name` subquery must filter by `e.event_status NOT IN ('cancelled', 'draft')` to avoid referencing non-customer-visible events."

- [ ] **SP-6:** Update "Files Affected" to include `src/app/api/cron/event-guest-engagement/route.ts` — the `EVENT_PROMO_TEMPLATE_KEYS` constant needs updating.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1:** `src/app/api/cron/event-guest-engagement/route.ts` — Add `event_general_promo_14d` and `event_general_promo_14d_paid` to `EVENT_PROMO_TEMPLATE_KEYS` array (~line 53)

- [ ] **IMPL-2:** Migration SQL — Use `DISTINCT ON (customer_id)` with priority ordering after the UNION ALL to prevent duplicate rows

- [ ] **IMPL-3:** Migration SQL — Add `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO service_role;`

- [ ] **IMPL-4:** Migration SQL — Filter `last_event_name` subquery with `event_status NOT IN ('cancelled', 'draft')`

- [ ] **IMPL-5:** Migration SQL — Keep a default recipient limit (recommend 200) rather than removing LIMIT entirely

## ASSUMPTIONS TO RESOLVE

- [x] **ASM-1:** Reply-to-book for paid general promos — **RESOLVED:** Same as existing behaviour. Free events use reply-to-book, paid events get a short link. The pre-existing template-agnostic reply-to-book path is a known quirk, not in scope to fix here.

- [x] **ASM-2:** "Attendance" definition — **RESOLVED:** "Had a booking" is sufficient. Include all bookings (cancelled, unpaid, no-show). This matches how `customer_category_stats` already works.

- [ ] **ASM-3:** Audience size — How many customers have attended any event in the last 3 months? If >500, the soft cap and elapsed-time checking become critical. → Check: Run a count query against production

## REPO CONVENTIONS TO PRESERVE

- Template keys follow the pattern `event_<type>_<lookahead>` (e.g., `event_cross_promo_14d`)
- RPC functions use `p_` prefix for parameters
- Safety guard constants are defined at the top of `event-guest-engagement/route.ts`
- SMS sending uses `sendSmsSafe` wrapper in cross-promo, not raw `sendSMS`
- All marketing SMS must check both `sms_opt_in` AND `marketing_sms_opt_in` in the RPC

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-3:** Re-review the actual migration SQL to verify DISTINCT ON / dedup correctness
- [ ] **CR-2:** Run EXPLAIN ANALYZE on the general pool query with real data
- [ ] **CR-2:** Verify audience sizes in production before full rollout

## REVISION PROMPT

You are revising the event cross-promo general audience spec based on an adversarial review.

Apply these changes to `docs/superpowers/specs/2026-04-16-event-cross-promo-general-audience-design.md`:

1. **Spec revisions:**
   - Remove "No changes to the cron orchestrator" — add cron template key update to scope
   - Replace "No limits" with soft cap (recommend p_max_recipients DEFAULT 200)
   - Add explicit DISTINCT ON dedup strategy to the RPC section
   - Add REVOKE/GRANT privilege management to migration section
   - Add event_status filter for last_event_name subquery
   - Update Files Affected to include event-guest-engagement/route.ts

2. **Preserve these decisions:**
   - Two-pool UNION ALL approach with category priority
   - Extending existing RPC (not creating new one)
   - Same paid/free SMS behaviour split
   - No changes to sms_promo_context schema

3. **Flag for human review:**
   - Reply-to-book behaviour for paid general promos (ASM-1)
   - "Attendance" vs "booking" definition for general pool eligibility (ASM-2)
   - Production audience size check before rollout (ASM-3)

After applying changes, confirm:
- [ ] All spec revisions applied
- [ ] All implementation changes noted
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for human review
