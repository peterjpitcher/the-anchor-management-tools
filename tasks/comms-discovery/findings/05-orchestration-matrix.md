# 05 — Comms Orchestration & Scheduling Matrix

**Scope:** Map how The Anchor Management Tools fires customer/staff communications (SMS + email), identify the central send chokepoint(s), and recommend the cleanest hook point for a **channel-selection engine** (prefer EMAIL over SMS when a customer has an email, to cut Twilio cost).

**Method:** Read `vercel.json`, enumerated `src/app/api/cron/**` and `src/app/api/webhooks/**`, read the send-function definitions, the unified job queue, the SMS-queue service, and both webhook routes; traced all `sendSMS` / `sendEmail` call sites.

> NOTE: The load-bearing architectural facts are **directly verified**: (a) `sendSMS` in `src/lib/twilio.ts:207` is the single SMS transport (only `messages.create` in the repo; 25 importers), and (b) `sendEmail` in `src/lib/email/emailService.ts:25` is the generic transport-A email wrapper. A separate Microsoft Graph transport B exists for invoices/quotes/internal reminders and is out of scope for the channel-selection engine.

---

## 1. Cron Matrix

`vercel.json` declares **29 cron entries**. The very first one is the **background-job processor** (`/api/jobs/process`), which is the real async dispatch engine — most *event-driven* comms (booking confirmations, reminders, bulk sends) flow through enqueued jobs, NOT through the dedicated `/api/cron/*` routes. The `/api/cron/*` routes are mostly *time-based sweeps* that compute "who is due" and then either send inline or enqueue a job.

Additionally there are **cron route directories with no `vercel.json` schedule** (manual/internal or disabled): `backfill-marketing-links`, `pub-ops-event-calendar-sync`, `sunday-lunch-prep`, `sunday-preorder`. (32 cron dirs on disk vs 29 scheduled paths; `/api/jobs/process` is scheduled but lives under `/api/jobs`, not `/api/cron`.)

| Cron (path) | Schedule (UTC) | Comms sent | Channel | Recipient | File |
|---|---|---|---|---|---|
| `/api/jobs/process?process=true&batch=30` | `* * * * *` (every min) | **Drains unified job queue** — actual send happens here for queued SMS/bulk SMS and non-comms jobs | SMS | Customers (per job) | `src/app/api/jobs/process/route.ts` |
| `/api/cron/event-booking-holds` | `*/5 * * * *` | Hold-expiry / release notice (verify) | likely SMS | Customers w/ event holds | `src/app/api/cron/event-booking-holds/route.ts` |
| `/api/cron/event-waitlist-offers` | `*/5 * * * *` | Waitlist seat-offer notice (verify) | SMS and/or Email | Waitlisted customers | `src/app/api/cron/event-waitlist-offers/route.ts` |
| `/api/cron/event-guest-engagement` | `*/15 * * * *` | Guest engagement nudges (verify) | likely SMS | Event guests | `src/app/api/cron/event-guest-engagement/route.ts` |
| `/api/cron/parking-notifications` | `*/15 * * * *` | Parking start/expiry/reminder notices (verify) | SMS (parking flow) | Parking guests | `src/app/api/cron/parking-notifications/route.ts` |
| `/api/cron/reconcile-sms` | `*/15 * * * *` | **No send** — reconciles Twilio delivery status (reads `messages.create`/status API) | n/a | n/a (system) | `src/app/api/cron/reconcile-sms/route.ts` |
| `/api/cron/paypal-deposit-reconciliation` | `*/15 * * * *` | Possible payment-state follow-up (verify) | maybe none | system / customers | `src/app/api/cron/paypal-deposit-reconciliation/route.ts` |
| `/api/cron/private-booking-monitor` | `0 9 * * *` | Private-booking status/SLA alerts (verify) | Email/SMS (staff) | Staff/managers | `src/app/api/cron/private-booking-monitor/route.ts` |
| `/api/cron/invoice-reminders` | `0 9 * * *` | Invoice due/overdue reminders (verify) | Email | Invoice contacts | `src/app/api/cron/invoice-reminders/route.ts` |
| `/api/cron/birthday-reminders` | `0 9 * * *` | Employee birthdays digest | Email | Manager | `src/app/api/cron/birthday-reminders/route.ts` |
| `/api/cron/oj-projects-billing-reminders` | `0 9 * * *` | OJ Projects billing reminders (verify) | Email | OJ clients | `src/app/api/cron/oj-projects-billing-reminders/route.ts` |
| `/api/cron/event-checklist-reminders` | `0 8 * * *` | Event prep checklist reminders | Email | Staff | `src/app/api/cron/event-checklist-reminders/route.ts` |
| `/api/cron/auto-send-invoices` | `0 7 * * *` | Sends generated invoices | Email | Invoice contacts | `src/app/api/cron/auto-send-invoices/route.ts` |
| `/api/cron/apply-customer-labels` | `0 2 * * *` | **No send** — segmentation/labels | n/a | n/a | `src/app/api/cron/apply-customer-labels/route.ts` |
| `/api/cron/engagement-scoring` | `0 3 * * *` | **No send** — scoring | n/a | n/a | `src/app/api/cron/engagement-scoring/route.ts` |
| `/api/cron/cleanup-rate-limits` | `0 3 * * *` | **No send** — maintenance | n/a | n/a | `src/app/api/cron/cleanup-rate-limits/route.ts` |
| `/api/cron/oj-projects-retainer-projects` | `0 0 1 * *` | **No send** — provisioning (verify) | n/a | system | `src/app/api/cron/oj-projects-retainer-projects/route.ts` |
| `/api/cron/oj-projects-billing` | `5 1 * * *` | Billing run; may email invoices (verify) | Email | OJ clients | `src/app/api/cron/oj-projects-billing/route.ts` |
| `/api/cron/recurring-invoices` | `0 1 * * *` | Generates (and possibly sends) recurring invoices (verify) | Email | Invoice contacts | `src/app/api/cron/recurring-invoices/route.ts` |
| `/api/cron/private-bookings-weekly-summary` | `0 * * * *` (hourly gate) | Weekly private-bookings summary | Email | Staff/managers | `src/app/api/cron/private-bookings-weekly-summary/route.ts` |
| `/api/cron/generate-slots` | `0 0 * * 1` | **No send** — availability slot generation | n/a | n/a | `src/app/api/cron/generate-slots/route.ts` |
| `/api/cron/employee-invite-chase` | `0 9 * * *` | Chase unaccepted employee invites | Email | Employees | `src/app/api/cron/employee-invite-chase/route.ts` |
| `/api/cron/rota-auto-close` | `0 5 * * *` | **No send (likely)** — auto-closes rota; may alert | maybe Email | Staff | `src/app/api/cron/rota-auto-close/route.ts` |
| `/api/cron/employee-separations` | `0 6 * * *` | Separation processing (verify) | maybe Email | Staff/HR | `src/app/api/cron/employee-separations/route.ts` |
| `/api/cron/payroll-periods` | `15 6 * * *` | **No send (likely)** — period rollover | n/a | system | `src/app/api/cron/payroll-periods/route.ts` |
| `/api/cron/rota-manager-alert` | `0 18 * * 0` (Sun) | Manager alert: rota not finalised | Email | Managers | `src/app/api/cron/rota-manager-alert/route.ts` |
| `/api/cron/rota-staff-email` | `0 21 * * 0` (Sun) | Weekly rota to staff | Email | Staff | `src/app/api/cron/rota-staff-email/route.ts` |
| `/api/cron/table-booking-deposit-timeout` | `0 * * * *` | Deposit-timeout cancellation + notice (verify) | SMS/Email | Customers | `src/app/api/cron/table-booking-deposit-timeout/route.ts` |
| `/api/cron/private-bookings-expire-holds` | `0 6 * * *` | Expire private-booking holds (+ notice?) (verify) | maybe SMS/Email | Customers/staff | `src/app/api/cron/private-bookings-expire-holds/route.ts` |

**Unscheduled cron dirs (on disk, not in `vercel.json`):** `backfill-marketing-links`, `pub-ops-event-calendar-sync`, `sunday-lunch-prep`, `sunday-preorder`. `sunday-preorder` / `sunday-lunch-prep` are strong candidates for Sunday-lunch reminder comms — **verify whether they are invoked via the job queue or a separate trigger.**

**Takeaway:** Roughly half the `/api/cron/*` routes send no comms (scoring, labels, slot generation, cleanup, reconciliation, payroll rollover). The comms-bearing ones split into:
- **Customer-facing transactional/reminder** (events, parking, table-booking) — the prime targets for channel selection.
- **Staff/admin operational** (rota, private-booking summaries, invoice/billing, employee invites) — mostly email already; lower priority for the cost-saving engine.

---

## 2. Background Job System (the real async dispatch) — VERIFIED

- **Queue trigger:** `vercel.json` cron `/api/jobs/process?process=true&batch=30` every **60 seconds**. Batch param parsed, floored to 1, **hard-capped to 100** (default 30) to prevent flood runs. Auth via `authorizeCronRequest` (`src/lib/cron-auth.ts`). Manual trigger: `src/app/api/jobs/process-now/route.ts`.
- **Route is thin:** `src/app/api/jobs/process/route.ts` does only auth + `await jobQueue.processJobs(batchSize)`. The real engine is **`src/lib/unified-job-queue.ts`** (singleton `jobQueue`).
- **Engine + type files:** `src/lib/unified-job-queue.ts` (dispatch), `src/lib/job-types.ts` (job `type` union + payloads), plus `src/lib/job-processor.ts`, `src/lib/background-jobs.ts`, `src/lib/job-queue.ts`.
- **Admin UI:** `src/app/(authenticated)/settings/background-jobs/`.
- **Queue table:** defined in `supabase/migrations/20251123120000_squashed.sql`. Jobs carry a `type` discriminator + JSON payload.
- **Queue→send service:** `src/services/sms-queue.ts` imports `sendSMS` directly — i.e. queued SMS reminders ultimately call the same chokepoint.

**Job types & dispatch (VERIFIED — `src/lib/unified-job-queue.ts`):**
- `processJobs(limit)` → `claimJobs` (Postgres `claim_jobs` RPC w/ lease, fallback to direct update) → `processJob` → `executeJob(type)` switch.
- `SUPPORTED_JOB_TYPES` (the only types this queue claims/runs): `send_sms`, `send_bulk_sms`, `export_employees`, `rebuild_category_stats`, `categorize_historical_events`, `generate_report`, `sync_calendar`, `cleanup_old_data`, `classify_receipt_transactions`, `detect_receipt_rule_conflicts`, `suggest_receipt_rules`, `refresh_receipt_duplicate_candidates`, `reconcile_receipt_invoice_payments`.
- **Comms handlers in `executeJob`:** `case 'send_sms'` → `const { sendSMS } = await import('@/lib/twilio')` then `sendSMS(payload.to, messageWithSupport, { customerId, metadata })` (line ~1038–1066). `case 'send_bulk_sms'` → `sendBulkSms` from `@/lib/sms/bulk` (which itself calls `sendSMS`). Template-based SMS jobs are explicitly rejected (`'Template-based SMS jobs are no longer supported'`).
- **CRITICAL: the unified queue has NO email handler.** Its `executeJob` switch has no `send_email` case; `SUPPORTED_JOB_TYPES` excludes email. There is a *separate, legacy* `src/lib/job-types.ts` union that DOES list `send_email` / `send_welcome_email`, consumed by `src/lib/background-jobs.ts` / `src/lib/job-processor.ts` (the pre-unification processors). **So the every-minute `/api/jobs/process` cron dispatches SMS only.** Welcome/loyalty emails ride the older job path or are sent inline.
- SMS jobs run **serially** with a fatal-safety abort (if outbound persistence fails, remaining SMS jobs are requeued) — non-SMS jobs run concurrently. Idempotency via `claimIdempotencyKey` + `template_key`/`stage` fingerprint metadata.
- Table: `jobs` (`.from('jobs')`), defined in `supabase/migrations/20251123120000_squashed.sql`.

**Why this matters:** For **automated SMS**, this is the single best hook point — one `case 'send_sms'` handler, one `sendSMS` call, covering all queued sends. But because email does NOT flow through this queue, a job-processor-only hook cannot *divert SMS→email* here unless you also teach this handler to call `sendEmail` (i.e. introduce a `notify_customer` job type or channel-resolve inside `send_sms`). That nuance pushes the design toward a small shared engine (below) rather than a pure in-place edit.

---

## 3. Send Chokepoints (DIRECTLY VERIFIED)

### 3a. Email — generic wrapper chokepoint ✅
- **`sendEmail(options)` — `src/lib/email/emailService.ts:25`** is the generic transport-A email wrapper. Venue/HR/ops/customer emails such as rota, private bookings, invites, calendar invites, parking manager notices, refunds, and OJ client statements go through `sendEmail()` plus thin template helpers (`src/lib/email/private-booking-emails.ts`, `employee-invite-emails.ts`, `calendar-invite.ts`). Orange Jelly invoices/quotes/internal reminders use the separate transport-B functions in `src/lib/microsoft-graph.ts` and are excluded from the Resend Phase 1/channel-selection work.

### 3b. SMS — SINGLE raw-send chokepoint ✅
- **`export const sendSMS = async (to, body, options: SendSMSOptions = {})` — `src/lib/twilio.ts:207`** is the single SMS transport, and **`src/lib/twilio.ts` is the ONLY file that calls `client.messages.create`** (line ~457). Every customer SMS routes through `sendSMS`. **25 importers** confirmed, including: `src/lib/unified-job-queue.ts` (queue), `src/services/sms-queue.ts` (private-booking reminders), `src/app/api/webhooks/twilio/route.ts` (reply auto-response), `src/lib/sms/bulk.ts`, `src/lib/sms/cross-promo.ts`, `src/lib/refund-notifications.ts`, `src/lib/events/{waitlist-offers,event-payments}.ts`, `src/lib/parking/payments.ts`, `src/lib/table-bookings/{bookings,staff-deposit-transitions}.ts`, `src/services/{event-bookings,events,messages}.ts`, `src/app/actions/{sms,events}.ts`, and several API routes.
- The `src/lib/sms/` directory is a rich support layer around `sendSMS` (NOT competing senders): `bulk.ts`, `quiet-hours.ts`, `safety.ts`/`safety-info.ts`, `suspension.ts`, `sanitise.ts`, `templates.ts`, `link-shortening.ts`, `logging.ts`, `metadata.ts`, `review-once.ts`, `reply-to-book.ts`, `cross-promo.ts`, `support.ts` (`ensureReplyInstruction`).
- Other files matching `messages.create` are **NOT customer sends** — they call the Twilio *messages list/fetch/status* API for import/diagnostics/reconciliation/GDPR: `src/app/api/cron/reconcile-sms/route.ts`, `src/app/actions/import-messages.ts`, `src/app/actions/diagnose-messages.ts`, `src/scripts/import-missed-messages.ts`, `src/services/gdpr.ts`, plus UI files that render existing messages.

**ACTION TO CONFIRM:** read `src/lib/twilio.ts` to capture the exact exported send function name(s) and signature (e.g. `sendSMS` / `sendSmsMessage` / a class method) and whether bulk sends in `src/lib/sms/bulk.ts` funnel back through it or call `messages.create` directly. The grep says only `twilio.ts` contains `messages.create`, so bulk **does** funnel through it — good.

### Architecture verdict
There are **two clean chokepoints, one per channel** — NOT a single unified `notify()` that already abstracts channel. So:
- A customer SMS path = enqueue/call → `src/lib/sms/*` helpers → **`src/lib/twilio.ts` (send)**.
- A transport-A customer email path = call → template helper → **`sendEmail()` (send)**.
- These two never meet at a shared "decide channel" layer today. Call sites individually decide "send an SMS" or "send an email."

---

## 4. Reminder Systems (what to send + when)

Multiple independent reminder mechanisms exist, each computing "who is due" then calling `sendSMS` (inline or via queue):

- **Private bookings (VERIFIED — `src/services/sms-queue.ts`, `SmsQueueService`):** the richest reminder engine. Trigger types: `booking_created/confirmed/completed`, several `booking_cancelled*`, `booking_expired`, `deposit_reminder_7day/1day`, `balance_reminder_14day/7day/1day`, `event_reminder_1d`, `setup_reminder`. Messages are staged in the **`private_booking_sms_queue`** table (status `pending → approved → sent/failed/cancelled`) with heavy dedupe/locking (`private_booking_audit` trail), then physically sent by calling **`sendSMS`** directly. Channel = **SMS, hard-coded**. Driven by crons `private-booking-monitor`, `private-bookings-expire-holds`, `private-bookings-weekly-summary` (+ approval UI).
- **Event reminders / engagement:** crons `event-booking-holds`, `event-waitlist-offers`, `event-guest-engagement`, `event-checklist-reminders`; senders `src/lib/events/waitlist-offers.ts`, `src/lib/events/event-payments.ts`, `src/services/event-bookings.ts`, `src/services/events.ts` — all import `sendSMS`. SMS, mostly **inline**. Tables likely `booking_reminders` / `reminder_processing_logs` (verify).
- **Table bookings:** `table-booking-deposit-timeout` cron; senders `src/lib/table-bookings/bookings.ts`, `staff-deposit-transitions.ts`, `src/app/api/boh/table-bookings/[id]/sms/route.ts` — `sendSMS` inline. Reminder history table (e.g. `table_booking_reminder_history`) — verify.
- **Parking:** `parking-notifications` cron + `src/lib/parking/payments.ts` → `sendSMS`. SMS, driven by per-record notification flags. **Refunds:** `src/lib/refund-notifications.ts` → `sendSMS`.
- **Birthdays / invoices / OJ billing / rota / employee invites:** dedicated daily/weekly crons — mostly **email** via `sendEmail` for transport A and `microsoft-graph.ts` for transport B.

**Pattern:** "what + when" is computed by the cron/service (rows where due + not-yet-sent), then dispatched **either inline (`sendSMS` direct) or by enqueuing a `send_sms` job**. Channel is **hard-coded per subsystem** (private/table/parking/events ⇒ SMS; rota/invoices/invites ⇒ email). There is no place today that asks "this customer has an email — should this go by email instead?"

---

## 5. Webhook → Comm Map (VERIFIED for top-level routes)

`src/app/api/webhooks/` has exactly two providers: **`paypal`** and **`twilio`** (plus PayPal *sub-routes* like `/webhooks/paypal/parking`, referenced by comment — verify their bodies separately).

| Webhook | Trigger | Comm fired? | Channel | File |
|---|---|---|---|---|
| `webhooks/twilio` | Inbound SMS + Twilio delivery-status callbacks | **Yes (one path):** inbound reply → `handleReplyToBook()`; if it returns a response, `sendSMS(fromNumber, replyResult.response, …)` (bypasses quiet hours). STOP/opt-out keywords flip `sms_status='opted_out'` (no send). Status callbacks only update `messages`/`message_delivery_status` (no send). | SMS (auto-reply only) | `src/app/api/webhooks/twilio/route.ts` (send at ~line 493) |
| `webhooks/paypal` (top-level) | PayPal events | **No customer comm.** Only `webhook_logs` + `audit_logs` writes for `PAYMENT.CAPTURE.COMPLETED` / `PAYMENT.CAPTURE.DENIED`; all other types return 200 with no action. | none | `src/app/api/webhooks/paypal/route.ts` |

So **payment-success → confirmation** is NOT fired by the top-level PayPal webhook. It must live in a PayPal **sub-route** (e.g. parking) or in the server action that captures the payment. **ACTION:** check `src/app/api/webhooks/paypal/*/route.ts` and `src/lib/parking/payments.ts` / `src/lib/events/event-payments.ts` (both import `sendSMS`) for the actual confirmation send. No Stripe webhook directory exists despite Stripe config — confirm Stripe is unused for customer comms.

---

## 6. WHERE SHOULD CHANNEL-SELECTION LIVE?

### The core question
Is there a single chokepoint to add "prefer email over SMS"? **Per channel, yes; across channels, no.** Verified:
- **One SMS transport:** `sendSMS` (`src/lib/twilio.ts:207`) — the only `messages.create`, with **25 importers** (job queue, `sms-queue` service, twilio webhook, event/table/parking libs, bulk, cross-promo, refunds, server actions, services).
- **One generic email transport A:** `sendEmail` (`src/lib/email/emailService.ts:25`) over Microsoft Graph; invoice/quote transport B is separate and excluded.
- **No shared layer above them** owns the "which channel?" decision; each of the 25 SMS call sites has *already decided* "this is an SMS." The email queue path is even separate (legacy job processor), so the unified queue can't currently divert SMS→email without new code.

This means: adding the cost-saving logic **inside `sendSMS`** would technically intercept 100% of SMS, but `sendSMS` has no email template and shouldn't grow email responsibilities (Option C, rejected). The clean answer is a thin engine above both transports.

### Candidate hook points

**Option A — Introduce a unified dispatch service `notifyCustomer()` (RECOMMENDED, phased).**
Create `src/lib/notifications/dispatch.ts` exposing something like:
```
notifyCustomer({ customerId, purpose, context, channelOverride? })
  -> resolve customer contact + preferences
  -> selectChannel(): email if email present & purpose email-eligible & customer not opted-out, else SMS
  -> render channel-appropriate template
  -> call sendEmail()  OR  src/lib/twilio.ts sender
  -> unified audit log
```
- **Pros:** Single place owns channel logic + preference + opt-out + fallback (email fails ⇒ SMS). Future-proof. Testable in isolation. Matches the existing `src/services` pattern.
- **Cons:** Requires migrating call sites to it. SMS and email templates are authored separately today, so each "purpose" needs both a template and a sender mapping. Not every SMS has an email equivalent (and vice-versa).
- **Mitigation:** Don't big-bang. Route the **highest-volume customer transactional flows first** (event/table-booking confirmations + reminders), leave staff/admin email-only flows untouched.

**Option B — Hook inside the background-job processor (`/api/jobs/process`).**
Add channel selection where comms job types are dispatched: a `notify_customer` job type (or augment existing `send_sms`/`send_email` types) that resolves channel at processing time.
- **Pros:** Covers the bulk of *automated* traffic in one file (`src/app/api/jobs/process/route.ts`). Async, retry-friendly, idempotent infra already present. Smallest blast radius for the most cost.
- **Cons:** Only covers what is enqueued as jobs. Inline sends (some crons, webhook confirmations, ad-hoc staff "send SMS now") bypass it. Channel logic risks being trapped in a route handler rather than a reusable service.
- **Best as:** the *first delivery vehicle* for Option A's `selectChannel()` — i.e. build the engine as a pure function, call it from the job processor first.

**Option C — Hook at the SMS chokepoint (`src/lib/twilio.ts`): "if customer has email, divert to email instead of sending SMS."**
- **Pros:** Literally one file; guarantees every SMS path is considered.
- **Cons:** **Anti-pattern.** The SMS sender would need to know how to render+send an *email* (wrong responsibility), wouldn't have the email template for that message, and would surprise callers expecting an SMS. Rejected except as a last-resort safety net.

### Recommendation
1. **Build a pure, side-effect-free `selectChannel()` engine** in `src/lib/notifications/` taking `{ hasEmail, hasPhone, purpose, customerPreference, optOuts }` → `'email' | 'sms'` (+ fallback order). Unit-test it. This is the "decide channel" core the owner wants and it has **no dependency on the outage-blocked file reads**.
2. **Wrap sends in `notifyCustomer()` (Option A)** that consumes `selectChannel()` and calls the two existing chokepoints. Keep `sendEmail()` and `src/lib/twilio.ts` as the dumb transports.
3. **Roll out via the job processor first (Option B)** for queued customer transactional/reminder flows, then migrate webhook confirmations, then inline cron sends. Staff/admin email-only flows can be left as-is.
4. **Preconditions to verify before building**: per-reminder inline-vs-enqueue + hard-coded channel; webhook send points; and the final customer email health/suppression columns from the design spec.

### Trade-off summary
| Approach | Coverage | Effort | Cleanliness | Verdict |
|---|---|---|---|---|
| A. Unified `notifyCustomer()` service | All flows (as migrated) | High (incremental) | High | **Target architecture** |
| B. Job-processor hook | Most *automated* sends | Low–Med | Medium | **Best first step** (host the engine here) |
| C. Inside `twilio.ts` | Every SMS | Low | **Poor** | Avoid (last-resort fallback only) |

**Bottom line:** No single existing chokepoint owns channel choice, but the two transports are each centralized. Introduce one thin **`selectChannel()` + `notifyCustomer()`** layer above them, deploy it first inside the every-minute **job processor** for the high-volume customer flows, and migrate the rest incrementally.
