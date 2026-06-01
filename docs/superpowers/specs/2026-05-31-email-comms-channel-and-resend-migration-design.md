# Design Spec — Email-Preferred Customer Comms & Resend Migration

- **Date:** 2026-05-31
- **Author:** Peter Pitcher (with Claude)
- **Status:** Draft for review — owner updates applied
- **Complexity:** 5 / XL (cross-cutting; new transport, schema, dispatch layer; phased)
- **Discovery findings:** [`tasks/comms-discovery/findings/`](../../../tasks/comms-discovery/findings/) (`01`–`06`)

---

## 1. Summary

Cut Twilio SMS cost — and modernise deliverability — by sending **email instead of SMS** to customers who have a usable email address, falling back to SMS automatically. In the same programme, migrate the venue's generic email transport off the personal `peter@orangejelly.co.uk` Microsoft Graph mailbox onto **Resend**, sending by default as **The Anchor `<noreply@auth.orangejelly.co.uk>`**.

The work introduces three things the app does not have today: (1) a **channel-selection engine** with a per-comm policy, (2) an **email deliverability/consent model** (status, bounce/complaint suppression) without which "prefer email" is unsafe, and (3) the **Resend integration** with delivery/open webhooks.

---

## 2. Background — what discovery established

**Architecture is favourable for a central change:**
- Every SMS funnels through one primitive — `sendSMS` at [`src/lib/twilio.ts:207`](../../../src/lib/twilio.ts) (the only `messages.create`, line 457; uniform consent gate `isCustomerSmsSendAllowed` at lines 127–189). 25 callers.
- The venue/generic email transport is a single wrapper — `sendEmail(options)` at [`src/lib/email/emailService.ts`](../../../src/lib/email/emailService.ts) (24 callers, 36 sites). A second Microsoft Graph transport exists for Orange Jelly invoices/quotes in [`src/lib/microsoft-graph.ts`](../../../src/lib/microsoft-graph.ts), and is explicitly excluded from this migration.
- There is **no cross-channel layer** — every call site has already committed to SMS or email. This is the clean insertion point.

**The cost reality (be clear-eyed — this shapes priorities):**
- **758 customers; only 138 (18.2%) have an email.** 82% are phone-only.
- 90-day SMS volume ≈ 1,060 messages (down from 2,201 the prior 90 days — already halving).
- `messages.cost_usd` is a **hardcoded `$0.04 × segments` estimate**, never backfilled with Twilio's real price — usable only as a *volume proxy*, and it over-states real UK SMS cost.
- Email coverage is **bimodal**: table-booking confirmations 60% emailable, table review follow-ups 43%, private-booking 39% — but event reminders **0%**, event bookings 10%, marketing 3–8%.
- Realistically convertible spend ≈ **$7 / 90 days of the estimate** (~half from the two table-booking comms). The naive "convert the biggest spender" instinct is wrong: the biggest bill (`bulk_sms_campaign`) reaches recipients who are only 6.3% emailable.

**Honest framing:** the *direct cash saving from channel-switching is small and capped by email coverage.* The durable value of this programme is (a) correct, deliverable, brand-consistent comms off a personal mailbox, (b) the infrastructure to switch channels safely, and (c) two adjacent fixes that are worth more than the switch itself (email capture; dead-number cleanup). All are in scope, phased.

**The deliverability gap (the core blocker):**
- No `email_opt_in` column exists in active use; no email status/validity, no bounce/complaint tracking, no suppression, no unsubscribe (finding 03).
- The previously noted `notification_preferences jsonb default '{"sms":true,"email":true}'` migration reference is for `loyalty_members`, not `customers`; it is not a customer-channel preference source and should not be adopted by `selectChannel()`.
- "Usable email" today = "present and usually format-valid." Preferring email on that basis alone would silently mis-route booking confirmations if the address later bounces or is suppressed. We must add a deliverability signal + suppression before flipping any default.

---

## 3. Goals & non-goals

### Goals
1. A **per-comm channel policy** with default **email-first, SMS fallback** for customer transactional comms.
2. A single **`notifyCustomer()`** dispatcher + **`selectChannel()`** engine; call sites migrated incrementally.
3. **Email equivalents** (HTML) for the customer transactional comms that are SMS-only today.
4. **Resend migration** of the venue transport (`emailService.ts`) from `noreply@auth.orangejelly.co.uk`, behind a provider flag for safe cutover.
5. **Email deliverability infra:** send logging, Resend delivery/bounce/complaint/open webhooks, suppression list — required to make email-first safe.
6. Two **adjacent, separable workstreams**: an **email-capture drive** and a **dead-number cleanup**.

### Non-goals (deliberately out of scope — flag if you want any added)
- **No Settings management UI** for toggling comms. The policy is uniform; the few exceptions live in typed code config. (Future enhancement; noted in §13.)
- **No marketing/promotional email sending.** Transactional only. Schema is left extensible (a `marketing_email_opt_in` column is added but not gated on) so a future marketing milestone can build on it. Marketing email needs PECR-compliant opt-in + unsubscribe in every message — a separate piece of work.
- **Orange Jelly invoicing/quotes** ([`src/lib/microsoft-graph.ts`](../../../src/lib/microsoft-graph.ts), "transport B") **stays on Microsoft Graph / orangejelly.co.uk, untouched.** This is the B2B Orange Jelly path, explicitly excluded.
- No change to the SMS consent/health model itself (it stays as-is; we read it).

---

## 4. Confirmed decisions (from review)

| # | Decision | Choice |
|---|---|---|
| D1 | Channel policy when email + mobile both present | **Email-first, SMS auto-fallback** (per-comm overridable in code) |
| D2 | Adjacent wins (email capture, dead-number cleanup) | **In scope**, as separable phases |
| D3 | Resend sending identity | **The Anchor `<noreply@auth.orangejelly.co.uk>`** (dedicated subdomain) |
| D4 | Marketing email | **Out of scope now**; schema extensible for later |
| D5 | Comms management | **Code config, no Settings UI** |
| D6 | Transport scope | Migrate venue transport A; **invoicing transport B excluded** |
| D7 | Open-tracking | **Included** (lightweight — handler is built anyway) |

> **Note on D3:** using the dedicated subdomain `auth.orangejelly.co.uk` neatly avoids the SPF-collision risk on the root domain (Resend's SPF include goes on the subdomain, isolated from any existing root SPF/MX). A display name of "The Anchor" means customers see the brand even though the domain is orangejelly.co.uk. (Minor consideration to accept: on expansion the visible domain is orangejelly.co.uk, not the-anchor.pub — acceptable per owner decision.)

---

## 5. Architecture

A thin, two-part layer inserted **above** the existing transports — not inside `sendSMS`/`sendEmail` (those stay pure transports).

```
caller (service/cron/action/webhook)
        │  notifyCustomer({ commType, customerId, context })
        ▼
┌───────────────────────────────────────────────┐
│ notifyCustomer()  — dispatcher                 │
│  1. load comm registry entry (policy, category)│
│  2. load customer contactability + suppression │
│  3. selectChannel() → ordered channel list     │
│  4. build SMS body / email HTML from context   │
│  5. send via transport; on email failure →     │
│     fall back to SMS if policy allows           │
│  6. log every attempt (messages / email_msgs)  │
└───────────────────────────────────────────────┘
        │                         │
        ▼                         ▼
   sendSMS (twilio.ts)      sendEmail (emailService.ts → Resend)
```

### 5.1 Comm registry (typed code config — no DB, no UI)
A single typed object cataloguing every customer comm, seeded from the discovery inventory (§9). Each entry:

```ts
type ChannelPolicy = 'email_first' | 'sms_only' | 'email_only' | 'both'
interface CommType {
  key: string                 // e.g. 'table_booking_confirmed' (matches messages.template_key)
  label: string
  category: 'transactional' | 'marketing'
  policy: ChannelPolicy       // default behaviour; D1 default is 'email_first'
  urgency: 'standard' | 'time_critical'  // time_critical (same-day/session) never email-only
  buildSms: (ctx) => string
  buildEmail?: (ctx) => { subject: string; html: string }  // absent ⇒ SMS-only in practice
}
```

The registry is the **single source of truth** for "what channels can this comm use and how is each rendered." Changing a comm's channel = a one-line code edit + redeploy. (Chosen over a DB-backed Settings UI per D5; revisit if operational need emerges.)

### 5.2 `selectChannel(customer, commType)` — pure function
Returns an ordered list of channels to attempt (e.g. `['email','sms']`, `['sms']`, `[]`). No side effects → unit-testable in isolation. Algorithm in §7.

### 5.3 `notifyCustomer(...)` — dispatcher
Orchestrates registry lookup → `selectChannel` → render → send → fallback → log. Mirrors and generalises the existing [`src/lib/refund-notifications.ts`](../../../src/lib/refund-notifications.ts) pattern (the only place today that already does email-first-then-SMS). Idempotency reuses the existing job/idempotency mechanisms.

### 5.4 Hook point & rollout
Per finding 05, the highest-leverage first hook is the **job processor's `send_sms` handler** and the per-comm service/lib send sites. Call sites are migrated **one comm at a time** — each migration is an independently shippable change. `sendSMS`/`sendEmail` remain callable directly for the things that must bypass the engine (internal ops alerts, OTP).

---

## 6. Data model changes (all additive; no destructive migrations)

> **PII approval gate:** §6.2/§6.3 persist recipient email addresses and delivery metadata in **new locations**. Per workspace safety rules this requires **explicit owner sign-off before building**. Flagged here; confirm at the spec-review gate.

### 6.1 `customers` — email channel health (mirror the SMS model)
Add (all nullable / safe defaults):
- `email_status text default 'unknown'` — CHECK in (`unknown`,`valid`,`bounced`,`complained`,`invalid`)
- `email_delivery_failures integer default 0`
- `last_email_failure_reason text`
- `last_successful_email_at timestamptz`
- `email_deactivated_at timestamptz`
- `marketing_email_opt_in boolean default false` — **stored but not gated on in this programme** (future marketing use; mirrors `marketing_sms_opt_in`)

> No transactional `email_opt_in` gate is introduced: transactional email rests on legitimate interest. Deliverability is governed by `email_status` + the suppression list, not an opt-in flag. No customer-level `notification_preferences` source exists in the current schema; a future customer preference override should be a deliberate new column/table, not inferred from the loyalty migration.

### 6.2 `email_messages` — email send log (new table)
Email equivalent of the role `messages` plays for SMS. One row per email send attempt:
`id`, `customer_id` (nullable — some recipients aren't customers), `to_address`, `from_address`, `comm_type` (registry key), `subject`, `resend_message_id`, `status` (`queued`/`sent`/`delivered`/`bounced`/`complained`/`failed`), `opened_at`, `clicked_at`, `bounced_at`, `complained_at`, `error`, booking-link FKs (mirroring `messages.*_booking_id`), `created_at`, `updated_at`. RLS on; written via service-role from the wrapper/webhook.

> **Decision — separate table, not overloading `messages`.** *Alternative considered:* add email rows to `messages` with `message_type='email'`. **Rejected:** many queries read `messages` assuming SMS (conversation threads, cost reports, the SMS consent reconcile) and would silently include email rows. A separate table keeps the mature SMS path untouched.

### 6.3 `email_suppressions` (new table)
`email text primary key`, `reason text` (`bounce`/`complaint`/`manual`), `resend_email_id text`, `created_at timestamptz default now()`. Hard bounces/complaints upsert here from the webhook; `sendEmail` short-circuits if the recipient is suppressed; `selectChannel` treats a suppressed address as email-ineligible.

### 6.4 `customer_communications` (new VIEW — optional UI, data now)
A read-only union of outbound `messages` (SMS) + `email_messages` (email) → a single per-customer timeline (`channel`, `comm_type`, `status`, `subject`/`body`, timestamps). Enables "see everything we've sent this customer" without a UI build; a profile widget can be added later cheaply.

---

## 7. Channel-selection algorithm

For `selectChannel(customer, commType)`:

1. **Resolve eligibility per channel:**
   - *Email eligible* iff: `customer.email` present **and** passes format check **and** `email_status NOT IN ('bounced','complained','invalid')` **and** `email_deactivated_at IS NULL` **and** address not in `email_suppressions`.
   - *SMS eligible* iff the **existing** SMS gate passes (`isCustomerSmsSendAllowed`: phone present, `sms_opt_in !== false`, `sms_status` active). Unchanged logic — we call it, not reimplement it.
2. **Apply the comm's `policy`:**
   - `email_first` → `[email, sms]` filtered to eligible (email first). At send time, an email send failure (Resend `{error}`) or a hard bounce triggers the SMS attempt.
   - `email_only` → `[email]` if eligible, else `[]`. **Forbidden for `urgency: time_critical`** (guard) — never let a same-day/session message be email-only.
   - `sms_only` → `[sms]` if eligible.
   - `both` → every eligible channel, both sent.
   - **Time-critical comms are configured `sms_only` (or `both`), never `email_first`**, so SMS delivery is guaranteed for same-day/session/security messages regardless of email coverage. `email_first` is reserved for standard (non-urgent) comms.
3. **Degrade gracefully:** if the preferred channel is ineligible, fall through to the next; if none, return `[]` and log `no_channel_available` (observability, not a silent drop).
4. **Marketing category** (future): additionally require the channel's marketing opt-in. Not exercised now (no marketing sends).

This generalises the refund pattern and is the *only* place channel logic lives.

---

## 8. Resend migration (venue transport A only)

### 8.1 Transport swap — keep the signature, add safety
Rewrite the body of `sendEmail(options)` to call Resend; **preserve `EmailOptions` and the return shape exactly** so all 24 callers keep working. Add one **optional, backward-compatible** field `from?: string` (defaults to `EMAIL_FROM_ADDRESS`) so a specific sender (e.g. OJ client statements) can override identity later.

```ts
import { Resend } from 'resend'
const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendEmail(options: EmailOptions) {
  // 0. provider flag: if EMAIL_PROVIDER==='graph' use the legacy Graph path (rollback)
  // 1. suppression check (email_suppressions) → short-circuit
  const { data, error } = await resend.emails.send({
    from: options.from ?? process.env.EMAIL_FROM_ADDRESS!,   // 'The Anchor <noreply@auth.orangejelly.co.uk>'
    to: options.to,                                          // single string — unchanged contract
    subject: options.subject,
    html: options.html,
    text: options.text,                                      // refund/cron rely on text — must map BOTH
    cc: options.cc, bcc: options.bcc,
    reply_to: process.env.EMAIL_REPLY_TO || undefined,
    attachments: options.attachments?.map(a => ({
      filename: a.name,
      content: typeof a.content === 'string' ? a.content : a.content.toString('base64'),
    })), // name→filename; Resend documents local attachment content as base64
  })
  if (error) return { success: false, error: error.message }  // ⚠️ SDK does NOT throw — must check
  return { success: true, messageId: data?.id }               // capture id for webhook correlation
}
```

**Top risk (highest-likelihood bug):** Resend returns `{error}` and does **not** throw (Graph throws). Missing the check turns every failure into a fake success → a wrapper unit test for the non-throwing error path is mandatory.

### 8.2 Provider flag & cutover
- `EMAIL_PROVIDER` env (`resend` | `graph`), default `graph` until verified, then flip to `resend`. Enables instant rollback. Optional dual-run (Resend, fall back to Graph on error) during bake-in.
- Keep the Graph code path until a clean window passes, then decommission (`MICROSOFT_*`, `@azure/identity`, `@microsoft/microsoft-graph-client`) — **only** for transport A's usage; transport B keeps Graph.
- Because transport B remains on Graph, do **not** remove the `MICROSOFT_*` env vars or Graph packages until invoices/quotes have a separate approved migration plan.

### 8.3 Domain & DNS (`auth.orangejelly.co.uk`)
Verify the subdomain in Resend; publish DKIM (Resend selector), SPF (on the subdomain — isolated, no collision), a custom MAIL FROM/Return-Path subdomain, and DMARC at `_dmarc` (`p=none` → monitor → tighten). Confirm DNS access before scheduling cutover. Manual send-test each attachment flow on the verified domain before flipping prod.

### 8.4 Env delta
Add: `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS='The Anchor <noreply@auth.orangejelly.co.uk>'`, `RESEND_WEBHOOK_SECRET`, `EMAIL_PROVIDER`. Optional: `EMAIL_REPLY_TO` if replies should go to a monitored venue inbox. Run `npm install resend`. Recipient vars (`MANAGER_EMAIL`, `ROTA_MANAGER_EMAIL`, `PAYROLL_ACCOUNTANT_EMAIL`, …) are transport-agnostic — keep. Document all in `.env.example`.

Resend currently documents a default API rate limit of **5 requests/second per team**; rota/staff sends and any batchy cron path should either reuse the existing queue/throttle patterns or send sequentially during the Phase 1 bake-in.

### 8.5 Attachments
4 transport-A flows carry attachments (employee contract PDF, OJ statement PDF, payroll XLSX, private-booking `.ics`). Map `{name,content,contentType}` → `{filename, content}` and encode Buffers to base64 for Resend's documented local attachment contract. Resend `batch.send` does **not** support attachments; keep these on single `emails.send`. Resend also documents a 40 MB email size ceiling including attachments after base64 encoding. Verify unsupported file types and any SDK-specific attachment fields against live docs at build time.

### 8.6 Webhooks + suppression (D7)
New `src/app/api/webhooks/resend/route.ts` (sibling of `paypal/`, `twilio/`):
- Read **raw** body; verify via SDK `resend.webhooks.verify({...})` with `svix-id`, `svix-timestamp`, and `svix-signature` headers + `RESEND_WEBHOOK_SECRET`.
- Handle `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.suppressed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked` → update `email_messages` by `resend_message_id`; on hard bounce/complaint/suppression upsert `email_suppressions`.
- Service-role admin client; route on the public/unauthenticated allowlist (like other webhooks).

### 8.7 Test mocks
Existing tests mock the wrapper (`vi.mock('@/lib/email/emailService')`) → unaffected if the signature holds. Add: a wrapper unit test mocking `resend` (param mapping incl. `name`→`filename`, the **error-not-thrown** path, suppression short-circuit); a webhook-handler test (signature reject + suppression upsert). No live API calls.

---

## 9. Comm classification (the per-comm policy map)

Default `email_first` for customer transactional comms; exceptions called out. Email template (`buildEmail`) authored when a comm is migrated (Phase 4), prioritised by coverage. Full inventory: finding 01.

| Comm (template_key) | Proposed policy | Urgency | Email template needed | Notes |
|---|---|---|---|---|
| `table_booking_confirmed` / `_pending_payment` | email_first | standard | **Yes (Phase 3 pilot)** | 60% coverage — highest-value switch |
| `table_review_followup` | email_first | standard | Yes | 43% coverage; email arguably better (clickable link) |
| `table_booking_deposit_confirmed` | email_first | standard | Yes | |
| `table_booking_cancelled` | email_first | standard | Yes | |
| `table_booking_pending_payment` (party-size→deposit) | email_first | standard | Yes | |
| `private_booking_created` + lifecycle (deposit/balance/review) | email_first | standard | Yes | 39% coverage; some email already exists — consolidate |
| `event_booking_confirmed` / `_pending_payment` | email_first | standard | Yes | 10% coverage; email branch built, SMS stays primary in practice |
| `event_payment_confirmed` | email_first | standard | Yes | |
| `event_payment_retry` | email_first | standard | Yes | failed-payment notice; email-first with SMS fallback |
| `event_booking_seats_updated` / `event_rescheduled` / `event_cancelled` / `event_booking_cancelled_admin` | email_first | standard | Yes | |
| `event_hold_expired` | email_first | standard | Yes | informational; email-first with SMS fallback |
| `event_reminder_1d` | sms_only (revisit to `both`) | time_critical | optional | 0% coverage; same-day reliability — keep SMS |
| `event_waitlist_joined` / `_accepted_confirmed` | email_first | standard | Yes | |
| `event_waitlist_offer` | **both** | time_critical | Yes | high-value, time-boxed — send both channels |
| `parking_payment_request` / `parking_payment_confirmation` | email_first | standard | Yes | manager email exists; **add customer email** (low-hanging) |
| `parking_*` reminders/expiry/session (#25) | sms_only (→ both later) | time_critical | optional | session-ending immediacy — keep SMS |
| `sunday_preorder_request` | email_first | standard | Yes | sent days ahead; preserve current `allowTransactionalOverride` intent for SMS fallback |
| `refund` | email_first | standard | (exists) | already email-first — fold into engine |
| `bulk_sms_campaign`, `event_*_promo_*`, `event_cross_promo_14d` (marketing) | sms_only (now) | — | deferred | **marketing out of scope**; email branch in future milestone |
| `otp_message` | **sms_only** | time_critical | no | security — must stay SMS |
| `message_thread_reply`, `event_reply_booking_response` | **sms_only** | — | no | conversational/inbound |
| `boh_manual_booking_sms`, approved private-booking manual SMS | **sms_only** | — | no | staff explicitly chose SMS |
| `foh_food_order_alert` | **sms_only** | — | no | internal ops, not a customer comm |

---

## 10. Email template authoring
Add a small shared HTML layout (Anchor header/footer, mobile-friendly, no marketing chrome) + per-comm `buildEmail(ctx)` content builders co-located with the registry. SMS bodies stay as-is (`buildSms`). Author per comm **as it is migrated** (don't pre-build 25 templates). Prioritise by coverage: table bookings → private bookings → events/parking. Transactional design tokens only; plain, calm tone (consistent with the venue's customer-facing voice).

---

## 11. Adjacent workstream A — Email-capture drive (separable; the real ceiling-lifter)
At 18% coverage, capture is worth more than all switches combined.
- Keep `z.string().trim().email()` validation and lowercase normalisation on the staff customer create/edit path ([`src/lib/validation.ts`](../../../src/lib/validation.ts) `customerSchema` already validates; [`src/services/customers.ts`](../../../src/services/customers.ts) lowercases). Audit import/bulk-edit paths and any new capture surface for the same behaviour; respect the existing `lower(email)` unique index.
- Prompt for email at event-booking and parking capture (currently weak).
- One-off backfill nudge for high-value phone-only customers (e.g. at next table booking).
- Success metric: coverage % over time, especially on event + parking comms.

## 12. Adjacent workstream B — Dead-number cleanup (separable; recovers wasted SMS)
~$6.8/90d (estimate) is SMS to dead numbers — all `status='failed'`, Twilio errors **21612** (unreachable, 97 rows) / **21211** (invalid number, 55 rows).
- Tag every automated sender with `metadata.template_key` (kills the "untagged" bucket so waste stops being invisible).
- **Store Twilio's real `Price`/`NumSegments`** from the status callback into `messages.price`/`cost_usd` — currently dropped, which is why no `£` figure is real. (Makes future cost reporting trustworthy.)
- Tighten failure-driven auto-deactivation; after an SMS hard-fail, fall back to email for the ~32% who have one.

---

## 13. Phasing (each phase independently deployable)

| Phase | Deliverable | Depends on |
|---|---|---|
| **1. Resend transport** | `npm i resend`; `emailService.ts` wrapper rewritten behind `EMAIL_PROVIDER`; domain verified; `{error}` handled; `messageId` captured; attachments mapped. Transport-A emails now send via Resend from The Anchor by default. **No channel change.** | DNS access; Resend account |
| **2. Deliverability infra** | `email_messages`, `email_suppressions`, customer `email_*` columns, Resend webhook (delivery/bounce/complaint/open/click), pre-send suppression, `customer_communications` view. | Phase 1; **PII approval** |
| **3. Channel engine + pilot** | `selectChannel`, `notifyCustomer`, comm registry, email validation at capture; migrate **`table_booking_confirmed`** end-to-end as proof. | Phase 2 |
| **4. Incremental rollout** | Migrate remaining `email_first`/`both` comms + author templates, by coverage order (table → private → event/parking). Each comm a separate shippable change. | Phase 3 |
| **5a. Email-capture drive** | §11 — validation everywhere + capture prompts + backfill. (Can run in parallel from Phase 1.) | — |
| **5b. Dead-number cleanup** | §12 — template_key tagging + real Twilio price capture + SMS-hard-fail→email. | Phase 2 (for email fallback) |
| *(future)* Marketing email | `marketing_email_opt_in` gating + tokenised unsubscribe route + PECR compliance. **Not in this programme.** | Phase 4 |

A future, optional **Settings → Communications UI** (toggle/policy per comm, comms-log viewer, per-customer timeline) can be added on top of the registry + `customer_communications` view if operational need emerges — explicitly deferred (D5).

---

## 14. Security, privacy & compliance
- **PII approval gate** for `email_messages` + `email_suppressions` (recipient emails + delivery metadata in new locations) — confirm before Phase 2.
- RLS on all new tables; writes via service-role from wrapper/webhook only.
- Resend webhook: signature-verified, raw-body, unauthenticated allowlist (like Twilio/PayPal).
- Audit logging (`logAuditEvent`) for any staff-facing config/customer changes per workspace convention.
- **PECR/GDPR:** transactional email needs no marketing consent; marketing email (deferred) will require opt-in + unsubscribe-in-every-message before any send. No marketing email ships in this programme.
- Secrets in env only; never logged. Follow the lesson: serialise provider errors by field (no `JSON.stringify(error)`).

## 15. Testing strategy
- `selectChannel` — pure-function unit tests across the eligibility/policy matrix (email/sms present×eligible×policy×urgency).
- `sendEmail` wrapper — Resend mocked: param mapping, `name`→`filename`, **error-not-thrown** path, suppression short-circuit.
- Resend webhook — signature reject + status/suppression upserts.
- `notifyCustomer` — fallback path (email fails → SMS), logging to both tables, `no_channel_available`.
- Per-comm migration — each gets happy-path + 1 fallback/edge test.
- All external services mocked (Twilio, Resend, Graph). No live calls (workspace rule).

## 16. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Resend `{error}` not thrown → fake success | Explicit check + mandatory unit test (§8.1) |
| Domain/SPF not ready | Dedicated subdomain (no root collision); verify before cutover; provider flag rollback |
| Resend rate limit hit by cron bursts | Throttle/sequential sends or queue batchy transport-A email flows; monitor `429` responses |
| Silent mis-route to bad email | Don't flip default until suppression + status exist (Phase 2 precedes Phase 3) |
| Time-critical comm sent email-only | `urgency:'time_critical'` forbids `email_only`; SMS always in the attempt list |
| Scattered call-site refactor regressions | Incremental, one comm per change; engine + transport shipped first |
| Over-investing for a small cash saving | Phasing front-loads the cheap, high-value infra + table bookings; marketing/event switching is deferred/low-effort |
| PII stored without approval | Explicit gate before Phase 2 |

## 17. Assumptions
- **A1:** Transport A (`emailService.ts`) is migrated wholesale to Resend — that includes venue *staff/ops* mail (rota, payroll, onboarding, manager alerts) and OJ client statements, defaulting to `The Anchor <noreply@auth.orangejelly.co.uk>`. Only invoicing/quotes/internal reminders in transport B are excluded and stay on Microsoft Graph. OJ client statements can use the new optional `from` override if the display name needs to be Orange Jelly-specific.
- **A2:** DNS for `orangejelly.co.uk` (to add the `auth` subdomain records) is accessible to the team.
- **A3:** No customer-level `notification_preferences` override exists in the current schema; any future customer channel preference is a deliberate new data-model decision.
- **A4:** A Resend account on a plan adequate for the volume (~1–2k emails/month + venue staff mail) is available.

## 18. Success metrics
- **Primary:** all transactional customer comms that *can* go by email do, safely (email-first with verified fallback); bounce/complaint suppression active.
- Email deliverability (delivered ÷ sent) tracked via webhooks; bounce rate < a sane threshold.
- SMS volume reduction on table-booking comms (the comms with real coverage).
- Email coverage % rising (Workstream A) — the lever that unlocks every other switch.
- Real Twilio cost visible (Workstream B) — replacing the $0.04 estimate.
- Venue email no longer sent from a personal mailbox.

## 19. References
- Findings: `tasks/comms-discovery/findings/01-sms-inventory.md` … `06-cost-savings.md`
- SMS: [`src/lib/twilio.ts`](../../../src/lib/twilio.ts) (`sendSMS` :207, gate :127), [`src/lib/sms/bulk.ts`](../../../src/lib/sms/bulk.ts)
- Email: [`src/lib/email/emailService.ts`](../../../src/lib/email/emailService.ts) (transport A), [`src/lib/microsoft-graph.ts`](../../../src/lib/microsoft-graph.ts) (transport B — excluded), [`src/lib/refund-notifications.ts`](../../../src/lib/refund-notifications.ts) (email-first pattern to generalise)
- Webhooks dir: `src/app/api/webhooks/` (add `resend/`)
