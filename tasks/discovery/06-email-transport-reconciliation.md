# 06 — Email Transport Reconciliation (Graph vs Resend)

Read-only discovery. Resolves the contradiction between "outbound email uses Microsoft Graph"
and "there is a Resend webhook + Resend lifecycle columns on `email_messages`".

**Both findings are correct. The app supports two transports and uses both today.**

---

## (a) Definitive transport answer

The app has a **dual-transport email layer**. `sendEmail()` is provider-agnostic and dispatches
to either Resend or Microsoft Graph based on the `EMAIL_PROVIDER` env var. Both npm packages are
installed and both code paths are live.

- `resend@^6.12.4`
- `@microsoft/microsoft-graph-client@^3.0.7` + `@azure/identity@^4.10.2`

### How `sendEmail()` picks a transport
`src/lib/email/emailService.ts`:
- `getEmailProvider()` reads `process.env.EMAIL_PROVIDER` (`'graph'` | `'resend'`).
- If unset/invalid, it falls back to: `RESEND_API_KEY && EMAIL_FROM_ADDRESS ? 'resend' : 'graph'`.
- A per-call `options.provider` overrides the env default.
- `sendEmail()` → `sendEmailViaResend()` or `sendEmailViaGraph()`.

### What is configured in production TODAY
`.env.example` line 54: **`EMAIL_PROVIDER=graph`** with the explicit comment
*"Keep EMAIL_PROVIDER=graph until auth.orangejelly.co.uk is verified in Resend."*

So **the live default for the generic `sendEmail()` path is Microsoft Graph**, with Resend
already wired and ready to flip on once the sending domain is verified. Resend is staged but not
yet the active sender for the general path.

**One-line answer:** Customer-facing email is sent via **Microsoft Graph today** (because
`EMAIL_PROVIDER=graph`), through a transport-agnostic `sendEmail()` that will switch to **Resend**
by changing one env var once the domain is verified. The CLAUDE.md "Microsoft Graph" claim is
**accurate for current behaviour** but **incomplete** — it omits the Resend transport and the
provider switch.

---

## (b) Graph-vs-Resend split table (file:line)

| Path / sender | File:line | Transport | Logged to `email_messages`? | Notes |
|---|---|---|---|---|
| `sendEmail()` (general, logged path) | `src/lib/email/emailService.ts` `sendEmail()` | **Provider-selected**: `EMAIL_PROVIDER` env, default `graph` | **Yes** — via `recordEmailMessage()` (`src/lib/email/logging.ts`) | The unified entry point. Calls `isEmailSuppressed()` first, records `sent`/`failed`/`suppressed`. |
| `sendEmailViaResend()` | `emailService.ts` (called from `sendEmail`) | Resend SDK | Yes (records `resend_message_id`) | Used when `EMAIL_PROVIDER=resend` or per-call override. |
| `sendEmailViaGraph()` | `emailService.ts` (called from `sendEmail`) | Microsoft Graph `/sendMail` | Yes | Used when `EMAIL_PROVIDER=graph` (current default). |
| `sendSimpleEmail()` | `emailService.ts` | Delegates to `sendEmail()` | Yes | Thin wrapper. |
| `sendInvoiceEmail()` | `src/lib/microsoft-graph.ts:79` (`POST /users/{sender}/sendMail` at :208) | **Microsoft Graph (hard-wired bypass)** | **No** — does not call `recordEmailMessage` | Invoice delivery. Independent Graph client (`getGraphClient()` in microsoft-graph.ts), dynamic `import('@microsoft/microsoft-graph-client')`. |
| `sendQuoteEmail()` | `src/lib/microsoft-graph.ts:228` (`sendMail` at :301) | **Microsoft Graph (hard-wired bypass)** | No | Quote delivery. Called from `src/app/actions/email.ts:738`. |
| `sendInternalReminder()` | `src/lib/microsoft-graph.ts:321` (`sendMail` at :368) | **Microsoft Graph (hard-wired bypass)** | No | Internal reminder emails. |
| `testEmailConnection()` | `src/lib/microsoft-graph.ts:385` | Microsoft Graph | No | Connectivity test. |
| Invoice/quote actions | `src/app/actions/email.ts:6,181,255,407,529,663,738,906` | Microsoft Graph (via the bypass fns above) | No | Gated on `isGraphConfigured()`; these never go through the provider switch. |

**Summary of the split:**
- **General/transactional venue email** (`sendEmail`/`sendSimpleEmail`) → transport-agnostic,
  currently **Graph**, switchable to **Resend**; **logged** to `email_messages`.
- **Invoice / quote / internal-reminder email** → **always Microsoft Graph**, bypasses the
  provider switch entirely, and is **not** recorded in `email_messages`. (Comment in
  `.env.example:44`: *"Required while Orange Jelly invoice/quote transport remains on Microsoft Graph."*)

---

## (c) Resend webhook — event types handled today

`src/app/api/webhooks/resend/route.ts` (runtime `nodejs`):
- Verifies the payload with `resend.webhooks.verify()` using `RESEND_WEBHOOK_SECRET` and the
  `svix-id` / `svix-timestamp` / `svix-signature` headers (Svix signing).
- `mapStatus()` recognises these event types (all **outbound delivery lifecycle**):

| Resend event | Mapped status | `email_messages` column set |
|---|---|---|
| `email.sent` | `sent` | `sent_at` |
| `email.delivered` | `delivered` | `delivered_at` (+ marks customer `email_status='valid'`, resets failure count) |
| `email.delivery_delayed` | `delivery_delayed` | `delivery_delayed_at` |
| `email.opened` | `opened` | `opened_at` |
| `email.clicked` | `clicked` | `clicked_at` |
| `email.bounced` | `bounced` | `bounced_at`, `error` (+ customer failure tracking) |
| `email.complained` | `complained` | `complained_at`, `error` (+ customer failure tracking) |
| `email.failed` | `failed` | `failed_at`, `error` |
| `email.suppressed` | `suppressed` | `failed_at`, `error` |
| (anything else) | `null` → ignored (`{ success: true, ignored: true }`) | — |

- Rows are matched/updated by `.eq('resend_message_id', emailId)` where `emailId = event.data.email_id`.
- `updateCustomerEmailHealth()` additionally updates the `customers` table
  (`email_status`, `email_delivery_failures`, `last_email_failure_reason`, `email_deactivated_at`,
  `last_successful_email_at`) for bounce/complaint/delivery events.

**Inbound handling: NONE.** There is no `inbound`, `email.received`, or inbound-parse branch.
Every handled event is an outbound delivery-status event. Resend inbound/parse is **not configured
anywhere** in the codebase (no inbound route, no `direction` write, no parse endpoint).

---

## (d) Exact path to add Resend inbound capture + customer matching

Resend now offers inbound email (parse + an `email.received`/inbound webhook). To capture inbound
and match it to a customer:

### Schema change required FIRST (blocker)
The `email_messages` table (`supabase/migrations/20260703000000_email_comms_resend_infra.sql:27`)
has **no `direction` column** — it implicitly models outbound only. Current columns:
`id, customer_id, to_address, from_address, comm_type, subject, resend_message_id, status, error,
metadata, sent_at, delivered_at, delivery_delayed_at, opened_at, clicked_at, bounced_at,
complained_at, failed_at, + the *_booking_id FKs, created_at, updated_at`.

There is a `CONSTRAINT email_messages_status_check` (line 52) — its allowed-value list must be
inspected/extended before writing a `received` status. (The only existing `direction = 'outbound'`
reference in the file is in a **view** over the separate SMS `messages` table, not this table.)

New migration should:
1. `ALTER TABLE public.email_messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound';`
   (backfill existing rows to `'outbound'`).
2. Add `received_at TIMESTAMPTZ` and a `body_text` / `body_html` column (inbound carries content;
   today only `subject` is stored).
3. Extend `email_messages_status_check` to permit a `received` status.
4. Add an index on `LOWER(from_address)` for inbound→customer matching.

### Webhook branch
In `src/app/api/webhooks/resend/route.ts`:
- Add the inbound event type to `mapStatus()` (e.g. `case 'email.received': return 'received'`)
  — or branch earlier, since inbound is an **insert**, not an `.update().eq(resend_message_id,…)`.
- On inbound: extract `from`, `to`, `subject`, body. Match a customer by normalised from-address:
  `adminClient.from('customers').select('id').ilike('email', fromAddr.trim().toLowerCase())`
  (mirror the `updateCustomerEmailHealth` matching style).
- Insert an inbound row via `recordEmailMessage()` (extend `RecordEmailMessageParams` with
  `direction` and body) or a dedicated `recordInboundEmail()` in `src/lib/email/logging.ts`,
  setting `direction = 'inbound'`, `status = 'received'`, `received_at = now`,
  `customer_id = matched?.id ?? null`, `from_address = sender`, `to_address = venue address`.
- Keep verification: inbound events are signed with the same Svix secret, so the existing
  `resend.webhooks.verify()` path covers them.

### Config
- Resend dashboard: enable Inbound for the receiving domain and point the inbound route at
  `/api/webhooks/resend` (or a new `/api/webhooks/resend/inbound`).
- No new env var strictly required (`RESEND_WEBHOOK_SECRET` already present), unless a separate
  inbound endpoint with its own signing secret is preferred.

**Feasibility: YES, low-to-moderate effort.** Code change is small; the real prerequisite is the
schema migration (add `direction` + body + `received` status) since the table is outbound-only today.

---

## (e) Contradiction with the CLAUDE.md "Microsoft Graph" claim

- CLAUDE.md states: *`src/lib/email/emailService.ts` — `sendEmail(...)` via Microsoft Graph*.
- **Status: outdated / incomplete, not wrong.**
  - `sendEmail()` is now **provider-agnostic** (Graph **or** Resend via `EMAIL_PROVIDER`).
  - Graph is still the **active default** (`EMAIL_PROVIDER=graph`), so the claim matches current
    runtime behaviour — but it omits that Resend is fully wired and one env var away from being live.
  - The doc also doesn't mention the Resend delivery webhook or the `email_messages` logging table.
- **Recommended doc update:** describe `sendEmail()` as a dual-transport dispatcher
  (`EMAIL_PROVIDER`, default `graph`), note the Resend webhook at `/api/webhooks/resend`, and note
  that invoice/quote/internal-reminder emails always use Microsoft Graph via `src/lib/microsoft-graph.ts`
  (bypassing the switch and not logged to `email_messages`).

---

## Key files
- `src/lib/email/emailService.ts` — transport-agnostic `sendEmail()` + provider switch + Graph/Resend senders.
- `src/lib/email/logging.ts` — `recordEmailMessage()`, `isEmailSuppressed()` (the logged path).
- `src/lib/microsoft-graph.ts` — Graph-only invoice/quote/reminder senders (bypass, unlogged).
- `src/app/actions/email.ts` — invoice/quote actions calling the Graph bypass fns.
- `src/app/api/webhooks/resend/route.ts` — Resend delivery-status webhook (outbound only, no inbound).
- `supabase/migrations/20260703000000_email_comms_resend_infra.sql` — `email_messages` + `email_suppressions` tables (no `direction` column).
- `.env.example` lines 43–58 — Graph + Resend config; `EMAIL_PROVIDER=graph`.
