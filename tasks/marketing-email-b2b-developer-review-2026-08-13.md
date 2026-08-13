# Developer review: B2B marketing email implementation plan

Date: 2026-08-13  
Reviewed brief: `tasks/marketing-email-b2b-review-prompt-2026-08-13.md`  
Authoritative plan: `tasks/marketing-email-b2b-implementation-plan-2026-08-13.md`  
Supporting material: discovery record, email design handover, current code and migrations  
Code snapshot: `540e35faeb39af38d52f78c248e8f9cc27fed133`  
Audience: implementing developer and delivery owner  
Review outcome: **not ready to build as written**

The original documents were not changed.

## 1. Executive summary

The overall direction is sensible: keep B2B contacts separate, use the existing email log and webhook,
store per-recipient state, reuse the unsubscribe route, preserve the supplied email HTML, and send in
small batches. The joins proposed for campaign statistics are also suitable for the expected scale.

The plan is not implementation-ready because important safety and compliance rules do not hold under
failure or concurrency, and several stated code contracts are wrong. The most serious problems are:

1. A free-mail-domain flag cannot establish whether a recipient is a corporate subscriber. The data
   model has no verified subscriber type, lawful basis, source evidence, privacy-notice date, or send
   eligibility decision.
2. GDPR erasure deletes the only unsubscribe evidence. A later import can subscribe the same address
   again. A separate marketing do-not-contact record is required.
3. Suppression checks currently fail open on database errors, so the proposed final safety check can
   still send to a suppressed address.
4. The proposed `SECURITY DEFINER` function remains executable through PostgreSQL `PUBLIC`, and the
   proposed RLS exposes all contact data to every authenticated user.
5. The seven-day frequency cap is not atomic. Two overlapping cron runs can send two campaigns to the
   same contact.
6. `sendEmail()` returns the Resend provider ID, not the UUID of the `email_messages` row required by
   `marketing_campaign_recipients.email_message_id`. Logging can also fail while the send still reports
   success, after which the webhook discards the event.
7. The recovery design is not exactly-once. Resend idempotency lasts only 24 hours, explicit failures
   never retry, and a crash between provider acceptance and local finalisation can create duplicates or
   lost state.
8. Enabling tracking on the shared `auth.orangejelly.co.uk` domain changes transactional Resend email too.
   This contradicts the stated non-goal and risks authentication delivery and link integrity.
9. The supplied footer says every recipient enquired about a booking or event, but the list includes new
   research contacts. The footer also lacks the privacy-notice link promised by the plan.
10. The batch, short-link, fidelity, campaign lifecycle, monitoring, and testing requirements need more
    detail before reliable estimates can be made.

## 2. Classification

- **Status: Confirmed issue** means a verified conflict, gap, or unsafe requirement.
- **Status: Required decision** means the owner or technical lead must choose before implementation.
- **Status: Optional improvement** means useful work that is not required for a safe first release.
- **P0** means release blocker or material privacy, compliance, security, or duplicate-send risk.
- **P1** means resolve before the affected phase is implemented or merged.
- **P2** means resolve before release if practical.

## 3. Findings

### F01 - Recipient eligibility is not established by the proposed data model

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Compliance / Data
- **Relevant section:** Phase 1.1, 1.6, 1.8; Launch checklist item 2; Decisions 5 and 8
- **Description:** Imports default every contact to `marketing_status = 'subscribed'`. The only extra
  control is `is_freemail`, based on a short domain list. Email domain does not tell whether the
  subscriber is a limited company, LLP, sole trader, or partnership. A sole trader can use a company
  domain and a limited company contact can use Gmail. The table also lacks the source URL or organisation,
  collection date, subscriber classification, consent evidence, lawful basis, legitimate-interest
  assessment reference, privacy-notice date, reviewer, and eligibility decision.
- **Rationale:** ICO guidance says uncertainty must be treated as an individual subscriber. Sole traders
  and some partnerships require consent or a fully satisfied soft opt-in, while corporate subscribers do
  not require PECR consent. Legitimate interests still needs a documented three-part assessment where
  personal data is used. See the [ICO B2B marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/).
- **Impact:** The first campaign can be unlawful even if all five free-mail rows are removed. Future CSV
  imports silently repeat the risk.
- **Recommended action:** Replace `is_freemail` as the gate with fields such as `subscriber_type`,
  `subscriber_type_verified_at`, `marketing_basis`, `basis_evidence`, `source_detail`, `collected_at`,
  `privacy_notice_sent_at`, `eligibility_status`, `eligibility_reviewed_by`, and `eligibility_reviewed_at`.
  Default imports to `pending_review`, not subscribed. Make snapshot and send require an eligible state.
  Keep free-mail as a review hint only. Complete and record an LIA for corporate named contacts.
- **Open questions:** Who classifies each of the 160 contacts? What evidence exists for warm contacts?
  Which contacts satisfy every soft-opt-in condition, including an opt-out when details were collected?

### F02 - Erasure would remove the do-not-contact evidence and allow re-import

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Compliance / Data lifecycle
- **Relevant section:** Phase 1.5; Hard rule 2; Decisions 8
- **Description:** The plan says GDPR erasure deletes or scrubs the business contact, recipient rows, and
  unsubscribe token. The unique lower-case email check then disappears. Importing the same address later
  creates a fresh subscribed contact.
- **Rationale:** The ICO recommends keeping a minimal do-not-contact or suppression record after an
  objection so new lists can be screened. This is a different purpose from sending marketing and is
  compatible with erasure when reduced to the minimum needed. See [ICO B2B marketing, objections](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/).
- **Impact:** A person who exercised an absolute right to object can receive marketing again. This is both
  a compliance and trust failure.
- **Recommended action:** Add a marketing-only do-not-contact table or irreversible keyed hash store. It
  must not use the global operational `email_suppressions` table. Every import, manual create, audience
  preview, snapshot, and send must check it. Define the retained fields, purpose, access, and retention.
  Erasure should remove campaign content and identity data while preserving only this minimal objection
  evidence.
- **Open questions:** Should the retained key be a normalised email, an HMAC, or both? Who may remove an
  entry after a proven new opt-in?

### F03 - Marketing suppression checks fail open

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Safety / Integration
- **Relevant section:** Hard rule 2; Phase 3.3 step 5
- **Description:** `src/lib/email/logging.ts:45-72` returns `false` when the suppression query errors or
  throws. `sendEmail()` then continues at `src/lib/email/emailService.ts:124-148`. Calling
  `isEmailSuppressed()` before `sendEmail()` only performs the same fail-open check twice.
- **Rationale:** A mandatory compliance guard must distinguish “not suppressed” from “could not check”.
  Transactional mail may intentionally fail open, but marketing must not.
- **Impact:** A database or network fault can send marketing to bounced, complained, or manually
  suppressed addresses.
- **Recommended action:** Add a tri-state or strict suppression API and make the marketing path fail closed.
  For example, `getEmailSuppressionStatus()` returns `suppressed`, `clear`, or `unavailable`, and the sender
  returns the row to a retryable state when unavailable. Do not change transactional behaviour without a
  separate decision.
- **Open questions:** How long should suppression-service failures retry before alerting an operator?

### F04 - The claim RPC and RLS policy are over-permissive

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Security / Database
- **Relevant section:** Phase 1.1 and 1.2
- **Description:** PostgreSQL grants function execution to `PUBLIC` by default. Revoking only from `anon`
  and `authenticated` does not remove the inherited `PUBLIC` grant. The safe local example is
  `supabase/migrations/20260414000000_job_queue_claiming.sql:57-58`, which revokes from `PUBLIC` and then
  grants only `service_role`. Also, “authenticated SELECT” policies on all three new tables let every
  signed-in user query personal contact data directly, bypassing the app permission check.
- **Rationale:** `SECURITY DEFINER` functions and contact lists require least privilege at the database
  boundary. Hiding the navigation is not access control.
- **Impact:** A normal authenticated user could claim campaign work or read the full B2B contact list,
  depending on table grants and PostgREST exposure.
- **Recommended action:** Use `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO service_role`. Qualify
  all objects, validate and cap `p_batch`, and add an explicit service-role check if practical. Either keep
  all new tables service-role-only or use RLS predicates based on `user_has_permission(auth.uid(),
  'marketing', 'view')`. Add negative RLS and RPC tests for anon, staff, manager, and service role.
- **Open questions:** Is direct browser Supabase access required anywhere in this section? If not, why grant
  authenticated access at all?

### F05 - The frequency cap has a race between campaigns

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Concurrency / Functional
- **Relevant section:** Phase 3.3 step 5; Risk “Cron double-send”
- **Description:** The claim RPC locks recipient rows, not contact rows. Two overlapping runs can claim two
  campaigns for the same contact, both read the same old `last_marketing_email_at`, and both send before
  either updates the contact. Vercel documents that cron invocations may overlap or be delivered more than
  once. See [Vercel cron concurrency guidance](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
- **Rationale:** Resend idempotency keys differ by campaign, so they do not enforce a cross-campaign
  frequency cap.
- **Impact:** The core “one marketing email per seven days” rule can be broken during normal overlap.
- **Recommended action:** Reserve the contact atomically in the claim transaction. Options include a
  dedicated contact send lease, a partial unique reservation, or a claim RPC that locks contacts and writes
  `marketing_reserved_until` before returning rows. Finalisation and release rules must be explicit.
- **Open questions:** If two campaigns are due, which campaign wins and what happens to the other recipient,
  skip permanently or defer until eligible?

### F06 - `sendEmail()` cannot provide the required campaign message link

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Integration / Data integrity
- **Relevant section:** Phase 3.3 steps 5 and 6; Phase 4.1 stats
- **Description:** `sendEmail()` returns `messageId` from Resend at
  `src/lib/email/emailService.ts:245-248`. `marketing_campaign_recipients.email_message_id` is a UUID foreign
  key to `email_messages.id`, not the Resend string ID. The local logging function obtains the UUID at
  `emailService.ts:93-118` but does not return it. The planned call also omits `requireLog: true`, so provider
  success can be returned even when no log row was written.
- **Rationale:** The entire statistics design depends on a reliable recipient-to-log join.
- **Impact:** The implementation cannot write the specified foreign key. If logging fails, the webhook
  looks up the missing Resend ID, updates zero rows, and marks the event processed at
  `src/app/api/webhooks/resend/route.ts:653-703`. Delivery, open, click, bounce, and complaint data are then
  permanently lost.
- **Recommended action:** Extend the email result to return both `providerMessageId` and `emailMessageId`.
  Make campaign sends require durable logging. Make logging idempotent by provider ID so a repeated Resend
  response returns the existing row. The webhook must create or quarantine an unmatched outbound event
  instead of accepting an update of zero rows. Include campaign ID, recipient ID, and contact ID in metadata.
- **Open questions:** Should `email_messages` gain a direct `business_contact_id` and campaign-recipient ID,
  or is the recipient foreign key plus metadata enough?

### F07 - Crash recovery and retry semantics are not safe enough

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Reliability / Queueing
- **Relevant section:** Phase 3.3 steps 2, 5 and 6; Risk “Cron double-send”
- **Description:** A process can crash after Resend accepts the email but before the recipient and contact
  updates commit. The row resets after 15 minutes and sends again. Resend keeps idempotency keys for only
  24 hours, not forever. See [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).
  A cron outage longer than 24 hours therefore allows a duplicate. Conversely, ordinary API, quota, and 5xx
  failures are marked `failed` permanently and never retry.
- **Rationale:** Provider calls and local database writes cannot share one transaction. The plan needs a
  durable send-attempt state machine, bounded retry policy, and reconciliation path.
- **Impact:** Recipients can receive duplicates, transient failures are silently abandoned, and campaigns
  can be labelled completed with unsent recipients.
- **Recommended action:** Add `attempt_count`, `next_attempt_at`, `last_attempt_at`, `lease_expires_at`,
  `provider_message_id`, and terminal/retryable failure classes. Reconcile a stale attempt by provider ID or
  durable local outbox evidence before resending. Add exponential backoff and a dead-letter/manual-retry
  path. Define “completed”, “completed with failures”, and “failed campaign”.
- **Open questions:** Which errors retry, how many times, and who can retry a terminal row? Is Resend lookup by
  idempotency key available, or must the local outbox be the source of truth?

### F08 - The shared domain decision changes transactional email

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Deliverability / Dependency
- **Relevant section:** Phase 0.1; Hard rule 3; Non-goals; Risks
- **Description:** Open and click tracking is configured per Resend domain. Enabling it for
  `auth.orangejelly.co.uk` therefore affects every Resend email on that domain, including transactional or
  authentication mail. Resend says tracking can hurt transactional delivery and link tracking can damage
  authentication links. It also recommends separating sending purposes by subdomain. See
  [Resend tracking documentation](https://resend.com/docs/dashboard/domains/tracking),
  [Resend auth deliverability guidance](https://resend.com/docs/knowledge-base/how-do-i-maximize-deliverability-for-supabase-auth-emails),
  and [Resend domain guidance](https://resend.com/docs/dashboard/domains/introduction).
- **Rationale:** The plan promises operational email is untouched, but the dashboard change is wider than
  the per-call provider override. The `auth` name also signals the wrong purpose and does not align with The
  Anchor brand.
- **Impact:** Marketing complaints, tracking, or link rewriting can affect higher-value transactional mail.
  Recipients may also distrust an Orange Jelly auth address advertising The Anchor.
- **Recommended action:** Push back on the owner decision. Use a verified subdomain of the venue's own domain,
  such as `news.the-anchor.pub`, with a separate custom tracking subdomain and DMARC. Keep tracking disabled on
  the authentication or transactional domain. If the owner keeps the shared domain, require a written risk
  acceptance and tests proving every transactional link remains usable.
- **Open questions:** Which transactional flows currently send from this domain? Is tracking already enabled?
  Can DNS for a venue-owned marketing subdomain be completed before Phase 3?

### F09 - The footer is factually false for researched contacts and lacks required privacy information

- **Status:** Confirmed issue
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Compliance / Content
- **Relevant section:** Hard rules 1 and 5; Phase 2; Phase 1.8; Discovery 4.6
- **Description:** The actual campaign footer in
  `docs/design/email-handover/anchor-christmas-and-lunch.html:116` says the recipient enquired about a booking
  or event. The imported list includes `new-research`, so that statement is false. The footer schema exposes
  only `unsubscribe_url`, and the HTML has no privacy-notice link despite the discovery document promising
  one. For indirectly sourced named contacts, privacy information must identify the categories and source
  no later than the first communication, and normally within one month. See
  [ICO lead collection guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/collect-information-and-generate-leads/)
  and [ICO Article 14 timing guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/when-should-we-provide-privacy-information/).
- **Rationale:** Byte fidelity cannot override truthfulness and transparency.
- **Impact:** The first campaign breaches the plan's own hard rule and may fail UK GDPR transparency duties.
- **Recommended action:** Block sending until the designer re-exports both footers with dynamic, truthful
  `reason_for_contact` and `privacy_notice_url` slots. Suggested neutral wording: “We are contacting you in
  your business capacity. See how we found and use your details in our privacy notice.” Where source detail is
  personal data, provide it on the linked notice or in a source-specific line.
- **Open questions:** What exact source should each contact be told? Is the current website privacy notice
  suitable for sourced B2B contacts and Resend tracking?

### F10 - Open and click tracking needs a separate compliance decision

- **Status:** Required decision
- **Severity:** Blocker
- **Priority:** P0
- **Type:** Compliance / Tracking
- **Relevant section:** Phase 0.1; Phase 4.1; Discovery 4.6
- **Description:** The plan treats open and click tracking as a dashboard prerequisite only. Resend inserts a
  recipient-specific pixel and rewrites every tracked link. ICO guidance says PECR storage/access rules can
  apply to tracking pixels in marketing email where they store or access device information. See
  [ICO storage and access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-storage-and-access-technologies/)
  and [Resend tracking details](https://resend.com/docs/dashboard/domains/tracking).
- **Rationale:** The legal basis, transparency, necessity, retention, and opt-out treatment for per-person
  tracking have not been assessed. Open rates are also inaccurate because mail clients prefetch or block the
  pixel. See [Resend open-rate limitations](https://resend.com/docs/knowledge-base/why-are-my-open-rates-not-accurate).
- **Impact:** Tracking may create a compliance gap and the UI may present misleading engagement data.
- **Recommended action:** Obtain a documented legal and privacy decision before enabling tracking. Update the
  privacy notice and data retention policy. Consider disabling open tracking and using aggregate short-link
  clicks as the primary measure. Label opens as estimated if retained.
- **Open questions:** Is per-recipient tracking necessary for the business decision? What consent or exception
  is relied on, and can a contact opt out of tracking without opting out of email?

### F11 - GET unsubscribe is vulnerable to email security scanners

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Functional / HTTP / Deliverability
- **Relevant section:** Phase 3.1; existing `src/app/api/unsubscribe/route.ts`
- **Description:** Both GET and POST unsubscribe immediately. Enterprise email scanners commonly issue GET
  requests to every link before delivery, causing false opt-outs. Resend's own guidance says the RFC 8058 POST
  should perform the one-click action and return 200/202, while GET should show the normal unsubscribe page.
  See [Resend unsubscribe guidance](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails).
- **Rationale:** A visible footer link can use a confirmation form while the mail client's native one-click
  control still works through POST.
- **Impact:** Contacts can be unsubscribed without choosing to unsubscribe, and staff will not know why.
- **Recommended action:** Change GET to a no-store confirmation page and perform the action with POST. Keep the
  header endpoint one-click compliant. Return a simple 200/202 to automated POSTs. Test link-prefetch GET,
  human confirm POST, native one-click POST, repeats, expired forms, and invalid tokens. Treat this as an
  existing customer-flow change and release it separately if needed.
- **Open questions:** Must the existing customer footer keep immediate GET behaviour for compatibility, or can
  both subject types move to the safer flow?

### F12 - The shared unsubscribe-token table is acceptable, but the migration is incomplete

- **Status:** Required decision
- **Severity:** Question
- **Priority:** P1
- **Type:** Data model / Migration
- **Relevant section:** Phase 1.3 and 3.1
- **Description:** `record_unsubscribe_token_use()` updates by token only at
  `supabase/migrations/20260809130000_email_unsubscribe_tokens.sql:51-61`, so a null `customer_id` does not
  break it. The XOR subject constraint is a reasonable supertype model and avoids duplicate token logic.
  However, the existing table comment and code comments promise “one token per customer”, and the plan does
  not specify migration rollback, constraint validation, or exact typed lookup behaviour.
- **Rationale:** A separate business token table lowers live-table DDL blast radius but adds a second query,
  token namespace, and more route logic. It is not clearly safer overall for this small extension.
- **Impact:** Either design can work, but an informal implementation can regress the live customer path.
- **Recommended action:** Keep the shared table unless the owner wants a separate B2B route for operational
  isolation. Update table and function comments, use a discriminated lookup result, run the migration in one
  transaction, and test existing rows, both subjects, token collision, concurrent creation, cascade, and RPC
  usage. If a separate table is chosen, keep one route contract and query both tables without revealing which
  matched.
- **Open questions:** Is avoiding any change to the live customer table worth the added permanent complexity?

### F13 - Campaign promotion and cancellation are not atomic

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Concurrency / Lifecycle
- **Relevant section:** Phase 3.3 steps 3, 5 and 6; Phase 4.1
- **Description:** Promotion first changes a campaign to `sending`, then inserts recipients. A crash between
  those operations leaves a sending campaign with zero recipients, which step 6 can mark completed. Cancel
  only changes campaign status; unclaimed pending rows stay pending forever. Stale rows on a cancelled
  campaign are also returned to pending by the global recovery step.
- **Rationale:** Campaign state and recipient state form one business transition and must change together.
- **Impact:** Campaigns can complete without sending, cancelled campaigns retain misleading queue state, and
  analytics become hard to reconcile.
- **Recommended action:** Use transactional RPCs for promote-and-snapshot, cancel, pause recovery, and final
  completion. Cancel should mark every unstarted row skipped with a cancellation reason while protecting the
  one provider call already in flight. Add legal transition constraints or a single transition service.
- **Open questions:** Can a scheduled campaign be cancelled before snapshot? Should cancelled recipient rows
  remain auditable rather than being removed?

### F14 - Pause semantics are not precise enough to test or promise

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Functional / Concurrency
- **Relevant section:** Phase 3.3 step 5; Phase 3 acceptance; Discovery 4.3
- **Description:** The plan says campaign status is rechecked per claimed row, but it does not define how near
  to the provider call or whether the check and send reservation are atomic. A pause can race after the check
  and before Resend accepts the email. The acceptance test only proves that a later cron sends nothing, not
  what happens inside the current batch.
- **Rationale:** “Takes effect within one batch” could mean up to 50 extra sends, while the described per-row
  check suggests at most the current provider request. These are materially different promises.
- **Impact:** Staff may pause after spotting a bad campaign and still send far more messages than expected.
- **Recommended action:** State the guarantee: after pause commits, at most one already-authorised provider
  request may complete. Recheck immediately before acquiring an atomic per-row send lease. Stop claiming or
  iterating as soon as pause is seen and return untouched rows to pending. Add a controlled race test.
- **Open questions:** Is at-most-one post-pause send acceptable? Is an emergency global stop expected to be
  stronger?

### F15 - Batch size 50 is not justified within a 60-second function

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Performance / Delivery
- **Relevant section:** Environment additions; Phase 3.3; Discovery 4.3
- **Description:** Each recipient needs contact checks, suppression checks, token lookup or insert, rendering,
  a Resend request, email logging, and at least two state updates. The plan appears sequential and has no time
  budget, concurrency limit, or graceful stop. The repository already has 47 Vercel cron entries, not 38, and
  the new route becomes number 48. Resend's default team-wide limit is five requests per second and is shared
  with other sends. See [Resend usage limits](https://resend.com/docs/api-reference/rate-limit).
- **Rationale:** A hard platform timeout can interrupt any step and trigger stale recovery. Blind parallelism
  would instead increase rate-limit and pause races.
- **Impact:** Normal batches may time out, explicit 429s become terminal failures, and other email flows can
  compete for the same quota.
- **Recommended action:** Measure a production-like batch before choosing the default. Add a deadline budget,
  bounded concurrency and provider-aware throttling, retry-after handling, and a smaller safe batch. Prefetch
  contact and suppression data where safe. Verify the Vercel plan's cron and duration limits and load test
  160, 1,000, and several thousand recipients.
- **Open questions:** What is the current Vercel plan and Resend rate/quota? What completion time is acceptable
  for a 160-recipient campaign?

### F16 - The dedicated recipient queue is reasonable, but it lacks proven queue features

- **Status:** Required decision
- **Severity:** Major
- **Priority:** P1
- **Type:** Architecture / Simplification
- **Relevant section:** Phase 1.2 and 3.3
- **Description:** Using `marketing_campaign_recipients` as the queue avoids duplicating every recipient into
  the generic `jobs` table and fits pause, cancellation, and statistics well. However, the plan copies only
  `SKIP LOCKED`, not the existing queue's lease, attempt count, maximum attempts, scheduling, heartbeat, stale
  handling, and priority semantics from `claim_jobs`.
- **Rationale:** A dedicated queue is not simpler if these mechanics are rebuilt incompletely. Moving to the
  generic queue would also create two sources of recipient truth.
- **Impact:** The chosen path currently has weaker recovery than the local queue it decided not to use.
- **Recommended action:** Keep the dedicated recipient queue, but deliberately adopt the mature lease and retry
  fields and test patterns from `jobs`. Use the minute processor only if the team prefers one scheduler and is
  willing to make the recipient row the canonical payload referenced by a lightweight job.
- **Open questions:** Is one-minute cadence valuable enough to add generic job records? Who owns dead-letter
  operations in the UI?

### F17 - Audience matching and snapshot timing are ambiguous

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Functional / Data
- **Relevant section:** Phase 1.1, 3.3 step 3, 4.1 and 4.2
- **Description:** `{ tags, exclude_tags }` does not define whether multiple include tags mean ANY or ALL,
  whether excluded tags use ANY, how values are normalised, or how unknown tags behave. The list uses both
  segment and source-group tags, so this choice materially changes recipients. The plan previews at schedule
  time but snapshots only when due. A campaign due outside the send window snapshots early and can wait for
  days, excluding later additions while retaining deleted or edited addresses.
- **Rationale:** Audience rules must be identical in preview, snapshot, and audit evidence.
- **Impact:** The wrong businesses can be contacted, counts can change without explanation, and staff cannot
  prove who was approved.
- **Recommended action:** Define the audience expression formally, preferably category-aware groups with OR
  within a category and AND between categories. Store an audience version and the approved preview count.
  Decide whether snapshot occurs on schedule, on entering the send window, or immediately before send. Show
  and export the exact recipient list before approval.
- **Open questions:** Should tag edits affect already scheduled campaigns? Should a changed email use the
  snapshotted address or the contact's latest address?

### F18 - The short-link API named in Phase 4 does not support the requirement

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Integration / Technical
- **Relevant section:** Phase 2.3; Phase 4.3
- **Description:** `getOrCreateShortLinkVariantInternal()` requires a parent short code and `utm_content`, and
  hard-codes `channel: 'meta_ads'`, at `src/services/short-links.ts:570-670`. It cannot create an arbitrary
  marketing destination with the proposed campaign metadata. The current renderer is synchronous, while
  short-link creation is asynchronous and database-backed. “One variant per campaign” also fails when a
  campaign contains several destination URLs.
- **Rationale:** Extending the render-time string pass with this service will not type-check or produce correct
  analytics.
- **Impact:** Phase 4 is underestimated and can create Meta-labelled links, route multiple CTAs incorrectly,
  or make rendering unexpectedly depend on database availability.
- **Recommended action:** Decide the link model before Phase 2. Prefer pre-provisioning one short link per
  `(campaign, canonical destination)` during schedule validation, then pass a deterministic map into the pure
  renderer. Add a marketing-specific service and unique key. Decide `marketing_email` now rather than leaving
  the database type decision to a PR ADR.
- **Open questions:** Which links count as CTAs? Should ordinary website, social, telephone, WhatsApp, privacy,
  and unsubscribe links be shortened or left alone?

### F19 - The stated byte-fidelity tests conflict with mandatory transforms

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Rendering / Testing
- **Relevant section:** Hard rule 1; Phase 2.2, 2.3 and 2.6
- **Description:** Campaign fidelity says `renderMarketingEmail()` must equal the original file byte for byte,
  but that function also must replace the unsubscribe token and append UTM parameters to site links. The
  handover file has no UTMs. Entity handling is also undefined: passing `&rsquo;` through the stated escape
  function yields `&amp;rsquo;`, while passing the Unicode character does not reproduce the entity bytes. The
  test says apostrophes are escaped although the escape contract lists only `& < > "`.
- **Rationale:** A test cannot simultaneously require unchanged source bytes and changed links/content.
- **Impact:** Phase 2 acceptance is impossible or will be weakened with ad hoc normalisation that hides real
  drift.
- **Recommended action:** Split rendering into a pure template stage and a delivery-transform stage. Fidelity
  mode should use original sample values, `%%unsubscribe%%`, and no UTM rewrite. Separately test an exact,
  allow-listed diff for unsubscribe, UTM, and short-link changes. Define canonical entity encoding and HTML
  attribute query encoding, including `&amp;`, existing queries, and fragments.
- **Open questions:** Is byte equality required only before provider tracking rewrites? Which entities are
  canonical for dynamic content?

### F20 - Manual extraction is not independently proven for every campaign-only block

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Rendering / Delivery
- **Relevant section:** Phase 2.1 and 2.6
- **Description:** The 18 marker-delimited blocks can be extracted deterministically, but seven campaign-only
  blocks and the shell are selected by manual structure. A committed script does not make a manually chosen
  boundary correct. The full campaign comparison helps, but it is currently blocked by F19 and it does not
  exercise alternate values or each boundary independently.
- **Rationale:** Fixtures and templates derived from the same mistaken slice can agree with each other.
- **Impact:** A bad extraction can pass block tests and later break new compositions in Outlook.
- **Recommended action:** Store source byte offsets or stable start/end hashes for every extracted slice,
  compare the concatenated untouched regions to the source, and require a reviewed source-to-fixture diff.
  Keep the full-document golden test independent. Send the first output through the handover's real client
  matrix, not only browser widths.
- **Open questions:** Can the designer add normal block markers around the seven campaign-only blocks and
  shell boundaries?

### F21 - The block count and Phase 2 estimate are inconsistent

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Scope / Estimation
- **Relevant section:** Feature summary; Phase 2.1 and 2.2; handover block catalogue
- **Description:** `anchor-email-blocks.html` contains 18 marked blocks. The campaign adds seven different
  blocks, making 25 implemented block modules before the excluded `note_bar` and shared button patterns. The
  README calls the catalogue “all 18 blocks” while listing more entries. “One module per block” therefore has
  no authoritative count.
- **Rationale:** Tests, schemas, renderer registrations, extraction work, and review effort scale with the real
  number of modules.
- **Impact:** Phase 2 is likely underestimated and completion can be disputed.
- **Recommended action:** Add one authoritative inventory with source file, marker status, module, schema,
  fixture, campaign use, and in/out state. Re-estimate Phase 2 after the count is agreed. Consider shipping
  only the first campaign's required blocks plus a small proven reusable set, then adding others on demand.
- **Open questions:** Must all reusable blocks ship before the first campaign, or can the first release be
  reduced to the seven campaign blocks, shell, and footers?

### F22 - DB JSON is suitable, but campaigns need versioning and immutability

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Data model / Rendering
- **Relevant section:** Phase 1.1; Phase 2.3 and 2.4; Phase 4.1
- **Description:** Storing validated block JSON is more practical than requiring a deployment for every
  campaign. However, there is no `schema_version` or `renderer_version`, the database default `{}` is invalid,
  and a later code deployment can make a scheduled campaign unrenderable. The plan also does not forbid
  editing subject, content, audience, or UTM after scheduling.
- **Rationale:** Write-time Zod validation only proves compatibility with the code deployed at that moment.
- **Impact:** A scheduled campaign can change after approval or fail when a new renderer is deployed.
- **Recommended action:** Add explicit schema and renderer versions, remove the invalid default, preflight and
  freeze all delivery fields when scheduling, and keep old parsers or migrate drafts before removing support.
  Store a content hash and optionally the approved rendered HTML hash. Only drafts should be editable; changes
  to a scheduled campaign should create a new draft or require unscheduling and reapproval.
- **Open questions:** How long must old campaign content remain reproducible? Who approves a content revision?

### F23 - Unsubscribe attribution does not identify the campaign link used

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Analytics / Compliance
- **Relevant section:** Phase 3.1; Phase 4.1 stats; Discovery 4.4
- **Description:** One durable token is reused in every email. The route attributes an unsubscribe to
  `last_marketing_campaign_id`, not to the email whose link was clicked. A contact opening an older email after
  receiving a newer one is credited to the newer campaign.
- **Rationale:** The token identifies a contact only. It carries no campaign context.
- **Impact:** Campaign unsubscribe metrics are wrong and cannot be audited as claimed.
- **Recommended action:** Define this metric as “latest-touch attributed” or append a campaign-recipient ID to
  the durable token URL and validate it against a sent recipient row. The token should still unsubscribe even
  if the context is absent or invalid. Store the actual attribution event separately rather than inferring it
  from mutable contact fields.
- **Open questions:** Is approximate latest-touch attribution acceptable for v1?

### F24 - Statistics need exact definitions and several indexes

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Analytics / Performance
- **Relevant section:** Phase 4.1 and 4.2
- **Description:** The join from campaign recipients to `email_messages` by primary key is fine for a few
  thousand recipients, so denormalised counters are not needed. However, the plan does not define whether
  delivered includes later opened/clicked messages, whether rates exclude suppressed/skipped rows, how unique
  clicks are counted, when late webhooks refresh completed campaigns, or how complaints and delayed delivery
  appear. `status` alone is unsuitable because the webhook promotes it from delivered to opened to clicked.
  The cron also lacks efficient indexes for global pending claims, stale claims, due campaigns, and unsubscribe
  attribution.
- **Rationale:** Percentages can be materially different while all queries look reasonable.
- **Impact:** The dashboard can undercount delivery and present non-reconciling totals.
- **Recommended action:** Define every numerator, denominator, event-time rule, and late-event behaviour. Use
  timestamp columns such as `delivered_at IS NOT NULL` rather than final status. Include complaint and delayed
  counts. Add or justify indexes such as campaigns `(status, scheduled_for)`, partial recipients
  `(created_at) WHERE status='pending'`, partial recipients `(claimed_at) WHERE status='sending'`, and contacts
  `(last_marketing_campaign_id, unsubscribed_at)`. Confirm with `EXPLAIN` on expected volumes.
- **Open questions:** Are rates based on sent, delivered, or total eligible recipients? Are Apple/Gmail
  machine opens excluded or simply labelled approximate?

### F25 - Scheduling and sending permissions use the wrong capability

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Security / RBAC
- **Relevant section:** Phase 1.4; Phase 3.5; Phase 4.1
- **Description:** The repository already has `messages.send_marketing` at
  `src/types/rbac.ts:107-109`. The plan instead grants managers generic marketing create/edit/delete and uses
  `marketing.edit` for test sends. It does not say which permission protects scheduling, resuming, cancelling,
  importing personal data, or exporting recipient details.
- **Rationale:** Editing a draft and authorising external bulk communication are different risks.
- **Impact:** A manager who may edit campaign data can send to the entire list without an explicit sending
  grant. The unused existing capability creates inconsistent policy.
- **Recommended action:** Define a permission matrix. Require an explicit send capability for test send,
  schedule, resume, and retry. Reuse `messages.send_marketing` or create `marketing.send`, but do not leave both
  meanings active. Add separate import/export and delete rights if needed. Test every action server-side.
- **Open questions:** Which roles may approve and send a real campaign? Is two-person approval required for
  the first launch?

### F26 - Webhook contact synchronisation is too weakly linked

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Integration / Data integrity
- **Relevant section:** Phase 3.3 metadata; Phase 3.4
- **Description:** The send metadata includes only `campaign_id`, and the webhook proposal finds a business
  contact by email. If the contact's email changes after send, or casing/normalisation differs, the bounce or
  complaint does not update the intended row. Email matching can also be ambiguous if historical data is ever
  retained under a changed address.
- **Rationale:** The send already has stable campaign-recipient and contact IDs.
- **Impact:** A complained contact can remain marked subscribed in the UI even though the global suppression
  prevents delivery.
- **Recommended action:** Persist contact ID and campaign-recipient ID on `email_messages` or in indexed
  metadata and make the webhook follow that stable link. Use email lookup only as a fallback and normalise it.
  Alert if suppression succeeds but contact-state sync fails.
- **Open questions:** Should a later delivered event ever clear `bounced`, or is manual review required?

### F27 - There is no operational kill switch, heartbeat, or alert plan

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Operations / Monitoring
- **Relevant section:** Phase 3.3; Launch checklist; Risks
- **Description:** The plan relies on per-campaign pause and a JSON cron response. It has no global marketing
  send disable switch, cron heartbeat, oldest-pending monitor, stuck-campaign alert, webhook-lag alert, provider
  quota alert, complaint threshold, or suppression-check failure metric. The bounce gate is a manual next-day
  check only.
- **Rationale:** Bulk sends need a fast, observable stop path that does not require a deployment or editing
  every campaign.
- **Impact:** A bad campaign, broken webhook, or repeated provider failure can continue unnoticed.
- **Recommended action:** Add `MARKETING_SEND_ENABLED` or a database-controlled global pause checked before
  claim and immediately before each send. Add structured metrics and alerts for cron failure/absence, queue
  age, retries, dead letters, webhook lag, bounces, and any complaint. Integrate with the existing communications
  monitor if possible. Document the rollback and incident procedure.
- **Open questions:** Who receives alerts and who has authority to resume after a complaint or high bounce rate?

### F28 - CSV import behaviour is incomplete and not safely repeatable

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Functional / Data migration
- **Relevant section:** Phase 1.6 to 1.8
- **Description:** The plan does not define whitespace and case normalisation, duplicate rows within one file,
  conflicting existing details, tag separators, malformed rows, partial batch failure, concurrent imports, or
  whether a previously unsubscribed/bounced contact is preserved. The one-off name split on the first space is
  lossy. “Writes nothing on validation failure” is stated for the script but not guaranteed transactionally.
- **Rationale:** The first real data load is part of the release, not an informal setup step.
- **Impact:** Imports can partially apply, create misleading contact names/tags, or hide why contacts were
  skipped.
- **Recommended action:** Normalise and validate the full file first, then use one transactional RPC or a
  clearly resumable batch with an import ID and row results. Preserve all negative marketing states. Define
  merge policy and exact tag parsing. Produce an audit file containing row number, source, decision, and reason,
  without logging personal data to shared build logs.
- **Open questions:** Should duplicates update missing fields and tags or always skip? Does the spreadsheet
  include enough legal source evidence to import?

### F29 - The campaign and contact schemas lack important integrity constraints

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Database / Data integrity
- **Relevant section:** Phase 1.1
- **Description:** `created_by` has no foreign key, `last_marketing_campaign_id` has no foreign key, and status
  fields are not tied to their timestamps or reasons. Email is unique by `lower(email)` but is not trimmed or
  stored canonically. `content` defaults to invalid `{}`. Error, notes, subject, name, tag count, and JSON sizes
  are unbounded. Deleting a zero-send contact can still cascade pending campaign recipients.
- **Rationale:** Service actions are not the only future writer, and the plan already relies on direct scripts
  and service-role code.
- **Impact:** Impossible states reach the sender and analytics, and large or malformed input can cause UI or
  rendering problems.
- **Recommended action:** Add foreign keys where lifecycle permits, canonical email enforcement, bounded text
  and JSON validation, and database checks for scheduled/sent/skipped state consistency. Decide deletion
  behaviour for pending recipients. Prefer no campaign-content default. Store actor and reason for schedule,
  pause, cancel, resume, resubscribe, and retry.
- **Open questions:** Should contact email changes create a new contact or update the existing identity?

### F30 - Environment configuration is not validated tightly enough

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Configuration / Deployment
- **Relevant section:** Environment additions; Phase 0.2; Phase 3.3 step 1
- **Description:** The current `src/lib/env.ts` has no optional-with-warning mechanism. The plan does not define
  parsing or safe ranges for batch size and cap days, validate sender syntax, or require the marketing reply-to,
  webhook secret, tracking setup, and public base URL at go-live. It also says to add values to `.env.local`,
  which is developer machine state rather than a deliverable.
- **Rationale:** Presence checks do not catch zero, negative, huge, malformed, or mismatched values.
- **Impact:** Bad configuration can disable the cap, overload the function, produce broken unsubscribe URLs,
  or send with no working reply path or analytics.
- **Recommended action:** Add typed parsing with bounds and clear startup/runtime diagnostics. Create a single
  marketing readiness check covering provider key, from, reply-to, app URL, webhook, sending domain, tracking
  decision, global enable flag, batch, and frequency cap. Document local setup without requiring a committed
  `.env.local` change.
- **Open questions:** Should test and preview deployments ever be able to send outside a provider sandbox?

### F31 - The provider's marketing API has not been evaluated

- **Status:** Required decision
- **Severity:** Major
- **Priority:** P1
- **Type:** Dependency / Simplification
- **Relevant section:** Architecture; Phase 3.3
- **Description:** Current Resend guidance directs promotional and newsletter sends to the Broadcast API,
  while the plan uses the one-to-one Send Email API and builds contacts, scheduling, topics, and unsubscribe
  handling locally. See [Resend sending guidance](https://resend.com/docs/knowledge-base/what-sending-feature-to-use)
  and [Broadcast API](https://resend.com/docs/api-reference/broadcasts/create-broadcast).
- **Rationale:** A local system offers stronger ownership and integration with AMS, but it duplicates provider
  features and may use different quotas or operational expectations.
- **Impact:** The team may build unnecessary queue and subscription machinery or discover plan/billing limits
  late.
- **Recommended action:** Record a short architecture decision before Phase 1 comparing Broadcasts with the
  custom sender for HTML fidelity, per-recipient webhooks, local do-not-contact rules, data residency, cost,
  scheduling, pause, testing, and vendor lock-in. If the custom sender remains, obtain confirmation that the
  chosen API and account plan support this marketing use.
- **Open questions:** Does the current Resend plan include the needed marketing or transactional quota? Can
  Broadcast webhooks still populate the existing `email_messages` model reliably?

### F32 - The testing plan cannot prove the highest-risk behaviour

- **Status:** Confirmed issue
- **Severity:** Major
- **Priority:** P1
- **Type:** Testing / Quality
- **Relevant section:** Phase acceptance criteria; Test summary
- **Description:** A mocked-client “integration-style” claim test cannot prove PostgreSQL row locking,
  `SKIP LOCKED`, `PUBLIC` grants, RLS, transaction boundaries, or the cross-campaign frequency race. The plan
  also omits crash points after provider acceptance, retries after 24 hours, provider 429 handling, missing
  webhook rows, import rollback, re-import after objection, send-window DST gaps/overlaps in the schedule UI,
  and a timed 50-recipient run.
- **Rationale:** These are the exact cases most likely to cause unlawful or duplicate sends.
- **Impact:** CI can be green while the core safety properties are false.
- **Recommended action:** Add real-Postgres concurrency tests with two connections; RLS/grant tests for every
  role; deterministic crash/restart tests around every provider boundary; provider error classification tests;
  import and erasure round trips; queue load tests; and a full canary reconciliation from recipient to webhook
  and UI. Keep browser and real email-client sign-off as recorded release evidence.
- **Open questions:** Is a Supabase integration environment available in CI, and can Resend sandbox webhooks be
  replayed deterministically?

### F33 - Plain-text and accessibility requirements are incomplete

- **Status:** Confirmed issue
- **Severity:** Minor
- **Priority:** P2
- **Type:** Accessibility / Deliverability
- **Relevant section:** Phase 2; Phase 3.3 send call; handover accessibility section
- **Description:** The marketing send passes HTML only even though `sendEmail()` supports text. The plan checks
  image alt text and two browser widths but does not require `lang="en-GB"`, presentation roles, meaningful
  heading order, link purpose, colour-only checks, screen-reader review, or preservation of text alternatives
  after composition. The visible unsubscribe page uses `lang="en"` today.
- **Rationale:** Plain text helps recipients who block HTML and gives a usable fallback. Email accessibility
  needs structural checks as well as visual checks.
- **Impact:** Some recipients receive a poor or unusable message, and regressions can escape the byte tests.
- **Recommended action:** Generate and review a plain-text part containing the key message, CTA URLs, sender
  identity, privacy link, and unsubscribe URL. Add static accessibility assertions and one screen-reader pass.
  Keep the supplied `en-GB`, table roles, alt text, text sizing, and non-colour cues.
- **Open questions:** Should the designer supply an approved text version or may it be generated from block
  JSON?

### F34 - The global “no em dashes in code” rule adds delivery cost without protecting the feature

- **Status:** Optional improvement
- **Severity:** Minor
- **Priority:** P2
- **Type:** Scope / Maintainability
- **Relevant section:** Hard rule 4
- **Description:** The brand rule is relevant to customer-facing copy. Extending it to code, SQL, and comments
  has no functional benefit, is not linted, and can conflict with vendored handover text or normal technical
  documentation.
- **Rationale:** Unenforced stylistic absolutes create review noise and unrelated edits.
- **Impact:** Developers spend time policing comments instead of testing send safety.
- **Recommended action:** Suggested wording: “Do not introduce em dashes in customer-visible marketing copy.
  Preserve vendored source files exactly.”
- **Open questions:** Does the owner intentionally want this rule in internal technical writing too?

## 4. Direct answers to the ten review challenges

1. **Unsubscribe token widening:** Keep the shared table. The RPC works because it keys on token. A separate
   table is not clearly safer after accounting for duplicate route and token logic. Complete the migration and
   tests described in F12.
2. **Claim RPC versus job queue:** A dedicated recipient queue is the better fit, but it must adopt real lease,
   retry, backoff, attempt, and dead-letter behaviour. The current proposed RPC is too weak. See F05, F07,
   F13, F15, and F16.
3. **Stats via joins:** Joins are appropriate at this scale and counters would add consistency risk. Define the
   metrics and add the operational indexes in F24.
4. **Content as DB JSON:** Agree, provided campaigns are versioned, preflighted, and immutable after approval.
   See F22.
5. **Byte fidelity:** Golden files are the right approach, but the stated campaign test is impossible while
   UTM and unsubscribe transforms run. Manual campaign-only extraction also needs independent boundary proof.
   See F19 and F20.
6. **Shared sending domain:** Push back. The small list limits volume risk but does not isolate complaint
   reputation or domain-level tracking from transactional auth email. See F08.
7. **Pause semantics:** With an immediate per-row recheck, one provider request may still race after pause.
   The plan must promise and test an exact bound. It must also bulk-finalise cancelled rows. See F13 and F14.
8. **Compliance:** The treatment is incomplete. Subscriber classification, LIA/consent evidence, Article 14
   transparency, a durable do-not-contact list, tracking assessment, and data-processing/retention decisions
   are missing. See F01, F02, F09, F10, and F27.
9. **`commType` constraint:** There is no `comm_type` CHECK constraint in the current migrations or logging
   types. `comm_type` is plain text at
   `supabase/migrations/20260703000000_email_comms_resend_infra.sql:32`; no migration is needed for
   `marketing_campaign`. The plan should state this as verified and add a regression test instead of leaving
   it conditional.
10. **Missing entirely:** The main omissions are fail-closed suppression, RPC grants, contact-level frequency
    locking, durable retries, exact send-log linkage, global kill switch and monitoring, true recipient
    eligibility, do-not-contact retention, privacy/tracking treatment, provider API choice, plain text, and
    real concurrency/load tests.

## 5. Readiness and delivery assessment

### Are the phases independently deployable?

- **Phase 1:** Technically deployable after F01, F02, F04, F12, F17, F25, F28, and F29 are resolved. As
  written, it exposes personal data too widely and creates contacts as subscribed without enough evidence.
- **Phase 2:** Code-only and deployable, but its acceptance test is contradictory and its scope is unclear.
  Resolve F19 to F22 first.
- **Phase 3:** Not safely deployable as written. It depends on Phases 1 and 2, has no reliable campaign seed
  path, and fails core logging, retry, concurrency, pause, suppression, and monitoring requirements.
- **Phase 4:** Not independently safe because it changes rendering into an asynchronous data integration and
  may require a short-link migration. Provision links before render and deploy schema before dependent code.

The phases can be made safe as sequential releases. They are not independent in the normal meaning of that
word.

### Would implementation start from this plan as written?

**No.** Discovery and a small technical spike can start, but schema and sender implementation should wait for
the recipient-eligibility, objection-retention, domain/tracking, queue state, and message-link decisions.

### Key required changes

1. Add a verified eligibility and lawful-basis model. Default imports to pending review.
2. Add a marketing-only do-not-contact record that survives erasure and re-import.
3. Make suppression checks fail closed for marketing.
4. Fix RLS and revoke the claim RPC from `PUBLIC`.
5. Make contact frequency reservation atomic across campaigns.
6. Return and require the real `email_messages.id`; make webhook recovery durable.
7. Define retry, lease, dead-letter, completion, and reconciliation semantics.
8. Move marketing to a separate venue-owned sending and tracking subdomain.
9. Replace the false footer line and add correct Article 14 privacy information.
10. Make campaigns versioned and immutable after approval; pre-provision short links.

### Unresolved decisions

- Corporate-subscriber classification and evidence for each initial contact.
- Legal basis and LIA, plus whether any individual subscribers have valid consent or soft opt-in.
- Whether open tracking is necessary and lawful for this audience.
- Shared auth domain versus a dedicated venue-owned marketing subdomain.
- Custom per-recipient sender versus Resend Broadcasts.
- Frequency-cap conflict behaviour: skip or defer.
- Exact audience tag logic and snapshot time.
- Exact pause guarantee and emergency-stop authority.
- Short-link type and one-link-per-destination model.
- Approval roles and whether the first send requires two people.

### Major delivery risks

- Compliance review and contact classification are larger owner tasks than the plan allows.
- Phase 2 contains at least 25 modules, not 18, and is likely underestimated.
- Phase 3 is closer to a durable queue/outbox project than a medium cron route.
- Phase 4 combines full campaign UI, analytics, and a new async short-link integration and should be split.
- Domain/DNS, provider plan, tracking, and legal decisions can block launch after code is complete.

### Recommended next steps

1. Hold a short decision review covering F01, F02, F08, F10, F16, F17, F22, F25, and F31.
2. Amend the plan with the resulting data model, permission matrix, state machine, metric definitions, and
   operational runbook.
3. Run a focused spike proving: atomic claim across campaigns, durable send-log linkage, provider retry after
   a simulated crash, one real rendered email, and the exact short-link approach.
4. Re-estimate and split delivery into foundations/compliance, renderer for the first campaign only, durable
   sender, campaign UI, and later catalogue/conversion enhancements.
5. Do not import the real list or enable real sending until eligibility review, privacy wording, domain setup,
   webhook health, canary reconciliation, and emergency-stop tests are signed off.

The first three findings to fix are F01, F02, and F06. Before any sender code is merged, F03 to F08 must also
be closed.
