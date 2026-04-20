# Adversarial Review: Private Bookings SMS Redesign

**Date:** 2026-04-18
**Mode:** Spec Compliance Review (Mode C)
**Engines:** Codex (all reviewer passes)
**Scope:** `docs/superpowers/specs/2026-04-18-private-bookings-sms-redesign-design.md`
**Reviewers deployed:** Repo Reality Mapper, Assumption Breaker, Workflow & Failure-Path, Integration & Architecture, Security & Data Risk. Spec Trace Auditor retried but produced an empty report — skipped without substitution.

## Inspection Inventory

### Inspected
- `src/lib/twilio.ts`, `src/lib/sms/support.ts`, `src/lib/sms/quiet-hours.ts`, `src/lib/sms/name-utils.ts`
- `src/services/sms-queue.ts`, `src/services/private-bookings/mutations.ts`, `src/services/private-bookings/payments.ts`, `src/services/private-bookings/types.ts`, `src/services/private-bookings.ts` (barrel)
- `src/app/api/cron/private-booking-monitor/route.ts` (all 5 passes)
- `src/app/api/cron/post-event-followup/route.ts` (legacy)
- `src/app/api/cron/booking-balance-reminders/route.ts` (legacy)
- `src/lib/private-bookings/feedback.ts`, `src/lib/private-bookings/manager-notifications.ts`
- `src/lib/guest/tokens.ts`, `src/lib/guest/token-throttle.ts`
- `src/lib/email/emailService.ts`
- `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx`
- `src/app/actions/privateBookingActions.ts`
- `src/app/(authenticated)/sms-queue/page.tsx`
- `supabase/migrations/20251123120000_squashed.sql` (private_bookings, private_booking_sms_queue schema)
- `supabase/migrations/20260502000000_private_booking_payments.sql`
- `supabase/migrations/20260404000001_review_once_columns.sql`
- `vercel.json` (cron schedule)
- `docs/superpowers/specs/2026-03-22-event-sms-cross-promotion-and-tone-refresh.md`
- `docs/superpowers/specs/2026-03-19-private-bookings-payment-history.md`
- `docs/superpowers/specs/2026-04-12-sms-pipeline-fixes-design.md`
- Existing tests in `tests/services/`, `tests/api/`, `tests/lib/`

### Not Inspected
- Stripe/PayPal refund APIs (spec implications only; production integration not traced end-to-end)
- Twilio scheduling/deferred-send behaviour under STOP replies (mentioned in 2026-04-12 spec but not re-traced)
- Production environment variables for `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` (live-flag state requires human confirmation)
- Operational routing of the existing `manager@the-anchor.pub` inbox (who reads it, response SLAs)

### Limited Visibility Warnings
- The "live review spam" premise depends on the prod state of `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`. If OFF, most of Phase 1's urgency framing is wrong.
- `computeRefundAmount()` risk analysis assumes the existing `private_booking_payments` ledger is the sole source of truth; manual Stripe refunds bypass this and cannot be enumerated from repo alone.

## Executive Summary

The spec made 30+ factual or architectural claims that the codebase contradicts. Ten are blockers requiring spec revision before implementation begins. The biggest ones: the outcome-email GET links will be consumed by email security scanners (P0 security defect); two legacy crons (`post-event-followup`, `booking-balance-reminders`) already send the SMS the spec treats as "not live"; the "live review spam" bug may not be live at all; and the refund amount cannot be calculated from the specified data source alone.

The non-blocker findings are material: `ensureReplyInstruction` is a no-op (not a suffix appender); the dedupe lock hashes message body (so the copy refresh can cause duplicate sends); and the proposed new `private_booking_outcome_tokens` table duplicates the existing `guest_tokens` pattern.

## What Appears Solid

- The cancellation-copy split concept (hold vs paid) is sound — it just needs a better financial-outcome model.
- The Communications tab idea is good; it just needs shared eligibility logic with cron.
- Drop the "The Anchor:" opener, match event-reminder voice — no reviewer objected.
- 10-working-day SLA — no reviewer challenged (ops confirmation separately recommended).
- Delete-gate intent (block after SMS sent) — the rule is right; the implementation statuses and enforcement layer need work.
- Reuse `manager@the-anchor.pub` — the existing `manager-notifications.ts` abstraction confirms this is the right inbox.
- Quiet hours already apply to private-booking SMS via `sendSMS()` — spec's "verify" item can be downgraded to a one-line test.

## Critical Risks (BLOCKERS)

### B1 — GET side-effect in outcome email links (Security P0, Integration #1, Workflow #1–2)
**Spec says:** `GET /api/private-bookings/outcome/[token]` updates `post_event_outcome`, consumes token, invalidates siblings, writes audit.
**Reality:** Outlook/Gmail preview fetchers and link scanners (Microsoft Defender, Mimecast, Proofpoint) follow every URL in inbound emails. With a mutating GET, a single inbound scan consumes all three tokens and records the scanner's arbitrarily-ordered choice before the manager sees the email.
**Fix:** GET renders a confirmation page only. POST (with hidden `token` + `outcome` fields) performs the state change. Existing guest feedback flow is already this shape (`src/lib/private-bookings/feedback.ts`, `/g/[token]/private-feedback/action`).

### B2 — Legacy cron routes still scheduled (Assumption Breaker, Integration #4)
**Spec says:** Modify only `private-booking-monitor` Pass 5; reject 7-day/1-day balance reminders.
**Reality:** `vercel.json` schedules `/api/cron/post-event-followup` (sends `post_event_followup`) and `/api/cron/booking-balance-reminders` (sends `balance_reminder_7day` + `balance_reminder_1day`). Both are actively running with old copy.
**Fix:** In scope. Either fold them into `private-booking-monitor`, retire the routes and remove from `vercel.json`, or explicitly disable with a kill switch. Copy refresh is incomplete while these keep sending the old strings.

### B3 — Review lifecycle columns already exist (Assumption Breaker, Integration #3)
**Spec says:** Add `post_event_outcome`; narrative also references `outcome_email_sent_at` and `review_sent_at` (never declared in the migration section).
**Reality:** `private_bookings` already has `review_processed_at` and `review_clicked_at`; Pass 5 uses `review_processed_at IS NULL` as the once-only guard.
**Fix:** Collapse into one lifecycle. Either (a) reuse `review_processed_at` as the terminal "handled" flag and add only the outcome enum, or (b) introduce an explicit `review_decision`, `review_decided_at`, `review_sms_sent_at` set with migration that backfills from existing columns. Do not leave both independently authoritative.

### B4 — Delete gate statuses are fictional (Assumption Breaker, Workflow #14)
**Spec says:** Block if `private_booking_sms_queue` has rows with `status IN ('sent','queued','dispatching')`.
**Reality:** Valid statuses are `pending`, `approved`, `sent`, `cancelled`, `failed`. `dispatching:` is an `error_message` claim, not a status.
**Fix:** Explicit semantics: `sent` blocks hard delete; `approved` and any row with `scheduled_for` in the future must be cancelled first; `pending` / `cancelled` / `failed` do not block. Also enforce at the DB layer (trigger or RPC-only delete path) — a server-action guard alone can be bypassed by future utilities (see B9 below).

### B5 — Refund amount cannot be trusted from the ledger alone (Assumption Breaker, Workflow #9–12, Integration #5)
**Spec says:** `computeRefundAmount()` reads `total_paid` from payment history.
**Reality:** No `total_paid` column. Manual Stripe/PayPal dashboard refunds are invisible to the ledger. Disputes/chargebacks not modelled. Contract says deposit is separate and non-refundable on cancellation.
**Fix:** Introduce an explicit cancellation-financial-outcome: `no_money` / `refundable` / `partial_refund_already_issued` / `non_refundable_retained` / `manual_review`. Create `getPrivateBookingPaidTotals()` service function that sums deposit + `private_booking_payments`. Block auto-SMS if Stripe/PayPal shows a dispute; fall back to "manual review" copy with no refund promise. Paid-but-non-refundable needs its own distinct template (NOT the hold variant — "no money changed hands" is false).

### B6 — Outcome flow race conditions (Workflow #2, #4)
**Spec says:** Three tokens per booking, "consume with token, invalidate siblings". Relies on `outcome_email_sent_at IS NULL` + `review_sent_at IS NULL` guards.
**Reality:** Those guard columns don't exist in the proposed migration. Two managers can click different outcomes within the same second → last-write-wins, and a review SMS can fire after someone reported issues.
**Fix:** Conditional UPDATE: `UPDATE private_bookings SET post_event_outcome = $outcome WHERE id = $id AND post_event_outcome = 'pending' RETURNING *`. Losing requests render the recorded outcome (read-your-writes). Token consume also wrapped in a conditional UPDATE claiming the row.

### B7 — "Live review spam" premise is unverified (Assumption Breaker #1)
**Spec says:** Pass 5 is ungated → LIVE BUG FIX → P0 urgency.
**Reality:** Pass 5 is gated behind `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`, defaulting OFF in production. It also checks `review_processed_at IS NULL`, customer/phone presence, review-once, global guard, daily run lock, and cap.
**Fix:** Human confirmation required on the prod flag before calling this a live bug. If flag is OFF, reframe as "enablement + correctness" rather than "fix in-flight damage". Phase ordering may change (review gate becomes a prerequisite for enabling the flag, not a panic fix for already-live spam).

### B8 — Reuse `guest_tokens`, not a new token table (Assumption Breaker, Integration #1)
**Spec says:** New table `private_booking_outcome_tokens`.
**Reality:** `guest_tokens` already supports `private_booking_id`, hashed tokens, expiry, throttling, cleanup, and multiple action types (`private_feedback` is retired but the schema and flow remain).
**Fix:** Add action type `private_booking_outcome` to `guest_tokens`. Put `outcome` in the URL path (`/api/private-bookings/outcome/[outcome]/[token]`) OR extend `guest_tokens` with a small typed context column. Do not create a parallel table.

### B9 — Copy refresh deployment can cause duplicate sends (Assumption Breaker, Workflow #17)
**Spec says:** "15-min dedupe lock remains".
**Reality:** Dedupe hash includes `message_body`. On deploy of new copy, the lock treats old-body and new-body as different sends. If a cron re-fires inside the deploy window, the customer gets the same reminder twice with different wording.
**Fix:** Introduce a stable business idempotency key independent of body — booking + trigger + reminder-window-key (e.g. `balance_reminder_14day:{event_date}` or `deposit_reminder_1day:{hold_expiry}`). Existing dedupe hash stays for defense-in-depth.

### B10 — Delete gate needs DB-level enforcement (Security #5)
**Spec says:** Server-side guard in `deletePrivateBooking()`, all roles.
**Reality:** Later migrations include a broad `FOR ALL` policy on `private_bookings` for users with `manage` / `edit` / `create`. Future admin utilities, RPC functions, or direct client calls can bypass the action guard.
**Fix:** Delete via an RPC or trigger that enforces the SMS-sent check. Action layer remains the primary UI path; DB layer is defense-in-depth. If not done now, spec must call out residual risk explicitly.

## Implementation Defects (MAJOR)

### M1 — `ensureReplyInstruction()` is a no-op
Spec references it as appending a support contact. Reality: it only trims. Either drop every "reply-instruction suffix" claim OR implement the helper first and re-verify the ≤306 char budget.

### M2 — Date-TBD detection is note-based, not column-based
Spec plans `event_date IS NOT NULL AND is_date_tbd = false`. Reality: no `is_date_tbd` column; TBD is detected by `internal_notes` containing exact `DATE_TBD_NOTE` text. Spec needs either (a) add a real column with migration + backfill, or (b) centralise the note-based detector into a helper that cron + UI both call.

### M3 — First-name interpolation must use `getSmartFirstName()`
Spec templates pass `{firstName}` directly. Reality: existing code uses `getSmartFirstName()` to scrub placeholders like "guest" / "customer" / "unknown" to "there". Every new template function must accept raw booking fields and apply this helper.

### M4 — SMS content injection via customer name (Security #6)
`customer_first_name` is not sanitised for newlines/control chars. A hostile name injects extra lines/numbers into the SMS body. Central interpolation helper must strip control chars and cap length.

### M5 — Manual send UI is not safely out of scope
`PrivateBookingMessagesClient.tsx` lets admins send bespoke SMS via `sendSms({ bookingId })`. Copy refresh will affect template suggestions here. Spec must state whether manual templates update, or remain old.

### M6 — Queue approval UI already exists — overlaps preview
`sms-queue/page.tsx` already shows pending / approved / cancelled SMS with approve/reject/send actions. Proposed Communications tab duplicates some of this surface. Spec must say whether the tab is additive, replacement, or integrated with the queue view.

### M7 — Outcome-flow holes (Workflow #3, #6, #7, #8)
- Graph email failure: next cron creates a second token set. Fix: reuse active tokens per booking/outcome, unique active-token constraint, record `email_attempted_at` separately from `email_delivered_at`.
- Booking cancelled after outcome email: no check that `status != 'cancelled'` before review SMS. Customer gets a review ask for a cancelled event.
- Booking rescheduled after outcome email: tokens tie to booking, not event date/version. Stale clicks record outcome for a changed event. Fix: snapshot event date on token; reject if booking version changed.
- STOP reply handling: spec doesn't verify existing inbound STOP blocks review SMS.

### M8 — Message module abstraction — constrain its surface area (Integration #2)
New `src/lib/private-bookings/messages.ts` is defensible but must be pure (copy/rendering only). Must NOT own sending, querying, feature flags, or cron eligibility. Test coverage: pure builder tests + caller tests proving each send path passes correct data.

### M9 — Scheduled-SMS preview must share eligibility logic with cron (Integration #6)
Spec computes scheduled reminders in React. Cron eligibility (env flags, TBD detection, balance outstanding, date windows) lives elsewhere. Drift guaranteed. Fix: server-side helper `getBookingScheduledSms(id)` called by both cron AND UI.

### M10 — Communications tab must read feature flags (Integration #9)
`PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` gates Pass 3/4/5. UI must not show those as "scheduled" while prod flag is off.

### M11 — Use `manager-notifications.ts` abstraction (Integration #8)
`src/lib/private-bookings/manager-notifications.ts` centralises private-booking manager emails and `PRIVATE_BOOKINGS_MANAGER_EMAIL`. New outcome email should add a function there, not duplicate recipient config.

## Workflow & Failure-Path Defects (MAJOR/MINOR)

Covered in B1, B5–B7, M7 above. Minor items:
- Communications tab 500-row pagination (MINOR)
- TBD booking label clarity on tab (MINOR)
- Dedupe collision on cancel-uncancel-cancel within 15 min (MAJOR — Fix: dedupe by event id for destructive state changes)
- Queue row `cancelled` status should NOT count as "customer was told" (covered in B4)

## Security & Data Risks (MAJOR/MINOR)

Covered in B1, B10, M4 above. Additional notes:
- Rate-limit for outcome POST route: low action limit (8/15min recommended) per `scope + token_hash + client_ip`
- Audit entry for outcome change must include: booking id, outcome, token id, previous outcome, IP, user agent, timestamp (durable, not best-effort)
- Token table should use RLS with explicit service-role-only policy — not "RLS disabled"
- Customer info in manager email (first name, date, guest count) is acceptable; keep it minimal, no phone/email/payment

## Unproven Assumptions

| Assumption | What would confirm it |
|-----------|----------------------|
| `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` is OFF in production | Read Vercel env var; ask user |
| 10 working days refund SLA matches operations reality | Confirm with ops team |
| 14-day outcome token expiry is appropriate | Ask product; base on event-review feedback windows |
| `manager@the-anchor.pub` is monitored daily | Confirm with ops |
| Manual Stripe refunds are rare in practice | Review last 90 days of bookings |

## Recommended Fix Order

1. **Fix B7 first** — confirm prod flag state. Determines whether Phase 1 is a panic fix or a planned enablement.
2. **Fix B1 + B8 + B10** — authentication/token/route shape. Changes the API design.
3. **Fix B2** — legacy crons. Determines the full set of files the copy refresh must touch.
4. **Fix B3 + B6** — review lifecycle + atomic claims. Changes the data model.
5. **Fix B5** — refund model. Changes copy templates and adds manual-review variant.
6. **Fix B4 + B9** — delete statuses + dedupe idempotency. Tightens enforcement.
7. **Fix M1–M11 in same revision** — most are copy-level or wiring-level.

## Follow-Up Review Required

- [ ] **B1 post-revision**: confirm outcome flow uses GET-confirm + POST-mutate pattern and is behind throttle.
- [ ] **B5 post-revision**: re-read refund logic once the new financial-outcome enum is specified.
- [ ] **B7 post-confirmation**: if prod flag is OFF, Phase 1 urgency framing must be rewritten before implementation.
- [ ] **B10 post-revision**: verify DB trigger or RPC path enforces delete gate.
