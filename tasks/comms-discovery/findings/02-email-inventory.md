# Email Inventory — The Anchor Management Tools

**Purpose:** Exhaustive inventory of every email the application sends, to support (a) replacing Twilio SMS with email where a customer email exists, and (b) migrating the generic venue email transport off Microsoft Graph (sending mailbox = `MICROSOFT_USER_EMAIL`, production `peter@orangejelly.co.uk`) to Resend. Per the design spec, the separate Orange Jelly invoice/quote Graph transport is inventoried here but excluded from Phase 1.

**Method:** Traced both Graph send primitives and every caller. All file:line references verified by reading the code.

**Resend status:** ❌ NOT in `package.json` (deps confirmed: `@microsoft/microsoft-graph-client`, `@azure/identity`, `twilio` — no `resend`). ❌ No Resend code in `src/` (grep "resend" only matches the substring in unrelated words). **Migration is greenfield** — 100% of email goes via Microsoft Graph today.

---

## 1. Current Email Infrastructure (read first — feeds the Resend migration)

There are **TWO independent Microsoft Graph send implementations**. Phase 1 migrates Primitive A only; Primitive B remains on Microsoft Graph for Orange Jelly invoicing/quotes/internal reminders unless a later finance-specific migration is approved.

### Primitive A — `src/lib/email/emailService.ts` → `sendEmail(options)`
Used by ~all venue/HR/ops/customer emails.
```ts
interface EmailOptions {
  to: string;                 // single recipient
  subject: string;
  html?: string;              // contentType auto = 'HTML' if html present, else 'Text'
  text?: string;
  cc?: string[];              // array
  bcc?: string[];             // array (supported, rarely used)
  attachments?: EmailAttachment[];
}
interface EmailAttachment {
  name: string;               // filename
  content: Buffer | string;   // Buffer (.toString('base64')) OR pre-base64 string
  contentType: string;        // MIME
}
// returns { success: boolean; error?: string; messageId?: string }
```
- Guards on `isGraphConfigured()` (from `microsoft-graph.ts`); sender = `process.env.MICROSOFT_USER_EMAIL`.
- Builds Graph `message` (`toRecipients`, optional `ccRecipients`/`bccRecipients`, `attachments` as `#microsoft.graph.fileAttachment`), `POST /users/{sender}/sendMail`, `saveToSentItems: true`.
- Has its own **non-cached** `getGraphClient()` (`ClientSecretCredential`). Also exports `sendSimpleEmail(to, subject, body)` (text-only).
- try/catch, `console.error('Error sending email:', error)`, returns `{success:false}` — **never throws**.

### Primitive B — `src/lib/microsoft-graph.ts` (the B2B invoicing transport)
Exports `isGraphConfigured()` plus three **purpose-built** senders (each builds its own Graph message + PDF, NOT via `sendEmail`):
- **`sendInvoiceEmail(invoice, recipientEmail, subject?, body?, ccRecipients?, additionalAttachments?, emailOptions?)`** — generates the invoice PDF (`generateInvoicePDF`), attaches `invoice-{n}.pdf` (or `receipt-{n}.pdf` for remittance), default subject `Invoice {n} from Orange Jelly Limited` (or `Receipt: Invoice {n} (Paid)`), warm default body signed `${COMPANY_CONTACT_NAME||'Peter Pitcher'}` / Orange Jelly Limited / `${COMPANY_CONTACT_PHONE||'07995087315'}`. Body `contentType: 'Text'`. Supports extra attachments.
- **`sendQuoteEmail(quote, recipientEmail, subject?, body?, ccRecipients?)`** — generates quote PDF, attaches `quote-{n}.pdf`, default subject `Quote {n} from Orange Jelly Limited`.
- **`sendInternalReminder(subject, body, attachmentHtml?, attachmentName?)`** — sends **to self** (`MICROSOFT_USER_EMAIL`), subject prefixed `[REMINDER]`, optional HTML attachment.
- Also `testEmailConnection()` and `getGraphConfigurationHelp()` (the help text hardcodes the example `MICROSOFT_USER_EMAIL=peter@orangejelly.co.uk`).
- Uses a lazy `getGraphClient()` (dynamic import). Same `MICROSOFT_USER_EMAIL` sender. try/catch, returns `{success:false}`, never throws.

### From-address / env
`.env.example` relevant vars:
- Auth/sender: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, **`MICROSOFT_USER_EMAIL`** (the single from-address; prod `peter@orangejelly.co.uk`).
- Recipient (NOT from) defaults: `PRIVATE_BOOKINGS_MANAGER_EMAIL=manager@the-anchor.pub`, `ROTA_MANAGER_EMAIL`, `PAYROLL_ACCOUNTANT_EMAIL=accountant@the-anchor.pub`, `OJ_PROJECTS_BILLING_ALERT_EMAIL` (falls back to `PAYROLL_ACCOUNTANT_EMAIL`), `MANAGER_EMAIL=manager@the-anchor.pub`, `CRON_ALERT_EMAIL`, `EVENT_CHECKLIST_EMAIL_RECIPIENT`. Optional: `COMPANY_CONTACT_NAME`, `COMPANY_CONTACT_PHONE`.
- Hardcoded recipients in code (not env): `manager@the-anchor.pub` (table bookings, charge approvals, feedback, performer interest, parking — several modules default to this string), `leo.dowling@live.co.uk` (performer-interest internal CC), a `BILLY_EMAIL` constant (separation CC).
- **No `EMAIL_FROM_ADDRESS` / `EMAIL_REPLY_TO` / `RESEND_API_KEY` exist** — must be added for Resend.

### Error handling / retry / logging
- Neither primitive retries. SMS has rate-limit/idempotency/retry + `/api/cron/reconcile-sms`; **email has none**.
- Several callers persist a delivery row in `rota_email_log` (rota, payroll, leave) or `invoice_email_logs` (invoices/quotes/chase) with `status: sent|failed` and `message_id`. Invoice/quote send-actions add full **idempotency** (`claimIdempotencyKey`/`persistIdempotencyResponse`) in `src/app/actions/email.ts`.
- **No reply-to anywhere.** BCC only on Primitive A, rarely used.

### Templates / HTML source
- No shared template/branding wrapper. HTML/text built inline per domain:
  - `src/lib/email/private-booking-emails.ts` (8 customer builders+senders; ~28 KB)
  - `src/lib/email/employee-invite-emails.ts` (5 text builders+senders)
  - `src/lib/email/calendar-invite.ts` (ICS generator `generateBookingCalendarInvite`; organizer `events@the-anchor.pub`)
  - `src/lib/microsoft-graph.ts` (invoice/quote default bodies)
  - inline at call sites: rota (`src/lib/rota/email-templates.ts`, `send-rota-emails.ts`), payroll, leave, birthdays, table bookings, charge approvals, parking, refunds, feedback, OJ projects, cron alerts, performer interest.
- Resend Phase 1 uses `The Anchor <noreply@auth.orangejelly.co.uk>` for Primitive A by default. Because Primitive A includes OJ client statements and payroll, the wrapper should support a per-send `from` override so those edge cases can carry an Orange Jelly display name if required.

### Migration implication
Two Graph paths exist, but the approved Phase 1 path is **transport A only**. Re-implement Primitive A `sendEmail` against `resend.emails.send` (map `to`/`cc[]`/`bcc[]`; attachments `{name,content,contentType}` → Resend `{filename, base64 content}`), keep Primitive B on Graph, and keep `MICROSOFT_*` + Graph packages until Primitive B has its own migration plan. Resend **requires an explicit verified `from`** — today implicit. Add `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, optionally `EMAIL_REPLY_TO`, and verify SPF/DKIM/DMARC for `auth.orangejelly.co.uk` before cutover.

---

## 2. Master Table

Recipient: **C**=customer, **E**=employee, **M**=manager, **A**=accountant, **V**=vendor/B2B, **P**=performer, **Op**=ops/self. **From = `MICROSOFT_USER_EMAIL` for every row.**

| # | Communication | Trigger | Send location (file:line) + trigger location | Recipient | Subject / source | Attachments | Txn/Mktg | SMS equiv? |
|---|---|---|---|---|---|---|---|---|
| 1 | Invoice send | Manual (UI) | `microsoft-graph.ts:79 sendInvoiceEmail`; action `app/actions/email.ts:218 sendInvoiceViaEmail`; also `invoices.ts:216` (receipt-on-payment) | V | `Invoice {n} from Orange Jelly Limited`; default body in `microsoft-graph.ts` | **PDF** `invoice-{n}.pdf` (`generateInvoicePDF`) | Txn | No |
| 2 | Invoice payment receipt | Action — payment recorded | `invoices.ts:216` via `sendPaymentReceipt` (`microsoft-graph.ts:79`, `emailOptions.documentKind='remittance_advice'`) | V | `Receipt: Invoice {n} (Paid)` | **PDF** `receipt-{n}.pdf` | Txn | No |
| 3 | Invoice chase (overdue) | Manual (UI) | `app/actions/email.ts:490 sendChasePaymentEmail` → `sendInvoiceEmail` | V | `Gentle reminder: Invoice {n} - {N} days overdue` | **PDF** invoice | Txn | No |
| 4 | Invoice auto-send | **Cron `0 7 * * *`** `/api/cron/auto-send-invoices` | route `:182` → `sendInvoiceEmail` (subj `:150`) | V | `Invoice {n} from Orange Jelly Limited` | **PDF** | Txn | No |
| 5 | Invoice reminders (internal + customer) | **Cron `0 9 * * *`** `/api/cron/invoice-reminders` | route `:262` (internal-to-self) & `:369` (customer) → `sendInvoiceEmail` | V (+ self) | `Payment Due Today: Invoice {n}…` / `{reminderType}: Invoice {n} from Orange Jelly Limited` | **PDF** | Txn | No |
| 6 | Recurring invoice send | **Cron `0 1 * * *`** `/api/cron/recurring-invoices` | route `:342` → `sendInvoiceEmail` (subj `:338`) | V | `Invoice {n} from Orange Jelly Limited` | **PDF** | Txn | No |
| 7 | OJ Projects billing-run invoices | **Cron `5 1 * * *`** `/api/cron/oj-projects-billing` (+ `0 9` reminders) | route `:2495` & `:3326` → `sendInvoiceEmail(...additionalAttachments)` | V | `Invoice {n} from Orange Jelly Limited` | **PDF + extra attachments** | Txn | No |
| 8 | Quote send | Manual (UI) | `microsoft-graph.ts:228 sendQuoteEmail`; action `app/actions/email.ts:699 sendQuoteViaEmail` | V | `Quote {n} from Orange Jelly Limited` | **PDF** `quote-{n}.pdf` | Txn | No |
| 9 | OJ Projects — client statement | Manual action `sendStatementEmail` (perm `oj_projects:view`) | `app/actions/oj-projects/client-statement.ts:362` | V/client | `Statement of Account …`; inline HTML; **uses `cc`** | **PDF** `statement-{vendor}-{from}-{to}.pdf` | Txn (B2B) | No |
| 10 | OJ Projects — billing-run alert | **Cron** (billing routes above) | `lib/oj-projects/billing-alerts.ts:130 sendBillingRunAlert` | Op/A (`OJ_PROJECTS_BILLING_ALERT_EMAIL` ‖ `PAYROLL_ACCOUNTANT_EMAIL`) | `…billing run…` summary; inline HTML | None | Txn (internal) | No |
| 11 | PB — provisional hold confirm | Action — booking created/confirmed | `lib/email/private-booking-emails.ts:104 sendBookingConfirmationEmail`; callers `services/private-bookings/mutations.ts:797`, `payments.ts:254` | C | `Provisional Booking Hold — {event} on {date}` | None | Txn | Adjacent SMS exists |
| 12 | PB — booking confirmed (deposit received) | Action — deposit recorded | `private-booking-emails.ts:194 sendDepositReceivedEmail`; caller `payments.ts:171` | C | `Booking Confirmed — {event} on {date}` | None | Txn | Adjacent SMS |
| 13 | PB — payment complete (balance paid) | Action — balance paid | `private-booking-emails.ts:250 sendBalancePaidEmail`; caller `payments.ts:673` | C | `Payment Complete — {event} on {date}` | None | Txn | Adjacent SMS |
| 14 | PB — calendar invite | Action — booking confirmed / deposit paid / manual | `private-booking-emails.ts:305 sendBookingCalendarInvite`; callers `mutations.ts:801`, `payments.ts:257`, `privateBookingActions.ts:1988` | C | `Your Event at The Anchor — {date}` | **ICS** `booking.ics` (`generateBookingCalendarInvite`) | Txn | No |
| 15 | PB — deposit payment link | Action — request deposit | `private-booking-emails.ts:388 sendDepositPaymentLinkEmail`; caller `privateBookingActions.ts:2099` | C | `Deposit payment — {event} on {date}`; PayPal approve link | None | Txn | Adjacent SMS |
| 16 | PB — balance reminder | Action / scheduled | `private-booking-emails.ts:450 sendBalanceReminderEmail` | C | `Event Balance Due — {event} on {date}` | None | Txn | Adjacent SMS |
| 17 | PB — deposit refunded | Action — refund | `private-booking-emails.ts:506 sendDepositRefundEmail` | C | `Deposit Refunded — {event} on {date}` | None | Txn | Maybe |
| 18 | PB — deposit refund w/ deductions | Action — refund w/ deductions | `private-booking-emails.ts:569 sendDepositRefundWithDeductionsEmail` | C | `Deposit Refund Update — {event} on {date}` | None | Txn | Maybe |
| 19 | PB manager — new booking enquiry | Action — booking created | `lib/private-bookings/manager-notifications.ts:206 sendManagerPrivateBookingCreatedEmail` | M (`PRIVATE_BOOKINGS_MANAGER_EMAIL`) | `New private booking enquiry: {ref}`; HTML+text | None | Txn (internal) | No |
| 20 | PB manager — weekly digest | **Cron `0 9 * * *`** `/api/cron/private-booking-monitor` (Mon) | `manager-notifications.ts:403 sendManagerPrivateBookingsWeeklyDigestEmail` | M | `Private bookings weekly summary — {weekLabel}` | None | Txn (internal) | No |
| 21 | PB manager — event outcome ("did it go well?") | **Cron `0 9 * * *`** `/api/cron/private-booking-monitor` | `manager-notifications.ts:559 sendPrivateBookingOutcomeEmail`; trigger route `:962` | M | `Did {firstName}'s event go well? — {date}`; HTML+text + token links | None | Txn (internal/CSAT) | No |
| 22 | PB — feedback received (manager) | Customer submits feedback form | `lib/private-bookings/feedback.ts:288 sendPrivateBookingFeedbackManagerEmail`; trigger `:445` | M (`manager@the-anchor.pub`) | feedback-submitted summary; HTML | None | Txn (internal) | No |
| 23 | PB weekly summary (separate cron) | **Cron `0 * * * *`** `/api/cron/private-bookings-weekly-summary` | route → manager digest | M | weekly summary | None | Txn (internal) | No |
| 24 | Rota — staff weekly rota | **Cron `0 21 * * 0`** `/api/cron/rota-staff-email` | `lib/rota/send-rota-emails.ts:105 sendRotaWeekEmails` (per-employee loop) | E | per-staff rota (`buildStaffRotaEmailHtml`) | None | Txn (internal) | No |
| 25 | Rota — staff change notice | Action — rota republished w/ changes | `send-rota-emails.ts:285 sendRotaWeekChangeEmails` (per-employee) | E | rota change (`buildRotaChangeEmailHtml`) | None | Txn (internal) | No |
| 26 | Rota — manager review alert | **Cron `0 18 * * 0`** `/api/cron/rota-manager-alert` | route `:62` `sendEmail` (`buildManagerAlertEmailHtml`) | M (`system_settings.rota_manager_email` ‖ `ROTA_MANAGER_EMAIL`) | `Rota Alert: week of {weekStart} needs attention` | None | Txn (internal) | No |
| 27 | Payroll export → accountant | Manual (payroll UI) | `app/actions/payroll.ts:626` | A (`PAYROLL_ACCOUNTANT_EMAIL`), **cc** = sender's profile email | `Payroll — {monthLabel}`; HTML (`buildPayrollEmailHtml`) | **XLSX** (`buildPayrollWorkbook`) | Txn (internal) | No |
| 28 | Payroll — earnings-threshold alert | Manual (same flow, conditional) | `app/actions/payroll.ts:683` | M (`MANAGER_EMAIL`) | `URGENT: Earnings alert — … over £833 in {month}` | None | Txn (internal) | No |
| 29 | Employee onboarding welcome | Action — invite/create (`employeeInvite.ts:204/359`) | `lib/email/employee-invite-emails.ts:160 sendWelcomeEmail` | E (cc `MANAGER_EMAIL`) | `Welcome to The Anchor -- Complete Your Profile`; **text** | None | Txn | No |
| 30 | Staff portal invite | Action (`employeeInvite.ts:286`) + **Cron `0 9 * * *`** `/api/cron/employee-invite-chase:50/74` | `employee-invite-emails.ts:155 sendPortalInviteEmail` | E (cc `MANAGER_EMAIL`) | `Set Up Your Staff Portal Access -- The Anchor`; text | None | Txn | No |
| 31 | Onboarding chase reminder | **Cron `0 9 * * *`** `/api/cron/employee-invite-chase:52/76` | `employee-invite-emails.ts:163 sendChaseEmail` | E (cc `MANAGER_EMAIL`) | `Reminder: Please Complete Your Profile`; text | None | Txn | No |
| 32 | Onboarding complete (manager notice) | Action — onboarding finished (`employeeInvite.ts:953`) | `employee-invite-emails.ts:168 sendOnboardingCompleteEmail` | M (`MANAGER_EMAIL`) | `{name} has completed their profile`; text | None | Txn (internal) | No |
| 33 | Separation started | Action (`employeeInvite.ts:1110`) | `employee-invite-emails.ts:173 sendSeparationStartedEmail` | E (cc `MANAGER_EMAIL` + `BILLY_EMAIL`) | `Formal separation process started - Orange Jelly Limited`; text | None | Txn | No |
| 34 | Employee document send | Action — attachment uploaded w/ "email" flag (`employeeActions.ts:577 addEmployeeAttachment`) | `employeeActions.ts:~175` (`sendEmail`) | E | `buildEmployeeDocumentEmail` subject; text | **The uploaded file** (PDF/doc, any MIME) | Txn | No |
| 35 | Holiday request received | User action — employee submits leave | `app/actions/leave.ts:167` (`sendEmail`) | E | `Holiday Request Received — {start} to {end}` (`buildHolidaySubmittedEmailHtml`) | None | Txn | No |
| 36 | Holiday request decision | User action — manager approves/declines | `app/actions/leave.ts:249` (`sendEmail`) | E | `Holiday Request Approved`/`Declined` (`buildHolidayDecisionEmailHtml`) | None | Txn | No |
| 37 | Employee birthdays digest | **Cron `0 9 * * *`** `/api/cron/birthday-reminders` | `app/actions/employee-birthdays.ts:109` | M (`MANAGER_EMAIL`) | `Birthday Reminder: {N} upcoming birthday(s) next week` | None | Txn (internal) | No |
| 38 | Table booking — manager new-booking | Action/API — booking created | `lib/table-bookings/bookings.ts:369 sendManagerTableBookingCreatedEmailIfAllowed` | M (`manager@the-anchor.pub`) | `A new table booking has been created` (subject var) | None | Txn (internal) | Customer side is SMS |
| 39 | Table booking — charge approval needed | Action — charge/deposit flow | `lib/table-bookings/charge-approvals.ts:280 sendManagerChargeApprovalEmail` | M (`manager@the-anchor.pub`) | `Charge approval needed: {type} {amount}`; approval link | None | Txn (internal) | No |
| 40 | Parking — manager payment confirmation | Action — parking payment captured (`parking.ts:138`, `api/parking/...`) | `lib/parking/payments.ts:561` (`buildPaymentConfirmationManagerEmail`) | M | parking payment confirmation; HTML | None | Txn (internal) | Customer side is SMS |
| 41 | Refund confirmation | Action — refund issued (`refundActions.ts:287`) | `lib/refund-notifications.ts:38 sendRefundNotification` | C | `Refund Confirmation — The Anchor` | None | Txn | **YES — email-first, SMS fallback** (same fn) |
| 42 | Event checklist reminder | **Cron `0 8 * * *`** `/api/cron/event-checklist-reminders` | route `:232` (`sendEmail`) | M (`EVENT_CHECKLIST_EMAIL_RECIPIENT`) | checklist reminder; HTML+text | None | Txn (internal) | No |
| 43 | Cron failure alert | Cron error paths (many) | `lib/cron/alerting.ts:107 reportCronFailure` | Op (`CRON_ALERT_EMAIL`) | `[CRON FAILURE] {job} - {env}`; HTML | None | Op alert | No |
| 44 | Performer interest — confirmation | API `/api/external/performer-interest` (public form) | route `:278` (`sendEmail`) | P | `buildPerformerConfirmationEmail` subject; HTML+text | None | Txn | No |
| 45 | Performer interest — internal notify | Same API | route `:284` (`sendEmail`) | M (`manager@the-anchor.pub`, **cc `leo.dowling@live.co.uk`**) | `buildInternalNotificationEmail` subject; HTML+text | None | Txn (internal) | No |
| 46 | Internal reminder (to self) | Programmatic (invoice infra) | `microsoft-graph.ts sendInternalReminder` | Op (self = `MICROSOFT_USER_EMAIL`) | `[REMINDER] {subject}` | optional HTML | Op | No |
| 47 | Test email / connection | Manual (admin, perm `invoices:manage`) | `app/actions/email.ts:testEmailConfiguration` → `microsoft-graph.ts testEmailConnection` | self/diagnostic | n/a (profile fetch) | None | Diagnostic | No |

> **~47 distinct email communications** across ~25 source files, all on Microsoft Graph.

---

## 3. Per-domain detail & notes

### Invoicing / Quotes / Statements — Orange Jelly B2B (items 1–10, 46)
- All invoice/quote sends route through `src/lib/microsoft-graph.ts` (`sendInvoiceEmail`/`sendQuoteEmail`), each generating its own PDF. **Default subjects/bodies are baked into that file** and signed as Orange Jelly Limited with `COMPANY_CONTACT_NAME`/`COMPANY_CONTACT_PHONE`. This is the **most attachment-heavy** domain (a PDF on every send, plus extra attachments in OJ billing).
- Send-action layer: `src/app/actions/email.ts` (`sendInvoiceViaEmail`, `sendChasePaymentEmail`, `sendQuoteViaEmail`) — full idempotency, recipient resolution via `resolveManualInvoiceRecipients` (CC from vendor contacts flagged `receive_invoice_copy`), and `invoice_email_logs` persistence.
- Crons: `auto-send-invoices` (07:00), `invoice-reminders` (09:00, sends BOTH an internal-to-self copy and the customer copy), `recurring-invoices` (01:00), `oj-projects-billing` (01:05) + `oj-projects-billing-reminders` (09:00).
- `sendInternalReminder` sends to the Graph mailbox itself.

### Private bookings — customer (items 11–18) — richest customer domain
- `src/lib/email/private-booking-emails.ts`: 8 builder+sender fns, all `to: booking.contact_email`, all subjects suffixed `— The Anchor` / event+date. Each early-returns if no `contact_email`.
- Wiring: confirmation + calendar invite fire from `services/private-bookings/payments.ts` (booking-confirmed and deposit-received side-effects) and `mutations.ts`; deposit-received email and balance-paid email from `payments.ts`; deposit-payment-link and a standalone calendar invite from `app/actions/privateBookingActions.ts`. Sends are fire-and-forget (`.catch` logged) — failures are swallowed.
- Only the **calendar invite** carries an attachment (ICS).

### Private bookings — manager/ops (items 19–23)
- `manager-notifications.ts`: new-enquiry (on create), weekly digest + event-outcome (both driven by `/api/cron/private-booking-monitor`, with an `outcome_email_sent_at` claim to dedupe). `feedback.ts` sends a manager email when a customer submits the feedback form. **There is NO customer-facing "please give feedback" email** — the post-event customer touch is via token links surfaced in the manager outcome flow. A second weekly summary exists at `/api/cron/private-bookings-weekly-summary` (hourly cron `0 * * * *`, presumably guarded to weekly — confirm).

### Rota (items 24–26)
- `src/lib/rota/send-rota-emails.ts`: `sendRotaWeekEmails` (staff, cron Sun 21:00, per-employee loop, logs to `rota_email_log`) and `sendRotaWeekChangeEmails` (on republish-with-changes). `rota-manager-alert` cron (Sun 18:00) sends directly via `sendEmail`, recipient from `system_settings.rota_manager_email` falling back to `ROTA_MANAGER_EMAIL`.

### Payroll (items 27–28)
- `payroll.ts:626` → accountant (`PAYROLL_ACCOUNTANT_EMAIL`), **CC = sending user's own profile email**, **XLSX** attached; logs to `rota_email_log`. Conditionally (`payroll.ts:683`) sends an earnings-threshold (£833) alert to `MANAGER_EMAIL`. Manual trigger.

### Employees / onboarding / separation (items 29–34)
- `src/lib/email/employee-invite-emails.ts` (text emails, all CC `MANAGER_EMAIL`): welcome, portal-invite, chase, onboarding-complete (→ manager), separation-started (→ employee, CC manager + `BILLY_EMAIL`). Wired via `app/actions/employeeInvite.ts` and chased by `/api/cron/employee-invite-chase` (09:00).
- **Employee document send** (`employeeActions.ts addEmployeeAttachment`): when an attachment is uploaded with the email option, the uploaded file is emailed to the employee (arbitrary MIME attachment) — an attachment-heavy, ad-hoc path.
- `/api/cron/employee-separations` (06:00) calls `finalizeEmployeeSeparation` — **does not itself email** (separation email is sent earlier from the action).

### Leave (items 35–36)
- `leave.ts`: submitted-confirmation to the employee (`:167`) and decision to the employee (`:249`). **No manager notification email** in this flow. Logs to `rota_email_log`.

### Birthdays (item 37)
- `employee-birthdays.ts:109` → `MANAGER_EMAIL`, cron `birthday-reminders` 09:00, idempotency-guarded.

### Table bookings (items 38–39) — manager-only by email
- Both emails go to `manager@the-anchor.pub` (new-booking + charge-approval). **There is NO customer table-booking confirmation EMAIL** — customer confirmations/reminders are SMS (`sendTableBookingCreatedSmsIfAllowed`, etc.). High-value SMS→email candidate.

### Parking (item 40) — manager-only by email
- `parking/payments.ts:561` sends a manager payment-confirmation email; the **customer** parking confirmation is SMS (logged in the same function as `channel: 'sms'`). SMS→email candidate.

### Refunds (item 41) — already the desired pattern
- `refund-notifications.ts sendRefundNotification`: **tries email first (if `params.email`), falls back to SMS (if `params.phone`)**, returns `email_sent | sms_sent | skipped | failed`. This is the exact "prefer email, fall back to SMS" model the owner wants — a reference implementation.

### Operational / external (items 42–47)
- Event checklist cron (`EVENT_CHECKLIST_EMAIL_RECIPIENT`), cron failure alerting (`CRON_ALERT_EMAIL`, used by ≥6 crons/libs), performer-interest public route (2 emails, one with a hardcoded external CC), the to-self `sendInternalReminder`, and admin test-email.

---

## 4. SMS-equivalence map (core to the cost-cutting goal)

**Already email-first w/ SMS fallback (the target pattern):**
- Refund confirmation (#41) — copy this pattern.

**Customer emails with an ADJACENT SMS for the same lifecycle (define replace-vs-supplement):**
- Private booking customer lifecycle (#11–18) — PB also sends SMS for confirmations/reminders/deposit; today email + SMS can both fire.

**Customer events that are SMS-ONLY today (prime "add email where email exists" targets — biggest Twilio spend):**
- **Event reminders / event booking SMS** — `src/app/actions/` event SMS schedulers + `/api/jobs/process` queue (`* * * * *`), `event-booking-holds` (`*/5`), `event-waitlist-offers` (`*/5`), `event-guest-engagement` (`*/15`). Highest volume.
- **Table booking** customer confirmation/reminder/cancellation/Sunday-preorder (`lib/table-bookings/bookings.ts` `*SmsIfAllowed` fns) — email path missing.
- **Parking** customer confirmation/expiry (SMS via parking actions/notifications) — only manager email exists.
- Ad-hoc customer SMS / bulk customer messaging actions.

**Email-ONLY (no SMS):** all invoicing/quotes/statements, PB manager notices, rota, payroll, onboarding/invite/separation, employee-document, leave, birthdays, table/charge/parking **manager** alerts, performer interest, cron alerts, feedback.

---

## 5. Cron → email map (`vercel.json`, verified)

| Route | Schedule | Sends email? |
|---|---|---|
| `/api/cron/auto-send-invoices` | `0 7 * * *` | ✅ #4 |
| `/api/cron/invoice-reminders` | `0 9 * * *` | ✅ #5 (internal + customer) |
| `/api/cron/recurring-invoices` | `0 1 * * *` | ✅ #6 |
| `/api/cron/oj-projects-billing` | `5 1 * * *` | ✅ #7 + alert #10 |
| `/api/cron/oj-projects-billing-reminders` | `0 9 * * *` | ✅ #7/#10 |
| `/api/cron/private-booking-monitor` | `0 9 * * *` | ✅ digest #20 + outcome #21 |
| `/api/cron/private-bookings-weekly-summary` | `0 * * * *` | ✅ #23 (hourly — confirm weekly guard) |
| `/api/cron/rota-staff-email` | `0 21 * * 0` | ✅ #24 |
| `/api/cron/rota-manager-alert` | `0 18 * * 0` | ✅ #26 |
| `/api/cron/birthday-reminders` | `0 9 * * *` | ✅ #37 |
| `/api/cron/event-checklist-reminders` | `0 8 * * *` | ✅ #42 |
| `/api/cron/employee-invite-chase` | `0 9 * * *` | ✅ #30/#31 |
| `/api/cron/employee-separations` | `0 6 * * *` | ❌ (finalize only) |
| `/api/cron/payroll-periods` | `15 6 * * *` | ❌ |
| `/api/cron/rota-auto-close` | `0 5 * * *` | ❌ |
| `/api/cron/parking-notifications` | `*/15 * * * *` | parking (SMS-led); cron-failure alert only |
| `/api/cron/reconcile-sms` | `*/15 * * * *` | ❌ SMS reconciliation |
| `/api/cron/event-booking-holds` | `*/5 * * * *` | ❌ (holds/SMS) |
| `/api/cron/event-waitlist-offers` | `*/5 * * * *` | ❌ (SMS) |
| `/api/cron/event-guest-engagement` | `*/15 * * * *` | ❌ (SMS) |
| `/api/cron/table-booking-deposit-timeout` | `0 * * * *` | cron-failure alert only |
| `/api/cron/private-bookings-expire-holds` | `0 6 * * *` | ❌ |
| `/api/jobs/process` | `* * * * *` | queue worker (SMS/jobs) |

(Other crons: `event-guest-engagement`, `generate-slots`, `apply-customer-labels`, `engagement-scoring`, `cleanup-rate-limits`, `oj-projects-retainer-projects`, `sunday-lunch-prep`, `sunday-preorder`, `pub-ops-event-calendar-sync`, `backfill-marketing-links` — no direct customer email.)

---

## 6. Gaps & Risks

1. **TWO Graph implementations** (`emailService.ts` `sendEmail` + `microsoft-graph.ts` `sendInvoiceEmail`/`sendQuoteEmail`/`sendInternalReminder`). The design now intentionally migrates only transport A. Risk shifts from "forget B" to "accidentally decommission Graph while B still needs it."
2. **No central template/branding.** ~15 inline builders. Transport A will default to The Anchor display name; OJ client statements/payroll may need an explicit `from` override or copy review so the sender identity matches the audience.
3. **From-address implicit; mixed brands.** Orange Jelly finance (invoices/quotes/statements/payroll, signed "Orange Jelly Limited") vs The Anchor venue/HR. Resend needs explicit verified `from`. Phase 1 uses `auth.orangejelly.co.uk`; configure SPF/DKIM/DMARC before cutover or deliverability drops. The invoice bodies + `getGraphConfigurationHelp` stay Graph-bound in transport B.
4. **No retry / weak failure surfacing.** SMS has guards; email has none. PB customer emails are fire-and-forget (`.catch` logged) — silent loss. Add a retry wrapper (mirror `src/lib/retry.ts`).
5. **No reply-to anywhere.** Customer mail (bookings, invoices, contracts/statements, refunds) replies hit the raw sending mailbox. Add a monitored reply-to during migration.
6. **Hardcoded recipients** (`manager@the-anchor.pub` in 4+ modules; `leo.dowling@live.co.uk`; `BILLY_EMAIL`). Centralise to env during migration to avoid scattered edits.
7. **Attachment-heavy paths** (every invoice/quote/statement = PDF; payroll = XLSX; employee-document = arbitrary file; PB = ICS). Resend request size cap (~40 MB) — large employee files/payroll could exceed; verify and consider hosted-link fallback.
8. **Dual-channel duplication.** PB (and, if email is added, table bookings/parking) can notify by both SMS and email. To realise Twilio savings the policy must define **replace** (suppress SMS when email succeeds, per the refund pattern) vs **supplement**.
9. **Customer table-booking & parking confirmations are SMS-only** — these plus event reminders are the highest-impact SMS→email opportunities, and they currently have NO email builder at all (net-new work, not just transport swap).

---

## 7. Open Questions

1. Confirm prod `MICROSOFT_USER_EMAIL = peter@orangejelly.co.uk` (the transport-A from being migrated).
2. Confirm whether OJ client statements/payroll should use the default `The Anchor <noreply@auth.orangejelly.co.uk>` sender or an Orange Jelly display-name override on the same verified subdomain.
3. SMS→email semantics: **replace** SMS when email exists (refund #41 model) or **fallback only**? PB currently can send both.
4. Which SMS-only flows first? Event reminders (highest volume) + table-booking + parking are the candidates with no email today.
5. Add reply-to and which mailbox monitors it?
6. Decide whether transport B should get a later, separate Resend migration or remain on Microsoft Graph indefinitely.
7. Confirm `/api/cron/private-bookings-weekly-summary` (`0 * * * *` hourly) is internally guarded to weekly, and whether it overlaps with the `private-booking-monitor` digest (#20).
8. Attachments via Resend inline vs hosted links for large payroll/employee files?
