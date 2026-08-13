# Reviewer prompt: B2B marketing email plan (hand this to the reviewing developer verbatim)

You are reviewing a fully scoped feature before implementation starts. Your job is to find problems with the plan now, when they are cheap to fix. This is a READ-ONLY review: do not implement anything, do not edit the documents, do not create branches.

## What you are reviewing

Read these, in this order, in the AnchorManagementTools repo:

1. `tasks/marketing-email-b2b-implementation-plan-2026-08-13.md` (the authoritative plan you are reviewing)
2. `tasks/marketing-email-b2b-discovery-and-scope-2026-08-13.md` (discovery record: what already exists in the codebase and live DB, and why the architecture is shaped this way)
3. `docs/design/email-handover/README.md` (the designer's contract for the email HTML; the plan's Phase 2 must honour it exactly)
4. The existing code the plan builds on, at minimum: `src/lib/email/emailService.ts`, `src/lib/email/logging.ts`, `src/lib/email/unsubscribe.ts`, `src/app/api/unsubscribe/route.ts`, `src/app/api/webhooks/resend/route.ts`, `src/app/api/cron/event-payment-reminders/route.ts` (the claim-before-send pattern), `src/services/short-links.ts`, `supabase/migrations/20260809130000_email_unsubscribe_tokens.sql`, `supabase/migrations/20260703000000_email_comms_resend_infra.sql`

The feature in one paragraph: scheduled marketing emails to a curated list of ~160 business contacts, sent automatically by cron through the existing `sendEmail()` service with Resend forced per call. New `business_contacts`, `marketing_campaigns`, `marketing_campaign_recipients` tables. Campaign content is JSON composed from 18 designer-supplied email blocks, never edited in the UI. Engagement stats come from the existing `email_messages` table fed by the existing Resend webhook. Unsubscribe reuses the existing token + one-click route, widened to support business-contact subjects. Staff UI at `/marketing` for contacts, campaign set-up, scheduling, and analytics.

## Verify claims against reality

The plan asserts facts about the codebase and database. Do not take them on trust: spot-check them, and flag any that are wrong, including line-level details like function signatures, table columns, and CHECK constraints. Past reviews in this repo have caught specs written against stale assumptions.

## Specific challenges I want your judgement on

Answer each explicitly, with reasoning:

1. **Unsubscribe token widening** (plan 1.3): the plan makes `email_unsubscribe_tokens.customer_id` nullable and adds `business_contact_id` with a one-subject CHECK, modifying a table used by live customer flows. Would you instead create a separate token table for business contacts? Which is safer given the existing route and `record_unsubscribe_token_use()` RPC?
2. **Claim RPC vs job queue** (plan 1.2, 3.3): the plan uses a dedicated `FOR UPDATE SKIP LOCKED` claim RPC in a 5-minute cron rather than the existing `unified-job-queue` (`claim_jobs`, minute cadence). Is that the right call? Consider failure modes: cron overlap, Vercel 60s maxDuration with batch size 50, retry semantics for crashed sends.
3. **Stats via joins** (plan 4.1): campaign stats aggregate `marketing_campaign_recipients` joined to `email_messages`, with no denormalised counters. At 160 to a few thousand recipients, is that fine? Any indexing the plan is missing?
4. **Content as DB JSON** (plan 2.3, 4.1): block-JSON content lives in `marketing_campaigns.content`, validated by zod at write and send time. The alternative is code-registered campaign files requiring a deploy per campaign. Do you agree with the DB choice, and is the validation story tight enough that the renderer can never receive unrenderable content?
5. **Byte-fidelity strategy** (plan 2.1, 2.6): fixtures are extracted from the handover files and tests assert byte-for-byte equality of rendered output. The campaign-only blocks have no comment markers and are extracted by hand. Is the fidelity test design sound, and is there a hole where hand-extraction errors would pass the tests (fixtures and renderer both derived from the same wrong extraction)?
6. **Shared sending domain**: the owner decided marketing sends from `noreply@auth.orangejelly.co.uk`, which transactional Resend mail also uses. The plan accepts this with a bounce-rate gate. Given the list is 160 curated B2B contacts, do you see a deliverability or reputation risk big enough to push back on the decision?
7. **Pause semantics** (plan 3.3 step 5): paused campaigns return claimed rows to `pending`; cancelled ones mark them `skipped`. Race conditions between the UI status change and an in-flight cron batch: any window where a paused campaign still sends more than the current batch?
8. **Compliance**: the plan's PECR/GDPR treatment (legitimate interest, free-mail flagging for sole traders, unsubscribe in every email, GDPR export/erasure registration). Anything missing or wrong for a UK venue emailing UK businesses?
9. **The `commType` constraint** (plan 3.3): the plan flags that `'marketing_campaign'` may need adding to an `email_messages` comm-type constraint. Check the actual constraint and say what the migration must do.
10. **What is missing entirely?** Look for gaps the plan does not mention at all: edge cases, operational concerns, security (RLS policies, the claim RPC's SECURITY DEFINER, the cron's auth), interactions with the 38 existing crons, anything in the email rendering that will break in Outlook.

## Feedback format

Return a numbered list of findings, most severe first. For each:

- **Severity**: Blocker (plan must change before implementation) / Major (should change, say why) / Minor (nice to have) / Question.
- **Where**: document section or file:line.
- **What**: the problem, concretely. If you claim the codebase contradicts the plan, cite the file and line you checked.
- **Fix**: your recommended change, specific enough to act on.

Close with three summary judgements: (a) is each phase genuinely independently deployable as claimed, (b) would you start implementation from this plan as written, (c) the three findings you would fix first.

Do not pad the review. If something is right, say nothing about it; only findings and the closing judgements.
