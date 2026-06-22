# Outbound SMS Discovery — Inventory & Logging Audit

_Read-only discovery. The Anchor Management Tools. Generated 2026-06-21._

## TL;DR

Every outbound SMS in the codebase funnels through **one** canonical function: `sendSMS` in
`src/lib/twilio.ts:208`. There are **no** direct `client.messages.create` calls anywhere outside
that file. `sendSMS` automatically logs each send to the `messages` table with `customer_id` and
`direction = 'outbound'`, and it **fails closed** (returns `logging_failed`) if it cannot resolve a
customer to attach the row to. As a result, customer-linked logging is essentially guaranteed for
all customer-facing SMS. The only paths that intentionally do **not** produce a customer-linked
`messages` row are (a) the FOH food-order staff alert (fixed staff number, `skipMessageLogging`),
and (b) recruitment SMS to candidates (logged in a separate `recruitment_communications` table, not
`messages`).

---

## (a) Canonical send function & logging behaviour

### `sendSMS` — `src/lib/twilio.ts:208`

`export const sendSMS = async (to, body, options: SendSMSOptions = {})`

Pipeline (in order):

1. **Emergency kill switch** — `SUSPEND_ALL_SMS` / `SUSPEND_EVENT_SMS` env flags → returns early,
   no send, no log.
2. **Customer resolution** — `resolveCustomerIdIfNeeded(to, options)` (`twilio.ts:58`) →
   `ensureCustomerForPhone(...)` (`src/lib/sms/customers.ts:189`). Looks up customer by phone
   (with `generatePhoneVariants`); if no match and `createCustomerIfMissing !== false`, **creates a
   new customer** (fallback name `Unknown Guest`, `sms_opt_in: true`). Fails closed on lookup error.
3. **Eligibility / opt-out check** — `isCustomerSmsSendAllowed(...)`.
4. **Safety guards** — rate limits + idempotency dedup (`buildSmsDedupContext`, `claimSmsIdempotency`).
   Duplicate → returns `status: 'suppressed_duplicate'` (no send, no new log).
5. **Quiet hours** — defers via Twilio scheduling or the job queue (`unified-job-queue`), requires a
   `customerId` to defer (else returns failure).
6. **Twilio send** — `client.messages.create(messageParams)` wrapped in `retry()` (`twilio.ts:483`).
7. **AUTOMATIC LOGGING** (`twilio.ts:506`+):
   - If `options.skipMessageLogging === true` → returns success, **NO `messages` row written**.
   - Else, if no `customerId` yet and `createCustomerIfMissing !== false` → `ensureCustomerForPhone`
     to create one.
   - If a `customerId` exists → `recordOutboundSmsMessage(...)` (`src/lib/sms/logging.ts:33`) inserts
     the row.
   - **If no customer could be resolved → returns `code: 'logging_failed'` / `logFailure: true`
     (fail-closed). The SMS was sent but NOT logged.** Callers (esp. bulk/queue loops) are expected
     to abort on this.
8. **Failure path** (`twilio.ts:649`) — on Twilio send error, still writes a `messages` row with
   `status: 'failed'` + `error_code`/`error_message` (unless `skipMessageLogging`).

### `recordOutboundSmsMessage` — `src/lib/sms/logging.ts:33`

Inserts into `messages`. Returns `null` (no insert) when `customerId` is falsy. Insert payload:

```
customer_id, direction: 'outbound', message_sid, twilio_message_sid, body, status,
twilio_status, from_number, to_number, message_type: 'sms', segments, cost_usd,
sent_at, read_at, [failed_at], [metadata],
[event_booking_id | table_booking_id | private_booking_id | template_key | error_code | error_message]
```

### `messages` table columns (`src/types/database.generated.ts:5556`)

`customer_id` (**NOT NULL**), `direction`, `message_sid`, `twilio_message_sid`, `body`, `status`,
`twilio_status`, `from_number`, `to_number`, `message_type`, `segments`, `cost_usd`, `sent_at`,
`read_at`, `delivered_at`, `failed_at`, `error_code`, `error_message`, `price`, `price_unit`,
`event_booking_id`, `table_booking_id`, `private_booking_id`, `template_key`, `created_at`, `updated_at`, `id`.

> `customer_id` is non-nullable — this is _why_ `sendSMS` fails closed when no customer resolves: a
> row literally cannot be inserted without a customer.

### Wrapper layers (all delegate to `sendSMS`)

- `sendSms` (action) — `src/app/actions/sms.ts:248` → calls `sendSMS` w/ `createCustomerIfMissing: true`.
- `sendBulkSMSAsync` — `src/app/actions/sms.ts:369` (queues jobs).
- `sendBulkSMSDirect` — `src/app/actions/sms-bulk-direct.ts:41`.
- `sendBulkSMS` core loop — `src/lib/sms/bulk.ts:331` → `sendSMS` per recipient.
- `sendSmsReply` — `src/app/actions/messageActions.ts:67`.
- Job queue processors — `src/lib/background-jobs.ts:340`, `src/lib/unified-job-queue.ts:1072`,
  `src/services/sms-queue.ts:233`.

---

## (b) Send-site inventory

All call `sendSMS` (directly or via a wrapper) unless noted. "Logged?" = produces a customer-linked
`messages` row via the canonical pipeline.

| Trigger type | File:line | Resolves customer? | Logged to `messages`? | Gap? |
|---|---|---|---|---|
| Manual (staff "send SMS" action) | `src/app/actions/sms.ts:316` (`sendSms`) | Yes (`createCustomerIfMissing: true`) | Yes | No |
| Manual reply (messages thread) | `src/app/actions/messageActions.ts:67` → `sendSMS` | Yes | Yes | No |
| Manual / template SMS | `src/app/actions/sms.ts:200` | Yes | Yes | No |
| Bulk SMS (direct) | `src/app/actions/sms-bulk-direct.ts:41` → bulk → `sendSMS` | Yes per-recipient | Yes | No |
| Bulk SMS (async/queued) | `src/app/actions/sms.ts:369` → queue → `sendSMS` | Yes | Yes | No |
| Bulk core loop | `src/lib/sms/bulk.ts:331` | Yes | Yes | No |
| Event booking confirmation/updates | `src/app/actions/events.ts:1575`, `:1890` | Yes | Yes | No |
| Event service (reminders etc.) | `src/services/events.ts:1221` | Yes | Yes | No |
| Event booking confirm (service) | `src/services/event-bookings.ts:270` | Yes | Yes | No |
| Event payment notifications | `src/lib/events/event-payments.ts:765,853,974,1119` | Yes | Yes | No |
| Event reschedule notifications | `src/lib/events/reschedule-notifications.ts:144` | Yes | Yes | No |
| Event staff seat updates | `src/lib/events/staff-seat-updates.ts:268` (→ events action) | Yes | Yes | No |
| Waitlist offer (lib) | `src/lib/events/waitlist-offers.ts:290` | Yes | Yes | No |
| Waitlist offer (API) | `src/app/api/event-waitlist/route.ts:105` | Yes | Yes | No |
| Waitlist offer confirm (public link) | `src/app/g/[token]/waitlist-offer/confirm/route.ts:169` | Yes | Yes | No |
| **Cron: event booking holds** | `src/app/api/cron/event-booking-holds/route.ts:145` | Yes | Yes | No |
| **Cron: event guest engagement** | `src/app/api/cron/event-guest-engagement/route.ts:482` | Yes | Yes | No |
| **Cron: parking notifications** | `src/app/api/cron/parking-notifications/route.ts:865` | Yes | Yes | No |
| Parking payment SMS | `src/lib/parking/payments.ts:185,502` | Yes | Yes | No |
| Table booking confirm/cancel/etc. | `src/lib/table-bookings/bookings.ts:1048,1175,1320` | Yes | Yes | No |
| Table booking staff deposit transitions | `src/lib/table-bookings/staff-deposit-transitions.ts:149` | Yes | Yes | No |
| Table booking msg to slot guests (BOH) | `src/app/api/boh/table-bookings/[id]/sms/route.ts:116` | Yes | Yes | No |
| Table booking party-size change | `src/app/api/boh/table-bookings/[id]/party-size/route.ts:72,90` & `foh/bookings/[id]/party-size/route.ts:68,86` (→ events action) | Yes | Yes | No |
| Table booking message action | `src/app/actions/table-booking-messages.ts:255` | Yes | Yes | No |
| Inbound auto-reply (webhook) | `src/app/api/webhooks/twilio/route.ts:528` | Yes | Yes | No |
| Generic notification helper | `src/lib/notifications/notify.ts:195` | Yes | Yes | No |
| Refund notifications | `src/lib/refund-notifications.ts:48` | Yes | Yes | No |
| Cross-promo / follow-up SMS | `src/lib/sms/cross-promo.ts:146` | Yes | Yes | No |
| Queue processor (background jobs) | `src/lib/background-jobs.ts:340` | Yes | Yes | No |
| Queue processor (unified job queue) | `src/lib/unified-job-queue.ts:1072` | Yes | Yes | No |
| Queue processor (sms-queue service) | `src/services/sms-queue.ts:233,995` | Yes | Yes | No |
| Messages service send | `src/services/messages.ts:105` | Yes | Yes | No |
| **FOH food-order staff alert** | `src/app/api/foh/food-order-alert/route.ts:32` | No (fixed staff #, `createCustomerIfMissing: false`) | **No (`skipMessageLogging: true`)** | **By design — see GAP-1** |
| **Recruitment candidate SMS** | `src/lib/recruitment/communications.ts:590,697` | No (`createCustomerIfMissing: false`) | **No `messages` row**; logged in `recruitment_communications` instead | **By design — see GAP-2** |

Notes:
- The `*party-size` API routes call the events server action (`updateBookingPartySize` with
  `sendSms`), which internally calls `sendSMS`. They do not call Twilio directly.
- Cron reconcile (`src/app/api/cron/reconcile-sms/route.ts`) and the twilio webhook status path
  read/update Twilio + `messages` for **status reconciliation only** — they do not _send_ new SMS.
- `import-messages.ts`, `diagnose-*.ts`, backfill scripts (`*-backfill-safety.ts`,
  `scripts/import-missed-messages.ts`) touch `messages` but do not send outbound SMS.

---

## (c) Gaps — outbound SMS not logged / not customer-linked

There are **no accidental gaps**. The architecture forces customer-linked logging for every
customer-facing send (fail-closed on missing customer). The two non-logged paths are deliberate:

### GAP-1 (intentional): FOH food-order staff alert — not logged
- **File:** `src/app/api/foh/food-order-alert/route.ts:32`
- **What:** Sends the literal text `"Food order"` to a hardcoded staff mobile
  `+447956315214` when FOH staff press a button.
- **Why no log:** `skipMessageLogging: true` + `createCustomerIfMissing: false`. The recipient is a
  staff member, not a customer, so there is intentionally no `messages` / customer-history row.
- **Risk:** Low. This is a staff operational ping, not customer comms. Acceptable, but note: there is
  **no audit trail** of these alerts beyond app logs.

### GAP-2 (intentional, separate table): Recruitment candidate SMS — not in `messages`
- **Files:** `src/lib/recruitment/communications.ts:590` (send) and `:697` (retry).
- **What:** SMS to job candidates (gated on `candidate.sms_consent`).
- **Why no `messages` row:** `createCustomerIfMissing: false` — candidates are not customers. The
  send is instead recorded in the `recruitment_communications` table (insert at
  `communications.ts:~575`, status updated after send). If the candidate happens to already exist as
  a customer by phone, `sendSMS` _would_ still log to `messages` (since a customerId resolves), so
  there can be partial double-tracking for candidate-who-is-also-customer.
- **Risk:** Low/by-design. Candidate comms live in their own subsystem.

### Conditional (not a gap, but worth flagging): `logging_failed` fail-closed states
`sendSMS` can send an SMS and then return `code: 'logging_failed'` / `logFailure: true` **without a
`messages` row** in these runtime conditions (`twilio.ts:599`, `:618`, `:632`):
- the `messages` insert itself errors, or
- no customer could be resolved at log time (only reachable if `createCustomerIfMissing: false`).

These are degraded-mode outcomes, not call-site gaps — callers are written to treat them as fatal and
stop bulk loops. They are logged via `logger.error` ("SMS sent but failed to persist outbound message
log"). For customer-facing sends with default options, this only triggers under DB failure.

---

## Confidence

- "Single canonical send fn": **High** — `grep` for `messages.create` returns **zero** matches
  outside `src/lib/twilio.ts`; every send site imports `sendSMS` from `@/lib/twilio` (or a wrapper
  that does).
- "Auto-logged + customer-linked by default": **High** — verified in `twilio.ts` + `logging.ts`;
  `messages.customer_id` is non-nullable in the generated DB types.
- Non-`messages` channels (`recruitment_communications`, `sms_promo_context`, `idempotency_keys`)
  are tracking/dedup tables, not the customer comms history.
