---
title: Twilio
aliases:
  - SMS Integration
  - Twilio SMS
tags:
  - type/reference
  - integration/twilio
  - status/active
integration: twilio
created: 2026-03-14
updated: 2026-03-14
---

← [[Integrations MOC]]

## Overview

Twilio provides all SMS messaging for the Anchor Management Tools — both outbound messages to customers and inbound replies from customers. SMS is used across several modules to send booking confirmations, parking reminders, and direct messages.

## Environment Variables

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Identifies the Twilio account |
| `TWILIO_AUTH_TOKEN` | Secret key for API authentication |
| `TWILIO_PHONE_NUMBER` | The sending number customers see (E.164 format) |

## Library Files

| File | Purpose |
|---|---|
| `src/lib/twilio.ts` | Low-level Twilio API wrapper |
| `src/lib/sms/` | Higher-level SMS service with safety guards |

## Webhook

`POST /api/webhooks/twilio` receives delivery status callbacks from Twilio after a message is sent.

| Status | Meaning |
|---|---|
| `delivered` | Message successfully received by the handset |
| `failed` | Message could not be delivered |
| `undelivered` | Carrier rejected the message |

Delivery status is written back to the originating record (e.g. the booking confirmation or SMS queue entry).

## Used By

| Module | Purpose |
|---|---|
| [[Messages & SMS]] | Direct outbound and inbound staff messaging to customers |
| [[Private Bookings]] | SMS confirmation queue — held for approval before sending |
| [[Table Bookings]] | Automated booking confirmations |
| [[Parking]] | Parking permit reminders |

## Safety Guards

All outbound SMS passes through `src/lib/sms/` before reaching the Twilio API. The following guards are applied in sequence:

| Guard | Description |
|---|---|
| Opt-in validation | Only sends to customers who have given SMS consent |
| Quiet hours enforcement | Blocks sends outside business hours |
| Hourly rate limit | Caps outbound volume per hour to prevent accidental bulk sends |
| Daily rate limit | Caps total outbound volume per calendar day |
| Idempotency keys | Prevents duplicate sends for the same logical message |
| Opt-out handling | Respects STOP replies; updates customer consent flag |

> [!DANGER] Never bypass the SMS library
> Always route sends through `src/lib/sms/` — never call the Twilio API directly from a server action. The safety guards exist to protect customers and prevent billing surprises.

## Send Flow

```
Server action
  → CustomerService (resolve and validate E.164 phone number)
  → SMS lib (apply all safety guards)
  → Twilio REST API
  → Twilio webhook callback to /api/webhooks/twilio (delivery update)
```

## SMS Queue (Private Bookings)

[[Private Bookings]] uses a staged queue table (`private_booking_sms_queue`) where outbound messages are written but held. A staff member reviews and approves queued messages before they are dispatched. This prevents accidental sends during booking amendments.

> [!NOTE] Queue approval
> Messages in `private_booking_sms_queue` with status `pending` will not be sent until explicitly approved. Check the queue after any bulk booking operation.

## Inbound Messages

When a customer replies to an SMS, Twilio delivers the inbound message to `POST /api/webhooks/twilio`. The message is stored in the `messages` table and surfaced in [[Messages & SMS]] for staff to action.

> [!TIP] Opt-out replies
> If a customer replies STOP, Twilio automatically blocks further sends to that number. The webhook also updates the customer's consent flag in the database so the opt-out is reflected in the UI.

## Related

- [[Messages & SMS]]
- [[Private Bookings]]
- [[Table Bookings]]
- [[Parking]]
- [[SMS Policy]]
- [[Webhooks]]
- [[Integrations MOC]]
