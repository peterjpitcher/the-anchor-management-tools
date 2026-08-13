# B2B Marketing Email: Implementation Plan

Date: 2026-08-13
Audience: implementing developer. This document is self-contained; the companion discovery/scope document is `tasks/marketing-email-b2b-discovery-and-scope-2026-08-13.md`.
Design handover: vendored at `docs/design/email-handover/` (README.md is the design contract; read it in full before Phase 2).

## What is being built

A B2B marketing email system for The Anchor, inside AMS:

- A new `business_contacts` store, fully separate from the consumer `customers` table, populated by CSV import.
- Campaigns whose content is a JSON list of designer-specified email blocks. Content is authored by Claude (or a developer) as block JSON; the UI never edits HTML or copy.
- Staff UI (`/marketing`) to set up campaigns from that content, choose the audience, schedule the send, pause/cancel, and read delivery/open/click/unsubscribe/conversion stats.
- Automatic sending via a Vercel cron, through the existing `sendEmail()` service with `provider: 'resend'` forced (production `EMAIL_PROVIDER` stays `graph` for operational mail).
- Unsubscribe via the existing token + one-click route, extended to business-contact subjects.
- Anti-spam guardrails: frequency cap, business-hours send window, suppression and consent checks at snapshot time and again at send time.

### Non-goals

- No email content editing in the UI.
- No changes to consumer messaging, invoice email (Graph-only, by design), or any existing cron.
- No revenue attribution in v1 (clicks + UTM only).

## Hard rules the implementation must respect

1. **Email HTML is preserved byte-for-byte.** The handover blocks are production artefacts (nested tables, inlined styles, MSO conditionals). Interpolate into text nodes and `href` values only. Never "clean up" the markup. (Handover README, "About the design files".)
2. **Never write `email_suppressions` from an unsubscribe.** Unsubscribed is a consent state on the contact; suppression is a deliverability state that would also kill operational email. The existing route header documents this; keep it true for contacts.
3. **Marketing sends hard-require Resend.** If `RESEND_API_KEY` or `MARKETING_EMAIL_FROM_ADDRESS` is unset, the sender must fail loudly. It must never fall back to Graph (no tracking, wrong identity).
4. **No em dashes** anywhere: code, comments, copy, migrations. The brand's content rules say the same for email copy.
5. **Never invent facts in email copy.** Verified facts live in the handover README ("Content rules"); anything not verified there is left out.
6. Project conventions apply throughout: manual snake_case to camelCase mapping (no `fromDb` helper), server actions return `{ success?, error? }`, `logAuditEvent()` on every mutation, `checkUserPermission()` in every action, dateUtils for display dates, `no-console` (warn/error only).

## Phase 0: prerequisites (owner actions, block Phase 3 go-live, not development)

| # | Action | Owner |
|---|---|---|
| 0.1 | Confirm open + click tracking is enabled for `auth.orangejelly.co.uk` in the Resend dashboard. Decision (owner, 2026-08-13): marketing sends from the existing `noreply@auth.orangejelly.co.uk`, already verified in Resend. Trade-off accepted: this domain is shared with transactional Resend mail, so marketing complaints would affect its reputation; mitigated by the small curated list and the bounce-rate gate in the launch checklist | Peter |
| 0.2 | Set Vercel env: `MARKETING_EMAIL_FROM_ADDRESS`, `MARKETING_EMAIL_REPLY_TO` (see env table) | Peter |
| 0.3 | Supply the two photographs for the first campaign (1200x680 hero, 1200x520 lunch; JPEG, sRGB, under 200KB each, hosted on the-anchor.pub or CDN) | Peter |
| 0.4 | Confirm Saturday/Sunday kitchen hours from 1 September, and the reply-to address, before they are added to any email (handover flags both as unverified) | Peter |
| 0.5 | Ask the designer to re-export the `note_bar` block: it appears only in the reference-only kit file (`The Anchor Email Kit.dc.html`), which the handover says not to parse or ship. Until then, `note_bar` is out of the catalogue | Peter |

Development can start immediately; only real sends are blocked on 0.1 to 0.3.

## Environment additions

Add to `.env.example`, `.env.local`, Vercel (all environments), and the env validation in `src/lib/env.ts` (optional-with-warning, required at runtime by the marketing sender only):

```
MARKETING_EMAIL_FROM_ADDRESS=The Anchor <noreply@auth.orangejelly.co.uk>   # decided 2026-08-13
MARKETING_EMAIL_REPLY_TO=manager@the-anchor.pub
MARKETING_SEND_BATCH_SIZE=50            # per cron run
MARKETING_FREQUENCY_CAP_DAYS=7          # min days between marketing emails per contact (decided)
```

---

## Phase 1: data layer and contacts (complexity M, one PR)

### 1.1 Migration: core tables

`supabase/migrations/<ts>_marketing_email_core.sql` (follow `prod-migrate` skill for review/apply; check timestamp ordering against existing migrations):

```sql
CREATE TABLE public.business_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text,
  last_name text,
  company_name text,
  job_title text,
  invoice_vendor_id uuid REFERENCES public.invoice_vendors(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('csv_import', 'manual', 'invoice_vendor')),
  tags text[] NOT NULL DEFAULT '{}',
  is_freemail boolean NOT NULL DEFAULT false,   -- flagged at import: PECR review needed
  marketing_status text NOT NULL DEFAULT 'subscribed'
    CHECK (marketing_status IN ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  unsubscribed_at timestamptz,
  resubscribed_at timestamptz,
  resubscribe_note text,
  last_marketing_email_at timestamptz,
  last_marketing_campaign_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_contacts_email_key ON public.business_contacts (lower(email));
CREATE INDEX business_contacts_tags_idx ON public.business_contacts USING gin (tags);

CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}',
  -- content shape (validated in code by zod, see Phase 2):
  -- { "preheader": "...", "masthead": "masthead_green",
  --   "blocks": [{ "type": "hero_image", "data": {...} }, ...],
  --   "footer": "footer" }
  audience jsonb NOT NULL DEFAULT '{}',   -- { "tags": [...], "exclude_tags": [...] }
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

CREATE TABLE public.marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.business_contacts(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason text,
  email_message_id uuid REFERENCES public.email_messages(id),
  claimed_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX mcr_campaign_status_idx ON public.marketing_campaign_recipients (campaign_id, status);
```

RLS: enable on all three; policies allow `authenticated` SELECT only (writes go through server actions with the service-role client, matching the short-links pattern). `REVOKE ALL` from `anon`.

`updated_at` triggers: copy whichever existing trigger convention the newest migrations use.

### 1.2 Migration: claim RPC

```sql
CREATE OR REPLACE FUNCTION public.claim_marketing_recipients(p_batch int)
RETURNS SETOF public.marketing_campaign_recipients
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE marketing_campaign_recipients r
  SET status = 'sending', claimed_at = now()
  WHERE r.id IN (
    SELECT r2.id
    FROM marketing_campaign_recipients r2
    JOIN marketing_campaigns c ON c.id = r2.campaign_id
    WHERE r2.status = 'pending' AND c.status = 'sending'
    ORDER BY r2.created_at
    LIMIT p_batch
    FOR UPDATE OF r2 SKIP LOCKED
  )
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_marketing_recipients(int) FROM anon, authenticated;
```

Note: new public functions get EXECUTE granted to anon+authenticated by default in this project's setup; the REVOKE is mandatory.

### 1.3 Migration: widen unsubscribe tokens

```sql
ALTER TABLE public.email_unsubscribe_tokens
  ADD COLUMN business_contact_id uuid REFERENCES public.business_contacts(id) ON DELETE CASCADE;
ALTER TABLE public.email_unsubscribe_tokens
  ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.email_unsubscribe_tokens
  ADD CONSTRAINT email_unsubscribe_tokens_one_subject
  CHECK ((customer_id IS NULL) <> (business_contact_id IS NULL));
CREATE UNIQUE INDEX email_unsubscribe_tokens_contact_key
  ON public.email_unsubscribe_tokens (business_contact_id)
  WHERE business_contact_id IS NOT NULL;
```

Mandatory function audit before writing this migration (workspace rule): grep migrations for `email_unsubscribe_tokens` and check `record_unsubscribe_token_use()` still works with a NULL `customer_id` (it keys on token, so it should; verify).

### 1.4 Migration: RBAC

Copy the idempotent pattern from `supabase/migrations/20260302000001_short_links_rbac_permissions.sql`: insert `marketing` module permissions (`view`, `create`, `edit`, `delete`) and grant to `super_admin` and `manager`.

Code side: add `'marketing'` to the `ModuleName` union in `src/types/rbac.ts`.

### 1.5 GDPR registration

In `src/services/gdpr.ts`: register `business_contacts` (email identity) in `exportUserData` via `fetchRowsByIdentity`, and in `deleteUserData` scrub/delete the contact row plus its `marketing_campaign_recipients` rows and unsubscribe token. Follow the existing per-table helpers (`scrub`, `deleteRows`).

Known adjacent gap (do NOT fix in this changeset, it is parked): `email_unsubscribe_tokens` is not registered for customer erasure today.

### 1.6 Types, service, actions

- `src/types/marketing.ts`: `BusinessContact`, `MarketingCampaign`, `MarketingCampaignRecipient`, status unions, audience shape. Manual field mapping in query transforms (project convention; `database.generated.ts` is stale, do not regenerate as part of this work).
- `src/services/marketing-contacts.ts`: list/search (name, company, email, tag, status filters), create, update, softness: no hard delete in v1 (contacts with send history must survive for suppression/audit; provide delete only for contacts with zero sends).
- `src/app/actions/marketing-contacts.ts`: server actions wrapping the service. Every action: `checkUserPermission('marketing', ...)`, zod validation, `logAuditEvent`, `revalidatePath('/marketing/contacts')`.
  - `importBusinessContacts(rows)`: dedupe by `lower(email)` against existing, validate email format, set `is_freemail` from a small free-mail domain list (gmail, googlemail, hotmail, outlook, live, yahoo, icloud, me, aol, btinternet, sky, talktalk), return `{ imported, skippedDuplicates, flaggedFreemail }`.
  - `unsubscribeContactManually(id, note)` / `resubscribeContact(id, note)`: note required on resubscribe; both audit-logged.

### 1.7 Contacts UI

- Section wiring: nav item in `NAV_GROUPS` (`src/ds/shell/SidebarNav.tsx`), slug `marketing` added to `RESERVED_TOP_LEVEL_ROUTES` in `src/lib/short-links/routing.ts`, pages under `src/app/(authenticated)/marketing/` with a `nav.ts` exporting section tabs (Campaigns, Contacts).
- `marketing/contacts/page.tsx`: server component, permission check, then a client list using `@/ds` `DataTable`/`Table`, `SearchInput`, `Badge` for status, tag filter chips.
- CSV import modal modelled on `src/components/features/customers/CustomerImport.tsx` (papaparse, template download with headers `email,first_name,last_name,company_name,job_title,tags`, preview with per-row validation, duplicate and free-mail flags shown before confirm).
- All components from `@/ds`; no hex colours; use title/subtitle/action props on CardHeader (not children).

### 1.8 Initial population script

The real list exists: `Anchor_Christmas_Contacts_ENRICHED.xlsx` (owner-curated, 2026-08-13). Contacts sheet, headers on row 4: Group, Company, Contact, Email, Segment, Distance/travel, Cluster, Staff (est), Fits our room?, What that means, Your angle, Opening line, When to send, Notes from source, Sent?, Date, Reply?. 160 contacts, all with an email, 5 on free-mail domains.

`scripts/one-off/import-christmas-contacts.ts` (tsx + exceljs, both already available):

- Takes the xlsx path as an argument. **The spreadsheet contains personal data and must never be committed to the repo.**
- Maps: Email to `email`, Company to `company_name`, Contact to `first_name`/`last_name` (split on first space; single-word names go to `first_name`), `source = 'csv_import'`.
- Tags: slugified Segment (`aviation`, `freight-cargo`, `school-college`, `care-home`, `industrial-trades`, `professional-services`, `business-network`, `public-sector-health`, `other-local-business`) plus slugified Group (`warm-past-booker`, `new-research`, `existing-list`). These become the campaign audience filters.
- Sets `is_freemail` per the import rule; dedupes by `lower(email)`; prints a summary (imported, duplicates, flagged) and writes nothing on validation failure.
- The sheet's own tracking columns (Sent?, Date, Reply?, Opening line) are superseded by the app and are not imported, except Notes from source, which lands in `notes`.

### Phase 1 acceptance

- Migrations apply cleanly (`npx supabase db push --dry-run` first; prod apply via the prod-migrate process).
- Import a test CSV of 5 rows: dedupe works, free-mail rows flagged, tags stored.
- A `manager` role sees the section; a `staff` role does not.
- GDPR export for a contact email returns the contact row.
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all clean.

---

## Phase 2: rendering library (complexity M, one PR, no DB changes)

Everything lives in `src/lib/email/marketing/`.

### 2.1 Extraction (one-off dev script, committed for reproducibility)

`scripts/one-off/extract-email-blocks.ts`:

- Parse `docs/design/email-handover/anchor-email-blocks.html` scanning for `<!-- BLOCK: name -->` ... `<!-- /BLOCK: name -->` pairs (18 blocks).
- From `docs/design/email-handover/anchor-christmas-and-lunch.html` extract, by manual inspection anchored on the two `<!-- IMAGE SLOT -->` comments and the document structure: the shell head (doctype through the opening of the outer background table), the shell foot, and the campaign-only blocks `masthead_green`, `hero_image`, `fact_strip`, `price_tiles`, `hours_table`, `footer`, `divider_rule`. These have no comment markers; extraction is careful hand work, verified by the fidelity tests below.
- Write each as a fixture under `src/lib/email/marketing/blocks/__fixtures__/<name>.html`, byte-preserved.
- `note_bar` is excluded (only exists in the reference-only kit file; owner action 0.5).
- `buttons` is not a standalone fixture: the three button variants (primary, outline, ghost) are patterns reused inside blocks; implement as a shared snippet module used by block templates.

### 2.2 Block modules

One module per block: `src/lib/email/marketing/blocks/<name>.ts` exporting:

```ts
export const heroImageSchema = z.object({
  image: z.object({ src: z.string().url(), alt: z.string().min(1), width: z.number(), height: z.number() }),
  kicker: z.string(),
  headline: z.string(),
  body: z.array(z.string()).min(1).max(2),
  cta_label: z.string(),
  cta_url: z.string().url(),
})
export function renderHeroImage(data: HeroImageData): string
```

Implementation rule: the module contains the fixture markup as a template literal with interpolations ONLY in text nodes and href/src/alt attribute values, every interpolated value passed through `escapeEmailHtml()` (escapes `& < > "`). Keep the existing named entities in static copy exactly as shipped.

Slot inventory per block: use the handover README "Block catalogue" table as the authoritative slot list.

### 2.3 Composition

`src/lib/email/marketing/render.ts`:

```ts
export interface MarketingEmailContent {
  preheader: string           // required, aim ~85 chars
  masthead: 'masthead_green' | 'masthead_cream'
  blocks: MarketingBlock[]    // discriminated union on type, zod-validated
  footer: 'footer' | 'footer_dark'
}
export function renderMarketingEmail(
  content: MarketingEmailContent,
  ctx: { unsubscribeUrl: string; utm: { source: string; medium: string; campaign: string } }
): { html: string; sizeBytes: number; warnings: string[] }
```

- Compose: shell head, masthead, blocks in order, footer, shell foot. Inject preheader into the shell's hidden div. Replace the footer's `%%unsubscribe%%` with `ctx.unsubscribeUrl`; assert the token never survives into output.
- Link pass, one sweep over the composed document's `href`s: append UTM parameters to `the-anchor.pub` links; skip the unsubscribe URL, `mailto:`, `tel:`. (Short-link conversion wrapping is Phase 4.)
- Size guard: error above 80KB (Gmail clips near 100KB and hides the unsubscribe link).
- Lint warnings (non-fatal, surfaced in UI and test send): more than one primary button, more than one `pull_quote`, preheader length outside 60 to 90 chars, any image missing alt text.

### 2.4 Content validation

`src/lib/email/marketing/content-schema.ts`: the discriminated union of all block schemas plus the `MarketingEmailContent` shape. Used by the campaign actions (Phase 3) so invalid block JSON can never be saved, and by the sender before rendering.

### 2.5 First campaign content

`src/lib/email/marketing/campaigns/christmas-and-lunch-2026.ts`: the finished campaign email from the handover, transcribed into block JSON (copy verbatim from `anchor-christmas-and-lunch.html`, image srcs pending owner action 0.3). Exported so a seed script can insert it as a draft campaign. This file doubles as the fidelity proof: rendered output must match the handover file.

### 2.6 Tests (Vitest, co-located `__tests__/`)

1. **Fidelity per block**: render each block with the sample values present in the handover fixtures; output equals the fixture byte-for-byte.
2. **Campaign fidelity**: `renderMarketingEmail` of the Phase 2.5 content, with the handover's placeholder image rows and `%%unsubscribe%%` as the URL, reproduces `anchor-christmas-and-lunch.html` byte-for-byte (this pins the shell extraction).
3. Escaping: values containing `& < > "` and apostrophes render escaped, never break markup.
4. `%%unsubscribe%%` never present in output; unsubscribe URL present exactly where expected.
5. UTM pass: applied to site links, skipped for unsubscribe/mailto/tel; idempotent.
6. Size guard triggers on an oversized composition.

### Phase 2 acceptance

- All fidelity tests green.
- A dev-only preview route or script writes the rendered campaign to a file; open it in a browser at 320px and 620px widths: columns stack, no horizontal scroll.
- Full verification pipeline clean.

---

## Phase 3: unsubscribe extension and send engine (complexity M, one PR)

### 3.1 Unsubscribe for business contacts

- `src/lib/email/unsubscribe.ts`: add `getOrCreateContactUnsubscribeUrl(supabase, contactId, appBaseUrl?)` mirroring the customer version (same token scheme: `crypto.randomBytes(32).toString('base64url')`, stored clear, never expires, race-safe insert). Extend `lookupUnsubscribeToken` to return `{ subjectType: 'customer' | 'business_contact', subjectId }`.
- `src/app/api/unsubscribe/route.ts`: on a business-contact token (GET and one-click POST), set `marketing_status = 'unsubscribed'`, `unsubscribed_at = now()` (idempotent: already-unsubscribed is success), read `last_marketing_campaign_id` for attribution, write an `audit_logs` entry. Same neutral copy for every outcome. Customer tokens: behaviour unchanged, verified by existing tests.
- MUST NOT touch `email_suppressions` (hard rule 2).
- Tests: both subject types, one-click POST, unknown token, rate limiting unaffected.

### 3.2 Send window helper

`src/lib/email/marketing/send-window.ts`: `isWithinMarketingSendWindow(now)` returning true Monday to Friday 09:00 to 18:00 Europe/London (mirror `src/lib/sms/quiet-hours.ts` for the timezone handling). Unit tests across DST boundaries.

### 3.3 Campaign cron

`src/app/api/cron/marketing-campaigns/route.ts`, `vercel.json` entry `*/5 * * * *`. `authorizeCronRequest` guard, `runtime = 'nodejs'`, `maxDuration = 60`, service-role client throughout.

Run steps, in order:

1. **Config guard**: if `RESEND_API_KEY` or `MARKETING_EMAIL_FROM_ADDRESS` unset, return 500 with a clear error (hard rule 3). Do nothing else.
2. **Recover stale claims**: recipients `status = 'sending'` with `claimed_at < now() - interval '15 minutes'` back to `pending` (idempotent send retry is safe: Resend idempotency key).
3. **Promote due campaigns**: `status = 'scheduled' AND scheduled_for <= now()`, set `sending`, `started_at = now()`, then snapshot the audience into `marketing_campaign_recipients`: contacts matching audience tags (empty tags = all), excluding `marketing_status <> 'subscribed'` and emails in `email_suppressions`. Insert with `ON CONFLICT DO NOTHING` so re-promotion is idempotent.
4. **Send window check**: if outside the window, stop here (report `{ waiting: 'send_window' }`).
5. **Claim and send**: `claim_marketing_recipients(MARKETING_SEND_BATCH_SIZE)`. For each claimed row:
   - Re-checks: contact still `subscribed`; `isEmailSuppressed(email)`; frequency cap (`last_marketing_email_at > now() - MARKETING_FREQUENCY_CAP_DAYS` skips). Failures set `status = 'skipped'` with `skip_reason` (`'unsubscribed' | 'suppressed' | 'frequency_cap'`).
   - Campaign still `sending`? (paused/cancelled mid-batch: return row to `pending` for paused, `skipped` for cancelled.)
   - Render via `renderMarketingEmail` with the contact's unsubscribe URL and campaign UTM.
   - `sendEmail({ to, subject, html, provider: 'resend', from: MARKETING_EMAIL_FROM_ADDRESS, replyTo: MARKETING_EMAIL_REPLY_TO, idempotencyKey: 'marketing:' + campaignId + ':' + contactId, unsubscribeUrl, commType: 'marketing_campaign', metadata: { campaign_id } })`.
   - Success: `status = 'sent'`, `sent_at`, `email_message_id`; update the contact's `last_marketing_email_at` and `last_marketing_campaign_id`. Failure: `status = 'failed'`, `error` (claim released rows retry via step 2 only for crashes; explicit failures stay failed).
6. **Complete**: campaigns in `sending` with zero `pending`/`sending` recipients get `status = 'completed'`, `completed_at`.
7. Return `{ promoted, claimed, sent, skipped, failed, completedCampaigns }`.

`commType: 'marketing_campaign'` must be added to the `email_messages` comm-type allowed values if constrained (check `src/lib/email/logging.ts` status/comm-type unions and the table CHECK constraint; migrate if needed).

### 3.4 Webhook sync onto contacts

Small addition to `src/app/api/webhooks/resend/route.ts`: after the existing suppression upsert for bounce/complaint, if the email matches a `business_contacts` row, set `marketing_status` to `bounced`/`complained` (never downgrade `unsubscribed`). Keep the change minimal; all existing behaviour untouched.

### 3.5 Test send

Server action `sendMarketingTestEmail(campaignId)`: permission `marketing.edit`, renders with a placeholder unsubscribe URL, sends to the logged-in user's email via Resend, subject prefixed `[TEST] `. Not recorded against any contact; no recipient rows.

### Phase 3 acceptance

- With Resend in test/sandbox: schedule a campaign at a past time with 3 test contacts (one unsubscribed, one frequency-capped): cron sends 1, skips 2 with correct reasons, campaign completes, `email_messages` rows link back.
- Unsubscribe link from a received email works via GET and one-click POST; contact shows `unsubscribed`; a second campaign excludes them at snapshot.
- Pause mid-send verified (set `paused` while `pending` rows remain; next run sends nothing).
- Cron with missing Resend config returns 500 and sends nothing.
- Full verification pipeline clean.

---

## Phase 4: campaigns UI and conversions (complexity M, one PR)

### 4.1 Campaign actions

`src/app/actions/marketing-campaigns.ts`:

- `createCampaign` / `updateCampaign`: name, subject, content (zod-validated against the Phase 2 content schema), audience, `utm_campaign` (default: slugified name). Content arrives as JSON (authored by Claude); the UI offers upload/paste of a content JSON file plus read-only structured preview, never editing of block internals.
- `scheduleCampaign(id, when)`: requires status `draft`, content valid, audience preview count > 0. Warn (not block) when `scheduled_for` is outside the send window: it will wait for the next window.
- `pauseCampaign` / `resumeCampaign` / `cancelCampaign` with legal status transitions only.
- `getCampaignStats(id)`: aggregate recipients joined to `email_messages`: recipients, sent, delivered, opened, clicked, bounced, failed, skipped (by reason), unsubscribed (contacts with `last_marketing_campaign_id = id` and `unsubscribed_at >= started_at`). Percentages computed against sent.
- All actions permission-checked, audit-logged, `revalidatePath`.

### 4.2 Pages

- `marketing/page.tsx` (Campaigns list): status badges, headline stat columns, period totals. Exemplar: short-links list page (server component fetches, client renders).
- `marketing/campaigns/[id]/page.tsx`: funnel `StatGroup` (sent, delivered %, opened %, clicked %, unsubscribed), sparkline of opens over time from `email_messages.opened_at`, recipient `DataTable` with per-row status and skip reasons, HTML preview in a sandboxed iframe (`srcDoc`, `sandbox=""`), buttons: Test send, Schedule, Pause/Resume, Cancel.
- New campaign flow: name/subject, content JSON upload with validation errors surfaced, audience tag picker with live recipient count (and exclusion counts: unsubscribed/suppressed/frequency-capped estimate), schedule picker (dateUtils, London).

### 4.3 Conversions v1

- At render time (extend the Phase 2 link pass): rewrite site CTAs to short links via `ShortLinkService.getOrCreateShortLinkVariantInternal` with UTM metadata (`utm_source=marketing_email`, `utm_medium=email`, `utm_campaign=<campaign>`), one variant per campaign (not per recipient; per-recipient clicks already come from Resend). Widen the `short_links.link_type` CHECK with a `marketing_email` type (small migration) or reuse `promotion` (decide with a one-line ADR in the PR; recommendation: widen, it keeps analytics filterable).
- Campaign detail shows short-link click totals alongside Resend click totals (they measure different things: Resend counts clickers, short links count all click events including forwards).

### Phase 4 acceptance

- Create, schedule, pause, resume, cancel flows all verified in the browser.
- Stats reconcile against `email_messages` rows for a seeded campaign.
- ui-standards-enforcer subagent pass on the new section; responsive check at 375px and 768px (iPad portrait nav is a known past trap).
- Full verification pipeline clean.

---

## Launch checklist (first real campaign)

1. Phase 0 items 0.1 to 0.4 confirmed done.
2. Contacts imported via the Phase 1.8 script (160 contacts); the 5 free-mail-flagged rows reviewed by the owner (PECR: sole traders count as individuals; include only where there is an existing relationship, otherwise exclude).
3. Seed the Christmas campaign draft; owner reviews preview and test send on: Outlook on Windows, Gmail web, Gmail Android, Apple Mail iOS dark mode, Outlook.com (handover test matrix).
4. Photographs live, alt text meaningful, both under 200KB.
5. Send a canary to 5 internal/known addresses; verify opens/clicks/unsubscribe land in the UI within the hour.
6. Schedule the real send inside Tuesday to Thursday 10:00 to 12:00 (best B2B window).
7. Day after: check bounce/complaint rate in the campaign stats; anything above 2% bounces pauses further campaigns until list hygiene is done.

## Test summary (what CI must cover)

- Unit: block fidelity (every block), campaign byte-fidelity, escaping, UTM pass, size guard, send-window (incl. DST), frequency cap logic, audience snapshot exclusions, claim RPC behaviour (integration-style with mocked client), unsubscribe lib for both subjects.
- Route: unsubscribe GET/POST both subjects; cron happy path, config-guard failure, pause mid-run.
- Existing suites must stay green, especially unsubscribe and Resend webhook tests.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| New sending domain, no reputation | Small list, canary send, warm gradually, monitor bounce rate gate (launch checklist 7) |
| Outlook rendering drift from hand-ported markup | Byte-fidelity tests against handover fixtures; client test matrix before first send |
| Unsubscribe token migration touches a live customer flow | Additive-only DDL; existing customer tests must pass unchanged; verify `record_unsubscribe_token_use` with NULL customer_id |
| Cron double-send | Claim RPC (SKIP LOCKED) + Resend idempotency key per campaign+contact; proven pattern (`event-payment-reminders`) |
| Gmail clipping hides unsubscribe | 80KB hard size guard at render time |
| PECR exposure on sole traders | `is_freemail` flag + owner review step in launch checklist |

## Decisions already taken (owner-confirmed 2026-08-13 unless marked as assumption)

1. Sending identity: `The Anchor <noreply@auth.orangejelly.co.uk>` via Resend, the domain already verified and in use. Marketing sends force `provider: 'resend'` per call; operational email untouched.
2. Contact list: the owner's curated `Anchor_Christmas_Contacts_ENRICHED.xlsx` (160 contacts) imported via the Phase 1.8 script; the ~14 vendor/supplier emails in the DB are not auto-enrolled.
3. Conversions v1: opens/clicks per recipient (Resend) plus UTM-tagged short links; revenue attribution deferred.
4. Frequency cap: one marketing email per contact per 7 days.
5. (Assumption) `business_contacts` is separate from `customers`; no cross-linking.
6. (Assumption) Engagement stats derive from `email_messages`; no parallel event store.
7. (Assumption) Content is block JSON validated against the designer's block system; the UI never edits copy or HTML.
8. (Assumption) Unsubscribed contacts stay excluded unless manually re-subscribed with a recorded note.
9. `note_bar` is out of scope until the designer re-exports it.
