# Discovery 04 — Comms Data Model & Customer Profile UI

**Date:** 2026-06-21
**Project:** the-anchor-management-tools (Supabase ref `tfcasgxopxegwrabvwat`, Postgres 15)
**Scope:** Document the data model for customer communications (SMS + email) and how the customer profile UI displays communication history. Identify gaps for building a unified communications timeline.

---

## (a) Column Inventory — Comms Tables

### `messages` (SMS — inbound + outbound)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| **customer_id** | uuid | **NO** | — (FK → customers.id) |
| **direction** | text | NO | — (`inbound` / `outbound`) |
| message_sid | text | NO | — |
| body | text | NO | — |
| status | text | NO | — |
| created_at | timestamptz | NO | utc now() |
| updated_at | timestamptz | NO | utc now() |
| twilio_message_sid | text | YES | — |
| error_code | text | YES | — |
| error_message | text | YES | — |
| price | numeric | YES | — |
| price_unit | text | YES | — |
| sent_at | timestamptz | YES | — |
| delivered_at | timestamptz | YES | — |
| failed_at | timestamptz | YES | — |
| twilio_status | text | YES | — |
| from_number | text | YES | — |
| to_number | text | YES | — |
| message_type | text | YES | `'sms'` |
| read_at | timestamptz | YES | — |
| segments | integer | YES | 1 |
| cost_usd | numeric | YES | — |
| event_booking_id | uuid | YES | FK → bookings.id |
| table_booking_id | uuid | YES | FK → table_bookings.id |
| private_booking_id | uuid | YES | FK → private_bookings.id |
| template_key | text | YES | — |

### `email_messages` (Email — outbound only, no `direction` column)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| **customer_id** | uuid | **YES** | — (FK → customers.id) |
| to_address | text | NO | — |
| from_address | text | YES | — |
| comm_type | text | YES | — |
| subject | text | YES | — |
| resend_message_id | text | YES | — |
| status | text | NO | `'queued'` |
| error | text | YES | — |
| metadata | jsonb | NO | `{}` |
| table_booking_id | uuid | YES | FK → table_bookings.id |
| event_booking_id | uuid | YES | FK → bookings.id |
| private_booking_id | uuid | YES | FK → private_bookings.id |
| parking_booking_id | uuid | YES | FK → parking_bookings.id |
| sent_at | timestamptz | YES | — |
| delivered_at | timestamptz | YES | — |
| delivery_delayed_at | timestamptz | YES | — |
| opened_at | timestamptz | YES | — |
| clicked_at | timestamptz | YES | — |
| bounced_at | timestamptz | YES | — |
| complained_at | timestamptz | YES | — |
| failed_at | timestamptz | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **Note:** No `body` column (email body is not stored), no `direction` (email is outbound-only). Provider is Resend (`resend_message_id`).

### `message_delivery_status` (Twilio webhook status log for SMS)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| **message_id** | uuid | NO | FK → messages.id |
| status | text | NO | — |
| error_code | text | YES | — |
| error_message | text | YES | — |
| created_at | timestamptz | NO | now() |
| raw_webhook_data | jsonb | YES | — |
| note | text | YES | — |

### `recruitment_communications` (recruitment channel — NOT linked to customers)

Linked to `recruitment_candidates` / `recruitment_applications`, NOT to `customers`. Key cols: `candidate_id` (NO), `application_id`, `type`, `channel` (sms/email), `subject`, `final_body`, `delivery_status`, `provider`, `provider_message_id`, `sent_at`. **Out of scope** for a customer-facing timeline.

### Other comms-named tables (templates / queues / per-domain logs — not customer history)

- `message_templates`, `message_template_history`, `event_message_templates`, `table_booking_sms_templates`, `recruitment_email_templates`, `invoice_email_templates` — template definitions.
- `private_booking_sms_queue` — SMS approval queue (FK → private_bookings, no customer_id; has `customer_phone`/`customer_name` text).
- `sms_promo_context` — promo reply-window tracking (FK → customers, events, messages).
- `email_suppressions` — suppression list (keyed by email text, no customer_id).
- `invoice_emails`, `invoice_email_logs`, `rota_email_log` — per-domain email send logs (no customer_id; keyed by invoice/quote/payment/rota entity).
- `event_communal_seat_allocations` — matched the `comm` ILIKE but is seating, not comms (ignore).

---

## (b) FK Linkage Map to `customers`

Tables with a direct FK to `customers.id`:

| Table | FK column | Nullable | Notes |
|---|---|---|---|
| `messages` | customer_id | **NO** | every SMS row has a customer |
| `email_messages` | customer_id | **YES** | email may be unlinked (e.g. one-off address) |
| `sms_promo_context` | customer_id | NO | promo tracking, not message content |

Tables NOT linked to customers (linked to other entities instead): `recruitment_communications` (candidate), `private_booking_sms_queue` (booking), `invoice_emails`/`invoice_email_logs` (invoice/quote), `rota_email_log` (rota entity), `email_suppressions` (email text), `message_delivery_status` (→ messages → customer, indirect).

**The only two tables holding customer-addressed message content are `messages` and `email_messages`.** Both carry the same set of booking-context FKs (event/table/private booking; email also has parking).

---

## (c) Existing Union View — `customer_communications` (UNUSED)

A DB view **already exists** that unions outbound SMS and all email into one shape:

```sql
SELECT m.id, m.customer_id, 'sms' AS channel, m.template_key AS comm_type, m.status,
       NULL AS subject, m.body, m.from_number AS from_address, m.to_number AS to_address,
       m.sent_at, m.delivered_at, m.failed_at, m.created_at, m.updated_at
FROM messages m
WHERE m.direction = 'outbound'          -- ⚠️ inbound SMS EXCLUDED
UNION ALL
SELECT em.id, em.customer_id, 'email' AS channel, em.comm_type, em.status,
       em.subject, NULL AS body, em.from_address, em.to_address,
       em.sent_at, em.delivered_at,
       COALESCE(em.failed_at, em.bounced_at, em.complained_at) AS failed_at,
       em.created_at, em.updated_at
FROM email_messages em;
```

Unified columns: `id, customer_id, channel, comm_type, status, subject, body, from_address, to_address, sent_at, delivered_at, failed_at, created_at, updated_at`.

**Caveats:**
- Inbound SMS is filtered out (`direction = 'outbound'`), so this view is NOT a true two-way conversation feed.
- Email has no `body` (NULL) and SMS has no `subject` (NULL).
- **This view is referenced nowhere in `src/`** — completely unused by the application.

Related view `customer_messaging_health` aggregates SMS delivery stats per customer (delivery_rate, total_cost_usd, last_message_date) from `messages` only — no email. `message_templates_with_timing` is template metadata.

---

## (d) What the Customer Profile Currently Displays

**Page:** `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/customers/[id]/page.tsx` — single `'use client'` component (~53 KB), no separate `*Client.tsx`.

- **SMS shown? YES.** `loadMessages()` (page.tsx:257-285) calls server action `getCustomerMessages(customerId)` (page.tsx:262).
  - Action chain: `customerSmsActions.getCustomerMessages` (`src/app/actions/customerSmsActions.ts:86`) → `MessageService.getCustomerMessages` (`src/services/messages.ts:213-220`) which runs `from('messages').select('*').eq('customer_id', customerId).order('created_at')`.
  - Rendered by `MessageThread` component (`src/components/features/messages/MessageThread.tsx`), instantiated at page.tsx:1017.
  - Inbound vs outbound split by `message.direction === 'inbound'` (MessageThread.tsx:138) — so **SMS in + out are unified in one thread**.
  - Also calls `markMessagesAsRead(customerId)` and `getCustomerSmsStats`.
- **Email shown? NO.** The profile page never references `email_messages` or the `customer_communications` view.
- **Unified SMS+email timeline? NO.** Timeline is SMS-only.

---

## (e) Other Comms Surfaces

- **Global messages inbox:** `src/app/(authenticated)/messages/` — `page.tsx`, `_components/MessagesClient.tsx`, plus `bulk/page.tsx` + `bulk/BulkMessagesClient.tsx`.
  - `MessagesClient.tsx` calls `getMessages()` (line 129) and `getConversationMessages(customerId)` (line 180) from `src/app/actions/messagesActions.ts`.
  - `getMessages` (messagesActions.ts:151), `getConversationMessages` (messagesActions.ts:348), `getUnreadMessageCount` (messagesActions.ts:324), `getUnreadMessageCounts` (`src/app/actions/messageActions.ts:9`) — **all query `messages` only**. Inbound/outbound split via `direction`. **No email.**
- **Email is written but never read for display:**
  - `recordEmailMessage()` inserts rows — `src/lib/email/logging.ts:66/99` (cast `as any`).
  - Resend delivery webhook updates status — `src/app/api/webhooks/resend/route.ts:236`.
  - Event-ticket dedup read (not customer-facing) — `src/lib/email/event-ticket-emails.ts:145`.
- **Invoice email logs:** `getInvoiceEmailLogs()` (`src/app/actions/email.ts:137`) reads `invoice_email_logs` (separate per-invoice surface, not `email_messages`).

---

## TypeScript Types

**Hand-written** (`src/types/database.ts`):
- `interface Message` — line 655 (incl. `direction: 'inbound' | 'outbound'`, `body`, `status`, `read_at`). Used by both SMS UIs. Already snake_case → no camelCase conversion step.
- `interface MessageDeliveryStatus` — line 681.
- **No `EmailMessage` interface, no `CustomerCommunication` interface.**

**Generated** (`src/types/database.generated.ts`):
- `messages` Row — line 5556.
- `message_delivery_status` Row — line 5404.
- **`email_messages` and `customer_communications` are NOT in the generated types** — that's why email inserts are cast `as any`. Generated types are stale w.r.t. email.

No `fromDb<T>()` helper used for these tables; `messages` rows are returned directly as the snake_case `Message` interface.

---

## (f) GAPS — Building a Unified Communications Timeline

1. **Profile shows SMS only; email is invisible.** `email_messages` is written (Resend) and status-tracked via webhook, but **no UI ever reads it**. A customer's email history is completely absent from the profile.

2. **A union view already exists but is unused.** `customer_communications` unions SMS+email into a common shape and is ready to query — but no action/service/page references it. Lowest-effort path to a unified feed is to build a `getCustomerCommunications(customerId)` action over this view.

3. **The union view excludes inbound SMS** (`WHERE direction = 'outbound'`). For a true two-way timeline the view must be revised to include inbound SMS (and email is outbound-only by nature). As-is it is an *outbound* activity log, not a conversation.

4. **Email has no stored body.** `email_messages` stores `subject`, status timestamps, and `metadata` jsonb — but no body. A timeline can show "Email: <subject> — delivered/opened/bounced" but cannot show the email content. Decide whether that's acceptable or whether body capture is needed.

5. **Channel asymmetry in columns.** SMS has `body`+`direction`+`read_at`+cost; email has `subject`+rich lifecycle (`opened_at`, `clicked_at`, `bounced_at`, `complained_at`) but no body/direction. A unified UI model must reconcile these (the existing view collapses to lowest common denominator and drops email open/click/bounce detail).

6. **`email_messages.customer_id` is nullable.** Some emails (one-off addresses) won't link to a customer and won't appear on any profile — expected, but note for completeness/coverage.

7. **Types are missing/stale.** No `EmailMessage` or `CustomerCommunication` TS interface; generated types omit `email_messages` (forcing `as any` casts). Any timeline work should add proper types and regenerate `database.generated.ts`.

8. **No cross-channel ordering/pagination today.** Each surface queries one table with simple ordering. A unified timeline needs merged chronological ordering (the view gives `created_at`/`sent_at` to sort on) plus pagination strategy across both channels.

### Recommended minimal path
Revise `customer_communications` to include inbound SMS (+ optionally surface email open/click/bounce in `comm_type`/extra cols), add `EmailMessage`/`CustomerCommunication` TS types, add a `getCustomerCommunications(customerId)` server action over the view, and render a channel-aware unified timeline component on the profile (extending or alongside `MessageThread`).
