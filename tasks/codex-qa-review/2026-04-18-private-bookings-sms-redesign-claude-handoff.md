# Claude Hand-Off Brief: Private Bookings SMS Redesign

**Generated:** 2026-04-18
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High — 10 BLOCKERS require spec revision before implementation.

## DO NOT REWRITE

- **Cancellation split concept (hold vs paid)** — sound; only the financial-outcome model needs redefinition.
- **Drop "The Anchor:" opener + match event-reminder voice** — no reviewer objected.
- **10-working-day refund SLA** — acceptable wording; confirm with ops separately.
- **Reuse `manager@the-anchor.pub`** — correct inbox; use existing `manager-notifications.ts` abstraction.
- **Deletion gate intent** — rule is right; only the statuses and enforcement layer need changes.
- **Communications tab concept** — good; must be backed by shared server helper.
- **Quiet-hours coverage** — already handled in `sendSMS()`; spec's "verify" item can be a one-line test, not a work item.

## SPEC REVISION REQUIRED

- [ ] **SPEC-1 (B7)**: Rewrite the problem statement. Do not call the review-request ungated. Describe the current state as: Pass 5 is gated behind `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` (defaults OFF in production) and checks `review_processed_at IS NULL`; the redesign's job is to *add a manager-approval gate so the flag can be safely turned ON*, not to stop in-flight spam. Mark `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` production value as "requires human confirmation" in open questions.

- [ ] **SPEC-2 (B1)**: Rewrite §2 and §11 to specify GET renders confirmation page, POST performs mutation. Token + outcome passed as hidden form fields. Point to existing pattern: private feedback flow (`/g/[token]/private-feedback/action`).

- [ ] **SPEC-3 (B2)**: Add to §1 (Data model changes) and §9 (Cron changes) an explicit handling of the two legacy crons. Decision needed: either (a) retire `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders` (remove from `vercel.json` + delete routes) and fold their behaviour into `private-booking-monitor`, or (b) leave them running with updated copy. Recommend (a) — one code path.

- [ ] **SPEC-4 (B3)**: Rewrite §1 data model. Remove `post_event_outcome` as a standalone add. Choose one of:
  - Option A: `post_event_outcome text` (enum) + reuse `review_processed_at` as the "handled" terminal flag (backfill `post_event_outcome = 'skip'` for existing rows where `review_processed_at IS NOT NULL`).
  - Option B: Rename to `review_decision`, `review_decided_at`, `review_sms_sent_at` and migrate `review_processed_at`/`review_clicked_at` into the new schema.
  Recommended: A — smaller migration, preserves existing Pass 5 guard logic.

- [ ] **SPEC-5 (B4)**: Rewrite §4 (Deletion gate). Real statuses of `private_booking_sms_queue` are `pending`, `approved`, `sent`, `cancelled`, `failed`. Spec must say: block hard delete if any row exists with `status = 'sent'` OR (`status = 'approved'` AND `scheduled_for > now()`). `pending`, `cancelled`, `failed` do NOT block but should be listed in an advisory tooltip.

- [ ] **SPEC-6 (B5)**: Rewrite §3 (Cancellation copy split) and §8 (inventory). Replace two templates with three or four:
  - `booking_cancelled_hold` — no money in play
  - `booking_cancelled_refundable` — paid, refund amount determinable, SLA stated
  - `booking_cancelled_non_refundable` — paid, retained per policy (new — not a fallback to hold variant)
  - `booking_cancelled_manual_review` — dispute/chargeback in play, "we'll be in touch" (no refund promise)
  Introduce explicit financial-outcome enum: `no_money | refundable | partial_refund_issued | non_refundable_retained | manual_review`. Define `getPrivateBookingPaidTotals(bookingId)` service function that sums deposit + `private_booking_payments`. Fallback to "manual_review" if Stripe/PayPal shows a dispute OR refund amount ≤ £0 when money was paid.

- [ ] **SPEC-7 (B6)**: Rewrite §2 (Post-event outcome flow) to require conditional UPDATE claims:
  - Outcome consume: `UPDATE private_bookings SET post_event_outcome = $outcome, post_event_outcome_decided_at = now() WHERE id = $id AND post_event_outcome = 'pending'` — losing concurrent request renders existing outcome.
  - Email dedupe: add `outcome_email_sent_at timestamptz` column (or reuse a field) and guard with `WHERE outcome_email_sent_at IS NULL`. Declare this column in the migration section.
  - Review SMS dedupe: add `review_sms_sent_at timestamptz` column. Declare in migration. Do NOT rely on queue lookup alone.

- [ ] **SPEC-8 (B8)**: Remove the new `private_booking_outcome_tokens` table. Rewrite to use `guest_tokens` with a new action type `private_booking_outcome`. URL shape: `/api/private-bookings/outcome/[outcome]/[token]` — outcome in the path binds intent without adding a context column. Add migration: extend `guest_tokens` CHECK constraint to include `'private_booking_outcome'`.

- [ ] **SPEC-9 (B9)**: Rewrite §11 (or add to safeguards). Introduce a stable business idempotency key for cron-driven sends: `{booking_id}:{trigger_type}:{reminder_window_key}` (e.g. `abc:balance_reminder_14day:2026-05-12`). Use this as a DB uniqueness check BEFORE sending, independent of `message_body` hash. Existing dedupe lock stays as defense-in-depth.

- [ ] **SPEC-10 (B10)**: Add to §4. DB-level enforcement of delete gate via Postgres trigger on `private_bookings` DELETE: reject if `private_booking_sms_queue` has `status = 'sent'` row. Server-action guard stays for UX (graceful error); trigger stops any bypass.

- [ ] **SPEC-11 (M1)**: Remove every reference to `ensureReplyInstruction()` appending a suffix. The 306-char budget is based on non-existent suffix content. Either (a) delete the suffix concept and stay ≤160 chars per message, or (b) implement `ensureReplyInstruction()` to actually append contact + adjust budget.

- [ ] **SPEC-12 (M2)**: Rewrite §6 (Date-TBD suppression). No `is_date_tbd` column. Create a shared helper `isBookingDateTbd(booking)` that checks `internal_notes` for `DATE_TBD_NOTE` (authoritative matcher already in code). All cron passes and the Communications tab call it.

- [ ] **SPEC-13 (M3)**: Every template function accepts raw booking fields and internally calls `getSmartFirstName()`. Do not accept pre-formatted `firstName`.

- [ ] **SPEC-14 (M5)**: Add to Scope — manual send UI in `PrivateBookingMessagesClient.tsx` is IN scope for template suggestions (copy must update to match). Still out of scope for new manual-send triggers.

- [ ] **SPEC-15 (M6)**: Add to Scope — Communications tab is ADDITIVE to the existing `sms-queue/page.tsx` admin view. The queue admin view remains a global approval surface; the per-booking tab is a booking-scoped view that queries the same underlying data.

- [ ] **SPEC-16 (M7)**: Add to §2 (Post-event outcome flow):
  - Review SMS eligibility requires `status != 'cancelled'` at send time.
  - Outcome token claim reads booking `event_date` and `updated_at`; if those changed since the email was sent, show "booking changed since this was requested" confirmation before applying outcome.
  - Verify STOP handling: add a test confirming that `sendSMS()` blocks private-booking review SMS for customers who have opted out.

- [ ] **SPEC-17 (M8)**: Rewrite §10 (Message body construction). The new module is a pure copy/rendering boundary. It MUST NOT:
  - Query the database
  - Read feature flags
  - Decide cron eligibility
  - Apply dedupe logic
  It returns strings only. Tests: pure builder snapshot tests + one caller test per send path.

- [ ] **SPEC-18 (M9)**: Add to §6 (Communications tab) and §9 (Cron). Introduce server-side helper `getBookingScheduledSms(bookingId, now)` — used by BOTH cron eligibility logic AND the UI. Returns list of `{ trigger_type, expected_fire_at, preview_body, suppression_reason }`.

- [ ] **SPEC-19 (M10)**: Add to §6. Communications tab reads `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` (and any other feature flags) via the shared helper and labels suppressed items: "Won't send — feature disabled in production."

- [ ] **SPEC-20 (M11)**: Add to §2. New outcome email goes through `sendPrivateBookingOutcomeEmail()` added to `src/lib/private-bookings/manager-notifications.ts`, reusing `PRIVATE_BOOKINGS_MANAGER_EMAIL` constant.

## IMPLEMENTATION CHANGES REQUIRED

(These apply once implementation begins. Listed here so the subsequent writing-plans skill can track them directly.)

- [ ] **IMPL-1**: `src/services/private-bookings/mutations.ts:cancelBooking()` — add variant selection based on financial-outcome enum from `getPrivateBookingPaidTotals()`, pick one of four templates.
- [ ] **IMPL-2**: `src/services/private-bookings/mutations.ts:deletePrivateBooking()` — add SMS-sent check using real statuses.
- [ ] **IMPL-3**: Migration adds DB trigger enforcing delete gate.
- [ ] **IMPL-4**: `src/app/api/cron/private-booking-monitor/route.ts` Pass 5 — split into 5a (send manager email + generate `guest_tokens`) and 5b (send review SMS for `went_well` outcomes only).
- [ ] **IMPL-5**: New route `src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts` (GET = confirmation page, POST = mutation).
- [ ] **IMPL-6**: Migration extends `guest_tokens` action enum with `private_booking_outcome`.
- [ ] **IMPL-7**: Migration adds `post_event_outcome`, `post_event_outcome_decided_at`, `outcome_email_sent_at`, `review_sms_sent_at` columns to `private_bookings` (backfill `post_event_outcome = 'skip'` where `review_processed_at IS NOT NULL`).
- [ ] **IMPL-8**: Retire `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders` — remove routes, remove from `vercel.json`, fold balance-reminder-7day/1day into `private-booking-monitor` Pass 3 if reminders needed.
- [ ] **IMPL-9**: New helper module `src/lib/private-bookings/messages.ts` — pure builders, uses `getSmartFirstName()`, sanitises control chars, length caps.
- [ ] **IMPL-10**: New service `getPrivateBookingPaidTotals()` and `getPrivateBookingCancellationOutcome()` in `src/services/private-bookings/financial.ts` (new file).
- [ ] **IMPL-11**: New service `getBookingScheduledSms()` shared by cron + Communications tab.
- [ ] **IMPL-12**: Extend `src/lib/private-bookings/manager-notifications.ts` with `sendPrivateBookingOutcomeEmail()`.
- [ ] **IMPL-13**: New React component `CommunicationsTab.tsx` rendering history + scheduled preview via server helper.
- [ ] **IMPL-14**: Extend cancel/complete/delete confirmation modals with resolved-body preview.
- [ ] **IMPL-15**: Update tests in `tests/services/privateBookingsSmsSideEffects.test.ts` for the new copy + variants.
- [ ] **IMPL-16**: Update `PrivateBookingMessagesClient.tsx` template suggestions to match refreshed copy.

## ASSUMPTIONS TO RESOLVE (before coding starts)

- [ ] **A1**: `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` production value → Ask: "Is the private-booking review-request cron currently enabled in production?" If YES → B7 urgency stands. If NO → reframe problem statement as "enablement + correctness".
- [ ] **A2**: 10-working-day refund SLA → Ask: "Is 10 working days the correct refund SLA, or should we widen to 'up to 14 working days'?"
- [ ] **A3**: Outcome token expiry → Ask: "14 days from email send — OK? Or align to an existing timeframe (e.g. private feedback token default)?"
- [ ] **A4**: Legacy cron retirement → Ask: "Approve retiring `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders` (fold balance 7/1-day reminders into `private-booking-monitor`)?"
- [ ] **A5**: Non-refundable retained policy → Ask: "Is deposit always non-refundable on cancellation, or does it depend on timing?"
- [ ] **A6**: Manager inbox SLA → Ask: "How often is `manager@the-anchor.pub` checked? Are unanswered outcome emails a concern at >7 days?"

## REPO CONVENTIONS TO PRESERVE

- Inline message construction is the historical pattern; the new `messages.ts` helper is an explicit extraction with a pure-function boundary — justify in spec.
- `getSmartFirstName()` is the canonical first-name sanitiser — always use.
- `manager-notifications.ts` owns private-booking manager emails — always use.
- `guest_tokens` + `checkGuestTokenThrottle` is the canonical pattern for unauthenticated click links.
- Tests live under `tests/services/`, `tests/api/`, `tests/actions/`, `tests/components/`, `tests/lib/` — top-level `tests/` directory, not co-located `.test.ts` beside source.
- Admin operations use `createAdminClient()` (service role); auth operations use the cookie-based client.
- Audit events through `logAuditEvent()` — durable, not best-effort logger calls.

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **B1 / SPEC-2**: Confirm route handlers match GET-confirm + POST-mutate; confirm throttle parameters.
- [ ] **B5 / SPEC-6**: Review the financial-outcome enum logic and manual-review fallback.
- [ ] **B7 / SPEC-1**: Review problem statement rewrite after user confirms prod flag state.
- [ ] **B10 / SPEC-10**: Confirm DB trigger spec for delete gate.
- [ ] **M7 / SPEC-16**: Verify STOP-reply test coverage and booking-changed-since handling.

## REVISION PROMPT

You are revising the spec `docs/superpowers/specs/2026-04-18-private-bookings-sms-redesign-design.md` based on an adversarial review that identified 10 blockers and 11 major issues.

Apply the SPEC-1 through SPEC-20 changes in order. Preserve the items in "DO NOT REWRITE". After revision, update Open Questions with assumptions A1–A6 — these must be answered by the user before implementation starts.

Do not jump ahead to implementation. The next step after spec revision is the writing-plans skill, which will consume the revised spec plus the IMPL-1 through IMPL-16 checklist from this brief.

After applying changes, confirm:
- [ ] All SPEC-1 to SPEC-20 revisions applied
- [ ] Nothing in DO NOT REWRITE was touched
- [ ] Open Questions now contains A1–A6
- [ ] Spec references the legacy cron retirement decision explicitly
- [ ] Migration section declares every column referenced elsewhere in the spec
- [ ] Refund model has four variants, not two
