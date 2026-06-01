# SMS Inventory — The Anchor Management Tools

**Purpose:** Exhaustive inventory of every SMS the application sends, to support a project that switches eligible customer SMS to EMAIL (to cut Twilio cost) where the customer has an email on file.

**Method:** Static trace of the single send primitive `sendSMS()` and all 33 of its call sites, plus every cron/webhook/queue trigger and the consent gate. Read-only audit. Line numbers verified against source on 2026-05-31 (±2).

---

## 1. Architecture — how SMS is sent (READ THIS FIRST)

### One send primitive
- **`src/lib/twilio.ts:207`** — `export const sendSMS = async (to, body, options)`. This is the ONLY function that calls Twilio. The single `client.messages.create` is at **`src/lib/twilio.ts:457`**. There is **no second SMS stack** — `SMSService` does not exist. Everything funnels through here.
- It records every outbound message to the `messages` table (via `recordOutboundSmsMessage`, `src/lib/sms/logging.ts`), shortens URLs, applies quiet-hours deferral (can re-enqueue itself as a `send_sms` job, `twilio.ts:362`), idempotency/dedup, and safety rate-limits (`src/lib/sms/safety.ts`).

### The consent gate (uniform, applies to every send with a resolvable customer)
`sendSMS` → `isCustomerSmsSendAllowed(customerId, to, ...)` (`twilio.ts:127-189`), called at `twilio.ts:229-247`. Logic, in order:
1. Phone-ownership check: the `to` number must match the customer's stored phone, else `customer_phone_mismatch` → **blocked**.
2. `if options.allowTransactionalOverride === true → ALLOW` (skips both checks below).
3. `if customer.sms_opt_in === false → blocked` (`sms_opt_in_blocked`).
4. `if customer.sms_status === null || 'active' → ALLOW`; otherwise **blocked** (`sms_status_blocked`).

**Critical nuances:**
- The gate **only runs when a `customerId` resolves**. With `createCustomerIfMissing: false` and no `customerId` (and no phone match to an existing customer), the gate is skipped entirely — the SMS sends with no consent check (this is how staff/manager-alert and OTP sends behave).
- `sms_opt_in` is a **single global opt-in** consulted for ALL message types here (not just marketing). So a customer who replied STOP (sets `sms_opt_in=false`, see webhook) is blocked from ALL transactional SMS too — unless the caller passes `allowTransactionalOverride: true`.
- `allowTransactionalOverride: true` is currently used by exactly two places: **Sunday pre-order link** (`table-bookings/bookings.ts:1052`) and it is NOT broadly used elsewhere. Parking/table/private-booking sends do **not** override — they respect `sms_opt_in`/`sms_status`.
- There is **no `marketing_sms_opt_in` check inside `sendSMS`**. Marketing consent (`marketing_sms_opt_in`) is enforced only by the bulk-campaign recipient filter (`src/lib/sms/bulk.ts:255-266`), which checks `sms_opt_in === true` AND `marketing_sms_opt_in === true` AND `sms_status` not blocked.

### Cost model
`src/lib/twilio.ts`: segments = `ceil(body.length / 160)`, `cost_usd ≈ segments * 0.04` → **$0.04 per 160-char segment**, stored per-message in `messages.cost_usd`. Most templates prefix `"The Anchor: "` and append a reply instruction + support number, so confirmations with a name + date + URL frequently exceed 160 chars → **2 segments**.

### Templates: there is NO single template table
Almost every customer SMS body is an **inline string** built in code (e.g. ``The Anchor: Hi ${firstName}, ...``), tagged with a `metadata.template_key` for logging/dedup only. Private-booking message bodies come from helper builders in `src/lib/private-bookings/*` and are stored on the `private_booking_sms_queue` row. The `message_templates` / `event_message_templates` / `table_booking_sms_templates` tables exist in the schema and are managed via `src/app/actions/messageTemplates.ts` + `EventTemplateManager.tsx`, **but the live send paths build bodies inline** — those tables are largely legacy/admin-managed and not the source for the sends below. (Confirm before assuming an editable template exists for any given message.)

### Job queue
`enqueueJob`/`jobQueue.enqueue` (`src/lib/unified-job-queue.ts`, `src/lib/background-jobs.ts`) supports `send_sms` and `send_bulk_sms`. `send_sms` is used internally by `sendSMS` for quiet-hours deferral. `send_bulk_sms` is the bulk-campaign path. Drained by cron `/api/jobs/process?process=true&batch=30` (every minute). **No `send_review_request` job type exists** (reviews are sent inline by the engagement cron).

---

## 2. Master table

Recipient: C=customer, M=manager/staff number, O=ops. Consent: "gate" = standard `sms_opt_in`+`sms_status` check; "gate (override)" = `allowTransactionalOverride` bypasses opt-in; "NONE" = no customer resolved so no check.

| # | Communication | Trigger | Send location | Recip | Body source (template_key) | Consent | Txn/Mktg | Email equiv? |
|---|---|---|---|---|---|---|---|---|
| 1 | Event booking confirmation / pending-payment | Booking created | `src/services/event-bookings.ts:251` | C | inline (`event_booking_confirmed` / `event_booking_pending_payment`) | gate | Txn | Manager email exists; customer email unclear |
| 2 | Event payment confirmed | PayPal capture | `src/lib/events/event-payments.ts:438` | C | inline (`event_payment_confirmed`) | gate | Txn | No |
| 3 | Event payment retry (failed payment) | Payment failure | `src/lib/events/event-payments.ts:737` | C | inline (`event_payment_retry`) | gate | Txn | No |
| 4 | Event seats updated | Staff edits seats | `src/lib/events/event-payments.ts:592` | C | inline (`event_booking_seats_updated`) | gate | Txn | No |
| 5 | Event rescheduled | Staff reschedules event | `src/app/actions/events.ts:407` | C | inline (`event_rescheduled`) | gate | Txn | No |
| 6 | Event cancelled (whole event) | Staff cancels event | `src/services/events.ts:989` | C | inline (`event_cancelled`) | gate | Txn | No |
| 7 | Event booking cancelled (admin) | Staff cancels one booking | `src/app/actions/events.ts:1462` | C | inline (`event_booking_cancelled_admin`) | gate | Txn | No |
| 8 | Event hold expired (seats released) | Cron `event-booking-holds` (*/5) | `src/app/api/cron/event-booking-holds/route.ts:141` | C | inline (`event_hold_expired`) | gate | Txn | No |
| 9 | Event 1-day reminder | Cron `event-guest-engagement` (*/15) | `route.ts` send via `:450`, stage `reminders:send_sms` (`:880`) | C | inline (`event_reminder_1d`), seats>0 only | gate | Txn | No |
| 10 | Event "no-seats"/promo reminders (7d/3d) | Cron `event-guest-engagement` | template keys `event_reminder_promo_7d/3d(_paid)` | C | inline | gate | **Mktg** | No |  ⚠️ **DISABLED**: `EVENT_ENGAGEMENT_UPCOMING_SMS_ENABLED = false` (`route.ts:37`) |
| 11 | Event review request | Cron `event-guest-engagement`, post-event | `route.ts:1055`, stage `reviews:send_sms` (`:1075`) | C | inline (`event_review_followup`) | gate + review-once suppression | Txn/borderline | No |
| 12 | Event cross-promotion (14d) | engagement Stage 3 | `src/lib/sms/cross-promo.ts:141` (`sendEventCrossPromotion`) | C | inline (`event_cross_promo_14d(_paid)`) | gate, `marketing:true` | **Mktg** | No | ⚠️ **DISABLED**: `EVENT_ENGAGEMENT_INTEREST_MARKETING_ENABLED = false` (`route.ts:39`); zero live callers |
| 13 | Event waitlist — joined | Customer joins waitlist | `src/app/api/event-waitlist/route.ts:105` | C | inline (`event_waitlist_joined`) | gate | Txn | No |
| 14 | Event waitlist — seat offer | Cron `event-waitlist-offers` (*/5) | `src/lib/events/waitlist-offers.ts:290` | C | inline (`event_waitlist_offer`) | gate | Txn | No |
| 15 | Event waitlist — offer accepted/confirmed | Customer confirms via link | `src/app/g/[token]/waitlist-offer/confirm/route.ts:169` | C | inline (`event_waitlist_accepted_confirmed` / `..._pending_payment`) | gate | Txn | No |
| 16 | Table booking created/confirmation | Booking created (API/FOH) | `src/lib/table-bookings/bookings.ts:768`; triggers `api/table-bookings/route.ts:347`, `api/foh/bookings/route.ts:1264` | C | inline (`table_booking_confirmed` / `_pending_payment`) | gate | Txn | Manager email exists; customer email unclear |
| 17 | Table booking confirmed after deposit | Stripe/PayPal deposit captured | `bookings.ts:923`; triggers `api/stripe/webhook/route.ts:568`, `lib/table-bookings/paypal-deposit.ts:119` | C | inline (`table_booking_deposit_confirmed`) | gate | Txn | No |
| 18 | Sunday lunch pre-order link | Cron `sunday-preorder` (Thu 11:00) | `bookings.ts:1050`; trigger `src/app/api/cron/sunday-preorder/route.ts:80` | C | inline (`sunday_preorder_request`) | **gate (override)** — bypasses opt-in | Txn | No |
| 19 | Table booking cancelled | Cancel (FOH/BOH/cron timeout) | `bookings.ts:1195`; triggers in `api/foh/bookings/[id]/cancel`, `api/boh/table-bookings/[id]/route|status`, `cron/table-booking-deposit-timeout:82` | C | inline (`table_booking_cancelled`) | gate | Txn | No |
| 20 | Table booking party-size threshold → deposit due | Staff changes party size | `src/lib/table-bookings/staff-deposit-transitions.ts:149` | C | inline (`table_booking_pending_payment`) | gate | Txn | No |
| 21 | Table booking — manual staff SMS | Staff types message in BOH | `src/app/api/boh/table-bookings/[id]/sms/route.ts:116` | C | free text (`boh_manual_booking_sms`) | gate | Txn (staff-authored) | n/a |
| 22 | Table review request | Cron `event-guest-engagement`, post-visit | `route.ts:1377`, stage `table_reviews:send_sms` (`:1395`) | C | inline (`table_review_followup`) | gate + review-once suppression | Txn/borderline | No |
| 23 | Parking — payment request | Staff/system requests payment | `src/lib/parking/payments.ts:185` (`sendParkingPaymentRequest`) | C | inline (`parking_payment_request`) | gate | Txn | Manager email only; customer email NOT sent |
| 24 | Parking — payment confirmation | Payment captured | `src/lib/parking/payments.ts:502` (`sendConfirmationNotifications`) | C | inline (`parking_payment_confirmation`) | gate | Txn | Manager email only |
| 25 | Parking — reminders / expiry / session events | Cron `parking-notifications` (*/15) | `src/app/api/cron/parking-notifications/route.ts:865` | C | inline; `templateKey` varies by `eventType` | gate | Txn | No customer email path in cron |
| 26 | Private booking — auto-sent lifecycle SMS | Booking lifecycle mutations | `SmsQueueService.queueAndSend` (many callers in `services/private-bookings/*`); send at `src/services/sms-queue.ts:233` | C | builder strings on `private_booking_sms_queue` row | gate (`createCustomerIfMissing:false`) | Txn | Private-booking emails exist (deposit/contract) — partial overlap |
| 27 | Private booking — deposit/balance reminders | Cron `private-booking-monitor` (09:00) | queued+sent via `SmsQueueService.queueAndSend` (`route.ts:549/619/782/874`) | C | builders `depositReminder*`/`balanceReminder*` | gate | Txn | Partial | ⚠️ event/balance reminders partly gated by an "upcoming SMS disabled" flag (`route.ts:440`) |
| 28 | Private booking — review request | Cron `private-booking-monitor` | `route.ts:1130` (`trigger_type: 'review_request'`) | C | builder | gate | Txn/borderline | No |
| 29 | Private booking — manual/approved queued SMS | Staff approves in SMS queue UI | `sendApprovedSms` → `sms-queue.ts:233`; UI `private-bookings/sms-queue/page.tsx:68` | C | free text on queue row | gate | Txn (staff-authored) | n/a |
| ~~30~~ | ~~Private booking manager notification~~ — **NOT SMS** | — | `src/lib/private-bookings/manager-notifications.ts` uses `sendEmail` only (no `sendSMS`). Listed for completeness; **already email**. | M | n/a | n/a | n/a | Already email |
| 31 | Bulk SMS campaign (broadcast) | Staff action | `src/app/actions/sms-bulk-direct.ts:41` (`sendBulkSMSDirect`) → job `send_bulk_sms` → `src/lib/sms/bulk.ts:324` | C (many) | free text (`bulk_sms_campaign`) | **gate + `marketing_sms_opt_in` filter** (`bulk.ts:255-266`) | **Mktg** | n/a |
| 32 | Two-way conversation reply (staff → customer) | Staff replies in Messages UI | `src/app/actions/sms.ts:316` (`sendSms`) and `src/services/messages.ts:105` | C | free text (`message_thread_reply`) | gate (`messages.ts` also pre-checks opt-out) | Txn (1:1) | n/a |
| 33 | OTP / verification code | Customer auth/verify flow | `src/app/actions/sms.ts:200` | C | inline (`otp_message`), `createCustomerIfMissing:false` | gate if customer matches, else NONE | Txn (security) | **Must stay SMS** |
| 34 | Reply-to-book auto-response | Inbound Twilio webhook (customer texts back) | `src/app/api/webhooks/twilio/route.ts:493` | C | dynamic (`event_reply_booking_response`) | gate | Txn (conversational) | n/a |
| 35 | FOH food-order alert | FOH presses "food order" button | `src/app/api/foh/food-order-alert/route.ts:32` | **O** (fixed `FOOD_ORDER_ALERT_NUMBER`) | constant `FOOD_ORDER_ALERT_MESSAGE` | NONE (`skipMessageLogging`, no customer) | Txn (internal) | n/a — internal kitchen alert |
| 36 | Refund confirmation | Refund processed | `src/lib/refund-notifications.ts:48` | C | inline | gate | Txn | **Email-first, SMS only as fallback** (`refund-notifications.ts:37-53`) |

---

## 3. Per-item / cross-cutting detail

- **Event reminders moved into one cron.** All event/table reminders + reviews now run from **`event-guest-engagement`** (every 15 min). The only reminder that actually ships is `event_reminder_1d` for bookings with `seats > 0` (`route.ts:804` guards `seats <= 0`). The promo "no-seats" reminders (#10) and cross-promo (#12) are **both behind feature flags set to `false`** — currently dormant. If the owner re-enables them, they become high-volume marketing SMS and prime email candidates.
- **Reviews (#11, #22)** carry strong suppression: review-once across channels (`src/lib/sms/review-once.ts`), first-visit-only, and `review_sms_sent_at` dedup. They transition booking status to `visited_waiting_for_review`.
- **Inbound webhook (`api/webhooks/twilio/route.ts`)** does TWO things relevant here: (a) sends the reply-to-book auto-response (#34); (b) manages opt-in state — STOP/UNSUBSCRIBE/QUIT/CANCEL/END/STOPALL sets `sms_opt_in=false` AND `marketing_sms_opt_in=false` (`:618-628`), START sets `sms_opt_in=true` (`:547`). **No SMS confirmation of opt-out is sent.**
- **Parking customer email gap:** `parking/payments.ts` builds and sends a **manager** email on confirmation (`:560-561`) but the customer only gets SMS. `customerFallback.email` is passed to `sendSMS` only to create/enrich the customer record, not to send email. So parking is a clean candidate to ADD customer email.
- **Refund (#36) is the existing model for "email if available, else SMS"** — `refund-notifications.ts` tries `sendEmail` first and only falls back to `sendSMS`. Copy this pattern.
- **Private bookings (#26-#29)** all flow through `SmsQueueService` (`src/services/sms-queue.ts`). Some triggers auto-send (set in `PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS`, `sms-queue.ts:46-72`: `booking_created`, `deposit_received`, `payment_received`, `booking_confirmed`, cancellations, reminders, `review_request`, etc.); others wait for staff approval. Recipient phone resolves via `resolvePrivateBookingRecipientPhone` (booking contact, not necessarily a `customers` row). `queueAndSend` calls `sendSMS` with `createCustomerIfMissing: false` → if the contact isn't an existing customer, the consent gate is skipped.
- **Internal/staff SMS:** the only true internal SMS is **#35 food-order alert** (fixed kitchen number, bypasses consent gate). The private-booking manager notification (#30) is **email already**, not SMS — corrected in the table. Exclude both from the customer email-switch.
- **OTP (#33) must remain SMS** — email-based 2FA defeats the purpose for phone verification.

### Cost signals (where the money is)
1. **Bulk campaigns (#31)** — one SMS per opted-in customer; the single largest discretionary cost. Already marketing-gated.
2. **Event reminders (#9)** + (if re-enabled) **#10 promo reminders** — one per upcoming booking, recurring.
3. **Table/Sunday reminders & confirmations (#16-#19)** and **parking (#23-#25)** — steady daily volume; bodies often 2 segments.
4. **Reviews (#11, #22)** — one per visit.

---

## 4. Channels that do NOT send customer SMS (verified)

- **Rota** crons (`rota-auto-close`, `rota-manager-alert`, `rota-staff-email`) — email only (`rota-manager-alert` uses `sendEmail`). No SMS.
- **Birthday reminders** cron — not SMS to customers (employee/email oriented).
- **Invoices, payroll, OJ-projects, employee-invite/separations** crons — email/PDF, no SMS.
- **Waitlist/loyalty/OTP**: only OTP (#33) sends SMS; no loyalty SMS exists; waitlist is covered (#13-#15).
- `src/lib/sms/templates.ts` (legacy inline templates) — not imported by any live send path.

---

## 5. Gaps & Risks

1. **`sms_opt_in` is a single global flag gating BOTH transactional and marketing SMS** (`twilio.ts:173`). A customer who texts STOP loses all transactional SMS (booking confirmations, parking, etc.), except the two `allowTransactionalOverride` paths. When moving to email, decide whether `sms_opt_in=false` should also suppress transactional EMAIL (the design says no). **There is currently no email suppression or marketing-email preference column** — both are needed before any marketing email work.
2. **No central channel-selection logic.** Each of the 36 sites calls `sendSMS` directly with an inline body. An email switch touching all of them is large; the elegant move is a single `notifyCustomer({ customerId, templateKey, smsBody, emailHtml, channelPolicy })` dispatcher (mirroring `refund-notifications.ts`) and routing callers through it. Without that, the change is shotgun-scattered and error-prone.
3. **Bodies are inline strings, not DB templates.** Email versions must be authored per message (≈30 customer-facing messages). The `message_templates`/`table_booking_sms_templates` tables are NOT the live source, so don't assume editing them changes anything.
4. **Private-booking & manager sends skip the consent gate** (`createCustomerIfMissing:false` with non-customer contacts, or `customerId:undefined`). For these, an email address must be sourced from the booking/contact record, not `customers`, and consent basis is the booking relationship.
5. **Parking confirmation already emails the manager but never the customer** — low-hanging fruit to add customer email and drop the SMS.
6. **Two marketing flags are OFF** (`EVENT_ENGAGEMENT_UPCOMING_SMS_ENABLED`, `EVENT_ENGAGEMENT_INTEREST_MARKETING_ENABLED`). If the spec assumes these are live, it's wrong today. Confirm whether they'll be turned on (and should go straight to email).
7. **Cost is recorded per message (`messages.cost_usd`) but not aggregated** — savings modelling needs a query grouped by `metadata.template_key` / `message_type` over the `messages` table.
8. **`allowTransactionalOverride` is a real footgun** — it bypasses opt-in. Only Sunday pre-order uses it now; any email-switch refactor must preserve/relocate that intent deliberately.

---

## 6. Open questions for the user

1. **Replace or supplement?** When a customer has an email, do we send email INSTEAD of SMS, or BOTH? Per message type? (Refund already does email-first-then-SMS-fallback — is that the desired default everywhere?)
2. **Scope:** All customer-facing transactional (most of #1-#25, #36) are candidates. Include bulk marketing (#31) as email too, or keep that as SMS / a separate email-marketing track? Exclude internal alerts (#30, #35) and OTP (#33)?
3. **Email consent/preference:** There's no email-opt-out column today. Do we add one? Should an SMS STOP also opt the customer out of marketing email (it currently clears `marketing_sms_opt_in` only)?
4. **Time-critical messages** (parking expiry/session-ending #25, payment retry #3, hold expired #8): acceptable as email, or must stay SMS for immediacy?
5. **Private-booking contacts** often aren't `customers` rows — is there a reliable email on the booking, and is the organiser's consent assumed?
6. **Do you want a single unified `notifyCustomer` dispatcher built** (channel policy + consent + per-channel templates + cost logging), rather than editing 30+ call sites individually? Strongly recommended.
7. **The two disabled marketing flags** — will event promo reminders / cross-promo be turned on, and if so should they launch as email from day one?
8. **Sunday pre-order (#18)** uses `allowTransactionalOverride` (ignores opt-in). Keep that override semantics when moving to email?

---

*Generated by communications-discovery audit, 2026-05-31. Read-only; no source files modified. 36 distinct SMS communications identified (34 via direct `sendSMS`, plus the deferral job path and bulk job path).* 
