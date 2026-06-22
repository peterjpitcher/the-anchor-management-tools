# Outbound Email Discovery — AMS

Read-only inventory of every outbound email send path and whether each is logged to the
customer's communication history with a `customer_id` link.

Generated: 2026-06-21

---

## (a) emailService logging behaviour + signature

**File:** `src/lib/email/emailService.ts`

**Signature (NOT the legacy positional form):**
```ts
sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }>
```
`EmailOptions` fields relevant to logging:
`to, subject, html?, text?, cc?, bcc?, attachments?, provider?, from?, graphSender?, replyTo?,`
`commType?, customerId?, metadata?, tableBookingId?, eventBookingId?, privateBookingId?, parkingBookingId?`

There is also `sendSimpleEmail(to, subject, body)` → calls `sendEmail({ to, subject, text: body })` (never passes customerId).

**Does `sendEmail` log? YES — always, on every outcome.**
- Provider is chosen by `EMAIL_PROVIDER` env / presence of Resend keys (`graph` or `resend`).
- Before sending it checks `isEmailSuppressed(to)` against the `email_suppressions` table; suppressed sends are recorded with status `suppressed` and NOT sent.
- After every send (sent / failed / suppressed) it calls `recordEmailOutcome` → `recordEmailMessage` (`src/lib/email/logging.ts`).

**Logging target:** `recordEmailMessage` inserts a row into the **`email_messages`** table (via the admin/service-role client) with:
`customer_id, to_address, from_address, comm_type, subject, resend_message_id, status, error, metadata,`
`table_booking_id, event_booking_id, private_booking_id, parking_booking_id, sent_at/failed_at, updated_at`.

**Key consequence:** Logging is automatic, but **customer linkage depends entirely on the caller passing `customerId`** (and/or the booking-id fields). If a caller omits `customerId`, the row is still written but `customer_id` is `null` — logged, NOT linked. Logging failures are swallowed (warn only), so a failed insert never blocks the send.

### Second send path that BYPASSES emailService (no logging at all)
**File:** `src/lib/microsoft-graph.ts`** — three functions post directly to Graph `/users/{sender}/sendMail` and **never call `recordEmailMessage`**:
- `sendInvoiceEmail(invoice, to, subject, body, cc?, extraAttachment?)` — line ~79
- `sendQuoteEmail(...)` — line ~228
- `sendInternalReminder(subject, body, attachmentHtml?, attachmentName?)` — line ~321 (sends to self / internal)

These are NOT logged to `email_messages` and carry no customer linkage. (`testEmailConnection` is a diagnostic, not a real send.)

A third "provider" exists in `src/app/api/webhooks/resend/route.ts` (`new Resend(...)`) but that route only **processes inbound Resend delivery/bounce webhooks** to update `email_messages` status — it is not an outbound business send.

---

## (b) Send-site inventory

Legend — Logged? = does it write to `email_messages` (yes for any `emailService.sendEmail` call; **no** for `microsoft-graph` direct).
Linked? = is `customer_id` populated on that log row.

| Trigger | File:line | Recipient type | Customer-facing? | Logged? | Linked to customer? | Gap? |
|---|---|---|---|---|---|---|
| Manual (leave request submitted) | `src/app/actions/leave.ts:171` | Employee | No (staff) | Yes | No (employee, not customer) | No |
| Manual (leave decision) | `src/app/actions/leave.ts:263` | Employee | No (staff) | Yes | No | No |
| Manual (OJ client statement) | `src/app/actions/oj-projects/client-statement.ts:362` | OJ client (external biz) | No (B2B, not a `customers` row) | Yes | No | No |
| Manual (employee separation/HR) | `src/app/actions/employeeActions.ts:175` | Employee | No (staff) | Yes | No | No |
| Cron (birthday reminder) | `src/app/actions/employee-birthdays.ts:109` | Manager | No (internal) | Yes | No | No |
| Manual/Cron (payroll to accountant) | `src/app/actions/payroll.ts:626` | Accountant | No (external accountant) | Yes | No | No |
| Manual/Cron (earnings threshold alert) | `src/app/actions/payroll.ts:683` | Manager | No (internal) | Yes | No | No |
| Manual (rota manager shift alerts) | `src/app/actions/rota.ts:1893, 1990` | Manager | No (internal) | Yes | No | No |
| Webhook (performer interest → applicant) | `src/app/api/external/performer-interest/route.ts:278` | Performer applicant | No (not a customer) | Yes | No | No |
| Webhook (performer interest → manager) | `src/app/api/external/performer-interest/route.ts:284` | Manager | No (internal) | Yes | No | No |
| **Cron (table review follow-up)** | `src/app/api/cron/event-guest-engagement/route.ts:1459` | **Customer** | **Yes** | Yes | **Yes** (`customerId: customer.id`, `tableBookingId`) | **No — good** |
| Cron (rota shift acceptance) | `src/app/api/cron/rota-shift-acceptance/route.ts:158` | Employee | No (staff) | Yes | No | No |
| Cron (rota manager weekly alert) | `src/app/api/cron/rota-manager-alert/route.ts:62` | Manager | No (internal) | Yes | No | No |
| Cron (OJ billing alerts) | `src/lib/oj-projects/billing-alerts.ts:130` | Manager/internal | No | Yes | No | No |
| Auto (table booking → manager) | `src/lib/table-bookings/bookings.ts:448` | Manager | No (internal) | Yes | No | No |
| Auto (table charge approval → manager) | `src/lib/table-bookings/charge-approvals.ts:280` | Manager | No (internal) | Yes | No | No |
| Webhook/Manual (recruitment → manager) | `src/lib/recruitment/communications.ts:195` | Manager | No (internal) | Yes | No | No |
| Auto (recruitment → candidate ack) | `src/lib/recruitment/communications.ts:386` | Candidate | No (not a customer) | Yes | No (no customerId; uses commType only) | No (candidate ≠ customer) |
| Retry (recruitment resend) | `src/lib/recruitment/communications.ts:672` | Candidate/Manager | No | Yes | No | No |
| **Auto (customer refund confirmation)** | `src/lib/refund-notifications.ts:38` | **Customer** | **Yes** | Yes | **No (`customerId` NOT passed)** | **GAP** |
| Cron/Manual (rota staff email) | `src/lib/rota/send-rota-emails.ts:105, 285` | Employee | No (staff) | Yes | No | No |
| Auto (private booking feedback → manager) | `src/lib/private-bookings/feedback.ts:288` | Manager | No (internal) | Yes | No (`privateBookingId` set) | No |
| Auto (private booking manager notifs) | `src/lib/private-bookings/manager-notifications.ts:205, 402, 558` | Manager | No (internal) | Yes | No | No |
| Auto (parking → manager) | `src/lib/parking/payments.ts:561` | Manager | No (internal) | Yes | No | No |
| Wrapper (notify dispatcher) | `src/lib/notifications/notify.ts:174` | Customer or other | Depends on caller | Yes | **Yes when caller supplies** (`input.email.customerId ?? customer?.id ?? input.customerId`) | No — correct pattern |
| Cron alerting (system) | `src/lib/cron/alerting.ts:107` | Internal alert inbox | No (internal) | Yes | No | No |

### Helper module: `src/lib/email/event-ticket-emails.ts` — ALL customer-facing, ALL linked ✅
Every function passes `customerId: context.customerId` (and `eventBookingId` in metadata where relevant):
`sendEventPaymentLinkEmail` (220), `sendEventPaymentConfirmationEmail` (283), `sendEventPaymentManualReviewEmail` (327), `sendEventPaymentExpiredEmail` (371), `sendEventBookingCancelledEmail` (450), `sendEventTicketTransferredEmail` (502), `sendEventRescheduledEmail` (569), `sendEventPostponedEmail` (618).
**Customer-facing? Yes. Logged? Yes. Linked? Yes. Gap? No — this is the model to copy.**

### Helper module: `src/lib/email/private-booking-emails.ts` — customer-facing, logged, NOT linked ❌
All sent to `booking.contact_email`, and **none pass `customerId`** (grep: 0 occurrences). 9 functions:
`sendBookingConfirmationEmail` (104), `sendDepositReceivedEmail` (194), `sendBalancePaidEmail` (250), `sendBookingCalendarInvite` (305), `sendDepositPaymentLinkEmail` (388), `sendBalanceReminderEmail` (450), `sendDepositRefundEmail` (506), `sendDepositRefundWithDeductionsEmail` (569).
**Customer-facing? Yes. Logged? Yes (email_messages). Linked? No `customer_id`, no `privateBookingId` passed either. Gap? YES.**

### Helper module: `src/lib/email/employee-invite-emails.ts` — staff onboarding, not customers
`sendPortalInviteEmail`, `sendWelcomeEmail`, `sendChaseEmail`, `sendOnboardingCompleteEmail`, `sendSeparationStartedEmail` — all employee/manager recipients. Logged, not customer-linked (correctly, employees ≠ customers).

### Direct Microsoft Graph sends — UNLOGGED ENTIRELY ❌ (`src/lib/microsoft-graph.ts`)

| Trigger | Caller(s) | Recipient | Customer-facing? | Logged? | Linked? | Gap? |
|---|---|---|---|---|---|---|
| `sendInvoiceEmail` (manual send) | `src/app/actions/invoices.ts:291`, `src/app/actions/email.ts:255,529` | Invoice customer | **Yes** | **NO** | **NO** | **GAP** |
| `sendInvoiceEmail` (cron reminders) | `src/app/api/cron/invoice-reminders/route.ts:262 (internal), 369 (customer)` | Customer + internal | **Yes (369)** | **NO** | **NO** | **GAP** |
| `sendInvoiceEmail` (recurring) | `src/app/api/cron/recurring-invoices/route.ts:342` | Invoice customer | **Yes** | **NO** | **NO** | **GAP** |
| `sendInvoiceEmail` (auto-send) | `src/app/api/cron/auto-send-invoices/route.ts:182` | Invoice customer | **Yes** | **NO** | **NO** | **GAP** |
| `sendInvoiceEmail` (OJ projects billing) | `src/app/api/cron/oj-projects-billing/route.ts:2513,3346` | OJ client (B2B) | Partially (B2B) | **NO** | **NO** | Gap (B2B, lower priority) |
| `sendQuoteEmail` | `src/app/actions/email.ts:738` | Quote recipient (prospect/customer) | **Yes** | **NO** | **NO** | **GAP** |
| `sendInternalReminder` | `src/app/api/cron/oj-projects-billing-reminders/route.ts:98` | Self / internal | No (internal) | NO | No | No (internal) |

> Note: invoice "customers" live in the invoices/quotes domain and may not always map to a `customers` row. Even so, these customer-facing sends produce **no `email_messages` record at all**, so they are invisible to any communication-history view regardless of linkage.

---

## (c) GAPS

### Customer-facing emails that are LOGGED but NOT linked to `customer_id`
1. **Private booking lifecycle emails (9)** — `src/lib/email/private-booking-emails.ts`. Sent to `booking.contact_email`; no `customerId` and no `privateBookingId` passed to `sendEmail`. These are the customer's booking confirmation, deposit/balance receipts, payment links, reminders, refunds — high-value customer comms. **Fix:** thread the booking's `customer_id` (and `privateBookingId`) through each `sendEmail` call.
2. **Customer refund confirmation** — `src/lib/refund-notifications.ts:38`. `sendRefundNotification` has the customer context (name, email, phone) but does not pass `customerId`. **Fix:** add `customerId` to the params and to the `sendEmail` call.

### Customer-facing emails NOT logged AT ALL (no `email_messages` row)
3. **Invoice emails** — all `sendInvoiceEmail` paths (manual `invoices.ts`/`email.ts`, plus crons: `invoice-reminders`, `recurring-invoices`, `auto-send-invoices`, `oj-projects-billing`). Go straight through `microsoft-graph.ts`, bypassing `recordEmailMessage`. **Highest-impact gap.**
4. **Quote emails** — `sendQuoteEmail` via `src/app/actions/email.ts:738`. Same bypass.
   **Fix for 3 & 4:** either route these through `emailService.sendEmail` (preferred — gives logging + suppression + provider abstraction for free) passing `customerId`, or add a `recordEmailMessage` call inside `sendInvoiceEmail`/`sendQuoteEmail`.

### Non-gaps (correct, for reference)
- Event ticket/payment emails (`event-ticket-emails.ts`) — logged + linked. ✅
- Table review follow-up cron — logged + linked. ✅
- `notify.ts` dispatcher — logged + linked when caller supplies customer context. ✅
- Staff/manager/accountant/applicant emails — logged without `customer_id` by design (not customers).

### Cross-cutting observations
- The logging mechanism is solid and centralised; the gaps are purely **callers omitting `customerId`** or **two helpers bypassing the central `sendEmail`** (`microsoft-graph.ts`).
- Suppression (`email_suppressions`) and inbound status updates (Resend webhook) are wired in, so once invoice/quote/private-booking sends route through `sendEmail`, they automatically gain suppression checks and delivery-status tracking too.
- Recommend a lint/convention: forbid direct `microsoft-graph.ts` `sendMail` for customer comms; all customer-facing email must go through `emailService.sendEmail` with `customerId`.
