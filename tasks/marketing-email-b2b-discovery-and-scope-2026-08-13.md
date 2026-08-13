# B2B Marketing Email: Discovery and Scope

Date: 2026-08-13
Status: Superseded in part. The designer's handover arrived the same day (vendored at `docs/design/email-handover/`); the authoritative developer document is now `tasks/marketing-email-b2b-implementation-plan-2026-08-13.md`, which replaces section 4.2's template-registry model with the handover's block-composition system. This file remains the discovery record.
Complexity: L overall, delivered as 4 independently deployable phases (each S/M).

## 1. Goal

Send branded marketing emails to business email addresses, scheduled in advance and sent automatically by the application. Staff can set up campaigns, schedule sends, and see delivery/open/click/conversion stats in a new UI section. Email content is never authored in the UI: Claude authors templates in code from the designer's component handover. Business contacts are kept completely separate from consumer customers, with strong anti-spam guardrails and first-class unsubscribe handling.

## 2. Requirements (from owner)

1. Branded emails to business addresses (B2B marketing).
2. UI to see scheduled emails, read/open rates, conversions.
3. UI can set up campaigns and schedule sends; the application sends automatically.
4. No email content creation in the UI; Claude authors content from designer components (handover pending).
5. Business addresses kept clearly for businesses; do not spam them.
6. Unsubscribe requests must be handled properly.

## 3. Discovery: what already exists

Verified against the live database (project tfcasgxopxegwrabvwat) and the current codebase.

### Reusable as-is

| Piece | Where | Notes |
|---|---|---|
| Send service | `src/lib/email/emailService.ts` `sendEmail()` | Dual transport (Graph/Resend), per-call `provider` override, Resend idempotency keys, suppression check before send, `unsubscribeUrl` option sets `List-Unsubscribe` + RFC 8058 one-click headers on both transports (currently unused by any caller) |
| Email log | `email_messages` table + `src/lib/email/logging.ts` | Has `opened_at`, `clicked_at`, `bounced_at`, status enum incl. `opened/clicked/bounced/complained/suppressed`; 1,109 rows |
| Resend webhook | `src/app/api/webhooks/resend/route.ts` (721 lines) | Svix signature verification, idempotency via `webhook_logs`, status-rank progression guard, writes opens/clicks/bounces onto `email_messages`, upserts `email_suppressions` on bounce/complaint |
| Suppression | `email_suppressions` table (21 rows) | `sendEmail` checks it first and logs a `suppressed` outcome; populated by the Resend webhook |
| Unsubscribe route | `src/app/api/unsubscribe/route.ts` + `src/lib/email/unsubscribe.ts` | GET (footer link) + POST (one-click), rate limited, identical copy for good/bad tokens, deliberately never writes `email_suppressions` |
| Cron auth | `src/lib/cron-auth.ts` `authorizeCronRequest()` | Timing-safe CRON_SECRET compare; standard for all crons |
| Claim-before-send idempotency | `src/app/api/cron/event-payment-reminders/route.ts` | Insert-to-claim on a unique constraint; the model for the campaign sender |
| Short links + UTM | `src/services/short-links.ts`, `/api/redirect/[code]` | `createShortLinkInternal()`, `getOrCreateUtmVariant()`, click analytics with UTM/device/geo; canonical domain `l.the-anchor.pub` |
| CSV import pattern | `src/components/features/customers/CustomerImport.tsx` + `importCustomers()` | papaparse, template download, preview, validation, duplicate detection |
| Section wiring pattern | `src/types/rbac.ts`, permissions migration pattern, `NAV_GROUPS` in `src/ds/shell/SidebarNav.tsx`, `RESERVED_TOP_LEVEL_ROUTES` in `src/lib/short-links/routing.ts` | Short Links is the exemplar (incl. its RBAC migration `20260302000001`) |
| Stats UI components | `@/ds`: `Stat`, `StatGroup`, `Chart.tsx` (`RevenueChart`, `Sparkline`), `DataTable`, `Card`, `SectionNav` | Short Links Insights is the exemplar analytics page |
| RBAC actions | `send_marketing`, `send_transactional`, `view_consent_audit` already exist in the `ActionType` union | |

### Exists but needs extension

| Piece | Gap |
|---|---|
| `email_unsubscribe_tokens` | `customer_id` is `NOT NULL UNIQUE` FK to `customers`; business contacts cannot get a token without a schema change |
| Unsubscribe route + lib | Only knows customer subjects; must learn business-contact subjects |
| `short_links.link_type` CHECK | No marketing type; widen constraint or reuse `promotion` |
| GDPR service `src/services/gdpr.ts` | New tables must be registered in export + erasure paths |

### Missing entirely (net-new)

- Any business/marketing contacts table. The only B2B emails today: `invoice_vendors` (3 emails) + `invoice_vendor_contacts` (9 emails) + `vendors` (2 emails), about 14 addresses total, all transactional relationships (suppliers, invoicing clients), none with marketing consent fields. CSV import is therefore the primary population route, not a nice-to-have.
- Campaign, schedule, and per-recipient send tables.
- A batched email send engine (the SMS `sendBulkSms` engine is SMS-only; the old `send_email` background-job type is dead code that throws).
- A branded email layout wrapper or component system (every existing template is an inline HTML string).
- Open/click tracking in production: `EMAIL_PROVIDER=graph` in prod, and tracking only works for mail sent via Resend. Marketing sends will force `provider: 'resend'` per call, leaving operational mail on Graph untouched.

### Facts that shaped the design

- `customers` is consumer-only in practice: 1,056 rows, 273 emails, only 12 with `marketing_email_opt_in = true`. Building B2B marketing on a separate table is cleaner and matches the "keep business addresses clearly for businesses" requirement.
- The existing unsubscribe design deliberately separates "unsubscribed" (a consent state, blocks marketing only) from "suppressed" (a deliverability state, blocks everything). The route header warns it must never write `email_suppressions`, or booking confirmations would be killed. The B2B feature preserves this split.
- The Resend webhook is generic: it updates whatever `email_messages` row matches the Resend message id. No webhook changes are needed; campaign stats join through `email_messages`.

## 4. Architecture

### 4.1 Data model (new migration set)

```sql
-- Business contacts: fully separate from customers
CREATE TABLE public.business_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text,
  last_name text,
  company_name text,
  job_title text,
  invoice_vendor_id uuid REFERENCES invoice_vendors(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('csv_import', 'manual', 'invoice_vendor')),
  tags text[] NOT NULL DEFAULT '{}',
  marketing_status text NOT NULL DEFAULT 'subscribed'
    CHECK (marketing_status IN ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  unsubscribed_at timestamptz,
  last_marketing_email_at timestamptz,
  last_marketing_campaign_id uuid,          -- set at send time, used to attribute unsubscribes
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_contacts_email_key ON business_contacts (lower(email));

-- Campaigns: content lives in code (template_key + params), never in the UI
CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  template_key text NOT NULL,               -- must exist in the code template registry
  template_params jsonb NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  preheader text,
  audience jsonb NOT NULL DEFAULT '{}',     -- { "tags": [...], "exclude_tags": [...] }
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled')),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  utm_campaign text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Per-recipient send state; engagement comes from joining email_messages
CREATE TABLE public.marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES business_contacts(id) ON DELETE CASCADE,
  email text NOT NULL,                      -- snapshot at enqueue time
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason text,                         -- 'unsubscribed' | 'suppressed' | 'frequency_cap' | ...
  email_message_id uuid REFERENCES email_messages(id),
  claimed_at timestamptz,
  sent_at timestamptz,
  error text,
  UNIQUE (campaign_id, contact_id)
);

-- Widen unsubscribe tokens to cover business contacts
ALTER TABLE public.email_unsubscribe_tokens
  ADD COLUMN business_contact_id uuid REFERENCES business_contacts(id) ON DELETE CASCADE,
  ALTER COLUMN customer_id DROP NOT NULL,
  ADD CONSTRAINT email_unsubscribe_tokens_one_subject
    CHECK ((customer_id IS NULL) <> (business_contact_id IS NULL));
CREATE UNIQUE INDEX email_unsubscribe_tokens_contact_key
  ON email_unsubscribe_tokens (business_contact_id) WHERE business_contact_id IS NOT NULL;
```

Plus: RBAC permissions migration for a new `marketing` module (`view/create/edit/delete`, granted to `super_admin` and `manager`, following `20260302000001_short_links_rbac_permissions.sql`), and a claim RPC for the sender (FOR UPDATE SKIP LOCKED, modelled on `claim_jobs`).

RLS on all new tables; access via server actions with `checkUserPermission('marketing', ...)`; service-role for the cron path. All mutations audit-logged via `logAuditEvent()`.

Deliberately NOT reused: `customers`, `customer_consents` (both are customer-bound), the dead `send_email` job type.

### 4.2 Content model: code-registered templates

- `src/lib/email/marketing/templates/` holds one module per template. Registry `MARKETING_TEMPLATES: Record<string, MarketingTemplate>` where each entry has `key`, `name`, `description`, a zod `paramsSchema`, and `render(params, ctx)` returning `{ html, text }`. `ctx` carries the recipient (for greeting personalisation), the unsubscribe URL, and UTM values.
- A shared branded layout wrapper (`src/lib/email/marketing/layout.ts`) built from the designer's component handover: header, footer with business name and address, "why you are receiving this" line, and the unsubscribe link. Until the handover arrives, one plain placeholder template proves the pipeline.
- The UI lists registered templates read-only. Creating a campaign means: pick template, set subject/preheader (defaulted from the template), pick audience tags, schedule. No HTML editing anywhere in the UI.
- Every template render is followed by an automatic link pass that rewrites external links to UTM-tagged short links (mirroring `shortenUrlsInSmsBody`, with a marketing source tag).

### 4.3 Send pipeline

One new cron, `/api/cron/marketing-campaigns` (every 5 minutes, added to `vercel.json`, `authorizeCronRequest` guarded):

1. **Promote**: campaigns with `status = 'scheduled'` and `scheduled_for <= now()` move to `sending`, and the audience is snapshotted into `marketing_campaign_recipients` (excluding unsubscribed/bounced/complained contacts and suppressed emails at snapshot time).
2. **Send**: claim up to `MARKETING_SEND_BATCH_SIZE` (default 50) pending recipients via the claim RPC. For each, re-check at send time: `marketing_status = 'subscribed'`, `isEmailSuppressed()`, and the frequency cap (skip with `skip_reason` if the contact received any marketing email within the cap window). Then `sendEmail({ provider: 'resend', idempotencyKey: 'marketing:<campaignId>:<contactId>', unsubscribeUrl, ... })`, store `email_message_id`, set `sent_at`, update `last_marketing_email_at` and `last_marketing_campaign_id` on the contact.
3. **Complete**: campaigns with no pending/sending recipients left move to `completed`.

Guards, mirroring the SMS safety module:

- Send window: sends only 09:00 to 18:00 Europe/London, Monday to Friday (business audience); a due campaign outside the window waits for the next window. Configurable.
- Frequency cap: no contact receives more than one marketing email per 7 days (env `MARKETING_FREQUENCY_CAP_DAYS`, default 7), enforced at send time, skipped rows visible in the UI with the reason.
- Per-run batch cap plus the 5-minute cadence bounds throughput (600/hour ceiling, far above expected list sizes).
- Resend idempotency key per campaign+contact makes retries safe; the claim RPC makes concurrent runs safe; `event-payment-reminders` proves the pattern.
- Pause/cancel: the UI sets `paused`/`cancelled`; the sender only processes `sending` campaigns, so pausing takes effect within one batch.

### 4.4 Tracking and analytics

- Delivery, opens, clicks, bounces, complaints: already flow from the Resend webhook onto `email_messages`. Campaign stats aggregate `marketing_campaign_recipients` joined to `email_messages`. No new event pipeline.
- Requires the sending domain verified in Resend with open and click tracking enabled (owner action in the Resend dashboard).
- Conversions v1: click-through per recipient (Resend) plus UTM-tagged short links (`utm_source=marketing_email`, `utm_campaign=<campaign>`) so website-side activity is attributable in short-link analytics. Revenue/booking attribution is a later phase once "conversion" is defined.
- Unsubscribe attribution: the unsubscribe handler reads `last_marketing_campaign_id` from the contact, so each campaign reports its unsubscribe count.

### 4.5 Unsubscribe handling

Reuses the existing system end to end; the only change is teaching it a second subject type:

- `src/lib/email/unsubscribe.ts`: add `getOrCreateContactUnsubscribeUrl(supabase, contactId)`; `lookupUnsubscribeToken` returns which subject the token belongs to.
- `/api/unsubscribe` (GET + one-click POST, already rate limited): for business-contact tokens, set `marketing_status = 'unsubscribed'`, `unsubscribed_at = now()`, write an audit log entry with the attributed campaign. Same neutral copy for all outcomes. Customer tokens behave exactly as today.
- Every marketing send passes `unsubscribeUrl`, which sets both `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (Gmail/Yahoo/Outlook one-click compliant) plus the visible footer link.
- Unsubscribed is permanent unless the contact explicitly re-consents (manual re-subscribe in the UI requires a note recording why).
- Replies: `replyTo` goes to the manager mailbox; inbound `email.received` is already captured by the Resend webhook, and any reply saying "stop" is handled manually (low volume) with a manual unsubscribe button in the UI.
- Bounces/complaints: the existing webhook suppresses the address globally and the contact's `marketing_status` is updated to match on the next send attempt (visible as skips); a small webhook addition can sync `bounced`/`complained` onto `business_contacts` directly.

### 4.6 Compliance (UK PECR + GDPR)

- PECR: corporate subscribers (limited companies, LLPs) do not require prior consent for B2B marketing, but every email must identify the sender and carry a working opt-out. Sole traders and partnerships legally count as individual subscribers; addresses on free-mail domains are flagged at import for review before inclusion.
- GDPR: a named person's work email is personal data. Lawful basis: legitimate interest, with a privacy notice link in the footer, easy objection (unsubscribe), and registration of `business_contacts` + campaign tables in `src/services/gdpr.ts` export and erasure paths.
- Footer (baked into the layout wrapper): business name and postal address, why-you-are-receiving line, unsubscribe link, privacy notice link.
- Suppression and unsubscribe checked before every single send, at snapshot and again at send time.

### 4.7 UI: new `/marketing` section

Wiring: `marketing` module in `src/types/rbac.ts` + permissions migration; nav item in `NAV_GROUPS`; slug added to `RESERVED_TOP_LEVEL_ROUTES`; standard server-component pages with `checkUserPermission('marketing', 'view')` and `SectionNav` sub-tabs.

- **Campaigns** (default tab): list with status badges and headline stats (recipients, delivered %, opened %, clicked %, unsubscribed). New Campaign flow: pick registered template, subject/preheader, audience by tags with a live recipient-count preview, schedule date/time. Detail page: funnel stats (`StatGroup` + `Sparkline`), per-recipient table with per-row status incl. skip reasons, pause/cancel buttons, test-send-to-me button.
- **Contacts**: searchable list (company, name, email, tags, status), CSV import (template download, preview, dedupe by email, free-mail-domain flagging), manual add/edit, manual unsubscribe/re-subscribe with audit trail.
- **Settings** (small): frequency cap display, send window display, sending identity display (read-only, env-driven).

### 4.8 Config additions

```
MARKETING_EMAIL_FROM_ADDRESS   # e.g. "The Anchor <hello@<marketing subdomain>>"
MARKETING_EMAIL_REPLY_TO       # defaults to EMAIL_REPLY_TO (manager@the-anchor.pub)
MARKETING_SEND_BATCH_SIZE      # default 50
MARKETING_FREQUENCY_CAP_DAYS   # default 7
```

`EMAIL_PROVIDER` stays `graph`; marketing forces Resend per call. A dedicated marketing subdomain (verified in Resend, tracking enabled) isolates marketing reputation from operational mail. Domain choice is an open owner decision (in chat).

## 5. Phasing (each independently deployable)

| Phase | Scope | Size |
|---|---|---|
| 1. Foundations | Migrations (contacts, campaigns, recipients, token widening, RBAC, claim RPC), GDPR registration, contacts actions + CSV import, Contacts UI, section wiring (nav, RBAC, reserved slug) | M |
| 2. Send engine | Unsubscribe lib/route extension, template registry + placeholder template + link/UTM pass, campaign cron (promote/send/complete) with all guards, test-send action, webhook sync of bounce/complaint onto contacts | M |
| 3. Campaigns UI | Create/schedule/pause/cancel flows, campaign list + detail analytics, recipient table with skip reasons | M |
| 4. Brand + conversions | Designer handover integrated as the real layout wrapper and component set, real templates, UTM short-link conversion reporting, first live campaign dry run | S/M |

Phase order is risk-first: database, then engine, then UI, then brand. Phases 1 and 2 can land with zero user-visible surface beyond the Contacts tab.

## 6. Risks

1. **Deliverability**: new subdomain with no sending history; small volumes and a warmed schedule mitigate. Resend domain verification and tracking config are owner dashboard actions.
2. **PECR sole-trader nuance**: mitigated by import-time flagging and easy opt-out; final call on including free-mail addresses is the owner's.
3. **Graph fallback trap**: if `RESEND_API_KEY` is absent in prod the marketing path must fail loudly, not fall back to Graph (no tracking, wrong identity). The sender will hard-require Resend config.
4. **Unsubscribe token migration**: touches a live table used by customer flows; the change is additive (nullable column + CHECK), and the customer path keeps its exact current behaviour. Tests cover both subjects.
5. **`database.generated.ts` is stale** (known); new tables will be typed manually per project convention.

## 7. Assumptions recorded

1. Marketing sends use Resend regardless of `EMAIL_PROVIDER`; operational email is untouched (invoices stay Graph-only by design).
2. Business contacts are a new, separate table; no linkage to `customers`, optional linkage to `invoice_vendors`.
3. Engagement stats derive from `email_messages` joins rather than a parallel event store.
4. Unsubscribed contacts are excluded automatically and permanently unless manually re-consented.
5. Campaign content is only ever template_key + params; the UI never stores HTML.
6. The existing 14 vendor/supplier emails are NOT auto-enrolled; the list is built by CSV import unless the owner decides otherwise.
