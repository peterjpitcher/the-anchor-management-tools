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
- Confirm the booking only after PayPal capture is verified.
- Send payment links by SMS and email for staff-created bookings.
- Send follow-up reminders.
- Automatically cancel unpaid bookings and release seats when the hold expires.

No card details should be handled by either app. PayPal hosts the payment UI.

PayPal references:

- PayPal JavaScript SDK uses `createOrder` and `onApprove` callbacks, with final capture done by the server: https://developer.paypal.com/sdk/js/reference/
- PayPal webhooks support `PAYMENT.CAPTURE.COMPLETED`: https://developer.paypal.com/docs/api/webhooks/v1/
- PayPal Orders v2 is the API used to create and capture orders: https://developer.paypal.com/docs/api/orders/v2/

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

## Stripe Removal Requirement

As part of this change, remove Stripe from the event ticket payment stack.

This means:

- Delete or replace event-payment imports from `src/lib/payments/stripe`.
- Remove Stripe checkout creation from `src/lib/events/event-payments.ts`.
- Replace `src/app/g/[token]/event-payment/checkout/route.ts` so it no longer creates a Stripe checkout session.
- Remove Stripe wording from event payment pages, customer copy, staff UI, analytics labels, tests, comments, docs, and feature flags.
- Remove Stripe payment heuristics from `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-booking-experience.ts` and `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-booking-copy.ts`.
- Remove event-ticket Stripe refund paths from `src/lib/events/manage-booking.ts`.
- Remove any event-ticket Stripe reporting labels from cashing-up, booking sheets, dashboards, and payment history.
- Audit old pending event payment links before launch. Migrate them to PayPal links or let them expire before Stripe routes are removed.

Database rule:

- New event ticket payment code must not read or write Stripe payment fields.
- New event ticket payment CHECK constraints should only allow `paypal` and `manual`.
- If old Stripe columns cannot be dropped immediately because the shared `payments` table or old migrations still need them, they may remain as inert legacy columns only. They must not be used by event ticket payment runtime code.

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

- `payment_provider text`, values: `paypal`, `manual`.
- `paypal_order_id text`.
- `paypal_capture_id text`.
- `payment_method text`, values: `paypal`, `cash`, `card_terminal`, `comp`.
- `updated_at timestamptz`.

Indexes:

- Unique partial index on `paypal_order_id` where not null.
- Unique partial index on `paypal_capture_id` where not null.
- Index on `(event_booking_id, payment_provider, status)`.

Add CHECK constraints for `payment_provider` and `payment_method`. If any existing event payment rows have Stripe IDs, migrate, expire, or archive them before launch so new event ticket payment constraints do not need a Stripe value.

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

### Database confirmation

Do not make browser routes perform many independent updates.

Add one new database confirmation path:

- `confirm_event_paypal_payment_v01`.

Do not generalise `confirm_event_payment_v05`. Leave it untouched for old code paths only.

The confirmation path must:

- Lock the booking row.
- Confirm only pending-payment bookings.
- Handle already-confirmed replay safely.
- Recover from a recently expired hold using the existing 10-minute event payment grace window.
- Update `bookings`, `booking_holds`, `payments`, and related table bookings together.
- Return a structured result: `confirmed`, `already_confirmed`, or `blocked`.

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

Extend or add a cron job to catch payment edge cases:

- Pending event payments with PayPal order IDs.
- PayPal says captured but local booking is still pending.
- Local booking expired but PayPal captured inside the grace window.
- PayPal order is gone or never captured and local hold is expired.

This can live beside the existing PayPal table deposit reconciliation pattern.

## Reminders And Auto-Cancel

Keep the existing auto-expiry behaviour in:

- `src/app/api/cron/event-booking-holds/route.ts`

Add reminder sending before expiry.

Recommended reminder stages:

- `payment_due_12h`: send when a staff-created hold has 12 hours or less left.
- `payment_due_2h`: send when any hold has 2 hours or less left.

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

Expired notification already exists by SMS. Add email equivalent when email exists.

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

Add a staff-only action or route:

- `POST /api/foh/event-bookings/[id]/mark-paid`

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
- `comp` means no money taken, must use amount `0`, and must require a note.
- Insert `payments` row with `payment_provider = 'manual'` and `status = 'succeeded'`.
- Confirm booking using the same confirmation path.
- Write audit log with staff user ID.

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
- Remove old event-ticket Stripe refund code. If any old Stripe event payments exist, identify them before launch and decide whether to migrate, manually handle, or archive them before removing the code.

## Reporting Changes

Any report that says "Stripe" for event ticket money needs to be updated. Event ticket money should report as PayPal or manual payment going forward.

Likely areas:

- Cashing up reports.
- Event booking sheets.
- Event detail payment history.
- Dashboard totals that read from `payments`.

Use labels:

- `PayPal`
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
- Remove event-ticket Stripe checkout, refund, route, copy, test, and reporting references.
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
- Table deposit, private booking, and parking PayPal flows still work.
- No new Stripe checkout sessions are created for event tickets.
- No event-ticket runtime code, customer copy, staff UI, tests, or reporting labels reference Stripe.

## Open Decisions

- Confirm exact website hold length. Recommended: 15 minutes.
- Confirm whether website event booking should require email or keep it optional. Recommended: optional.
- Confirm if staff can override expired holds when marking a manual payment. Recommended: yes, with audit log.
- Confirm whether any existing pending Stripe event payment links need PayPal migration before launch.
