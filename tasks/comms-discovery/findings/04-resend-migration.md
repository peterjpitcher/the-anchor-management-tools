# Email Migration: Microsoft Graph → Resend

**Scope:** Map the complete surface required to migrate transport A (`src/lib/email/emailService.ts`) from Microsoft Graph to [Resend](https://resend.com), while documenting transport B (`src/lib/microsoft-graph.ts`) so it is not accidentally changed. The design spec excludes transport B from Phase 1.
**Status:** Discovery / read-only audit. No code changed.
**Date:** 2026-05-31
**Verified against:** actual source (`src/lib/email/emailService.ts`) + Resend Node SDK docs (Context7).

---

## 0. ⚠️ TWO Graph transports exist — not one

There are **two independent Microsoft Graph senders**. The approved Phase 1 plan migrates **transport A only**. Any implementation must avoid deleting Graph env/packages because transport B remains live for Orange Jelly invoicing/quotes/internal reminders.

| Transport | File | Public functions | Used for |
|---|---|---|---|
| **A. Generic wrapper** | `src/lib/email/emailService.ts` | `sendEmail(options)`, `sendSimpleEmail(...)` | everything except invoices/quotes (§2) |
| **B. Invoice/quote sender** | `src/lib/microsoft-graph.ts` | `sendInvoiceEmail(...)`, `sendQuoteEmail(...)`, `sendInternalReminder(...)`, `testEmailConnection()` | invoice & quote PDFs, internal reminders, settings "test email" button |

Transport B has its **own copy** of Graph plumbing (its own `getGraphClient` analogue, its own `EmailAttachment` interface — re-exported and even re-aliased as `graphSendInvoiceEmail` in `src/app/actions/email.ts`), its own `contentBytes` base64 attachment building, and its own From = `MICROSOFT_USER_EMAIL`. It also owns `isGraphConfigured()` that transport A imports.

**Transport B production callers (8 files):** `src/app/actions/email.ts` (calls `sendInvoiceEmail`, `sendQuoteEmail`, `testEmailConnection`; re-exports them), `src/app/actions/invoices.ts`, `src/app/actions/oj-projects/system.ts` (uses `isGraphConfigured`), `src/app/api/cron/auto-send-invoices/route.ts`, `src/app/api/cron/invoice-reminders/route.ts`, `src/app/api/cron/recurring-invoices/route.ts`, `src/app/api/cron/oj-projects-billing/route.ts`, `src/app/api/cron/oj-projects-billing-reminders/route.ts` (uses `sendInternalReminder`). Plus 2 test files mock `sendInvoiceEmail` (`invoices-receipt.test.ts`, `invoices-void.test.ts`). These send the **invoice/quote PDFs** and write to the existing `invoice_email_logs` table. (Transport B's own `EmailAttachment` and `sendInvoiceEmail`/`sendQuoteEmail` accept `ccRecipients?: string[]` and an `additionalAttachments` array of `{ filename, buffer }`.)

**Migration implication:** `emailService.ts` can be swapped behind a provider flag without touching invoice/quote signatures. Keep `microsoft-graph.ts`, `isGraphConfigured()`, `MICROSOFT_*`, `@azure/identity`, and `@microsoft/microsoft-graph-client` intact until a separate transport-B migration is explicitly approved. The call-site counts in §2 cover transport A.

---

## 1. Current email infrastructure (transport A)

**Sending wrapper:** `src/lib/email/emailService.ts` (127 lines). It is consumed by template/helper modules (`src/lib/email/private-booking-emails.ts`, `src/lib/email/employee-invite-emails.ts`, `src/lib/email/calendar-invite.ts`) and directly by actions/crons/services.

Config gate: `src/lib/microsoft-graph.ts` exports `isGraphConfigured()` (true only when all four `MICROSOFT_*` vars are set) — shared by both transports.

### Public surface — THE migration contract

```ts
interface EmailAttachment {
  name: string                    // NOTE: Graph field name. Resend wants `filename`.
  content: Buffer | string        // Buffer, or already-base64 string
  contentType: string
}

interface EmailOptions {
  to: string                      // SINGLE recipient only — NOT an array
  subject: string
  html?: string
  text?: string                   // plain-text alternative
  cc?: string[]
  bcc?: string[]
  attachments?: EmailAttachment[]
}

export async function sendEmail(
  options: EmailOptions
): Promise<{ success: boolean; error?: string; messageId?: string }>

export async function sendSimpleEmail(   // thin wrapper → sendEmail({to,subject,text})
  to: string, subject: string, body: string
): Promise<{ success: boolean; error?: string }>
```

**Important facts (correcting common assumptions):**
- `to` is a **single string**, not `string[]`. `cc`/`bcc` ARE `string[]`.
- There is **no `from`/`fromName`/`replyTo`** parameter anywhere. The From address is hard-wired to `process.env.MICROSOFT_USER_EMAIL`; there is no Reply-To anywhere in the codebase (`replyTo` count = 0).
- Attachment field is **`name`** (Graph convention), not `filename`.
- `messageId` is declared and *attempted* (`response?.id`) but Graph `sendMail` returns 202 with no body, so it is effectively always `undefined` today.
- `sendSimpleEmail` exists but has **zero callers** — only `sendEmail` is used in practice.
- This signature is the **migration anchor**: keep `sendEmail(options)` and the return shape backward-compatible so all 36 existing call sites keep working unchanged. The design spec adds only an optional `from?: string` override for edge-case sender identity.

### Authentication (Graph)
- `getGraphClient()` builds `ClientSecretCredential(MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)` from `@azure/identity`.
- `@microsoft/microsoft-graph-client` `Client.initWithMiddleware` with a custom `getAccessToken` requesting scope `https://graph.microsoft.com/.default`.
- **No client caching** (a fresh client is built per send — minor inefficiency, not a blocker).

### Message construction (all Graph-specific → must be transformed)
- Recipients: `toRecipients = [{ emailAddress: { address: to } }]`; cc/bcc mapped the same way (only attached to the message when non-empty).
- Body: `{ contentType: options.html ? 'HTML' : 'Text', content: html || text || '' }`.
- Attachments: `{ '@odata.type':'#microsoft.graph.fileAttachment', name, contentType, contentBytes }` where `contentBytes` = Buffer→`.toString('base64')` (strings passed through).
- Send: `client.api('/users/${senderEmail}/sendMail').post({ message, saveToSentItems: true })`.

### Retry / error handling / rate limiting
- **No retry.** Single `try/catch`; on failure logs `console.error` and returns `{ success:false, error: getErrorMessage(error) }`.
- **No rate limiting** at this layer (SMS has guards; email does not).
- **Never throws to callers** — always resolves the result object. Graph throws on API error → caught here.

---

## 2. Caller surface (must keep working)

**24 code files import `sendEmail`** from `@/lib/email/emailService` (plus 2 test files reference it = 26 total matches; **36 call sites** counting invocations). All use the named import `sendEmail` — none import `sendSimpleEmail`.

| Domain group | Files | Purpose |
|---|---|---|
| `src/app/actions` (7) | `employee-birthdays.ts`, `employeeActions.ts`, `employeeInvite.ts`, `leave.ts`, `oj-projects/client-statement.ts`, `payroll.ts`, `privateBookingActions.ts` | Employee docs/invites, leave, OJ client statements, payroll, private bookings |
| `src/app/api/cron` (3) | `employee-invite-chase/route.ts`, `event-checklist-reminders/route.ts`, `rota-manager-alert/route.ts` | Scheduled sends |
| `src/app/api/external` (1) | `performer-interest/route.ts` | Public performer-interest notify |
| `src/lib/email` (2) | `employee-invite-emails.ts`, `private-booking-emails.ts` | Template helpers (one hop over the wrapper) |
| `src/lib/private-bookings` (2) | `feedback.ts`, `manager-notifications.ts` | Private-booking notifications |
| `src/lib/table-bookings` (2) | `bookings.ts`, `charge-approvals.ts` | Table-booking confirmations / charge approvals |
| `src/lib/oj-projects` (1) | `billing-alerts.ts` | Billing run alerts |
| `src/lib/rota` (1) | `send-rota-emails.ts` | Weekly rota emails |
| `src/lib` (3) | `cron/alerting.ts`, `parking/payments.ts`, `refund-notifications.ts` | Cron-failure alerts, parking receipts, refund notices |
| `src/services/private-bookings` (2) | `mutations.ts`, `payments.ts` | Private-booking service-layer sends |

**Emails carrying attachments — 4 files (highest regression risk):**
- `src/app/actions/employeeActions.ts` — employee Contract PDF (`application/pdf`, Buffer)
- `src/app/actions/oj-projects/client-statement.ts` — client statement PDF (`application/pdf`, Buffer)
- `src/app/actions/payroll.ts` — payroll **XLSX** (`...spreadsheetml.sheet`, Buffer)
- `src/lib/email/private-booking-emails.ts` — booking attachment (`application/octet-stream`, Buffer)

Transport B also sends **invoice & quote PDFs** (§0), but those are excluded from Phase 1. All transport-A attachment call sites use the `{ name, content, contentType }` shape. **Plain-text (no HTML / `text:`) sends (7 files):** `employee-birthdays.ts`, `employeeInvite.ts`, `cron/event-checklist-reminders/route.ts`, `api/external/performer-interest/route.ts`, `lib/email/employee-invite-emails.ts`, `lib/private-bookings/manager-notifications.ts`, `services/private-bookings/mutations.ts` — these rely on the `text` branch, so Resend mapping must preserve `text`.

**Multi-recipient note:** because `to` is a single string, "send to several people" is done via `cc:string[]` today (e.g. `oj-projects/client-statement.ts`, `payroll.ts`, `performer-interest` cc's `leo.dowling@live.co.uk`). Resend `to` accepts an array, but **keep the `to:string` contract** to avoid touching callers.

---

## 3. Environment variable delta

**Present in `.env.example` today (Graph transport):**
```
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_TENANT_ID=your_microsoft_tenant_id
MICROSOFT_USER_EMAIL=your_email@domain.com   # the actual From address
```
**Recipient/identity vars (transport-agnostic — unaffected by migration):**
`PRIVATE_BOOKINGS_MANAGER_EMAIL`, `CRON_ALERT_EMAIL`, `EVENT_CHECKLIST_EMAIL_RECIPIENT`, `ROTA_MANAGER_EMAIL`, `PAYROLL_ACCOUNTANT_EMAIL`, `OJ_PROJECTS_BILLING_ALERT_EMAIL`, `MANAGER_EMAIL` (all default to `@the-anchor.pub`), plus `COMPANY_CONTACT_NAME/PHONE`, `COMPANY_LEGAL_NAME`, `DOCUMENT_EMAIL_SENDER`.

**Resend vars present:** NONE. `RESEND_API_KEY` does **not** exist. No `SMTP_*`/SendGrid/Postmark vars. `package.json` has **no `resend` dependency** (it does have `@azure/identity ^4.10.2` and `@microsoft/microsoft-graph-client ^3.0.7`).

**Required additions:**
```
RESEND_API_KEY=re_xxx
EMAIL_PROVIDER=graph                                      # graph|resend; default graph for rollback
EMAIL_FROM_ADDRESS=The Anchor <noreply@auth.orangejelly.co.uk>
EMAIL_REPLY_TO=manager@the-anchor.pub                     # optional monitored inbox
RESEND_WEBHOOK_SECRET=whsec_xxx                          # for the webhook in §5
```
Run `npm install resend`. (Webhook signature verification is **built into the Resend SDK** — `resend.webhooks.verify(...)`; a separate `svix` dependency is *not* required.)

**Cleanup:** do not remove the four `MICROSOFT_*` vars, `@azure/identity`, or `@microsoft/microsoft-graph-client` in Phase 1 because transport B still depends on them.

---

## 4. From-address, domain & DNS analysis

### Sender / address strings referenced in `src`
| Address | Count | Domain | Typical role |
|---|---|---|---|
| `manager@the-anchor.pub` | 18 | the-anchor.pub | dominant recipient default (cron/notify targets) |
| `peter@orangejelly.co.uk` | 3 | orangejelly.co.uk | = `MICROSOFT_USER_EMAIL` placeholder, the real Graph From |
| `events@the-anchor.pub` | 2 | the-anchor.pub | events notify |
| `support@orangejelly.co.uk` | 1 | orangejelly.co.uk | copy/fallback |
| `billy@orangejelly.co.uk` | 1 | orangejelly.co.uk | copy/fallback |

The actual envelope From today is always `MICROSOFT_USER_EMAIL` (an `orangejelly.co.uk` mailbox). The `@the-anchor.pub` strings are almost all **recipients**, not senders.

### Decision: send transport A from `auth.orangejelly.co.uk`
Per the design spec, transport A should move to Resend using the dedicated subdomain identity **`The Anchor <noreply@auth.orangejelly.co.uk>`** by default. This keeps SPF/DKIM changes isolated to a subdomain instead of the root `orangejelly.co.uk` or `the-anchor.pub` mail setup. Because transport A also includes OJ client statements and payroll, add an optional `from` override to `EmailOptions` so those sends can use an Orange Jelly display name on the same verified subdomain if required.

### DNS / verification (per sending domain in Resend)
Verify **auth.orangejelly.co.uk** in Resend. Resend issues, and DNS must publish:
- **SPF** — TXT include for Resend's sending host.
- **DKIM** — Resend-generated CNAME/TXT selector record(s).
- **Custom MAIL FROM / Return-Path** (recommended) — a subdomain with MX + SPF so bounce/Return-Path aligns (improves DMARC alignment and bounce capture).
- **DMARC** — TXT for the sending subdomain; start `p=none` (monitor) then tighten.

**Risk:** if `auth.orangejelly.co.uk` already has DNS/mail records, Resend's SPF must be merged rather than duplicated. If it is a clean subdomain, publish only the Resend-issued records there. Confirm DNS is owned/accessible before scheduling a cutover. Verify exact record values in the Resend dashboard at setup.

---

## 5. Deliverability / feedback handling (new capability)

**Today: none** for deliverability. No bounce/complaint/delivery handling and no suppression list. There ARE existing send-log tables — `invoice_email_logs` (written by transport B) and `rota_email_log` (written by `leave.ts`) — useful precedent/pattern for a unified email-send log, but neither captures bounces/complaints. `messageId` is never captured, so a send cannot be correlated to a later delivery event.

**Existing webhook directory:** `src/app/api/webhooks/` currently contains **only `paypal/` and `twilio/`** (no `stripe/`, no `sms/`). Add a sibling:
```
src/app/api/webhooks/resend/route.ts
```
- Read the **raw** request body (signature verification needs the exact bytes) — mirror the existing Twilio/PayPal webhook raw-body handling.
- Verify with the SDK: `resend.webhooks.verify({ payload: rawBody, headers: { id, timestamp, signature }, webhookSecret: RESEND_WEBHOOK_SECRET })` using `svix-id` / `svix-timestamp` / `svix-signature` headers.
- Handle `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.suppressed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`.
- Use the **service-role admin client** (`src/lib/supabase/admin.ts`) — system context, no user session. Route must be on the **public path allowlist** (no auth cookie); note `(authenticated)/layout.tsx` enforces auth, so confirm `/api/webhooks/resend` is reachable unauthenticated like the other webhooks.

**Suppression list (new table — migration required):**
```sql
create table email_suppressions (
  email          text primary key,
  reason         text not null,          -- 'bounce' | 'complaint' | 'manual'
  resend_email_id text,                  -- correlate to the originating send
  created_at     timestamptz not null default now()
);
```
On hard `email.bounced` / `email.complained`, upsert the recipient. In `sendEmail`, **check `email_suppressions` before sending** and short-circuit with `{ success:false, error:'recipient suppressed' }`. To correlate events to sends, the wrapper should **capture Resend's `data.id` into `messageId`** (Resend, unlike Graph, returns it).
**Approval gate:** persisting recipient emails + delivery metadata = storing PII in a new location → requires explicit owner approval per workspace rules before building §5.

---

## 6. Attachments: Graph → Resend transformation

| Aspect | Graph (current) | Resend |
|---|---|---|
| Per-attachment shape | `{ '@odata.type':'#microsoft.graph.fileAttachment', name, contentType, contentBytes: <base64> }` | `{ filename, content: base64String }` *(or `{ path }`)* |
| Field renames | — | `name`→`filename`; `contentBytes`→`content`; drop `@odata.type` |
| `contentType` | required | not a documented top-level field in the SDK examples — **verify**; rely on `filename` extension if unsupported |
| Encoding | Buffer→base64 manually; string passed as-is | Current Resend docs show local attachment `content` as **base64 encoded**; keep Buffer→base64 conversion in the wrapper |

**Transformation inside the wrapper:**
```ts
attachments: options.attachments?.map(att => ({
  filename: att.name,
  content: typeof att.content === 'string' ? att.content : att.content.toString('base64'),
}))
```
Current transport-A payloads: PDFs (Buffers from pdfkit/puppeteer — employee contract, OJ statement), a payroll **XLSX** Buffer, and an `.ics` calendar Buffer. All map cleanly through base64 encoding.
**Constraints:** Resend **`batch.send` does NOT support attachments** — keep the 4 attachment flows on `resend.emails.send` (single). Resend currently documents a 40 MB email size ceiling including attachments after base64 encoding; large employee files need a hosted-link fallback if they approach that limit.

---

## 7. Send-call mapping (single email — keep wrapper signature identical)

```ts
import { Resend } from 'resend'
const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendEmail(options: EmailOptions) {
  // (optional) suppression check here — see §5
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM_ADDRESS!,        // replaces hard-wired MICROSOFT_USER_EMAIL
    to: options.to,                               // single string — matches current contract
    subject: options.subject,
    html: options.html,                           // map BOTH html and text:
    text: options.text,                           // refund-notifications & cron/alerting rely on text
    cc: options.cc,                               // already string[]
    bcc: options.bcc,
    attachments: options.attachments?.map(a => ({
      filename: a.name,
      content: typeof a.content === 'string' ? a.content : a.content.toString('base64'),
    })),
    reply_to: process.env.EMAIL_REPLY_TO || undefined,
  })
  if (error) return { success: false, error: error.message }   // SDK does NOT throw
  return { success: true, messageId: data?.id }
}
```
**Critical behaviour difference:** the Resend SDK **returns `{ error }` and does NOT throw** on API failures (Graph throws). The wrapper MUST check `error` and translate to `{ success:false, error }`, or failures will masquerade as successes. Add idempotency where the SDK/API supports it for cron/automated sends to avoid duplicates on retry. Current docs use `reply_to`; verify package typings at implementation time.

---

## 8. Test-mock changes

Email is mocked by **module-mocking the wrapper**, not the transport. Pattern used in 8+ test files:
```ts
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
```
Files using it: `tests/actions/leave.test.ts`, `tests/actions/employeeActions.test.ts`, `tests/lib/privateBookingEmails.test.ts`, `tests/lib/employeeInviteEmails.test.ts`, `tests/lib/tableBookingHoldAlignment.test.ts`, `tests/lib/tableCheckoutSessionExpiry.test.ts`, `tests/lib/privateBookingFeedbackMutationGuards.test.ts`, `tests/lib/parkingPaymentsPersistence.test.ts`. (Helper modules like `private-booking-emails`/`employee-invite-emails` are themselves mocked in `tests/actions/privateBookingActions.test.ts` and `tests/actions/employeeInvite.test.ts`.)

**Impact: effectively zero** for these tests if the wrapper signature is preserved — they never touch Graph or Resend. Migration test work to ADD:
- A unit test for the wrapper that mocks the `resend` package (`vi.mock('resend', ...)`): assert param mapping (to/cc/bcc/text/html/attachment `name`→`filename`), the **error-not-thrown** path → `{ success:false }`, and the suppression short-circuit.
- A webhook-handler test: mock `resend.webhooks.verify`, assert suppression upsert on bounce/complaint and rejection on bad signature.
- No live API calls in tests (workspace rule).

---

## 9. Migration risks & cutover strategy

**Keep wrapper signatures stable.** The Phase 1 migration should fit inside `src/lib/email/emailService.ts` (+ the optional webhook/suppression additions). Do NOT change `EmailOptions`/the return shape. Do not change `sendInvoiceEmail`/`sendQuoteEmail` signatures or Graph configuration in Phase 1 because transport B remains Graph-bound.

**Top risks**
1. **Silent failure flip.** Graph throws → caught; Resend returns `{ error }` and does NOT throw. Omitting the `error` check turns every failure into a fake success. *Mitigation:* explicit `error` handling + a wrapper unit test for it. (Highest-likelihood bug.)
2. **Domain/DNS not ready / SPF collision.** An unverified domain or duplicated SPF = silent failures / spam-foldering. *Mitigation:* verify `auth.orangejelly.co.uk` in Resend before cutover; confirm DNS access first.
3. **Attachment regression.** The field rename `name`→`filename` plus base64 encoding must be correct across transport-A attachments. *Mitigation:* manual send-test each transport-A attachment flow (employee contract, OJ statement, payroll XLSX, booking .ics) on a verified domain before flipping prod.
4. **`text`-only sends.** `refund-notifications.ts` and `cron/alerting.ts` send plain text. *Mitigation:* map both `html` and `text` into the Resend call.
5. **Sender reputation/rate-limit cold-start.** New domain reputation and Resend's default 5 req/sec team rate limit can affect cron bursts. *Mitigation:* DMARC `p=none` monitoring first; warm gradually; throttle/sequentially send rota/staff loops; log and alert on `429`.
6. **No deliverability visibility today.** Without §5, bounces/complaints are invisible and repeat-sends to dead addresses harm reputation. *Mitigation:* ship §5 with or right after cutover.
7. **PII approval gate.** Suppression table / send log stores recipient emails + delivery events in a new location → needs explicit owner approval.
8. **From/Reply-To semantics.** Moving From to `auth.orangejelly.co.uk` changes what guests see/reply to. No Reply-To exists today; if guests should be able to reply, add `EMAIL_REPLY_TO` to a monitored Anchor inbox.

**Recommended cutover (phased, each independently deployable)**
1. **Prep:** verify `auth.orangejelly.co.uk` in Resend (SPF/DKIM/DMARC/MAIL-FROM); `npm install resend`; add `RESEND_API_KEY` + `EMAIL_PROVIDER` + `EMAIL_FROM_ADDRESS`.
2. **Wrapper swap behind a flag:** rewrite the transport inside `emailService.ts`; choose provider by `EMAIL_PROVIDER` env. **Dual-run option:** send via Resend, fall back to Graph on error during bake-in. Keep the signature identical.
3. **Capture `messageId`** from Resend `data.id`; add the wrapper unit test (mapping + non-throwing error path).
4. **Deliverability:** add `src/app/api/webhooks/resend/route.ts` + `email_suppressions` table + pre-send suppression check (after PII approval).
5. **Flip default to Resend**; monitor webhook events + Resend dashboard.
6. **Decommission:** remove only transport-A Graph code after a clean window. Keep `MICROSOFT_*`, `@azure/identity`, and `@microsoft/microsoft-graph-client` for transport B unless that path is separately migrated.

**Verify-against-docs flags:** package typings for `reply_to`; whether attachment `content_type` is supported; unsupported attachment file types; Svix header names; current Resend request-size limit; batch-send attachment limitation. Confirm all against current Resend docs at implementation time.
