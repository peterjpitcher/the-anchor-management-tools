---
title: SMS Policy
aliases:
  - sms rules
  - text message policy
  - SMS opt-in
tags:
  - type/reference
  - section/business-rules
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Business Rules MOC]]

# SMS Policy

The Anchor communicates with customers via SMS using [[Twilio]]. This note defines the rules governing when and how SMS messages may be sent.

## Opt-In Requirement

SMS may only be sent to a customer if they have explicitly opted in.

- `customers.sms_opt_in` must be `true` before any SMS can be sent
- Opt-in is captured at the point of booking (table booking or private booking form)
- Customers can opt out at any time
- Opt-out date is recorded in `customers.sms_opt_out_date`

> [!WARNING] Opt-In is Enforced Server-Side
> The SMS library checks `sms_opt_in` before sending, regardless of what the UI shows. Hiding the send button is not sufficient — the library will reject the request if opt-in is false.

## Delivery Failure Tracking

- Each failed SMS delivery increments `customers.delivery_failure_count`
- Once a customer's failure count reaches the configured threshold, automatic sending is blocked for that customer
- The threshold is defined in the SMS library configuration
- Failures are also reported via the [[Webhooks]] endpoint for Twilio delivery status callbacks

## Rate Limits

The SMS library enforces the following limits to prevent accidental bulk sends:

- **Hourly limit per phone number** — maximum messages to a single number per hour
- **Daily limit per phone number** — maximum messages to a single number per day

These limits are hardcoded in `src/lib/sms/` and apply to all outbound sends regardless of the trigger.

## Quiet Hours

SMS must not be sent outside of reasonable hours. The SMS library enforces quiet hours — attempts to send during these periods are either queued for later delivery or blocked entirely, depending on the message type.

## Idempotency

Each SMS send is assigned an idempotency key. If a server action is retried (e.g. due to a network timeout), the idempotency key prevents the same message from being sent twice to the same recipient.

## Private Bookings SMS Queue

[[Private Bookings]] uses a staged SMS queue (`private_booking_sms_queue`):

1. Staff compose messages in the booking management UI
2. Messages are added to the queue with status `pending`
3. A manager with the appropriate permission reviews and approves messages
4. Approved messages are sent via [[Twilio]]

Relevant permissions:
- `private_bookings.view_sms_queue` — view pending messages
- `private_bookings.approve_sms` — approve messages for sending

> [!NOTE] Why an Approval Queue?
> Private booking messages are often high-value customer communications (confirmations, contract summaries, payment reminders). The approval step ensures accuracy before sending and provides an audit trail.

## Inbound Messages

Customers can reply to SMS messages. Inbound messages are received via the [[Webhooks]] endpoint and can include opt-out keywords:

- `STOP`, `UNSUBSCRIBE` — sets `sms_opt_in = false` and records `sms_opt_out_date`
- These opt-outs are processed automatically without staff intervention

## Implementation

All SMS sending goes through `src/lib/sms/`. This library is the single point of enforcement for opt-in checks, rate limits, quiet hours, and idempotency. No module should call the Twilio API directly — all sends must go through this library.

## Related

- [[Business Rules MOC]]
- [[Messages & SMS]]
- [[Twilio]]
- [[Customer Model]]
- [[Customers]]
- [[Private Bookings]]
- [[Webhooks]]
