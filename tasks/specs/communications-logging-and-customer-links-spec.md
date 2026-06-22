# Spec — Complete Customer Communications Logging & Clickable Customer Names

**Status:** v3 — corrected after adversarial repo/doc review. Ready for implementation planning only with PR0/PR1 guardrails below.
**Author:** Discovery + spec (Claude)
**Date:** 2026-06-22
**Related discovery reports:** `tasks/discovery/01-outbound-sms.md`, `02-outbound-email.md`, `03-inbound-comms.md`, `04-data-model-and-profile-ui.md`, `05-customer-name-clickability.md`, `06-email-transport-reconciliation.md`, `07-channel-completeness-audit.md`, `08-channel-routing-and-whatsapp.md`

> **v3 changelog (adversarial review fixes):** fixed the holding-queue design so unmatched SMS/WhatsApp do not require nullable `messages.customer_id`; corrected Resend inbound body/attachment handling to use the Receiving/Attachments APIs after the metadata webhook; split email body storage into text/html with sanitised rendering; made email logging fail-closed for customer-facing sends; clarified immediate vs asynchronous delivery fallback; moved GDPR export/erasure/retention before PII body capture goes live; added email unread/reply fields; corrected invoice/quote context to UUIDs and marked OJ/vendor emails as not customer-profile comms unless explicitly customer-linked; split WhatsApp service-window state from explicit opt-in; added `webhook_logs` to retention/erasure scope.

---

## 1. Goal & scope

Three outcomes:

1. **Every customer communication in and out of the application is logged** — all SMS, email, and WhatsApp, inbound and outbound, automatic / manual / bulk / cron — linked to a `customer_id` when confidently matched, with unmatched inbound held separately, **full content stored after PR0 privacy gates**, and linked rows visible in one unified place on the customer's profile.
2. **Add WhatsApp as a customer channel and route customer messages by priority — email first, WhatsApp second, SMS last** — sending on the highest-priority channel the customer is eligible for, with immediate fallback on ineligibility or send-time failure; asynchronous delivery failure fallback only where explicitly enabled per notification type (§4.1a).
3. **Every place a customer's name appears in the UI is a clickable link** to that customer's profile (`/customers/[id]`).

### In scope
- Closing all logging gaps so 100% of customer-addressed SMS, email, and WhatsApp is recorded, linked where confidently matched, or held in `unmatched_communications` when not.
- **Inbound email capture via Resend** (the `email.received` branch — not Microsoft Graph).
- **WhatsApp send + inbound capture via Twilio** (`whatsapp:`-prefixed), stored in `messages` as `message_type:'whatsapp'`.
- **A unified channel-routing cascade (`email → whatsapp → sms`)** in the existing dispatcher, applied to all customer messages by migrating hard-coded send sites onto it.
- Storing **full message content after PR0 privacy gates** (SMS/WhatsApp body + email subject + email `body_text`/`body_html`, inbound and outbound).
- A **unified two-way communications timeline** on the customer profile (SMS + email + WhatsApp + inbound feedback + engagement signals).
- **Widening the global `/messages` inbox to include email** (and WhatsApp, which already shares the `messages` table).
- A single shared **`CustomerLink`** component rolled out across all customer-name render sites.

### Out of scope (explicitly)
- **Microsoft Graph inbound capture.** Per decision, we do not build Graph mail subscriptions. Inbound email is captured only via Resend (see §6 for the transport dependency this creates).
- **Meta WhatsApp Cloud API** — WhatsApp is delivered via the existing Twilio account, not a direct Meta integration.
- Recruitment candidate communications (`recruitment_communications`, keyed to candidates not customers).
- Internal/staff/accountant emails (rota, payroll, manager alerts) — not customer-profile communications; do not join them into `customer_communications`.
- Channels that genuinely do not exist or are dormant: voice, web-push, customer in-app notifications, loyalty comms (see §3E). *(WhatsApp moves from this list into scope.)*

---

## 2. Current state (what already works — do not rebuild)

| Channel / direction | State today | Where |
|---|---|---|
| **Outbound SMS** | ✅ **Solved.** Single canonical `sendSMS` (`src/lib/twilio.ts:208`) auto-logs every send to `messages` via `recordOutboundSmsMessage` (`src/lib/sms/logging.ts:33`) with `customer_id` + `direction:'outbound'`. **Fails closed** — `messages.customer_id` is NOT NULL. ~35 send sites, all routed through it. | 01 |
| **Inbound SMS** | ✅ **Logged.** `POST /api/webhooks/twilio` → `handleInboundSMS` writes `messages` row `direction:'inbound'`, matched via `generatePhoneVariants`. Signature-verified, idempotent by SID. | 03 |
| **SMS delivery status** | ✅ **Tracked.** `handleStatusUpdate` updates `messages` + append-only `message_delivery_status`; auto-deactivates after >3 failures. | 03 |
| **Outbound email** | ⚠️ **Partial.** Dual-transport (see §2.1). The logged path `sendEmail()` writes `email_messages` via `recordEmailMessage`, but customer linkage only when the caller passes `customerId`; invoice/quote paths bypass logging entirely. | 02, 06 |
| **Inbound email** | ❌ **Not captured.** Resend webhook handles outbound lifecycle only; no `email.received` branch. | 03, 06 |
| **Unified profile view** | ❌ Profile shows **SMS only** (`MessageThread`). `email_messages`, calendar invites, feedback, review-clicks all in DB but invisible. Union view `customer_communications` exists but is unused and excludes inbound SMS. | 04, 07 |
| **Channel routing** | ⚠️ **Dispatcher exists but barely used.** `notifyCustomer()` (`src/lib/notifications/notify.ts`) + `selectChannel()` (`src/lib/notifications/channel.ts`) already implement an `email_first` cascade (email, fall back to SMS on ineligibility/failure). Wired into **one** flow only (table-booking-created, `bookings.ts:862`). ~28 direct `sendSMS` + ~25 direct `sendEmail` sites bypass it with hard-coded channels. | 08 |
| **WhatsApp** | ❌ **No send capability.** No WhatsApp sender/env. The only "WhatsApp" in code is a private-booking Booking-Source dropdown value + employee-onboarding checklist booleans — not a comms channel. `messages.message_type` (default `'sms'`) already exists as a channel discriminator. | 08 |
| **Clickable names** | ❌ No shared component. ~3 files link the name; ~10+ render plain text. | 05 |

### 2.1 Email transport reality (critical context)

The app has a **dual-transport email layer**; both packages are installed and live:

- `sendEmail()` (`src/lib/email/emailService.ts`) is **provider-agnostic**: `getEmailProvider()` reads **`EMAIL_PROVIDER`** (`graph` | `resend`). It logs to `email_messages` via `recordEmailMessage()` regardless of provider.
- **Today `EMAIL_PROVIDER=graph`** (`.env.example:54`, comment: *"keep graph until auth.orangejelly.co.uk is verified in Resend"*). The strategic direction is to **flip to Resend** once the sending domain is verified.
- The **Resend webhook** (`src/app/api/webhooks/resend/route.ts`, Svix-verified) already handles outbound lifecycle: `email.sent / delivered / delivery_delayed / opened / clicked / bounced / complained / failed / suppressed`, matched by `resend_message_id`. **No inbound branch.**
- **Invoice & quote emails bypass the switch** — hardwired to Microsoft Graph in `src/lib/microsoft-graph.ts` (`sendInvoiceEmail:79`, `sendQuoteEmail:228`, called from `email.ts:738`) and are **not logged**.

**Consequence for inbound (your decision #2):** Resend only receives a reply if the original outbound was *sent* via Resend (reply-to routes to the Resend inbound address). So **inbound email capture is gated on completing the Graph→Resend outbound cutover.** Until then, replies to Graph-sent mail return to Outlook and are not captured — which is acceptable per the decision "don't worry about Microsoft Graph emails." This makes the **Resend cutover a prerequisite workstream** (§5.0).

---

## 3. Master gap list

### 3A. Outbound email — logging/linkage gaps
| # | Gap | Location | Severity |
|---|---|---|---|
| A1 | **Invoice emails bypass logging entirely** (no `email_messages` row) | `microsoft-graph.ts:sendInvoiceEmail`; callers `invoices.ts`, `email.ts`, 4 crons | High |
| A2 | **Quote emails bypass logging** | `microsoft-graph.ts:sendQuoteEmail:228`, `email.ts:738` | High |
| A3 | **Private-booking lifecycle emails (8)** logged but never pass `customerId` → unlinked | `private-booking-emails.ts` (8 senders: confirmation, deposit-received, balance-paid, calendar-invite, deposit-payment-link, balance-reminder, deposit-refund, deposit-refund-with-deductions) | High |
| A5 | **Invoice/quote/receipt/remittance emails log to a parallel `invoice_email_logs` table**, not `email_messages` — invisible to the unified timeline (also `email.ts:288`, `oj-projects/client-statement.ts:383`) | `invoices.ts:291,313,353` | Medium |
| A4 | **Customer refund confirmation** logged but no `customerId` | `refund-notifications.ts:38` | Medium |

### 3B. Inbound — capture gaps
| # | Gap | Location | Severity |
|---|---|---|---|
| B0 | **Outbound not on Resend yet** → replies can't route to Resend inbound | `EMAIL_PROVIDER=graph` | Prereq |
| B1 | **No inbound email capture** (`email.received`) | `webhooks/resend/route.ts` | High |
| B2 | **Reply-to-book numeric SMS replies short-circuit** and write no inbound `messages` row | `webhooks/twilio/route.ts` | Medium |
| B3 | **Unmatched inbound numbers** auto-create `"Unknown (number)"` customers (`sms_opt_in:true`), no dedup | `webhooks/twilio/route.ts` | Medium |
| B4 | **Bulk import** matches by 3 exact columns, diverging from webhook's `generatePhoneVariants` | import path | Low |
| B5 | **Inbound private-booking feedback** form persisted to `feedback` table but not on profile timeline | `g/[token]/private-feedback/`, `lib/private-bookings/feedback.ts:378` | Low/Med |
| B6 | **Web enquiries** (table/private-booking forms) never recorded as inbound comms | form handlers | Low |

### 3C. Data model gaps (block a true unified timeline)
| # | Gap | Detail |
|---|---|---|
| C1 | `email_messages` has **no `direction`** column (outbound-only) | needed for inbound email |
| C2 | `email_messages` has **no body** column | needed to store/show full content (decision: store everything) |
| C3 | `email_messages` lacks `received_at` and the status check constraint needs widening for inbound | inbound support |
| C4 | Union view `customer_communications` filters `direction='outbound'` → drops inbound SMS | needs revision |
| C5 | **No `EmailMessage`/`CustomerCommunication` TS types**; `email_messages` absent from generated types | type safety |

### 3D. UI gaps
| # | Gap | Detail |
|---|---|---|
| D1 | Profile shows **SMS only**; email/WhatsApp/calendar/feedback/review-click invisible | `customers/[id]/page.tsx` → `MessageThread` |
| D2 | Global `/messages` inbox is **SMS-only** (decision: widen to email + WhatsApp) | `/messages` |
| D3 | No shared **`CustomerLink`**; ~10+ unlinked name render sites | 05 |

### 3E. Channels that DO NOT need work (completeness audit result)
From `07-channel-completeness-audit.md`:
- **Calendar invites (.ics)** — go through `sendEmail` already (`private-booking-emails.ts:267`), so they're logged as email rows; they just need to *surface* on the timeline (covered by D1). The .ics is an **attachment** — see §6.6.
- **Google review-click tracking** — request is SMS (already logged); the click is an engagement signal (`review_clicked_at`, `r/[token]/route.ts`) — surface as a timeline event/badge.
- **Parking notifications** — the customer SMS body **is** captured transitively (it routes through `sendSMS` with `customerId`). The dedicated `parking_booking_notifications` log additionally records "skipped" (no mobile, `parking-notifications/route.ts:838`) and pre-send "failed" rows (`payments.ts:208`) that never reach `messages`; those parking-specific outcomes are **intentionally not surfaced** on the timeline (operational log only) — see §6.4.
- **Voice calls** — none. **Web push** — dead stub in `public/sw.js:103`, no server send/VAPID/subscriptions. **Customer in-app notifications** — don't exist (customers never log in). **Loyalty comms** — `loyalty_notifications` tables exist but dormant, no producer.
- **WhatsApp** — *now in scope* (§3F / Workstream F); was previously dormant.

> **Definitive statement:** The customer communication channels in this app are **SMS, email, WhatsApp (to be added), calendar invites (an email attachment), inbound private-booking feedback, and review-link click tracking**. All other conceivable channels (voice, web-push, in-app, loyalty) are absent or dormant. The audit is complete.

### 3F. Channel routing & WhatsApp gaps
| # | Gap | Location | Severity |
|---|---|---|---|
| F1 | **No WhatsApp send capability** — no `sendWhatsApp`, no WhatsApp sender/env | `twilio.ts` / env | High |
| F2 | **No WhatsApp opt-in field** on `customers` (required for business-initiated WhatsApp); **no marketing-vs-transactional split** (`marketing_sms_opt_in` exists but no WhatsApp equivalent) | `customers` schema | High |
| F3 | **Cascade is only `email`/`sms`** — `selectChannel()` has no `whatsapp` channel or 3-tier ordering | `channel.ts` | High |
| F4 | **Routing applies to one flow only** — ~53 hard-coded `sendSMS`/`sendEmail` sites bypass `notifyCustomer` | across actions/crons | High |
| F5 | **Inbound webhook treats `From` as plain phone**, tags `message_type:'sms'` — no `whatsapp:` prefix handling, no STOP handling for matched WhatsApp customers, and no separate `last_whatsapp_inbound_at` service-window state | `webhooks/twilio/route.ts` | Medium |
| F6 | **WhatsApp templates** — business-initiated WhatsApp outside the 24h care window needs pre-approved templates (maps onto existing `template_key`) | template management | Medium |
| F7 | **Status webhook is SMS-shaped** — `applySmsDeliveryOutcome` (`route.ts:231-309`) increments `sms_delivery_failures` and auto-deactivates `sms_status`/`sms_opt_in` for *any* failure; a failed WhatsApp would wrongly kill the customer's SMS channel. `read`→`received` mapping (`sms-status.ts:43`) is also wrong for outbound WhatsApp | `webhooks/twilio/route.ts:231,1006`, `sms-status.ts:43` | High |
| F8 | **SMS safety/rate-limit query has NO `message_type` filter** — `evaluateSmsSafetyLimits` (`src/lib/sms/safety.ts:337-352`) counts all outbound rows; WhatsApp would contaminate SMS caps. (Distinct from the `message_type='sms'` filter at `src/services/sms-queue.ts:889`.) Also SMS suspension kill-switches (`src/lib/sms/suspension.ts`) + quiet-hours (`src/lib/sms/quiet-hours.ts`) applicability to WhatsApp undefined | `safety.ts`, `suspension.ts`, `quiet-hours.ts` | Medium |

---

## 4. Target architecture

### 4.1 Unified communications model — target design
**Keep two physical tables and expose a single revised SQL view `customer_communications` as the unified read model.** `messages` holds **both SMS and WhatsApp** (discriminated by the existing `message_type` column), `email_messages` holds email. Do not merge tables — write paths are proven and fail-closed for SMS; lifecycle columns differ materially. The view gives one chronological, channel-agnostic read shape without touching write paths. **WhatsApp needs no new storage table** — it stores in `messages` as `message_type:'whatsapp'`.

**Revised `customer_communications` view — target shape for linked communications only:**
```
id (COMPOSITE TEXT, prefixed: 'sms:'||messages.id / 'email:'||email_messages.id / 'feedback:'||feedback.id)
customer_id
channel            -- 'sms' | 'whatsapp' | 'email' | 'feedback'  (SMS+WhatsApp from messages.message_type)
direction          -- 'inbound' | 'outbound'
status             -- normalised: queued|sent|delivered|failed|received|opened|bounced|read|...
subject            -- email only
body_text          -- SMS/WhatsApp body / email plain text / feedback text
body_html          -- email HTML only; UI must render sanitised HTML or plain text fallback
from_address / to_address
created_at         -- canonical sort timestamp
sent_at/delivered_at/failed_at/read_at/opened_at/clicked_at/bounced_at
staff_read_at/replied_at  -- inbox state for inbound email/SMS/WhatsApp
delivery_history   -- joined from message_delivery_status (SMS/WhatsApp): surfaces regressions (e.g. late 'failed' after 'delivered') the messages row doesn't reflect
has_attachments    -- email/WhatsApp: whether the row carries attachment metadata (§6.6)
engagement         -- e.g. review_clicked_at surfaced as a signal
context: { event_id, table_booking_id, private_booking_id, parking_booking_id, invoice_id, quote_id }
twilio_message_sid / resend_message_id   -- provider ids (note: there is NO provider_message_id column; email uses resend_message_id)
cost / segments    -- SMS/WhatsApp only
```
Changes vs current view: remove the `direction='outbound'` filter (include inbound SMS); surface `messages.message_type` as `channel` so WhatsApp separates from SMS; add inbound email once `direction` exists; add the feedback channel (LEFT JOIN to derive `customer_id`, see §6.4); join `message_delivery_status` for `delivery_history`; expose engagement signals.

> **`id` is now a composite string, not a uuid.** The current view exposes a raw `uuid`. Because the target unions three tables, `CustomerCommunication.id` becomes `string` (`'<channel>:<uuid>'`). The DROP+CREATE is safe (view-freeze handled by `DROP VIEW IF EXISTS`), but every consumer must treat `id` as opaque text, and any per-row mutation **must parse the `channel:uuid` prefix to recover the source table + real row id** before updating. Unmatched inbound rows live in a separate holding table (§4.2/§6.3), not this linked view.

### 4.1a Channel-routing model (`email → whatsapp → sms`)
Routing lives in the **existing dispatcher**, extended — do not build a parallel one:
- `src/lib/notifications/channel.ts` — add `'whatsapp'` to `NotificationChannel`; add eligibility (customer has a WhatsApp opt-in + a usable `mobile_e164`); define the priority ordering **email → whatsapp → sms**; keep the existing eligibility checks (email_status/deactivated, sms_opt_in/sms_status).
- `src/lib/notifications/notify.ts` — add a `whatsapp` send branch (calls `sendWhatsApp`); keep break-on-success + fall-through to the next eligible channel on ineligibility or **send-time** failure.
- **Semantics:** pick the highest-priority eligible channel. If the low-level send fails before provider acceptance, try the next eligible channel immediately. If the provider later reports a terminal failure (Twilio `failed`/`undelivered`, Resend `bounced`/`failed`/`suppressed`), do **not** blindly send a duplicate on another channel. Instead, record it and only trigger delayed fallback when that notification type explicitly opts in.
- **Durable attempts:** add `notification_deliveries` / `notification_attempts` (names can be finalised in PR1) to store one logical notification id, `template_key`, policy, category, selected channel, every attempt, provider ids, terminal status, and whether delayed fallback is allowed. Webhooks update attempts by provider id. This is required for honest "fallback happened" UI and for any delayed fallback after async failure.
- **Per-type overrides:** allow a notification type to pin/skip channels (e.g. a time-critical reminder may prefer SMS/WhatsApp over email). Policy stays data-driven like the current `email_first|email_only|sms_only|both`, extended with whatsapp-aware policies.
- **Universal adoption:** migrate the ~53 hard-coded `sendSMS`/`sendEmail` sites onto `notifyCustomer` so the cascade actually governs all customer messages (Workstream F4). `sendSMS`/`sendEmail`/`sendWhatsApp` remain the low-level transports the dispatcher calls.

### 4.2 Schema changes
On `email_messages` (additive migration):
- **Add `direction text NOT NULL DEFAULT 'outbound'`** + check `in ('inbound','outbound')`; backfill existing → `'outbound'` (C1).
- **Add `body_text text NULL` and `body_html text NULL`** to store full email content — **inbound and outbound** (C2). UI renders text by default and only renders sanitised HTML. Do not use one ambiguous `body` column for email.
- **Add `received_at timestamptz NULL`, `staff_read_at timestamptz NULL`, and `replied_at timestamptz NULL`**; widen the `status` check constraint to allow `'received'` and add inbox unread/reply support for inbound email (C3).
- **Add `invoice_id uuid NULL REFERENCES public.invoices(id) ON DELETE SET NULL` and `quote_id uuid NULL REFERENCES public.quotes(id) ON DELETE SET NULL`** only for invoice/quote emails that are truly customer-linked. OJ vendor/client billing emails are not customer-profile communications unless a real `customers.id` is present; otherwise they remain internal/vendor comms and must not appear in `customer_communications`.
- **Add `has_attachments boolean NOT NULL DEFAULT false` + `attachments jsonb NULL`** for attachment metadata (filenames/content-types/sizes, NOT binaries) — see §6.6.
- **Inbound idempotency reuses the existing `resend_message_id`** (unique partial index already exists, migration `20260703000000:34/67`). **There is no `provider_message_id` column** — do not invent one; use `resend_message_id` everywhere. Store inbound `in_reply_to`/`references` threading headers in the existing **`metadata` jsonb** (`metadata.in_reply_to`, `metadata.references`) — no new column.
- Keep `customer_id` nullable at column level (system emails legitimately have none) but **enforce linkage in code** for customer-facing senders (§5).

On `customers` (additive migration, for WhatsApp routing — F2):
- **Add `whatsapp_opt_in boolean NOT NULL DEFAULT false`**, **`whatsapp_status text`**, `whatsapp_opt_in_at timestamptz`, `whatsapp_opted_out_at timestamptz`, `whatsapp_delivery_failures int NOT NULL DEFAULT 0` (mirroring the SMS columns so the status webhook has WhatsApp-specific counters to write — F7). A customer is WhatsApp-eligible only when opted in and holding a usable `mobile_e164`.
- **Add `marketing_whatsapp_opt_in boolean NOT NULL DEFAULT false`** to mirror the existing `marketing_sms_opt_in` (see consent model §4.2a). No `preferred_channel` column — routing is priority-ordered by eligibility.
- **Add `last_whatsapp_inbound_at timestamptz NULL`**. This tracks the 24-hour customer-service window and is **not consent**. Do not set `whatsapp_opt_in=true` just because the customer sent one inbound WhatsApp.

On `messages`: **no column add for WhatsApp** — `message_type` (default `'sms'`) already discriminates; WhatsApp rows use `message_type:'whatsapp'`. **Existing-code notes:** (1) `messages` has **no `received_at` column** — the WhatsApp 24h care window uses the customer's `last_whatsapp_inbound_at` plus inbound row `created_at`, not a new `messages.received_at`. (2) `messages` has **no `metadata` column** — `recordOutboundSmsMessage`'s metadata write already falls back to a stripped payload; when generalising to `recordOutboundMessage`, either add `messages.metadata jsonb` or drop the metadata write and rely on the existing `*_booking_id`/`template_key` columns. (3) `messages.customer_id` is currently **NOT NULL** and SMS fail-closed behaviour depends on that. Do not make it nullable just to support unmatched inbound unless PR1 explicitly chooses that tradeoff.

New holding table for unmatched inbound:
- **Create `unmatched_communications`** for inbound SMS, WhatsApp, and email that cannot be confidently linked. Required columns: `id`, `channel`, `direction='inbound'`, `twilio_message_sid`, `resend_message_id`, `from_address`, `to_address`, `subject`, `body_text`, `body_html`, `raw_payload jsonb`, `attachments jsonb`, `received_at`, `candidate_customer_ids uuid[]`, `status` (`unmatched|linked|ignored|deleted`), `linked_customer_id`, `linked_message_id`, `linked_email_message_id`, `resolved_by`, `resolved_at`, `resolution_note`.
- Add unique indexes on `(channel, twilio_message_sid)` and `(channel, resend_message_id)` where not null for idempotency. Link/merge copies the row into `messages` or `email_messages` with a real `customer_id`, then marks the holding row resolved. This preserves `messages.customer_id NOT NULL`.

New routing audit tables:
- **Create `notification_deliveries` and `notification_attempts`** before delayed fallback work. They are the source of truth for one logical notification, selected policy, per-channel attempts, provider ids, final outcome, and delayed fallback eligibility.

Indexes: `email_messages (customer_id, created_at desc)`, confirm/add `messages (customer_id, created_at desc)`.

Types: add `EmailMessage`, `MessageRecord`, unified `CustomerCommunication` (with `id: string` composite) to `src/types/`; add `'whatsapp'` to the channel/`message_type` union; regenerate Supabase types so `email_messages` + new `customers` columns are present (removes `as any`) (C5).

### 4.2a Consent model — marketing vs transactional
The dispatcher already models `NotificationCategory = 'transactional' | 'marketing'` (`channel.ts:4`), and `customers` already has **both** `sms_opt_in` (transactional) and `marketing_sms_opt_in` (marketing); STOP clears the marketing flag too. WhatsApp must mirror this split:
- `whatsapp_opt_in` = transactional eligibility; `marketing_whatsapp_opt_in` = marketing eligibility.
- `last_whatsapp_inbound_at` = service-window state only. It permits freeform replies during the 24-hour window but does not prove opt-in for future business-initiated notifications.
- **Eligibility in `selectChannel` is category-aware:** a `marketing` send (bulk tools, event-marketing SMS) may only use a channel whose **marketing** opt-in is set; a `transactional` send uses the transactional opt-in. This prevents migrated bulk/marketing flows (Workstream F4) from reaching customers who only consented transactionally — a WhatsApp-ban risk. Email marketing continues to honour `marketing_email_opt_in`.

### 4.3 Read service
New `CommunicationsService.getCustomerCommunications(customerId, { channel?, direction?, limit, before })` querying the revised view; reused by the profile timeline and the widened global inbox.

---

## 5. Workstream A — Outbound email: one logged path

### 5.0 Prerequisite — complete the Graph→Resend outbound cutover
Because inbound replies must route through Resend (§2.1), customer-facing outbound email needs to be **sent via Resend**. Steps:
- Verify the sending domain in Resend; set **`EMAIL_PROVIDER=resend`**.
- Configure **Resend inbound** (MX / inbound domain + an inbound route to the webhook) so replies are delivered to the `email.received` handler.
- Validate deliverability parity (SPF/DKIM/DMARC) before flipping in production.
- This is an **infra + config task with an external dependency**; it gates B0/B1. Track explicitly.

### 5.1 Close logging/linkage gaps
**Principle:** exactly one customer-email send path; customer-facing email must log + link or report failure. Add `requireLog?: boolean` (or equivalent) to `sendEmail`/`recordEmailOutcome`: when `requireLog` is true and `recordEmailMessage` returns null, the send result is treated as failed for application purposes and the caller surfaces the logging failure. Route customer emails through `sendEmail(options)` and thread `customerId` + backed context columns where applicable.
- **A1 invoice / A2 quote:** first classify these correctly. The current OJ invoice/quote paths are vendor/client billing emails keyed to `invoices.vendor_id` / `quotes.vendor_id`, not `customers.id`; they should move off direct Graph for provider consistency and delivery logging, but **must not appear in customer profiles unless a real `customerId` exists**. If a customer-linked invoice/quote path exists or is added later, route it through `sendEmail({ requireLog:true, customerId, invoiceId/quoteId })`.
- **A3 private-booking emails (8):** thread `customerId` (nullable for walk-ins) + `private_booking_id` context through every `private-booking-emails.ts` sender — the 8 are confirmation, deposit-received, balance-paid, calendar-invite, deposit-payment-link, balance-reminder, deposit-refund, deposit-refund-with-deductions.
- **A4 refund confirmation:** pass `customerId` (`refund-notifications.ts:38`).
- **A5 invoice/receipt/remittance parallel log:** these currently write to **`invoice_email_logs`** (`invoices.ts:313,353`; `email.ts:288`; `oj-projects/client-statement.ts:383`). Do **not** remove that table until `email_messages` carries the same audit/idempotency fields those flows rely on (`payment_id`, `sent_by`, failed-send rows, receipt/remittance document kind). If kept, it remains invoice-delivery audit only and is **not** joined into `customer_communications` unless the email row has a real `customer_id`.

**Models to copy (already correct):** `event-ticket-emails.ts` senders, the table-review cron, `notify.ts` dispatcher — all log AND link.

---

## 6. Workstream B — Inbound capture

### 6.1 Inbound email via Resend (B1)
Add an **`email.received`** (Resend inbound parse) branch to `src/app/api/webhooks/resend/route.ts`:
- Svix-verify (same as existing branches); **idempotent by `resend_message_id`** (reuse the existing unique partial index — there is no `provider_message_id` column).
- Resend's webhook event contains metadata only. After receiving `email.received`, call the Resend Receiving API with `event.data.email_id` to fetch `html`, `text`, and headers; call the Attachments API to retrieve attachment metadata/download URLs when attachments are present. Do not assume body or binary attachment content is in the webhook payload.
- Parse the `from` mailbox (handle `"Name <email@example.com>"`) and match against `customers.email` case-insensitively. Because `customers.email` is intended unique, multiple matches should be treated as data corruption and routed to holding with candidate ids, not guessed.
- If matched: write `email_messages` row with `direction:'inbound'`, `from_address`, `to_address`, `subject`, `body_text`, `body_html`, `received_at`, `resend_message_id`, `customer_id`, threading headers into `metadata` jsonb, attachment metadata into `attachments` (§6.6).
- If unmatched or ambiguous: write `unmatched_communications`, not `email_messages`, then surface in the holding queue (§6.3).
- **Depends on §5.0** (Resend cutover + inbound route configured).

### 6.2 Inbound SMS + WhatsApp gaps
- **B2 (reply-to-book):** resolve the sender to a customer first. If matched, write the inbound `messages` row *before* short-circuiting — for **all `handled:true` paths**, including the early-return responses (sold-out / too-many-seats / already-booked) at `route.ts:528-534`, not just successful bookings. The **outbound auto-reply** sent there (`sendSMS(normalizedFromNumber, replyResult.response, …)`) currently uses `createCustomerIfMissing:false`, so pass the resolved `customerId` so the auto-reply is logged AND linked. If no customer is matched, write `unmatched_communications` and do not create `"Unknown"` automatically.
- **B4:** unify customer matching on `generatePhoneVariants` across bulk import and the live webhook (extract one shared helper).
- **F5 (inbound WhatsApp) — explicit ordering:** the same Twilio webhook receives inbound WhatsApp with a `whatsapp:`-prefixed `From`/`To`. Order of operations: **(1)** SID-dedup/idempotency across both `messages` and `unmatched_communications`; **(2)** strip the `whatsapp:` prefix and resolve `message_type:'whatsapp'`; **(3)** match customer by canonical phone; **(4)** if matched, write `messages` and update `customers.last_whatsapp_inbound_at`; if unmatched, write `unmatched_communications`; **(5)** run channel-specific STOP against `whatsapp_status`/`whatsapp_opted_out_at` only when a customer is matched (NOT the SMS fields). **`handleReplyToBook` runs for SMS only — skip it for WhatsApp-tagged inbound**. A WhatsApp numeric reply must never be routed into the SMS short-circuit.

### 6.3 Unmatched inbound handling (B3) — decision: holding queue
Replace auto-creation of `"Unknown (number)"`/unknown-email customers with `unmatched_communications`: store the inbound content in the holding table and surface it in an "Unmatched" view where staff can link it to an existing customer or create one deliberately. Add a merge/link action (audit-logged; new permission — §10B). Apply the **same pattern to inbound SMS, WhatsApp, and email**. On link, copy into `messages` or `email_messages` with the selected `customer_id` and mark the holding row `linked`. Do not weaken `messages.customer_id NOT NULL` unless a later design explicitly accepts the impact on fail-closed SMS logging.

**Cleanup of existing `"Unknown (number)"` rows — DESTRUCTIVE, approval-gated.** These are real `customers` rows with NOT NULL FK children (`messages.customer_id`, `sms_promo_context.customer_id`). Per workspace rules, this DELETE/merge requires: (1) **explicit human approval before running**; (2) **reassigning FK children** to the target customer before deletion (never orphan); (3) completing the **`supabase.md` function/trigger audit** on `customers` first. Ship it as a reviewed one-off script, not an automatic migration.

### 6.4 Inbound feedback & web enquiries (B5/B6)
- **B5 (feedback → timeline):** the `feedback` table has **no `customer_id`** (3-way CHECK over `event_booking_id` / `table_booking_id` / `private_booking_id`). To put it on a customer timeline, the view must **LEFT JOIN feedback → the relevant booking table → `customer_id`**; rows whose resolved `customer_id` is NULL (walk-ins / unlinked bookings) are **excluded** from the per-customer timeline. Surface as `channel:'feedback'`, `direction:'inbound'`. (Despite the "private-booking feedback" label, the table also supports event/table feedback — handle all three join paths.)
- **B6 (lower priority):** optionally record table/private-booking enquiry form submissions as inbound comms.
- **Parking notifications:** parking customer SMS is already captured transitively (via `sendSMS`+`customerId`); the `parking_booking_notifications` "skipped"/pre-send "failed" rows are operational-log only and intentionally NOT surfaced (§3E).

### 6.5 Inbound media / MMS (decision: capture)
Twilio inbound webhooks include `NumMedia` / `MediaUrlN` / `MediaContentTypeN`; WhatsApp customers commonly reply with **photos** (receipt/booking screenshots). The webhook handles none today (zero `NumMedia` references in `src/`). Storing only text would log empty-body rows, contradicting Goal 1 ("full content"). Capture media by downloading from the expiring Twilio media URL immediately, storing in Supabase Storage, and recording references in `messages.attachments` / `unmatched_communications.attachments` (mirrors §6.6), with the same retention/erasure treatment as bodies. Resend inbound attachments require the Resend Attachments API and expiring download URLs, not webhook body data.

### 6.6 Attachments (email + WhatsApp media)
`sendEmail` supports attachments and invoices/contracts/quotes/.ics are delivered as attachments (report 07). Store **attachment metadata** (filename, content-type, size, storage ref) in `email_messages.attachments` jsonb + `has_attachments`; add equivalent `messages.has_attachments` / `messages.attachments` for WhatsApp/MMS media. The timeline (§7) shows an **attachment indicator** and filename. Decision: store **metadata + a storage reference**, not the binary inline, to bound storage/PII; binaries (where already persisted, e.g. invoice PDFs) link to their existing location. Outbound attachment metadata should be captured at send time; inbound email attachments require Resend Attachments API retrieval.

---

## 7. Workstream C — Unified communications timeline (profile UI)

Replace/augment the SMS-only `MessageThread` on `customers/[id]` with a **unified, chronological, two-way timeline** backed by `CommunicationsService`.
- One feed mixing **SMS + WhatsApp + email + feedback**, **inbound + outbound**, newest-first.
- Per item: channel icon (SMS / WhatsApp / email), direction indicator **(icon + label, not colour-only)**, status badge (delivered/failed/opened/bounced/received/read/clicked), timestamp via `dateUtils` (London), subject (email), **full text/html body or SMS/WhatsApp content**, engagement signals (email open/click, review click), and context chips linking to the related event / table booking / invoice / private booking.
- Show which **channel a notification was routed to** and any immediate or delayed fallback that occurred, sourced from `notification_deliveries` / `notification_attempts`, so staff can see the cascade outcome.
- **Attachment indicator** + filename where the row carries attachments/media (§6.6).
- **Expandable delivery-status history** per item (from `delivery_history`), surfacing regressions (e.g. a late `failed` after `delivered`) that the `messages` row alone hides.
- Handle **loading / error / empty** states (`ui-patterns.md`).
- Keep the SMS composer; allow staff to pick channel where eligible (WhatsApp only within the 24h window or via template). An email composer is a later enhancement (not v1).
- Filters: channel (All/SMS/WhatsApp/Email/Feedback), direction (All/In/Out). Index-backed pagination for high-volume customers.

---

## 8. Workstream D — Global `/messages` inbox widened to email + WhatsApp (decision #5)

Extend the global inbox (today SMS-only) to a **multi-channel inbox** reading the revised view:
- Channel column/filter (SMS/WhatsApp/Email/Feedback) and direction filter.
- Conversation/thread grouping per customer across channels where practical.
- Unread/needs-reply indicators spanning email + SMS + WhatsApp. SMS/WhatsApp continue using `messages.read_at`; email uses new `email_messages.staff_read_at` and `email_messages.replied_at`.
- Reuse `CommunicationsService`; enforce permissions as in §10B (the `/messages` page has no server-side gate today — add one).

### 8.1 Search across communications
Once full bodies (SMS/WhatsApp/email) live in one place, staff need to *find* a message. The current inbox has no search. Add:
- **Full-text body/subject search** across the unified view (Postgres `tsvector`/FTS index on `messages.body` + `email_messages.subject||body`, or at minimum `ilike` with a trigram index), scoped by channel/direction/date-range, and a per-customer search on the profile timeline.
- If FTS is deferred, say so explicitly — but a multi-channel inbox storing full content without search is operationally weak, so it is **in scope**.

---

## 9. Workstream E — Clickable customer names

### 9.1 Shared component
Create **one** `CustomerLink`, exported from `@/ds`:
- Props: `customerId?: string | null`, `firstName`/`lastName` (or `name`), optional loyalty passthrough.
- Renders `<Link href={/customers/${customerId}}>` when `customerId` is present; falls back to plain text otherwise (walk-ins degrade gracefully).
- Wrap the existing display-only `CustomerName` (`src/components/features/customers/CustomerName.tsx`) so there's one source of truth; retire the ad-hoc `[first_name,last_name].join(' ')` duplication (15+ files) over time.

### 9.2 Rollout order
1. Standardise the 3 existing linked spots (customers list ×2, `settings/sms-failures`).
2. **Cheap wins (id already in payload):** table-booking detail/BOH/reports (`BohBookingsClient.tsx:893`, `ListView.tsx:92`, `BookingDetailClient.tsx`, `reports/page.tsx`); event-detail booking lists; messages conversation list (make the **name** the link, not just the "View profile" button); **bulk-messages recipient table** (`BulkMessagesClient.tsx:213` — the row id IS the customer id, in the `customerIds[]` payload).
3. **Needs query/payload change (id absent or only `guest_name`):** private-booking list cards + detail header (null-guard nullable `customer_id`); parking list + detail; dashboard recent-activity; events command-center payload; **table-booking FOH live components** (`FohBookingDetailModal`, `FohUnassignedBookings`, `TablesFOH`, `TablesBOH`, `TimelineView`) which carry only `guest_name`/`guestName`, no `customer_id` — these need a payload change or stay plain text. (Note: the `_components/Tables*` cluster may be unrouted/demo code — confirm before scoping.)

### 9.3 Guardrails
- Only link **customers**. Employees/applicants have names too — never wire those to `/customers/[id]`; guard mixed-type lists.
- The link is navigation only and must not be treated as a permission check. Keep database RLS for direct client reads and add page/action-level permission checks where the target page or server actions expose customer data.
- Goal #3 = "every render site": the acceptance check is against report 05 **plus** the additional FOH/BOH and bulk sites enumerated above (report 05 did not list them individually).

---

## 9A. Workstream F — WhatsApp channel + unified routing cascade

The single largest new capability. Built in layers so each is independently shippable.

### F.1 WhatsApp transport (F1, F7, F8)
- Add **`sendWhatsApp(...)`** in `src/lib/twilio.ts` alongside `sendSMS`, reusing the same Twilio client with `whatsapp:`-prefixed `From`/`To`. Log to `messages` with `message_type:'whatsapp'`, `customer_id`, `direction:'outbound'` — generalise `recordOutboundSmsMessage` → `recordOutboundMessage(channel)`, preserving the **fail-closed** linkage guarantee.
- Configure the **WhatsApp sender** (Twilio WhatsApp number / Messaging Service) and env (`TWILIO_WHATSAPP_FROM` or a WhatsApp-enabled `MESSAGING_SERVICE_SID`). Document in `.env.example`.
- **Status callbacks (F7) — must branch on `message_type`, this is the highest-risk integration point:**
  - `handleStatusUpdate` calls `applySmsDeliveryOutcome` (`route.ts:231-309,1006`) for *every* callback, which increments `sms_delivery_failures` and after >3 failures sets `sms_status='sms_deactivated'` + `sms_opt_in=false`. **A failed WhatsApp must NOT touch SMS state** — load the message's `message_type` and route WhatsApp failures to `whatsapp_delivery_failures`/`whatsapp_status` instead.
  - **`read` mapping:** `STATUS_MAP` (`sms-status.ts:43`) maps `read`→`'received'`, which is wrong for an *outbound* WhatsApp (it would look inbound). Add a distinct `read` app-status for outbound `message_type='whatsapp'`; keep inbound→`'received'`. **Do not write `messages.read_at` from the status webhook** — `read_at` is the staff-inbox unread marker, not a delivery receipt.
- **Safety/suspension inheritance (F8):**
  - **Add `.eq('message_type','sms')` to the three count queries in `evaluateSmsSafetyLimits` (`src/lib/sms/safety.ts:337-352`)** — they currently filter by `direction` only with NO `message_type` predicate, so WhatsApp rows would inflate SMS hourly/daily caps. This is an ADD, not a "review" (there is no existing filter to find). Give WhatsApp its own caps if needed.
  - WhatsApp **honours the global incident kill-switch** (`SUSPEND_ALL_SMS`, ideally renamed `SUSPEND_ALL_COMMS`, + event-scoped suspension) but uses **WhatsApp template/window timing**, not SMS `quiet-hours` deferral.

### F.2 WhatsApp opt-in, consent records & templates (F2, F6)
- Add the WhatsApp opt-in/status/marketing columns to `customers` (§4.2/§4.2a). Surface an opt-in toggle in the customer UI. When a customer messages the business on WhatsApp, record `last_whatsapp_inbound_at` to open/refresh the 24-hour service window; do **not** automatically set `whatsapp_opt_in=true`.
- **Consent/opt-out audit trail (parity with SMS):** SMS STOP is a fail-closed, audited flow (STOP/UNSUBSCRIBE/QUIT/CANCEL/END/STOPALL clears `sms_opt_in`+`marketing_sms_opt_in`, records an `sms_opted_out` analytics event). WhatsApp must mirror it: define the keyword set, persist `whatsapp_status`/`whatsapp_opted_out_at`, clear `marketing_whatsapp_opt_in`, emit a `whatsapp_opted_out` analytics + `logAuditEvent`, and record opt-in events too (WhatsApp Business demands demonstrable consent + opt-out evidence).
- **Templates:** business-initiated WhatsApp outside the 24h care window requires **pre-approved templates**, and Meta treats **marketing** template categories far more strictly than utility/transactional. Map onto the existing `template_key`; maintain an approved-template registry tagged by category; only send marketing templates to `marketing_whatsapp_opt_in` customers (§4.2a). Freeform allowed inside the window.
- Compliance: never send business-initiated WhatsApp without the appropriate opt-in; honour STOP/opt-out (F5).

### F.3 Extend the cascade (F3)
Implement the `email → whatsapp → sms` ordering in `channel.ts`/`notify.ts` per §4.1a, with whatsapp-aware policies and per-type overrides.

### F.4 Migrate send sites onto the dispatcher (F4)
Progressively move the ~28 `sendSMS` + ~25 `sendEmail` hard-coded call sites onto `notifyCustomer` so the cascade governs all customer messages. Group by domain (events, table-bookings, parking, private-bookings, waitlists, refunds, crons) and migrate in batches; each batch is a small, verifiable PR. The low-level `sendSMS`/`sendEmail`/`sendWhatsApp` remain (the dispatcher calls them; a few genuinely channel-specific sends, e.g. OTP, may stay pinned).

### F.5 Inbound WhatsApp (F5)
Covered in §6.2 — same webhook, SID-dedup first across linked and unmatched rows, `whatsapp:` prefix stripped, `message_type:'whatsapp'` only after customer match, reply-to-book skipped for WhatsApp, STOP handled for matched customers, and `last_whatsapp_inbound_at` updated without setting explicit opt-in.

---

## 9B. Workstream G — GDPR export & erasure of stored comms content (NEW)

This programme stores, for the first time, **full email subject+body, full WhatsApp bodies, inbound email/WhatsApp content, and attachment/media** — a large PII expansion across `messages` + `email_messages` + `unmatched_communications` + `webhook_logs` + `feedback` + Storage. The privacy policy (`src/app/privacy/page.tsx`) commits to GDPR **Access (export)**, **Erasure**, and **"Messages: 2 years"** retention. These controls must ship before any PR starts writing new full email/WhatsApp bodies or media to production.

- **Data-subject export:** any existing customer-data export must now include `email_messages` (incl. body), WhatsApp rows, inbound content, linked attachment references, and resolved holding rows — or it is non-compliant. Extend the export to read the unified `customer_communications` view plus resolved `unmatched_communications` audit rows.
- **Right to erasure:** the customer deletion/anonymisation flow must purge or redact stored bodies/attachments across `messages`, `email_messages`, `unmatched_communications`, `webhook_logs`, and Storage media. Specify cascade vs anonymise semantics; audit-log the erasure.
- **Retention enforcement is currently dead code:** the only purge, `cleanupOldMessages` (`src/lib/background-jobs.ts:414`), hard-deletes `messages` by `created_at` but is in `LEGACY_JOB_TYPES` (disabled, no active cron); there is **no purge for `email_messages`, `unmatched_communications`, or Storage media**. Reactivate (or replace with a live cron) a retention job that (a) honours the documented 2-year policy, (b) filters by `message_type`/`direction` once WhatsApp shares `messages`, and (c) adds equivalent `email_messages`, `unmatched_communications`, `webhook_logs`, and Storage media purges/redactions.

## 9C. Workstream H — Delivery-health monitoring & alerting (NEW)

New failure modes have no observability today. Using the existing `src/lib/cron/alerting.ts`, add monitoring/alerts (metric + threshold + owner + surface) for:
- WhatsApp template rejections / send-failure spikes.
- The **Resend inbound route going silent** (replies vanish) and the **`EMAIL_PROVIDER=resend` cutover** degrading deliverability (bounce/complaint rate).
- The **holding queue filling up** (staff-facing "X unmatched messages" alert) so it doesn't become a black hole.
- Dispatcher immediate fallback rate and delayed fallback rate, sourced from `notification_attempts`, as health signals.

## 9D. Workstream I — Historical email backfill decision (NEW)

Existing `email_messages` rows (calendar invites, confirmations already logged) have **no `body`** (the column is new) and many have **no `customer_id`** (linkage only when callers passed it). Day-one timelines would show historic email as contentless/unlinked.
- **Backfill `customer_id`** on existing `email_messages` by matching `to_address` against `customers.email` (reuse the inbound matching helper) — recovers linkage for pre-existing email history.
- **Historic bodies are unrecoverable** — those rows show subject-only; state this as a known limitation (mirrors §10 backfill note).

---

## 10. Cross-cutting concerns

- **PII / content storage — APPROVED BUT GATED (decision #1):** store **full content** for SMS, WhatsApp, and email (subject + text/html body) + attachment/media metadata, inbound and outbound. This is a large PII expansion → **retention, export, and erasure are mandatory before production body/media capture** (Workstream G, §9B) — the previous "apply existing retention policy" was hollow because that job is dead code.
- **WhatsApp compliance:** explicit **opt-in** (transactional vs marketing — §4.2a) + pre-approved **templates** outside the 24h window; honour opt-out with an audit trail (§F.2). Prevent SMS-counter contamination by **adding** a `message_type='sms'` filter to `evaluateSmsSafetyLimits` (`src/lib/sms/safety.ts:337-352`, which has none today) — distinct from the existing filter at `src/services/sms-queue.ts:889`.
- **RLS / access model (corrected):** `email_messages`, `unmatched_communications`, and `customer_communications` are **service-role-only**; `messages` RLS is currently permissive for authenticated; several live read paths use admin/service-role clients and must gate at the application layer. Do **not** make the view `security_invoker` (authenticated has no grant — it would break reads). `CommunicationsService`, the widened `/messages` inbox, customer profile message reads, and holding-queue actions **must use admin client + explicit server/action/page-level `checkUserPermission` checks** (`messages:view`, `customers:view`, and stronger manage permissions for mutations). Do not rely on client navigation or client RBAC alone.
- **Audit logging:** new mutations (unmatched→customer link/merge, manual sends, opt-in/opt-out changes, erasure, delayed fallback sends) call `logAuditEvent()` (`supabase.md`).
- **Idempotency:** inbound email (**`resend_message_id`** — there is no `provider_message_id` column), inbound SMS/WhatsApp (SID, across both `messages` and `unmatched_communications`), delayed fallback attempts, and the `direction` backfill must be idempotent.
- **Destructive-data approval gate:** the `"Unknown (number)"` cleanup (§6.3) and any erasure deletes DELETE customer rows / FK children → explicit human approval + FK reassignment + function/trigger audit first (`supabase.md`).
- **Performance:** per-customer timeline query index-backed + paginated; FTS/trigram index for search (§8.1); materialise the view only if the live query proves slow.
- **Accessibility:** direction/status via icon+label not colour alone; keyboard-navigable timeline; `CustomerLink` visible focus styles.
- **Backfill:** `email_messages.direction`→`'outbound'`; existing-row `customer_id` backfill by `to_address` match (§9D). Do not backfill OJ/vendor invoice rows into customer timelines without a real `customers.id`. Historically un-logged sends (old direct-Graph sends, Graph-era replies) and historic email bodies cannot be retro-captured — known limitation.

### 10A. Testing infrastructure note
The Twilio and Resend **webhook routes have no existing test harness** (only paypal/table-bookings webhooks are tested) — yet they are the highest-risk new surfaces (signature verification, idempotency, phone/email matching, holding-queue/WhatsApp branching). Scope a **webhook-test scaffold** (mocked `Request` + Svix/Twilio signature helpers) as a prerequisite before the integration cases in §15.

### 10B. Permissions for new surfaces
- **Reading comms content:** decide whether `messages:view` suffices for the new email/WhatsApp content view or email needs a distinct grant; the `/messages` page currently has **no page-level server check** (server actions check, but the page itself relies on layout + client RBAC) — add a page/action-level gate.
- **Holding-queue link/merge** is a privileged mutation (re-points customer FKs) → its own permission action (e.g. `messages:manage` / `customers:edit`) + audit.
- **Toggling `whatsapp_opt_in`/opt-out** → gated to the appropriate role; audited.

---

## 11. Decisions — RESOLVED

1. **Content storage:** ✅ **Store everything, but only after privacy controls are live** — full email text/html body, SMS/WhatsApp body, and attachment/media metadata/storage refs. PR0 must ship export, erasure, retention, access gates, and audit coverage before new production body/media capture.
2. **Inbound email mechanism:** ✅ **Resend inbound only** (`email.received`). No Microsoft Graph inbound. Creates the Resend-cutover prerequisite (§5.0).
3. **Unmatched inbound:** ✅ **Dedicated holding table** (no auto-create) for SMS, WhatsApp, and email; staff link/merge later copies into `messages`/`email_messages` with a real `customer_id`.
4. **Scope:** ✅ **Implement everything**, phased per §12. Completeness audit done (§3E) — nothing else to capture.
5. **Global inbox:** ✅ **Widen to email + WhatsApp** (Workstream D).
6. **WhatsApp channel + priority:** ✅ **Add WhatsApp via Twilio**; route customer messages **email → whatsapp → sms** by eligibility through the existing dispatcher. Immediate fallback only covers ineligibility/send-time failure; delayed fallback after provider-terminal failure is opt-in per template (§4.1a, Workstream F).

### Recommendations applied without a blocking question (flagged for your awareness)
- **Provider = Twilio** (reuse existing account/webhook/logging), not Meta Cloud API.
- **"Has WhatsApp" = explicit opt-in** (`whatsapp_opt_in`), required for WhatsApp Business compliance — we do not assume any mobile can receive WhatsApp.
- **Marketing vs transactional consent split** (`marketing_whatsapp_opt_in` mirroring `marketing_sms_opt_in`) — marketing/bulk sends only reach marketing-opted-in customers (§4.2a).
- **Priority applies to all migrated customer messages**, which changes current behaviour: notifications that are SMS-only today may become **email-first**. Build a per-template routing matrix before PR11 so time-critical, reply-sensitive, or compliance-sensitive flows are explicitly pinned/overridden instead of silently changing channel.

### Additional implementation decisions
7. **Inbound media/MMS (§6.5):** capture photos/media to Storage with metadata + retention/erasure.
8. **Attachments (§6.6):** store metadata + storage reference, not inline binaries.
9. **Search (§8.1):** include FTS/trigram search in v-complete.
10. **`invoice_email_logs` (A5):** keep until the `email_messages` replacement preserves the same audit, idempotency, and reporting semantics; exclude non-customer OJ/vendor billing from customer timelines unless a real `customers.id` exists.

---

## 12. Phasing, complexity & PR breakdown

Score **5 (XL)** programme — broken into independently-deployable PRs (target 300–500 lines), within the project's max-4-phases constraint.

| Phase | PR | Content | Score | Depends on |
|---|---|---|---|---|
| **1 — Foundations** | PR0 | Privacy/access/logging guardrails: export/erasure/retention for `messages`, `email_messages`, `unmatched_communications`, `webhook_logs`, and Storage refs; page/action permission gates; `sendEmail({ requireLog:true })` fail-closed mode; no new production body/media writes before this lands | 4 | — |
| | PR1 | Schema: `email_messages` add `direction`, `body_text`, `body_html`, `received_at`, `staff_read_at`, `replied_at`, attachment fields + widen status constraint; `customers` add WhatsApp opt-in/status/`last_whatsapp_inbound_at`; `unmatched_communications`; `notification_deliveries`/`notification_attempts`; indexes; regenerate + add TS types incl. `'whatsapp'` channel (C1–C5, F2) | 4 | PR0 |
| | PR2 | Close outbound email gaps (A1–A4): route customer emails through `sendEmail({ requireLog:true })`; thread `customerId` everywhere applicable; move OJ invoice/quote sends off direct Graph for provider consistency but keep non-customer billing out of customer timelines | 3 | PR1 |
| | PR3 | `CustomerLink` component + rollout (Workstream E) — **independent, can ship first** | 3–4 | — |
| | PR3b | **Webhook test scaffold** (mocked Request + Svix/Twilio signature helpers) — prerequisite for all webhook integration tests (§10A) | 2 | — |
| **2 — Unified read** | PR4 | Revise `customer_communications` view (inbound SMS + SMS/WhatsApp via `message_type` + email + feedback LEFT JOIN + `delivery_history` + composite `id`) (C4); `CommunicationsService` with admin client + permission check (§10B) | 4 | PR1 |
| | PR5 | Unified profile timeline UI — SMS + WhatsApp + email + feedback + attachment indicator + delivery-history (Workstream C) | 4 | PR4 |
| | PR6 | Widen global `/messages` inbox to email + WhatsApp + add server-side permission gate (Workstream D) | 3 | PR4 |
| | PR6b | Comms search — FTS/trigram index + search UI (§8.1) | 3 | PR4 |
| **3 — WhatsApp + routing** | PR7 | WhatsApp transport: `sendWhatsApp` + `recordOutboundMessage(channel)` + sender/env + **status-callback `message_type` branching** (F7) + **`safety.ts` `message_type` filter** (F8) | 4 | PR1 |
| | PR8 | Consent model + opt-in/opt-out UI + audit trail + template registry (F2, F6, §4.2a, §F.2) | 3 | PR1 |
| | PR9 | Inbound WhatsApp on the Twilio webhook (SID-dedup across linked/unmatched, `whatsapp:` strip, reply-to-book skip, STOP for matched customers, service-window update without implicit opt-in) + inbound SMS gaps B2/B4 (F5) | 4 | PR4, PR7, PR8 |
| | PR10 | Extend cascade to `email → whatsapp → sms` in `channel.ts`/`notify.ts` + category-aware eligibility + immediate send-time fallback + `notification_attempts` writes (F3) | 4 | PR7, PR8, PR9 |
| | PR10b | Per-template routing matrix + delayed fallback worker for explicitly opted-in templates only | 3 | PR10 |
| | PR11a/b/c… | Migrate the ~53 hard-coded send sites onto `notifyCustomer`, batched by domain and checked against the routing matrix — each batch a small PR (F4) | 3 each | PR10b |
| **4 — Inbound email, unmatched, compliance** | PR12 | Unmatched holding queue table + link/merge copy into the linked destination table (B3) | 3–4 | PR4 |
| | PR12b | `"Unknown (number)"` cleanup — **approval-gated** reviewed one-off script (FK reassignment + function audit) (§6.3) | 2 | PR12 |
| | PR13 | Surface inbound feedback on timeline (B5) | 2 | PR4 |
| | PR14 | **Resend cutover prerequisite** (§5.0): verify domain, `EMAIL_PROVIDER=resend`, configure Resend inbound route (infra/config) | 3 | PR2 |
| | PR15 | Resend `email.received` inbound capture: metadata webhook + Receiving API body fetch + Attachments API metadata/download handling + customer match + holding queue (B0/B1) | 4 | PR14, PR12 |
| | PR16 | Delivery-health monitoring & alerting (Workstream H/§9C) | 3 | PR7, PR15 |
| | PR17 | Historical email `customer_id` backfill (Workstream I/§9D) | 2 | PR1 |
| | PR18 | Inbound media/MMS + attachment capture (§6.5/§6.6) | 3 | PR9, PR15 |
| | PR19 *(optional)* | Web-enquiry inbound logging (B6) | 3 | PR4 |

PR3 (`CustomerLink`) is fully independent — ship it first/in parallel. **Ordering safety:** PR0 gates new content capture, PR10 (cascade enabling WhatsApp sends) depends on PR9 (inbound WhatsApp **STOP/opt-out** path), and PR11 depends on the routing matrix so SMS-only flows do not silently become email-first. The migration batches (PR11) are the longest tail; incremental once PR10b lands.

---

## 13. Risks & rollback

| Risk | Mitigation |
|---|---|
| Resend cutover changes deliverability | Verify SPF/DKIM/DMARC + parity test before flipping `EMAIL_PROVIDER`; keep Graph as fallback during transition |
| Inbound email depends on Resend route being live | **PR15 gated on PR14**; monitoring alert if inbound route stops delivering (§9C) |
| Re-routing invoice/quote email changes formatting | Same render path; diff output; test-send to staff inbox first |
| Unmatched auto-create proliferation (existing pain) | Holding queue + merge tooling; `"Unknown"` cleanup is approval-gated with FK reassignment (§6.3) |
| View performance on high-volume customers | Index-backed pagination; FTS index; materialise only if needed |
| Linking employee/applicant names to customer profiles | `CustomerLink` only fires with a confirmed `customers.id`; guard mixed lists |
| **WhatsApp failure corrupts SMS state** | Status webhook branches on `message_type`; WhatsApp failures hit `whatsapp_*` columns, never `sms_status`/`sms_opt_in` (F7) |
| **WhatsApp swept into SMS rate limits** | **Add** `message_type='sms'` filter to `safety.ts:337-352` (none exists today) — not just "review" (F8) |
| **Marketing WhatsApp to transactional-only opt-in → ban** | Category-aware eligibility (`marketing_whatsapp_opt_in`); marketing templates only to marketing opt-ins (§4.2a) |
| **WhatsApp routable before opt-out works** | PR10 (cascade) gated on PR9 (inbound STOP path) — WhatsApp not a routable channel until opt-out is live |
| Async provider failures create duplicate notifications | Delayed fallback is disabled by default, tracked in `notification_attempts`, and only enabled per template with idempotency keys |
| Inbound media silently dropped | Capture media to Storage (§6.5) and test empty-body-with-media inbound cases |
| Dispatcher migration changes which channel customers receive on | Migrate in small per-domain batches; per-type overrides for time-critical sends; verify each batch before the next |
| PII expansion without export/erasure | PR0 ships export, erasure, retention, permission gates, and audit coverage before any new production body/media capture |

Rollback: most schema changes are additive (nullable columns + view replace), but the view `id` type change and new workers need consumer checks before deploy. Keep the cascade behind feature/template switches, disable delayed fallback independently, and keep Graph as temporary fallback during the Resend cutover.

---

## 14. Acceptance criteria (Definition of Done)

- [ ] 100% of customer-facing **outbound email** writes a linked `email_messages` row with `body_text`/`body_html` as applicable and fails closed when `requireLog:true` logging fails; grep proves no direct-Graph customer paths; private-booking/refund pass `customerId`; invoice/quote rows only appear in customer comms when a real `customerId` exists.
- [ ] **Outbound WhatsApp** sends via `sendWhatsApp`, logs to `messages` as `message_type:'whatsapp'`, fail-closed linked to a `customer_id`.
- [ ] **Channel routing** cascade `email → whatsapp → sms` is live in the dispatcher; all migrated customer-message sites route through `notifyCustomer`; immediate fallback on ineligibility/send-time failure is logged; delayed fallback only runs for templates that explicitly opt in.
- [ ] **Inbound SMS + WhatsApp** (incl. reply-to-book) writes either a linked `messages` row with the correct `message_type` or an `unmatched_communications` row; WhatsApp STOP is honoured only after a matched customer is found.
- [ ] **Inbound email** captured via Resend `email.received` metadata webhook plus Receiving API body fetch and Attachments API handling; linked or held when unmatched (post-cutover).
- [ ] **Unmatched** inbound (SMS + WhatsApp + email) lands in `unmatched_communications` with a staff link/merge action that copies into the linked table; existing `"Unknown (number)"` rows cleaned up.
- [ ] Customer profile shows a **single unified timeline**: SMS + WhatsApp + email + feedback, inbound + outbound, with status, direction (icon+label), timestamps (London), full content, engagement signals, channel-routed-to indicator, and context links; loading/error/empty handled.
- [ ] Global `/messages` inbox shows **email + SMS + WhatsApp** with correct unread/replied state per channel.
- [ ] Shared **`CustomerLink`** in `@/ds`; every customer-name render site from report 05 links when an id is available; walk-ins degrade to plain text.
- [ ] No business-initiated WhatsApp without the right explicit opt-in (transactional vs **marketing**); inbound WhatsApp only updates `last_whatsapp_inbound_at`; templates outside the 24h window; WhatsApp excluded from SMS rate-limit counters (`safety.ts` filter added); WhatsApp failures never deactivate SMS.
- [ ] WhatsApp **opt-out/STOP** persists + audits parity with SMS; opt-in events recorded.
- [ ] **Search** works across the unified inbox + profile timeline (channel/direction/date scoped).
- [ ] **Attachments/media** (email attachments, inbound WhatsApp/MMS) captured through provider APIs/download URLs and indicated on the timeline per §§6.5–6.6.
- [ ] **GDPR:** before production body/media capture, customer data export includes all comms content; erasure purges bodies/attachments across `messages`, `email_messages`, `unmatched_communications`, `webhook_logs`, and Storage; retention job is live (not legacy).
- [ ] **Monitoring/alerting** live for WhatsApp failures, Resend inbound silence, cutover deliverability, and holding-queue depth.
- [ ] Access model correct: `CommunicationsService` + widened inbox use the admin client **with** server-side `messages:view`/`customers:view` checks; `/messages` has a page-level gate; holding-queue link/merge is a gated, audited action.
- [ ] Historical `email_messages` `customer_id` backfilled by `to_address` match; subject-only for pre-existing rows (known limitation).
- [ ] Build, lint (zero warnings), typecheck, tests pass; webhook test scaffold in place; new tests cover email fail-closed logging, Resend body/attachment API fetch, WhatsApp send/inbound + status branching, immediate and delayed fallback idempotency, category eligibility, inbound match, and the holding-queue flow.

---

## 15. Testing strategy

- **Prerequisite:** build the webhook test scaffold (§10A) — no Twilio/Resend webhook tests exist today.
- **Unit:** `sendEmail({ requireLog:true })` fails when logging fails; `recordEmailMessage`/`recordOutboundMessage` linkage; invoice/quote rows are customer-linked only with a real `customerId`; phone + email matching helpers; **`selectChannel` cascade + category-aware eligibility/fallback** (email→whatsapp→sms across opt-in/marketing-opt-in/status permutations); **status-webhook `message_type` branching** (WhatsApp failure does NOT touch `sms_status`; `read` mapping correct for outbound WhatsApp); **`safety.ts` excludes WhatsApp** from SMS caps; view→`CustomerCommunication` mapping (composite id parse); delayed fallback idempotency key calculation.
- **Integration:** reply-to-book logs a linked inbound row when the customer is known and an `unmatched_communications` row when not; **inbound WhatsApp** (`whatsapp:` prefix, SID-dedup across linked + unmatched, reply-to-book skipped) logs `message_type:'whatsapp'` only after customer match and updates `last_whatsapp_inbound_at`; Resend `email.received` idempotency by **`resend_message_id`** plus Receiving API body fetch and Attachments API handling; unmatched→holding flow; link/merge audit; **dispatcher immediate fallback** when the primary send fails before provider acceptance; delayed fallback worker only runs for opted-in templates; opt-out/STOP parity.
- **UI:** timeline renders mixed SMS/WhatsApp/email/feedback/in/out + attachment indicator + delivery-history + empty/loading/error; inbox channel filter + search; `CustomerLink` links with id, plain text without.
- Mock all external services (Resend, Graph, Twilio incl. WhatsApp) — never hit real APIs (`testing.md`).

---

## 16. Appendix — key files

| Area | File |
|---|---|
| Canonical SMS send + logging (WhatsApp extends here) | `src/lib/twilio.ts:208`, `src/lib/sms/logging.ts:33` |
| Notification dispatcher + channel selection (cascade lives here) | `src/lib/notifications/notify.ts`, `src/lib/notifications/channel.ts`; wired example `src/lib/table-bookings/bookings.ts:862` |
| Provider-agnostic email send + logging | `src/lib/email/emailService.ts`, `src/lib/email/logging.ts` (`recordEmailMessage`) |
| Direct-Graph (bypass) email | `src/lib/microsoft-graph.ts` (`sendInvoiceEmail:79`, `sendQuoteEmail:228`), `email.ts:738` |
| Private booking emails + .ics | `src/lib/email/private-booking-emails.ts` (`sendBookingCalendarInvite:267`) |
| Refund email | `refund-notifications.ts:38` |
| Twilio webhook (inbound + status) | `src/app/api/webhooks/twilio/route.ts` |
| Resend webhook (outbound only today) | `src/app/api/webhooks/resend/route.ts` |
| Inbound feedback | `src/app/g/[token]/private-feedback/`, `src/lib/private-bookings/feedback.ts:378` |
| Review-click tracking | `src/app/r/[token]/route.ts` (`review_clicked_at`) |
| Union view (unused) | `customer_communications` (migrations) |
| Profile page + SMS thread | `src/app/(authenticated)/customers/[id]/page.tsx`, `MessageThread`, `MessageService` (admin client + permission gate) |
| Name display (no link) | `src/components/features/customers/CustomerName.tsx` + sites in report 05 + bulk (`BulkMessagesClient.tsx:213`) + FOH (`FohBookingDetailModal`, `FohUnassignedBookings`, `TablesFOH/BOH`, `TimelineView`) |
| Email provider switch + env | `EMAIL_PROVIDER` in `emailService.ts`, `.env.example:54` |
| Channel discriminator (SMS vs WhatsApp) | `messages.message_type` (default `'sms'`) |
| SMS safety/rate-limit (needs `message_type` filter ADDED) | `src/lib/sms/safety.ts:337-352` (no filter today); existing filter at `src/services/sms-queue.ts:889` |
| SMS status mapping + delivery outcome | `src/lib/sms-status.ts:43` (`read`→`received`), `webhooks/twilio/route.ts:231-309` (`applySmsDeliveryOutcome`) |
| Parallel invoice email log (keep until replacement preserves audit/idempotency) | `invoice_email_logs` — `invoices.ts:291,313,353`, `email.ts:288`, `oj-projects/client-statement.ts:383` |
| Retention (legacy/dead) | `cleanupOldMessages` `src/lib/background-jobs.ts:414` (in `LEGACY_JOB_TYPES`) |
| Monitoring | `src/lib/cron/alerting.ts` |
| Privacy commitments | `src/app/privacy/page.tsx` (Access, Erasure, "Messages: 2 years") |

Full per-site tables and column inventories live in the eight `tasks/discovery/*.md` reports. The completeness audit that produced v2 is summarised in `tasks/discovery/` workflow output.
