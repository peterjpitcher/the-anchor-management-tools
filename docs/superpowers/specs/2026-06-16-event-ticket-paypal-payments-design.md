# Event Ticket PayPal Payments Design

Date: 2026-06-16

Repos covered:

- Management app: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`
- Public website: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`

## Goal

Take payment while event tickets are being booked, with one flow for public website bookings and the same payment-link flow for phone, bar, FOH, and admin bookings.

The chosen approach is:

- Use PayPal Checkout for event ticket payments.
- PayPal is the only target provider for event ticket payments.
- Remove all Stripe references from the event ticket payment flow in both repos.
- Keep the current `pending_payment` booking state.
- Hold seats only while payment is outstanding.
- Website checkout holds last 15 minutes.
- Staff, phone, and bar payment links last 24 hours, or until event start if sooner.
- Confirm the booking only after PayPal capture is verified.
- Send payment links by SMS and email for staff-created bookings.
- Send follow-up reminders.
- Automatically cancel unpaid bookings and release seats when the hold expires.
- Collect customer details before payment so abandoned payment holds can receive service follow-up. Do not use abandoned payment data for future marketing unless separate consent or a valid soft opt-in exists.

No card details should be handled by either app. PayPal hosts the payment UI.

PayPal references:

- PayPal JavaScript SDK uses `createOrder` and `onApprove` callbacks, with final capture done by the server: https://developer.paypal.com/sdk/js/reference/
- PayPal webhooks support `PAYMENT.CAPTURE.COMPLETED`: https://developer.paypal.com/docs/api/webhooks/v1/
- PayPal Orders v2 is the API used to create and capture orders: https://developer.paypal.com/docs/api/orders/v2/

## Implementation Status

Implemented in this change:

- Event-ticket PayPal order/capture helpers, guest payment page, public website inline PayPal, external website proxy routes, PayPal webhook, and PayPal reconciliation cron.
- Channel-aware holds: 15 minutes for website, 24 hours for staff links, capped at event start.
- Provider-neutral payment fields and event PayPal/manual confirmation RPCs.
- Staff-created payment links by SMS and email, plus 12-hour and 2-hour staff-link reminders with duplicate-send logging.
- Staff manual settlement from the event attendee table: cash paid, card-terminal paid, or comp.
- Staff cancellation applies the locked event refund policy and uses PayPal refunds for PayPal event-ticket payments.
- Customer transfer support is once per original booking, manager-gated, and audit logged.
- Event-ticket Stripe runtime/copy/tests were removed or disabled while shared non-event Stripe code remains.

## Current State

### Management app

Existing useful pieces:

- Event bookings can already be returned as `pending_payment`.
- `src/services/event-bookings.ts` creates event bookings and generates payment links.
- `src/lib/events/event-payments.ts` creates guest payment tokens and currently creates Stripe Checkout sessions.
- `src/app/g/[token]/event-payment/page.tsx` shows the event payment page.
- `src/app/g/[token]/event-payment/checkout/route.ts` redirects to Stripe.
- `src/app/api/cron/event-booking-holds/route.ts` expires unpaid event holds.
- `vercel.json` already schedules `/api/cron/event-booking-holds` every 5 minutes.
- PayPal is already used for table deposits:
  - `src/lib/paypal.ts`
  - `src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts`
  - `src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts`
  - `src/app/api/webhooks/paypal/table-bookings/route.ts`
  - `src/lib/table-bookings/paypal-deposit.ts`

Main gaps:

- Event ticket payment code still contains Stripe checkout paths that must be replaced or disabled.
- The general `payments` table is Stripe-shaped.
- Event PayPal order and capture IDs are not stored.
- There is no event PayPal webhook.
- There is no scheduled event payment reminder before expiry.
- Public website pending-payment bookings only show a link, not inline PayPal buttons.
- Event refunds and seat reductions still assume Stripe in parts of `src/lib/events/manage-booking.ts`.

### Public website

Existing useful pieces:

- `app/api/event-bookings/route.ts` proxies event bookings to the management API.
- `components/features/EventBooking/ManagementEventBookingForm.tsx` handles event booking UI.
- The form already handles `pending_payment` and shows `next_step_url`.
- Table bookings already use inline PayPal:
  - `components/features/TableBooking/PayPalDepositSection.tsx`
  - `app/api/table-bookings/paypal/create-order/route.ts`
  - `app/api/table-bookings/paypal/capture-order/route.ts`
- `@paypal/react-paypal-js` is already installed.
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `ANCHOR_API_BASE_URL`, and `ANCHOR_API_KEY` are already part of the website integration pattern.

Main gaps:

- Event booking form has no inline PayPal section.
- Event booking form does not create a PayPal order after a pending-payment response.
- Event booking capture does not proxy through the public website.
- Event conversion tracking happens only for already-confirmed booking responses. It needs to also fire after payment capture.
- The form currently has no email field.

## Event Ticket Stripe Removal Requirement

As part of this change, remove Stripe from the event ticket payment stack only. Do not remove shared Stripe code that still supports table bookings, charge approvals, cashing-up, or historic refunds unless a separate business-wide Stripe removal project is approved.

This means:

- Delete or replace event-payment imports from `src/lib/payments/stripe` only where they are used for event tickets.
- Remove Stripe checkout creation from `src/lib/events/event-payments.ts`.
- Replace `src/app/g/[token]/event-payment/checkout/route.ts` so it no longer creates a Stripe checkout session.
- Remove Stripe wording from event payment pages, customer copy, staff UI, analytics labels, tests, comments, docs, and feature flags.
- Remove Stripe payment heuristics from `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-booking-experience.ts` and `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-booking-copy.ts`.
- Stop new event-ticket Stripe refunds from being created. Keep historic event-ticket Stripe payments displayable and refundable as described below.
- Remove event-ticket Stripe reporting labels for new payments. Keep a historic Stripe label for old rows if old paid rows exist.
- Audit old pending event payment links before launch. Migrate them to PayPal links or let them expire before Stripe routes are removed.

Database rule:

- New event ticket payment code must not read or write Stripe payment fields.
- New event ticket payments should use `payment_provider = 'paypal'` or `payment_provider = 'manual'`.
- Allow `payment_provider = 'stripe'` as an inert legacy value for historic paid rows. Do not delete, expire, or archive paid financial records to satisfy a new constraint.
- If old Stripe columns cannot be dropped immediately because the shared `payments` table, table booking flows, or old migrations still need them, they may remain as legacy columns. They must not be used by new event ticket payment runtime code.

Historic event payment rule:

- Discovery (2026-06-16) found **zero** paid Stripe event-ticket rows in production, so this rule is a safety net for any event payment taken before cutover, not a migration of existing data.
- Existing paid Stripe event ticket rows must remain visible in admin reports and customer histories.
- Historic Stripe event payments must remain refundable. Either keep a restricted Stripe refund path for pre-cutover event rows, or document that these refunds are handled manually in the Stripe dashboard with an audit note in the management app.
- Do not remove the last refund path for money already taken.

### Stripe Discovery Inventory (verified 2026-06-16)

Discovery was run across both repos with a provider-focused grep (excluding false positives such as `stripEventTimeZoneOffset` and visual "stripe" styling) and cross-checked against the live database (Supabase project `tfcasgxopxegwrabvwat`).

#### Live database ground truth

This is the single most important input for safe removal:

- `payments` holds **19 rows, all `charge_type = 'table_deposit'`. There are zero event-ticket payment rows.** 6 succeeded table-deposit rows carry Stripe IDs; the other 13 (pending/failed) carry none.
- **No Stripe event-ticket payment has ever been recorded in production.** The event Stripe checkout path exists in code but has never written a `payments` row. Removing the event Stripe code therefore carries no event-data-migration or historic-event-refund risk. The "historic event payment rule" above is precautionary only, in case an event payment is taken before cutover.
- Stripe columns exist on only three live tables: `payments` (`stripe_payment_intent_id`, `stripe_checkout_session_id`), `charge_requests` (`stripe_payment_intent_id`), and `customers` (`stripe_customer_id`, legacy / not populated for payments).
- `table_bookings` deposits already use **PayPal** (`paypal_deposit_order_id`, `paypal_deposit_capture_id`) - no Stripe columns. The 6 Stripe `payments` rows are historic table deposits taken before that migration. Stripe's live payment data footprint is historic table deposits. The charge-approval schema/code path is still Stripe-capable, but current live `charge_requests` rows have 0 Stripe payment intent rows. Neither is event-ticket.
- `card_captures` does **not** exist as a live table. Ignore any inventory that references it or a `complete_table_card_capture_v05` dependency.
- Current `payments` constraints: `charge_type IN ('prepaid_event','seat_increase','refund','approved_fee','walkout','table_deposit')`; `status IN ('pending','succeeded','failed','refunded','partially_refunded')`; no `payment_provider` column yet.

#### Independent verification note

Independent discovery re-ran provider grep across both repos and checked live counts. It matched the external discovery on the event-ticket risk: 0 event payment rows, no live website Stripe integration, and only event-ticket Stripe code should be removed. It tightened one point: `charge_requests` exists and should be kept, but current live rows have 0 Stripe payment intent values.

#### REMOVE - event-ticket only (safe; no production data)

- `src/lib/events/event-payments.ts` - the Stripe checkout block only (`createStripeCheckoutSession`, `computeStripeCheckoutExpiresAtUnix`). The file's token/SMS logic stays; swap the Stripe block for PayPal helpers.
- `src/lib/events/manage-booking.ts` - event refund / seat-increase Stripe calls (`createStripeCheckoutSession`, `createStripeRefund`). Make provider-aware; do not delete the file.
- `src/app/g/[token]/event-payment/checkout/route.ts` - Stripe redirect; replace with a redirect to the PayPal event-payment page.
- `src/app/api/stripe/webhook/route.ts` - only the `prepaid_event` and `seat_increase` branches (calling `confirm_event_payment_v05` and `apply_event_seat_increase_payment_v05`). See "shared" below - do not delete the route.
- `src/app/api/foh/bookings/[id]/cancel/route.ts` - the event-side `expireStripeCheckoutSession` call only; the route stays.
- `confirm_event_payment_v05` (RPC) - superseded by `confirm_event_paypal_payment_v01`; leave it inert once the event webhook branch is gone.
- Event-only Stripe tests: `tests/lib/eventPaymentsPersistence.test.ts`, `tests/lib/eventManageBookingCheckoutPersistence.test.ts`, and the event-checkout assertions inside `tests/lib/eventPaymentSmsSafetyMeta.test.ts` / `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`.

#### KEEP - load-bearing for live non-event flows (do NOT remove here)

Verified to back live table-booking, charge-approval, refund, or reconciliation behaviour. An earlier draft listed several of these for removal:

- `src/app/api/stripe/webhook/route.ts` - shared route. Keep signature verification and the `table_deposit` (`confirm_table_payment_v05`) and `approved_charge` (`approve_table_charge_payment_v05`) branches.
- `src/lib/payments/stripe.ts` - keep. Table bookings and charges use `createStripeTableDepositCheckoutSession`, `createStripeOffSessionCharge`, `createStripeRefund`, `expireStripeCheckoutSession`, `verifyStripeWebhookSignature`, `isStripeConfigured`, `computeStripeCheckoutExpiresAtUnix`. Only `createStripeCheckoutSession` is event-only and may be deleted once `event-payments.ts` drops it.
- `src/lib/table-bookings/bookings.ts`, `refunds.ts`, `charge-approvals.ts`, `table-payment-blocked-reason.ts`, `ui.ts` - keep.
- `src/app/api/boh/table-bookings/[id]/route.ts` - keep.
- `src/lib/env.ts` - keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `charge_requests` table + `stripe_payment_intent_id` - keep. The schema and charge-approval code path remain Stripe-capable even though current live rows have 0 Stripe payment intent values.
- Cashing-up Stripe fields/labels: `src/services/cashing-up.service.ts`, `src/app/actions/cashing-up-import.ts`, `src/components/features/cashing-up/DailyCashupForm.tsx`, authenticated cashing-up screens - keep; they reconcile real historic Stripe takings.
- Shared webhook tests (`tests/api/stripe-webhook-route.test.ts`, `tests/api/stripeWebhookMutationGuards.test.ts`, `tests/api/stripeWebhookTableDepositLockFailure.test.ts`) - keep; trim only the event-branch assertions.
- `customers.stripe_customer_id` - legacy/inert column; leave dormant.

#### Public website - no live Stripe

The website has no Stripe SDK, dependency, env var, API route, or test. The only references are the literal token `stripe` in two provider-detection regexes (`lib/event-booking-experience.ts`, `lib/event-booking-copy.ts`, already covered by `online|payment_link|prepaid|ticket`), plus archival docs and `docs/architecture/env-vars.md` (which correctly states the site has no Stripe). Website work is copy/doc hygiene only - drop the `stripe` token from the two regexes and tidy docs. No functional change, no live code.

#### Migrations

Do not edit applied migrations. Add forward migrations only - to add `payment_provider` and PayPal columns/indexes - and never to drop shared Stripe columns, constraints, or functions still used by table bookings, charges, or cashing-up.

#### Final acceptance gate

- Re-run the provider-focused grep across both repos after implementation.
- Event-ticket runtime code, event-ticket tests, customer event copy, event staff UI, event feature flags, and active event docs must have no Stripe references.
- Any remaining Stripe hits must fall in the KEEP list, historic applied migrations, the inert `customers.stripe_customer_id` column, or archived docs - each listed in the implementation notes.

## Target Customer Flows

### Public website, paid event

1. Customer opens event page on `the-anchor.pub`.
2. Customer chooses ticket count and enters name, mobile, and optional email.
3. Website posts booking to `/api/event-bookings`.
4. Management creates a booking with `status = pending_payment` and a short website hold.
5. Website receives `state = pending_payment`, `booking_id`, `next_step_url`, amount, currency, and hold expiry.
6. Website calls `/api/event-bookings/paypal/create-order`.
7. Website shows PayPal buttons inline in the form.
8. Customer approves in PayPal.
9. Website calls `/api/event-bookings/paypal/capture-order`.
10. Management verifies amount, order, capture, booking status, and hold.
11. Management marks payment succeeded, confirms booking, releases hold, and sends confirmation.
12. Website shows confirmed state and fires conversion tracking.

The customer should not have to open a separate tab unless PayPal or the website payment component fails. The `next_step_url` remains the fallback.

### Public website, free or pay-on-arrival event

Current confirmed booking flow remains unchanged.

### Phone booking

1. Staff creates booking in admin or FOH.
2. If the event is prepaid, booking is `pending_payment`.
3. Staff enters mobile and optional email.
4. System sends payment link by SMS and email.
5. Customer pays on their own device.
6. System confirms booking after payment capture.
7. If unpaid, reminders are sent and the booking expires automatically.

### Bar booking

There are two valid options:

- Customer pays on their own phone using the PayPal link or QR code.
- Staff takes cash or card-terminal payment and records a manual payment in the management app.

For manual bar payment, the booking should be confirmed immediately and an audit record must be saved.

## Core Design

### Locked business rules

- Website event ticket holds are 15 minutes.
- Staff-created event ticket payment links are 24 hours, capped at event start time.
- Seats stay reserved while a booking is `pending_payment` and the payment hold is active.
- If PayPal captures money but the booking can no longer be honoured, store the payment, do not confirm the booking, create a staff-resolution exception, notify the customer, alert staff, and do not fire conversion tracking.
- Customer cancellation refund policy:
  - 7 or more days before event start: 100% refund.
  - 3 to 7 days before event start: 50% refund.
  - Under 3 days before event start: no refund.
- If The Anchor cancels an event, paid event tickets receive an automatic full refund.
- If an event is postponed or rescheduled, staff must choose whether to refund, transfer, or keep the booking on hold.
- Customers may transfer tickets once only.
- Manual refund approval requires manager access or higher.
- Abandoned-payment reminders are service messages only. No future marketing use is allowed without separate consent or valid soft opt-in.

### Booking state model

Use the existing states:

- `pending_payment`: seats are held, payment is outstanding.
- `confirmed`: payment complete or no payment needed.
- `expired`: payment was not completed before the hold expiry.
- `cancelled`: staff/customer cancelled.

Do not mark prepaid website bookings as `confirmed` until PayPal capture has been verified server-side.

### Hold durations

The current event payment hold is up to 24 hours. That is too long for public website checkout because it can block tickets after an abandoned checkout.

Add channel-aware hold duration:

- Website booking hold: 15 minutes.
- Staff-created payment link hold: 24 hours, or event start time if sooner.
- Waitlist payment hold: keep the existing waitlist offer expiry if shorter.

Implementation option:

- Add `create_event_booking_v06` with a `p_payment_hold_minutes` input.
- Keep `create_event_booking_v05` as a compatibility wrapper.
- Update `src/services/event-bookings.ts`, `src/app/api/foh/event-bookings/route.ts`, and `src/app/actions/events.ts` to pass the correct hold duration by source.

### Payment provider model

Remove event ticket payment runtime use of Stripe columns. Do not build new Stripe checkout or rollback paths for event ticket payments.

Add provider-neutral fields to `public.payments`:

- `payment_provider text`, values: `paypal`, `manual`, `stripe`.
- `paypal_order_id text`.
- `paypal_capture_id text`.
- `payment_method text`, values: `paypal`, `cash`, `card_terminal`, `comp`, `stripe`.
- `updated_at timestamptz`.

Indexes:

- Unique partial index on `paypal_order_id` where not null.
- Unique partial index on `paypal_capture_id` where not null.
- Index on `(event_booking_id, payment_provider, status)`.

Add CHECK constraints for `payment_provider` and `payment_method`, but keep `stripe` as a permitted legacy value because `payments` is shared with live table-deposit Stripe rows. Backfill before adding the constraint: the 6 succeeded table-deposit rows that carry Stripe IDs become `payment_provider = 'stripe'`; there are no event rows to migrate. Forbid new event-ticket Stripe writes in application code and tests, not by deleting historic financial rows.

### PayPal order creation

Add event PayPal helpers in or under `src/lib/events/event-payments.ts`.

Required functions:

- `createEventPayPalOrderByBookingId`.
- `createEventPayPalOrderByRawToken`.
- `captureEventPayPalOrderByBookingId`.
- `captureEventPayPalOrderByRawToken`.

These should reuse `src/lib/paypal.ts`:

- `createInlinePayPalOrder`.
- `getPayPalOrder`.
- `capturePayPalPayment`.
- `verifyPayPalWebhook`.

Rules:

- Calculate the amount server-side from the booking and event.
- Never trust amount from the browser.
- Reuse an existing PayPal order only if it is still valid, not completed, and matches the current amount and booking.
- If amount, seats, event, or hold changes, clear the stale PayPal order and create a new one.
- Use a stable `PayPal-Request-Id` based on booking ID and amount version.
- Store a pending payment row before returning the order ID.
- Use `custom_id = event_booking:<booking_id>` and `reference_id = event_booking`.

### PayPal capture

Capture must be server-side.

Before capture:

- Load booking by ID or guest token.
- Require `status = pending_payment`.
- Require an active, unexpired hold.
- Require submitted `orderId` to match the stored `paypal_order_id`.
- Fetch order from PayPal.
- Verify PayPal amount and currency match the canonical booking total.
- Verify PayPal `custom_id` matches the booking.

After capture:

- Verify capture status is complete.
- Verify captured amount and currency again.
- Save `paypal_capture_id`.
- Mark payment `succeeded`.
- Confirm event booking.
- Expire/release the payment hold.
- Clear `hold_expires_at`.
- Consume the guest token if paying by token.
- Send confirmation SMS/email.
- Sync event calendar if required.

Capture must be idempotent. Repeating the same capture call for an already-confirmed booking should return success if the stored capture matches.

If the payment has captured but confirmation is blocked because capacity or linked table availability is gone, the capture path must:

- Insert or update the succeeded payment row.
- Insert an `event_payment_exceptions` row with `reason = 'capacity_unavailable_after_capture'` or `reason = 'table_unavailable_after_capture'`.
- Return a manual-review response to the caller, not a confirmed response.
- Send customer SMS/email saying staff are checking the booking.
- Alert staff.
- Avoid conversion tracking until staff resolves the exception.

### Database confirmation

Do not make browser routes perform many independent updates.

Add two new database confirmation paths:

- `confirm_event_paypal_payment_v01`.
- `confirm_event_manual_payment_v01`.

Do not generalise `confirm_event_payment_v05`. Leave it untouched for old code paths only.

The confirmation path must:

- Lock the booking row.
- Confirm only pending-payment bookings.
- Handle already-confirmed replay safely.
- Recover from a recently expired hold using a 10-minute event payment grace window.
- Update `bookings`, `booking_holds`, `payments`, and related table bookings together.
- Return a structured result: `confirmed`, `already_confirmed`, `manual_review`, or `blocked`.

Use a single application constant, `EVENT_PAYMENT_GRACE_WINDOW_MINUTES = 10`, for the route, webhook, reconciliation, and hold-expiry cron. The RPC should also use the same 10-minute value.

### Management API routes

Add API-key protected routes for the public website:

- `POST /api/external/event-bookings/[id]/paypal/create-order`
- `POST /api/external/event-bookings/[id]/paypal/capture-order`

Responses:

- Create order: `{ success: true, orderId, amount, currency, holdExpiresAt }`.
- Capture order: `{ success: true, state: 'confirmed', booking_id, amount, currency }`.

Add guest token routes for payment links:

- `POST /g/[token]/event-payment/paypal/create-order`
- `POST /g/[token]/event-payment/paypal/capture-order`

Replace or disable the Stripe redirect route:

- `src/app/g/[token]/event-payment/checkout/route.ts`

It should no longer create Stripe checkout sessions. If a customer lands there from an old link during cutover, redirect them back to the PayPal event payment page for the same token.

### Guest payment page

Update:

- `src/app/g/[token]/event-payment/page.tsx`

Add a client component:

- `src/app/g/[token]/event-payment/EventPayPalPaymentClient.tsx`

It should:

- Show event name, ticket count, total amount, and hold expiry.
- Render PayPal buttons.
- Use token-based create/capture routes.
- Show a clear expired state.
- Show confirmed state if booking is already confirmed.
- Never show Stripe copy.

### PayPal webhook

Add:

- `src/app/api/webhooks/paypal/event-bookings/route.ts`

Environment:

- `PAYPAL_EVENT_BOOKINGS_WEBHOOK_ID`.
- Fallback to `PAYPAL_WEBHOOK_ID` only if needed.

Events:

- `PAYMENT.CAPTURE.COMPLETED`.
- `PAYMENT.CAPTURE.DENIED`.
- `CHECKOUT.PAYMENT-APPROVAL.REVERSED`.
- Refund events if event refunds move to PayPal in the same release.

Webhook rules:

- Verify signature with PayPal.
- If `custom_id` is missing or does not start with `event_booking:`, return 200 and ignore it silently. Other PayPal webhooks may receive table, private booking, or parking captures.
- Look up payment by `paypal_capture_id` first, then `paypal_order_id`, then `custom_id`.
- Confirm booking if browser capture completed but app confirmation did not.
- Do nothing harmful on duplicate events.
- Log only event-looking captures that start with `event_booking:` but cannot be matched.

### Reconciliation

Add a separate cron job to catch payment edge cases:

- Pending event payments with PayPal order IDs.
- PayPal says captured but local booking is still pending.
- Local booking expired but PayPal captured inside the grace window.
- PayPal order is gone or never captured and local hold is expired.

This must not be folded into `/api/cron/event-booking-holds`. The hold cron handles fast expiry/race-window checks. The event PayPal reconciliation cron runs every 15 minutes and handles stuck or orphaned PayPal orders/captures.

## Reminders And Auto-Cancel

Keep the existing auto-expiry behaviour in:

- `src/app/api/cron/event-booking-holds/route.ts`

Add reminder sending before expiry.

Recommended reminder stages:

- `payment_due_12h`: send when a staff-created hold has 12 hours or less left.
- `payment_due_2h`: send when a staff-created hold has 2 hours or less left.

Do not send reminder SMS for 15-minute website holds. The inline PayPal UI is the reminder.

Before expiring a pending event booking, the cron must handle payment races:

- If the booking has a PayPal order and the hold expired less than 10 minutes ago, do not send an expiry SMS yet.
- If PayPal says the order is approved or captured, do not expire the booking. Let capture, webhook, or reconciliation finish confirmation.
- If the grace window has passed and PayPal has not captured payment, expire the booking and release seats.
- If the booking is recovered and confirmed inside the grace window, do not send an expiry SMS.

Add reminder log table:

- `event_payment_reminders`
- `id uuid`
- `event_booking_id uuid`
- `stage text`
- `channel text`, values: `sms`, `email`
- `sent_at timestamptz`
- `message_id text`
- `metadata jsonb`
- Unique `(event_booking_id, stage, channel)`

Send channels:

- SMS if the customer has an active mobile number.
- Email if the customer has an email address.

Expired notification already exists by SMS. Add email equivalent when email exists if the customer provided email.

## Staff UI Changes

### Admin event booking

Update event booking management screens to show:

- Payment status.
- Hold expiry.
- Payment link.
- Copy payment link button.
- Resend payment link button.
- Mark paid manually button.
- Cancel unpaid booking button.

Likely areas:

- `src/app/actions/events.ts`
- Authenticated event detail/client components under `src/app/(authenticated)/events`
- FOH event booking components/routes under `src/app/api/foh/event-bookings/route.ts`

### Manual payment at bar

Add a staff-only server action, and optionally expose it through FOH later:

- `markEventBookingPaidManually`

Inputs:

- `method`: `cash`, `card_terminal`, or `comp`.
- `amount`.
- optional `note`.

Rules:

- Requires staff auth and `checkUserPermission('events', 'manage')`, or the existing equivalent events management permission.
- Booking must be `pending_payment`.
- Hold must be active, or staff must confirm an override.
- `amount` must be validated against the canonical booking total calculated server-side.
- `cash` and `card_terminal` payments must match the canonical total unless a manager override is recorded.
- `comp` means no money taken and must use amount `0`.
- Insert `payments` row with `payment_provider = 'manual'` and `status = 'succeeded'`.
- Confirm booking using the same confirmation path.
- Write audit log with staff user ID.

### Customer transfers

Managers can transfer a confirmed event booking once per original booking.

Rules:

- The original booking must be confirmed.
- The target event must be bookable and must have capacity.
- If the target event is prepaid, the existing paid value must cover the target ticket value; otherwise staff must take payment separately before transferring.
- The replacement booking is created first, then confirmed, then the old booking is cancelled.
- Existing event-ticket payment rows move to the replacement booking so future refunds are tied to the active booking.
- A row is written to `event_ticket_transfers` to enforce the one-transfer rule and preserve the audit trail.
- Customer SMS is sent with the new event details and a manage-booking link.

## Public Website Changes

### API routes

Add:

- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/paypal/create-order/route.ts`
- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/paypal/capture-order/route.ts`

Create order route:

- Input: `{ bookingId }`.
- Validate UUID.
- Proxy to management `/external/event-bookings/${bookingId}/paypal/create-order`.
- Use `Authorization: Bearer ${ANCHOR_API_KEY}`.
- Return no-store JSON.

Capture route:

- Input: `{ bookingId, orderId, event conversion fields, attribution fields }`.
- Validate UUID and order ID.
- Proxy to management `/external/event-bookings/${bookingId}/paypal/capture-order`.
- On success, forward event booking conversion to CheersAI.
- Return no-store JSON.

### Event payment component

Add:

- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/features/EventBooking/PayPalEventPaymentSection.tsx`

Base it on:

- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/features/TableBooking/PayPalDepositSection.tsx`

Props:

- `bookingId`
- `orderId`
- `amount`
- `currency`
- `eventName`
- `tickets`
- `bookingSummary`
- `conversionPayload`
- `onSuccess`
- `onError`

Behaviour:

- Use `PayPalScriptProvider`.
- Use `PayPalButtons`.
- `createOrder` returns the existing order ID.
- `onApprove` posts to the website capture route.
- Disable buttons while capture is running.
- Show fallback payment link if PayPal fails.

### Event booking form

Update:

- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/features/EventBooking/ManagementEventBookingForm.tsx`

Changes:

- Add optional email field.
- Include email in `/api/event-bookings` payload.
- If response is `confirmed`, keep current success flow.
- If response is `pending_payment`, immediately call event PayPal create-order route.
- Show inline PayPal section.
- Keep `next_step_url` as fallback.
- Track `payment_started`, `payment_approved`, `payment_confirmed`, and `payment_failed` funnel steps.
- Fire `trackEventBookingComplete` only after capture success.
- Do not call the booking confirmed copy until capture succeeds.

### Website copy helpers

Update:

- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-booking-experience.ts`
- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-booking-copy.ts`

Copy direction:

- For prepaid events: "Book and pay online to secure your tickets."
- For free events: keep "No payment needed."
- For cash/pay-on-arrival events: keep "No payment now."

Also remove Stripe-specific matching from payment heuristics and replace with provider-neutral terms such as `prepaid`, `online`, `paypal`, `payment_link`, and `ticket`.

### Website tests

Update or add:

- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/tests/unit/ManagementEventBookingForm.test.tsx`
- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/paypal/create-order/__tests__/route.test.ts`
- `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/paypal/capture-order/__tests__/route.test.ts`

Test cases:

- Pending-payment response shows inline PayPal.
- PayPal create-order failure shows fallback link.
- Capture success shows confirmed state.
- Capture success fires conversion forwarding.
- Capture failure leaves booking pending and shows retry copy.
- Free/pay-on-arrival events do not show PayPal.
- Conversion forwarding is idempotent by booking ID, so capture success and replay cannot double count.

### Management tests

Add or update backend tests for:

- `confirm_event_paypal_payment_v01`: confirmed, already confirmed, blocked, expired inside grace window, expired outside grace window, and capacity exceeded after expiry.
- PayPal create-order amount, currency, booking status, stale order, and custom ID checks.
- PayPal capture amount, currency, order ID, capture ID, custom ID, hold expiry, and idempotent replay checks.
- Event PayPal webhook signature verification, non-event capture ignore, duplicate event replay, and event-looking unmatched capture logging.
- Expiry cron grace-window behaviour, including no expiry SMS when capture is in flight.
- Manual mark-paid permission, amount validation, comp note requirement, and audit log.

## Refunds And Booking Changes

Event refunds must become provider-aware.

Update:

- `src/lib/events/manage-booking.ts`
- Any event cancellation or seat-reduction routes that currently call Stripe refund code.

Rules:

- PayPal event payment refunds use `refundPayPalPayment`.
- Manual payments are marked for manual refund, not refunded automatically.
- Partial seat reduction refunds use the original provider capture/payment ID.
- Refund rows in `payments` should include provider and original payment reference in metadata.
- Keep historic Stripe event payments refundable. Either retain a restricted pre-cutover Stripe refund path, or require staff to refund manually in the Stripe dashboard and record the manual refund in the management app.
- Customer-requested cancellations use the locked refund policy: 7+ days full, 3-7 days 50%, under 3 days none.
- Anchor-cancelled events auto-refund paid PayPal tickets in full.
- Postponed or rescheduled events create staff actions; the system must not auto-refund or auto-transfer without staff choice.
- Customer transfers are limited to one transfer per original booking.
- Manual refund overrides require manager access or higher and must write audit logs.

## Reporting Changes

Reports should show PayPal or manual payment for new event ticket money. If historic Stripe event ticket rows exist, keep a `Stripe` label for those old rows so old money remains auditable.

Likely areas:

- Cashing up reports.
- Event booking sheets.
- Event detail payment history.
- Dashboard totals that read from `payments`.

Use labels:

- `PayPal`
- `Stripe` for historic rows only
- `Cash`
- `Card terminal`
- `Comp`
- `Online payment` when grouping providers together.

Do not mix PayPal ticket sales into any Stripe-only field.

## Security And Reliability Requirements

- Website routes must not expose management secrets to the browser.
- Management external routes must require API key auth.
- Guest token routes must use token hash lookup and consume tokens after success.
- PayPal capture must verify amount, currency, order ID, capture ID, custom ID, booking status, and hold expiry.
- Database confirmation must be transactional.
- Duplicate browser posts and duplicate webhooks must be safe.
- Conversion forwarding must be idempotent by booking ID.
- If PayPal captures but local confirmation fails, webhook or reconciliation must recover it.
- If local DB cannot store the pending payment row, do not return the PayPal order to the browser.
- Do not log PayPal access tokens or personal payment data.

## Rollout Plan

### Phase 1: Data and backend foundation

- Add payment provider columns.
- Add event PayPal create/capture helpers.
- Add event PayPal external routes.
- Add event PayPal confirmation RPC.
- Add tests.

### Phase 2: Guest payment links

- Replace guest event payment Stripe flow with PayPal.
- Add event PayPal webhook.
- Add reconciliation.

Suggested flags:

- `EVENT_PAYPAL_EVENT_PAYMENTS_ENABLED=true|false`
- `EVENT_PAYMENT_REMINDERS_ENABLED=true|false`

### Phase 3: Public website inline checkout

- Add website event PayPal proxy routes.
- Add `PayPalEventPaymentSection`.
- Update event booking form.
- Update copy and tests.

### Phase 4: Staff payment operations

- Add resend/copy payment link.
- Add manual bar payment confirmation.
- Add audit log.

### Phase 5: Reminders and reporting

- Add reminder scheduler and email support.
- Update reporting and cashing-up labels.
- Add operational dashboard checks for stuck payments.

### Phase 6: Event-ticket Stripe removal

Start this only after PayPal guest links and website inline checkout are live and verified.

- Migrate any open pending event payment links to PayPal, or let them expire.
- Disable event-ticket handling in the shared Stripe webhook without breaking non-event Stripe behaviour.
- Remove event-ticket Stripe checkout, refund, route, copy, test, and reporting references.
- Keep historic Stripe event payments displayable and refundable.
- Run the final provider-focused grep gate and list any remaining allowed Stripe references.

## Acceptance Criteria

- A prepaid website booking shows PayPal during booking.
- A prepaid website booking is not confirmed until PayPal capture succeeds.
- Website payment success confirms the booking and fires conversion tracking.
- Staff-created prepaid bookings send a payment link by SMS and email where available.
- Unpaid bookings are reminded and then expired automatically.
- Expired unpaid bookings release seats and linked table reservations.
- PayPal webhook can confirm a captured payment if the browser closes early.
- PayPal webhook ignores non-event captures without logging false alarms.
- A customer who pays within the 10-minute grace window is confirmed and does not receive an expiry SMS.
- Duplicate clicks, retries, and webhooks do not create duplicate payments.
- Amount changes invalidate old PayPal orders.
- Free and pay-on-arrival events keep their current booking behaviour.
- Existing table booking, private booking, parking, charge approval, and cashing-up flows still work.
- No new Stripe checkout sessions are created for event tickets.
- No new event-ticket runtime code, customer copy, staff UI, tests, or new-payment reporting labels reference Stripe.
- Historic Stripe event payments remain visible and refundable.

## Resolved Decisions

- Stripe removal scope is event-ticket-only. Shared Stripe code, columns, env vars, webhook branches, and reporting needed for table bookings, charge approvals, cashing-up, or historic refunds stay in place.

## Open Decisions

- Confirm exact website hold length. Recommended: 15 minutes.
- Confirm whether website event booking should require email or keep it optional. Recommended: optional.
- Confirm if staff can override expired holds when marking a manual payment. Recommended: yes, with audit log.
- Existing pending Stripe event payment links: discovery found zero event payment rows in production, so there are none to migrate today. Re-check immediately before cutover.
- Historic Stripe event refund handling: discovery found zero paid event rows, so there is nothing to refund today. If any event payment is taken before cutover, keep a restricted Stripe refund path or refund manually via the Stripe dashboard with an audit record.
