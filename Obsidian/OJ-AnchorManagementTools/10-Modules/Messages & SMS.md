---
title: Messages & SMS
aliases:
  - SMS
  - Messages
  - Twilio
  - Customer Messaging
tags:
  - type/reference
  - module/messages
  - status/active
module: messages
route: /messages
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Messages & SMS

Two-way SMS communication with customers via [[Twilio]]. Supports inbound message viewing, outbound broadcasts to customer segments, delivery tracking, reusable templates, and an approval workflow to stage messages before sending.

---

## Route

| Route | Purpose |
|---|---|
| `/messages` | Message centre: inbox, broadcasts, delivery tracking |

---

## Permissions

| Permission | Description |
|---|---|
| `messages.view` | View inbound messages and broadcast history |
| `messages.send` | Send broadcast SMS messages |
| `messages.manage_templates` | Create and edit message templates |

---

## Key Features

### Inbound Messages
Receive and view replies from customers. Inbound messages arrive via the [[Twilio]] webhook at `POST /api/webhooks/twilio` and are stored in the `messages` table.

### Outbound Broadcasts
Send SMS messages to selected customer segments. Broadcasts can target:
- All opted-in customers
- Customers associated with a specific event
- Filtered customer segments (e.g. by booking history)

### Delivery Tracking
Each outbound message has a tracked delivery status, updated via [[Twilio]] delivery callbacks.

| Status | Meaning |
|---|---|
| `sent` | Accepted by Twilio for delivery |
| `delivered` | Confirmed delivered to handset |
| `failed` | Could not be sent |
| `undelivered` | Sent but not delivered (e.g. number unreachable) |

### Message Templates
Reusable SMS copy to ensure consistent messaging. Templates are managed in [[Settings]] and can be assigned to specific events.

- Global templates available across all broadcasts
- Per-event templates for event-specific communications
- See `event_message_template` for event assignments

### SMS Queue Approval Workflow
Outbound messages can be staged for review before sending. A manager must approve the queue before dispatch.

```
Draft message → Queue for review → Manager approves → Sends via Twilio
```

> [!TIP]
> Use the queue workflow for bulk broadcasts to avoid accidental sends. Direct sends bypass the queue and go immediately — use with care.

### Error Logging
Delivery failures and Twilio errors are recorded per message for audit and troubleshooting.

---

## Safety Guards

All SMS sending passes through the safety layer in `src/lib/sms/`. These guards run on every send attempt.

| Guard | Description |
|---|---|
| **Opt-in validation** | Only sends to customers who have given SMS consent |
| **Quiet hours** | No messages sent outside business hours |
| **Hourly rate limit** | Cap on outbound messages per hour |
| **Daily rate limit** | Cap on outbound messages per day |
| **Idempotency** | Prevents duplicate sends of the same message |

> [!DANGER]
> Never bypass the safety guards in `src/lib/sms/`. Sending SMS to non-consenting customers or outside safe hours creates legal and reputational risk. All sends must go through the wrapper — never call Twilio directly.

---

## Database Tables

| Table | Purpose |
|---|---|
| `messages` | All inbound and outbound message records |
| `message_delivery_status` | Per-message delivery status updates from Twilio |
| `message_templates` | Reusable SMS templates |
| `event_message_template` | Assigns a template to a specific event |

---

## Webhook

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/webhooks/twilio` | `POST` | Twilio delivery status callbacks |

> [!NOTE]
> The Twilio webhook is authenticated via Twilio's request signature validation — not the standard app session. Do not add session auth middleware to this endpoint.

---

## Integrations

| Integration | Purpose |
|---|---|
| [[Twilio]] | SMS send/receive and delivery status |
| [[Customers]] | Opt-in status and segment targeting |
| [[Settings]] | Global template management |
| [[Private Bookings]] | Per-booking SMS communication |

---

## Related

- [[Modules MOC]]
- [[Twilio]]
- [[Customers]]
- [[SMS Policy]]
- [[Settings]]
- [[Private Bookings]]
