# Inbound Communications Inventory — AMS

Read-only discovery of every INBOUND communication path (SMS replies, inbound email, delivery status callbacks) and how each is logged + linked to a customer.

Single Twilio webhook endpoint handles BOTH inbound SMS and SMS status callbacks. Email is OUTBOUND-only (Microsoft Graph send + Resend status webhook). **There is no inbound customer email capture.** Inbound web enquiries do NOT create `messages` rows.

---

## (a) Inbound SMS Flow + Customer Matching

**Endpoint:** `POST /api/webhooks/twilio` — `src/app/api/webhooks/twilio/route.ts`
`runtime = 'nodejs'`. One route, branched by payload shape.

### Routing logic (route.ts:425–439)
- `hasBodyPayload = Boolean(params.Body && params.From && params.To)`
- `webhookStatus = (params.MessageStatus || params.SmsStatus).toLowerCase()`
- `isInboundMessage = hasBodyPayload && (webhookStatus === '' || webhookStatus === 'received')` → `handleInboundSMS()`
- `isStatusUpdate = Boolean(webhookStatus) && !isInboundMessage` → `handleStatusUpdate()`
- else → logged as `unknown_type`, returns 200.

### Signature verification (route.ts:181–212, 396–414)
- `verifyTwilioSignature()` uses `twilio.validateRequest(TWILIO_AUTH_TOKEN, X-Twilio-Signature, request.url, params)`.
- Verified BEFORE any `webhook_logs` write (prevents log poisoning). Invalid → 401, nothing persisted.
- Can be skipped only when `skipTwilioSignatureValidation()` AND `NODE_ENV !== 'production'` (route.ts:397–398).

### handleInboundSMS (route.ts:467–785)
1. Extract `Body` (trimmed), `From`, `To`, `MessageSid || SmsSid`. Missing any → log `invalid_payload`, return 200 (route.ts:475–492).
2. **Idempotency:** `findMessageBySid()` looks up `messages` by `twilio_message_sid` (route.ts:348–365, 494). Existing → log `duplicate_inbound`, return 200.
3. Normalize sender: `formatPhoneForStorage(fromNumber)` → `canonicalFromNumber` (E.164). Throws if unparseable (route.ts:511–517).
4. **Reply-to-book short-circuit (route.ts:519–543):** `handleReplyToBook(normalizedFromNumber, messageBody)` (`src/lib/sms/reply-to-book.ts`). If it returns `handled:true`, books a free/cash-door event seat from a numeric reply to a cross-promo SMS, optionally sends a reply SMS (bypasses quiet hours), and **returns early — NO inbound `messages` row is written** for handled reply-to-book messages. Thrown errors are non-fatal; falls through to standard handling.
5. **Customer matching (route.ts:546–565):** PRIMARY inbound matcher.
   - `phoneVariants = generatePhoneVariants(normalizedFromNumber)` (`src/lib/phone/index.ts:77` — produces raw, cleaned, `+digits`, `00digits`, national `0…`, country-code-joined forms).
   - OR query: `mobile_e164.eq.{canonicalFromNumber}` plus one `mobile_number.eq.{variant}` per variant; `.limit(1)`.
6. **Unmatched number → auto-create customer (route.ts:571–626):** inserts `{ first_name:'Unknown', last_name:'(<rawFrom>)', mobile_number, mobile_e164, sms_opt_in:true, sms_status:'active' }` with retry. Unique-violation `23505` → re-query for concurrently-created row. So inbound from unknown numbers is NEVER dropped — a placeholder "Unknown" customer is created.
7. Matched but `mobile_e164` null → back-fills canonical E.164 (route.ts:630–649).
8. **Opt-out keywords (route.ts:652–691):** STOP, UNSUBSCRIBE, QUIT, CANCEL, END, STOPALL (exact match or `KEYWORD `-prefixed). On match: update customer `sms_opt_in:false, sms_status:'opted_out', marketing_sms_opt_in:false`; FAILS CLOSED (throws if update errors or affects 0 rows so Twilio retries); records `sms_opted_out` analytics event.
9. **Persist message (route.ts:693–747):** insert into `messages`:
   `{ customer_id, direction:'inbound', message_sid, twilio_message_sid, body, status:'received', twilio_status:'received', from_number:normalizedFromNumber, to_number, message_type:'sms' }` (retry; `23505` dup → return existing).
10. Success → `webhook_logs` `success` with `customer_id` + `message_id`; return `{ success, messageId }`.

**Verdict:** Inbound SMS ARE logged to `messages` with `direction:'inbound'`, matched via `generatePhoneVariants` against `mobile_e164`/`mobile_number`, auto-creating an "Unknown" customer when unmatched.

---

## (b) Status Callback Flow (delivered/failed/undelivered/sent/canceled)

**handleStatusUpdate (route.ts:787–1047)** — same endpoint.

1. Extract `MessageSid||SmsSid`, `MessageStatus||SmsStatus` (lowercased), `ErrorCode`, `ErrorMessage`. Missing sid/status → `invalid_status_payload`, 200 (route.ts:795–812).
2. Look up the row in `messages` by `twilio_message_sid` (most recent, `.maybeSingle()`) (route.ts:815–821).
   - Lookup error → log `message_lookup_failed`, 500 (Twilio retries).
   - Not found → log `message_not_found`, return 200 (stops retries) (route.ts:850–866).
3. **Duplicate guard:** existing `twilio_status` == incoming status → log `duplicate_status`, skip (avoids inflating failure counters) (route.ts:868–885).
4. **Regression guard:** `isStatusUpgrade(existing, new)` false → append audit row to `message_delivery_status` with `note:'Status regression prevented'`, return 200; the `messages` row is NOT downgraded (route.ts:888–912).
5. **Update `messages` row (route.ts:915–933).** Columns written:
   - `status` = `mapTwilioStatus(messageStatus)` (`src/lib/sms-status.ts`)
   - `twilio_status` = raw lowercased status
   - `error_code` = `ErrorCode`
   - `error_message` = `ErrorMessage || formatErrorMessage(errorCode)`
   - cost fields via `buildTwilioCostUpdate()` (route.ts:113–134): `price`, `cost_usd` (abs value), `price_unit`, `segments` (from `Price`, `PriceUnit`, `NumSegments`)
   - `updated_at`; conditional timestamps: `delivered_at` (delivered), `failed_at` (failed/undelivered/canceled), `sent_at` (sent, if not already set)
   - matched on both `twilio_message_sid` AND `id` (extra safety).
6. **Append audit history:** insert into `message_delivery_status` `{ message_id, status, error_code, error_message, raw_webhook_data:params, created_at }` (route.ts:984–994). Append-only delivery audit log.
7. **Customer health side-effects — `applySmsDeliveryOutcome()` (route.ts:231–346, 1006–1010):**
   - `delivered` → reset `customers.sms_delivery_failures=0`, clear `last_sms_failure_reason`, set `last_successful_sms_at`.
   - `failed`/`undelivered`/`canceled` → increment `sms_delivery_failures`, set `last_sms_failure_reason`. After >3 failures (and not already opted_out): set `sms_status:'sms_deactivated'`, `sms_opt_in:false`, `sms_deactivated_at`, `sms_deactivation_reason:'delivery_failures'`, plus `sms_deactivated` analytics event.

**Reconciliation cron (backstop):** `GET /api/cron/reconcile-sms` (`src/app/api/cron/reconcile-sms/route.ts`) polls Twilio for OUTBOUND messages (`direction in ['outbound','outbound-api']`) stuck without a terminal status, fetches current status from Twilio API, applies the same upgrade/`twilio_status` logic, and marks unfound SIDs `twilio_status:'not_found'`. Does NOT touch inbound.

**Verdict:** Status callbacks YES — written back to `messages` (`twilio_status`, `status`, `error_code`, `error_message`, cost fields, timestamps) + append-only `message_delivery_status` history + customer SMS-health columns.

---

## (c) Inbound Email — STATUS: DOES NOT EXIST

- Outbound email = Microsoft Graph (`src/lib/email/emailService.ts`, per CLAUDE.md).
- `POST /api/webhooks/resend` (`src/app/api/webhooks/resend/route.ts`) handles ONLY Resend OUTBOUND delivery events: `email.sent/delivered/delivery_delayed/opened/clicked/bounced/complained/failed/suppressed` (mapStatus, route.ts:39–62). It updates `email_messages` (by `resend_message_id`), `email_suppressions`, and `customers` email-health columns (`email_status`, `email_delivery_failures`, etc.). **No `email.received`/inbound branch.**
- Searches for `receiveEmail`, `imap`, `mailbox`, `inbound email`, Graph `subscription` / `/messages/delta` returned NOTHING.
- **No inbound customer email is captured anywhere.** Customer email replies go to a mailbox outside AMS and are invisible to the app.

---

## (d) Other Inbound Channels (web forms)

- `POST /api/private-booking-enquiry` and `POST /api/public/private-booking` — create a `private_booking` record + send email + record analytics event. They do **NOT** write to the `messages` table (no inbound `messages` row).
- Table-booking enquiries similarly create booking records, not `messages` rows.
- **Bulk import:** `importMessagesFromTwilio()` (`src/app/actions/import-messages.ts`) — admin-triggered backfill. Pulls history from the Twilio API, filters `direction === 'inbound'` vs outbound, dedupes by `twilio_message_sid`, matches customers by `mobile_e164` / `mobile_number` / `mobile_number_raw` (does NOT use `generatePhoneVariants`), and inserts into `messages`. Not a live inbound path — a manual catch-up tool.

---

## GAPS / RISKS

1. **No inbound email capture (highest gap).** Customers replying to any Graph-sent email (booking confirmations, etc.) are never recorded in AMS. No IMAP poll, no Graph change-notification subscription, no `email_messages` inbound branch. Staff must check the mailbox manually.
2. **Reply-to-book messages produce no `messages` row.** A handled numeric reply (route.ts:524–534) returns before the inbound insert, so the customer's actual inbound text is NOT stored in the message thread — only the booking + outbound confirmation exist. Conversation history is incomplete for these.
3. **"Unknown" placeholder customers accumulate.** Every unmatched inbound number spawns a `first_name:'Unknown', last_name:'(<number>)'` customer (route.ts:577–584) with `sms_opt_in:true`. No dedup/merge/cleanup path observed — risk of junk/spam contacts and unintended marketing opt-ins.
4. **Two divergent customer-matching strategies.** Live webhook uses `generatePhoneVariants` (broad). Bulk import uses only 3 exact columns (`mobile_e164`/`mobile_number`/`mobile_number_raw`) — import can mis-match or duplicate where the webhook would have matched.
5. **Web enquiries are siloed from messaging.** Private-booking / table-booking enquiries never enter `messages`, so there is no unified inbound-communications inbox spanning SMS + web forms + email.
6. **Status regression on a message only appends to `message_delivery_status`** and silently leaves the `messages` row; correct for delivery semantics, but the audit row is only visible if someone queries that table.

---

## Key Files

| Path | Role |
|---|---|
| `src/app/api/webhooks/twilio/route.ts` | Inbound SMS + status callbacks (single endpoint) |
| `src/lib/sms/reply-to-book.ts` | Numeric-reply auto-booking; short-circuits inbound storage |
| `src/lib/phone/index.ts:77` / `src/lib/utils.ts:31` | `generatePhoneVariants` customer matcher |
| `src/lib/sms-status.ts` | `mapTwilioStatus`, `isStatusUpgrade`, `formatErrorMessage` |
| `src/app/api/cron/reconcile-sms/route.ts` | Outbound status reconciliation backstop |
| `src/app/api/webhooks/resend/route.ts` | OUTBOUND email status only (no inbound) |
| `src/app/actions/import-messages.ts` | Manual Twilio history backfill |
| `src/app/api/private-booking-enquiry/route.ts`, `src/app/api/public/private-booking/route.ts` | Web enquiries (no `messages` row) |

**Tables:** `messages` (direction, twilio_message_sid, twilio_status, status, error_code/message, cost), `message_delivery_status` (append-only status audit), `webhook_logs` (raw receipt audit), `customers` (sms/email health), `email_messages` + `email_suppressions` (outbound email).
