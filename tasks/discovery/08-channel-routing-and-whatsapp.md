# Discovery 08 — Channel Routing & WhatsApp Feasibility

Investigation for adding **WhatsApp** as a customer comms channel with routing priority
**email first → WhatsApp second → SMS last**. Read-only discovery; no code changed.

Project: `the-anchor-management-tools` (Supabase project id `tfcasgxopxegwrabvwat`).

---

## 1. Notification dispatcher / channel selection

**A central dispatcher EXISTS** and is the cleanest extension point. It is newer than the
bulk of the codebase and only partially adopted.

### `notifyCustomer()` — the dispatcher
- File: `src/lib/notifications/notify.ts`
- Signature:
  ```ts
  export async function notifyCustomer(input: NotifyCustomerInput): Promise<NotifyCustomerResult>
  ```
  where (lines 28–41):
  ```ts
  type NotifyCustomerInput = {
    supabase?: SupabaseClient<any, 'public', any>
    customerId?: string | null
    customer?: CustomerChannelState | null
    policy: NotificationPolicy        // 'email_first' | 'email_only' | 'sms_only' | 'both'
    urgency: NotificationUrgency      // 'standard' | 'time_critical'
    category?: NotificationCategory   // 'transactional' | 'marketing' (default transactional)
    email?: Omit<EmailOptions, 'to'> & { to?: string | null }
    sms?: { to?: string | null; body: string; options?: SendSMSOptions }
  }
  ```
- Flow (`notify.ts:124` onwards):
  1. Loads customer channel state (`loadCustomer`, `notify.ts:58`) selecting
     `id, email, mobile_number, mobile_e164, sms_status, sms_opt_in, marketing_sms_opt_in, email_status, email_deactivated_at, marketing_email_opt_in`.
  2. Computes `eligibility = { email, sms }` via `isEmailEligible` (`notify.ts:80`) and
     `isSmsEligible` (`notify.ts:106`).
  3. Calls `selectChannel(...)` to order channels.
  4. Iterates selected channels, sending email (`sendEmail`) and/or SMS (`sendSMS`).
     **Key fall-through logic** (`notify.ts:~290`): for `email_first`, if the email send
     succeeds it `break`s and does NOT send SMS — i.e. SMS is the fallback only when email
     fails or is ineligible.

### `selectChannel()` — the channel-priority engine
- File: `src/lib/notifications/channel.ts`
- Signature (line 22):
  ```ts
  export function selectChannel(input: SelectChannelInput): SelectChannelResult
  ```
- Types (lines 1–4):
  ```ts
  export type NotificationChannel = 'email' | 'sms'           // <-- no 'whatsapp' yet
  export type NotificationPolicy  = 'email_first' | 'email_only' | 'sms_only' | 'both'
  export type NotificationUrgency = 'standard' | 'time_critical'
  export type NotificationCategory = 'transactional' | 'marketing'
  ```
- Behaviour:
  - `time_critical` + `email_only` or `email_first` → rejected (returns `{ channels: [], reason }`).
    Rationale: time-critical messages must not depend on email.
  - `email_first` → candidates `['email','sms']`; `both` → `['email','sms']`;
    `sms_only` → `['sms']`; `email_only` → `['email']`.
  - Candidates are filtered by `eligibility[channel]`; empty result returns `no_channel_available`.

### How a channel is chosen TODAY
- **Where `notifyCustomer` is used** (the new path): the channel is policy-driven.
  Today it is used in exactly ONE place:
  - `src/lib/table-bookings/bookings.ts:862` — table-booking "created" notification,
    `policy: 'email_first', urgency: 'standard', category: 'transactional'`.
    So a table booking confirmation goes **email if eligible, else SMS**.
- **Everywhere else** (the legacy path, the vast majority): channels are NOT chosen — they
  are hard-coded at each call site. There is **no preference logic and no fallback** outside
  `notifyCustomer`. Direct call counts (excluding the wrappers themselves):
  - `sendSMS(` direct call sites: **28 files**
  - `sendEmail(` direct call sites: **25 files**
  These send unconditionally on their chosen channel — e.g. event reminders / booking SMS go
  straight through `sendSMS`, lifecycle emails straight through `sendEmail`.

**Summary:** A real dispatcher with an `email_first` cascade exists but is only wired into the
table-booking-created flow. Adding WhatsApp as a tier means (a) extending `channel.ts` /
`notify.ts`, and (b) migrating remaining notification call sites onto `notifyCustomer` to get
the benefit — a larger rollout, not a one-line change.

---

## 2. Customer contact + preference fields

### TypeScript type
- `src/types/database.ts` (Customer interface) and `src/types/database.generated.ts`
  (`public.customers`). The dispatcher's own working subset is `CustomerChannelState`
  (`notify.ts:15`).

### Live schema — `public.customers` (verified via information_schema)
Channel-relevant columns:

| Column | Type | Notes |
|---|---|---|
| `email` | varchar, nullable | email address |
| `email_status` | text, NOT NULL, default `'unknown'` | `invalid`/`bounced`/`complained` block email |
| `email_deactivated_at` | timestamptz, nullable | set → email ineligible |
| `email_delivery_failures` | int, NOT NULL default 0 | |
| `marketing_email_opt_in` | boolean, NOT NULL default false | gates marketing email |
| `mobile_number` | text, **NOT NULL** | primary phone (display/raw) |
| `mobile_e164` | varchar, nullable | normalised E.164 (preferred SMS target) |
| `mobile_number_raw` | text, nullable | |
| `sms_opt_in` | boolean, nullable default true | `false` blocks SMS |
| `sms_status` | text, NOT NULL default `'active'` | non-active (≠ null/`active`) blocks SMS |
| `sms_deactivated_at` / `sms_deactivation_reason` | timestamptz/text | |
| `marketing_sms_opt_in` | boolean, NOT NULL default false | gates marketing SMS |
| `messaging_status` | text, nullable default `'active'` | broader messaging health flag |
| `sms_delivery_failures`, `consecutive_failures`, `total_failures_30d`, `last_failure_type`, `last_sms_failure_reason`, `last_successful_sms_at`, `last_successful_delivery`, `last_successful_email_at`, `last_email_failure_reason` | various | health/diagnostics |

### NO existing channel-preference column
There is **no** `contact_preference`, `messaging_preference`, `preferred_channel`, nor any
`whatsapp*` column on `customers`. Routing today is purely eligibility-based (opt-in flags +
status), never an explicit per-customer channel preference.

### Where "WhatsApp" / preference labels actually appear (grep `whatsapp`)
1. **Private booking "Booking Source" dropdown** — `src/app/(authenticated)/private-bookings/new/page.tsx:267`
   and `.../[id]/edit/page.tsx:312`: `{ value: 'whatsapp', label: 'WhatsApp' }`. This is the
   `source` field (how the booking *came in*), NOT a comms channel and NOT a send capability.
   This is most likely the "contact-preference label / WhatsApp" the completeness audit flagged.
2. **Employee onboarding checklist** — `src/types/database.ts:639-642` and onboarding client
   (`NewEmployeeOnboardingClient.tsx`): `private_whatsapp_added`, `private_whatsapp_date`,
   `team_whatsapp_added`, `team_whatsapp_date`. These are booleans/dates tracking whether a new
   *employee* was added to staff WhatsApp groups. Unrelated to customer comms.
3. **Social copy** — `database.generated.ts:2990` `social_copy_whatsapp` (marketing content
   field on some table), not a send channel.

**Conclusion:** No existing WhatsApp *send* capability and no stored customer channel
preference. The only customer-facing "WhatsApp" is an inbound booking-source tag.

---

## 3. WhatsApp feasibility via Twilio

Twilio is already the SMS provider. WhatsApp would reuse the same account/credentials.

### Current Twilio config
- `src/lib/twilio.ts` reads (lines 21–24):
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`,
  `TWILIO_MESSAGING_SERVICE_SID`.
- `src/lib/env.ts:13-16` declares those four (all `.optional()`). `env.ts:79-80` defines
  `TWILIO_STATUS_CALLBACK = ${WEBHOOK_BASE_URL}/api/webhooks/twilio` and
  `TWILIO_STATUS_CALLBACK_METHOD = 'POST'`.
- `.env.example:33-38`: same four plus `TWILIO_WEBHOOK_AUTH_TOKEN`,
  `SKIP_TWILIO_SIGNATURE_VALIDATION`.
- **No `WHATSAPP*` env var and no WhatsApp sender configured anywhere.** A
  `TWILIO_MESSAGING_SERVICE_SID` may exist in prod (used for SMS scheduling) but there is no
  WhatsApp sender or template config.

### Sending path (`sendSMS` in `src/lib/twilio.ts`)
- Signature: `export const sendSMS = async (to: string, body: string, options: SendSMSOptions = {})`.
- Builds `messageParams` (`twilio.ts:461`): `{ body, to, statusCallback, statusCallbackMethod }`,
  then sets either `messagingServiceSid` (if configured) **or** `from: fromNumber` (`twilio.ts:469-473`).
- **To send WhatsApp via Twilio** you prefix both `From` and `To` with `whatsapp:` —
  e.g. `to: 'whatsapp:+447...'`, `from: 'whatsapp:+44...'` (or a WhatsApp-enabled Messaging
  Service). The existing `sendSMS` does NOT do this; it is SMS-only by construction. A sibling
  `sendWhatsApp` (or a `channel`/`transport` option on the send path) would be the clean
  addition, reusing the same `getTwilioClient()`, retry, idempotency, and logging machinery.
- Heavy safety scaffolding wraps every send and is **SMS-shaped**: suspension kill-switches
  (`SUSPEND_ALL_SMS`/`SUSPEND_EVENT_SMS`), quiet-hours deferral, idempotency claims, per-customer
  eligibility (`isCustomerSmsSendAllowed`, `twilio.ts:113` — checks `sms_status`/`sms_opt_in` and
  phone match), and safety rate limits. WhatsApp would need its own opt-in/eligibility checks
  (the `sms_opt_in`/`sms_status` gates do not represent WhatsApp consent).

### Inbound webhook — `src/app/api/webhooks/twilio/route.ts`
- Single Twilio webhook handles both delivery status callbacks and inbound messages.
- Inbound detection (`route.ts:425-427`): `hasBodyPayload = Boolean(params.Body && params.From && params.To)`
  and `isInboundMessage` when status is `''` or `'received'`.
- Inbound processing: normalises `params.From` via `formatPhoneForStorage` (`route.ts:511-517`),
  resolves/creates the customer by phone variants (`route.ts:549+`), handles STOP/opt-out
  keywords (`route.ts:654+`), runs reply-to-book (`handleReplyToBook`, `route.ts:523`), then
  inserts an inbound `messages` row with `direction: 'inbound'`, `message_type: 'sms'`
  (`route.ts:696-704`).
- **WhatsApp inbound** arrives at this SAME endpoint with `From`/`To` prefixed `whatsapp:`.
  Today `formatPhoneForStorage('whatsapp:+44...')` would mis-parse the `whatsapp:` prefix, so
  the handler must (a) detect the prefix, (b) strip it before phone normalisation, and
  (c) tag the stored row `message_type: 'whatsapp'` and apply WhatsApp opt-in logic instead of
  SMS STOP handling.

### WhatsApp Business constraints to bake into the design
- **Opt-in required**: a customer must have opted in before you can message them on WhatsApp;
  there is no existing WhatsApp consent field — needs a new opt-in flag/timestamp.
- **24-hour customer-care window**: free-form (non-template) messages are only allowed within
  24h of the customer's last inbound message. Outside it you must use approved templates.
- **Pre-approved templates**: business-initiated messages (confirmations, reminders) require
  Meta-approved message templates with named/numbered variables. This maps onto the existing
  `template_key` column on `messages` but needs a separate WhatsApp-template registry.

---

## 4. `messages` table & channel column

### Live schema — `public.messages` (verified)
Already has a discriminator column:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `customer_id` | uuid, **NOT NULL** | every message must map to a customer (logging fails closed otherwise) |
| `direction` | text NOT NULL | `'inbound'` / `'outbound'` |
| `message_sid` / `twilio_message_sid` | text | Twilio SID |
| `body` | text NOT NULL | |
| `status`, `twilio_status` | text | |
| **`message_type`** | text, nullable, **default `'sms'`** | **the channel discriminator** |
| `from_number`, `to_number` | text | |
| `segments`, `price`, `price_unit`, `cost_usd` | | SMS-centric billing |
| `template_key` | text | template id (reusable for WhatsApp templates) |
| `event_booking_id`, `table_booking_id`, `private_booking_id` | uuid | links |
| `sent_at`, `delivered_at`, `failed_at`, `read_at`, `error_code`, `error_message` | | lifecycle |

### How WhatsApp would be stored / distinguished
- The `message_type` column is the natural channel field. Today it is **only ever written as
  `'sms'`**: `src/lib/sms/logging.ts:73`, `src/app/api/webhooks/twilio/route.ts:704`,
  `src/app/actions/import-messages.ts:434`; and read with `.eq('message_type','sms')` in
  `src/services/sms-queue.ts:889`.
- A WhatsApp message would be stored in the same table with `message_type: 'whatsapp'`.
  Caveat: queries that assume SMS (e.g. `sms-queue.ts:889` filtering `message_type = 'sms'`,
  and the inbound STOP/opt-out logic) would need auditing so WhatsApp rows are not
  double-counted in SMS safety limits or mis-handled.
- No schema change strictly required to store WhatsApp; `message_type` already supports it.
  (A CHECK constraint or enum, plus possibly a WhatsApp `read_at`/template metadata, would be
  nice-to-have.)

---

## Recommendation — where to implement the email → WhatsApp → SMS cascade

The cleanest place is the **existing dispatcher**, extended:

1. **`src/lib/notifications/channel.ts`** — add `'whatsapp'` to `NotificationChannel`, add a
   policy (e.g. `'email_then_whatsapp_then_sms'`) or make `selectChannel` order
   `['email','whatsapp','sms']` for the `email_first`-style policy. Add `whatsapp` to
   `ChannelEligibility`.
2. **`src/lib/notifications/notify.ts`** — add a `whatsapp` branch to eligibility
   (`isWhatsAppEligible`: requires WhatsApp opt-in + valid `mobile_e164` + within-window OR
   approved template) and to the send loop, calling a new `sendWhatsApp`. Reuse the existing
   `email_first` break-on-success pattern so WhatsApp only fires when email is ineligible/fails,
   and SMS only when both email and WhatsApp are unavailable.
3. **`src/lib/twilio.ts`** — add `sendWhatsApp` (or a `transport: 'sms' | 'whatsapp'` option)
   that prefixes `whatsapp:` and logs with `message_type: 'whatsapp'`; give it WhatsApp-specific
   opt-in/eligibility rather than the SMS gates.
4. **`src/app/api/webhooks/twilio/route.ts`** — detect/strip the `whatsapp:` prefix on inbound,
   tag stored rows `message_type: 'whatsapp'`, and branch opt-in/STOP handling.
5. **Schema additions** (separate migration, with approval): customer WhatsApp opt-in flag +
   timestamp (no existing field), and a WhatsApp template registry keyed to `template_key`.
6. **Rollout reality**: the dispatcher is only used in one flow today. To make routing
   meaningful for confirmations/reminders/lifecycle messages, the ~28 direct `sendSMS` and
   ~25 direct `sendEmail` call sites must be progressively migrated onto `notifyCustomer`.

---

## Key files (absolute paths)
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/notifications/notify.ts`
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/notifications/channel.ts`
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts`
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/logging.ts`
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/twilio/route.ts`
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/table-bookings/bookings.ts` (only `notifyCustomer` consumer)
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/env.ts`
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.env.example`
- `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.ts`, `.../database.generated.ts`
