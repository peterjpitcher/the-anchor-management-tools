# B2B marketing email: how each review finding was resolved

Date: 2026-08-13
Reviewed document: `tasks/marketing-email-b2b-implementation-plan-2026-08-13.md`
Review: `tasks/marketing-email-b2b-developer-review-2026-08-13.md` (34 findings, verdict "not ready to build as written")
This document: what changed, and where the code proves it.

The review was right on the substance. Its ten headline problems were all real, and I verified its code claims independently against the repository and the live database rather than taking them on trust. Two claims needed correcting, noted at the bottom.

## Design decisions taken in response

Three decisions shaped everything else.

**Tracking stays off on the shared domain (F08, F10).** The owner chose to send from the existing `noreply@auth.orangejelly.co.uk`. Resend configures open and click tracking per DOMAIN, so enabling it would have changed transactional and authentication email too, which contradicted the plan's own non-goal. Rather than overturn the owner's decision or accept that risk, the feature does not require domain-level tracking at all. Click measurement comes from our own short links, which we control. Open tracking is treated as an optional extra that is off unless a dedicated marketing subdomain is set up later, and the UI labels opens as unavailable rather than showing a misleading zero. This also removes the separate PECR question about a per-recipient tracking pixel, since there is no pixel.

**Eligibility is a human decision, not a domain heuristic (F01).** `is_freemail` is kept but demoted to a review hint. Contacts import as `eligibility_status = 'pending_review'` and nothing can send to them until a person records a subscriber type, a lawful basis and evidence. The database enforces it: an `eligible` row without `marketing_basis` and a reviewer timestamp violates a CHECK constraint.

**An objection outlives the record it came from (F02).** `marketing_do_not_contact` keeps the address after erasure, because you cannot screen a new import against an objection you can no longer recognise. It is separate from `email_suppressions`, which blocks all mail including booking confirmations.

## Finding-by-finding

| # | Finding | Resolution | Where |
|---|---|---|---|
| F01 | Eligibility not established | `subscriber_type`, `marketing_basis`, `basis_evidence`, `source_detail`, `collected_at`, `privacy_notice_sent_at`, `eligibility_status`/`_reviewed_by`/`_reviewed_at`. Default `pending_review`. CHECK forces basis + reviewer on `eligible`. Snapshot and claim both require eligible | `20260813120000_marketing_email_core.sql`, `20260813120100` |
| F02 | Erasure destroys objection evidence | `marketing_do_not_contact` (email + sha256 hash, reason, removal audit). Checked at import, snapshot and claim. Removal requires a note | core migration, rpcs, contacts service |
| F03 | Suppression fails open | New `getEmailSuppressionStatus()` returns `suppressed`/`clear`/`unavailable`. New `suppressionMode: 'fail_closed'` on `sendEmail`, used only by marketing; unavailable becomes a retry, not a send. Transactional behaviour unchanged | `src/lib/email/logging.ts`, `emailService.ts` |
| F04 | RPC and RLS over-permissive | `REVOKE ALL ... FROM PUBLIC, anon, authenticated` then `GRANT ... TO service_role` on every table and function. No `authenticated` SELECT policies at all: reads go through server actions that check RBAC first. `p_batch` validated and capped | both migrations |
| F05 | Frequency cap races across campaigns | `claim_marketing_recipients` locks the CONTACT row (`FOR UPDATE SKIP LOCKED`) and sets `marketing_reserved_until` before returning. Locking recipients could never have worked: two campaigns have two recipient rows for one contact | `20260813120100` |
| F06 | `sendEmail` cannot return the log row id | `EmailSendResult` gains `emailMessageId`. `recordEmailMessage` upserts on `resend_message_id` so a deduplicated retry maps to one row. Marketing writes `business_contact_id`, `marketing_campaign_id`, `marketing_recipient_id` onto `email_messages`. Webhook parks unmatched events instead of dropping them | `emailService.ts`, `logging.ts`, `20260813120200`, resend webhook |
| F07 | Retry semantics unsafe | `attempt_count`, `max_attempts`, `next_attempt_at`, `last_attempt_at`, `lease_expires_at`, `provider_message_id`, `failure_class`, plus a `needs_review` state. Recovery: a row with a log link is finished not resent; a stale row past 24 hours goes to a human because provider idempotency has expired; inside the window it retries with the same key | `20260813120100`, cron |
| F08 | Shared domain changes transactional email | Domain-level tracking not required or enabled. See decision above | config, plan |
| F09 | Footer states something untrue | `reason_for_contact` is now a slot, defaulting for B2B to "we contacted you in your business capacity". `privacy_notice_url` added. Both are additive: with the privacy URL omitted the block still reproduces the designer's file byte for byte, which the test proves | `blocks/footer.ts` |
| F10 | Tracking needs its own decision | Removed from the critical path by not enabling it. Clicks come from first-party short links | config |
| F11 | GET unsubscribe unsafe | GET now returns a confirmation page with a POST form; POST performs the action, so the RFC 8058 one-click header still works. Mail scanners that fetch every link no longer unsubscribe people | `api/unsubscribe/route.ts` |
| F12 | Token migration incomplete | Shared table kept, as recommended. Nullable `customer_id`, new `business_contact_id`, XOR CHECK, partial unique index, table comment updated, RPC re-declared. Verified against live data: the table has 0 rows, so the CHECK validates trivially | `20260813120200` |
| F13 | Promotion/cancellation not atomic | `promote_due_marketing_campaigns` promotes AND snapshots in one transaction; a zero-match audience completes immediately rather than hanging. `cancel_marketing_campaign` cancels and skips pending rows together, leaving claimed rows alone so an in-flight send is not lost | `20260813120100` |
| F14 | Pause guarantee imprecise | Guarantee stated and enforced: after a pause commits, at most the already-claimed batch can finish, because claiming re-reads campaign status inside the locking RPC | rpcs, cron |
| F15 | Batch 50 unjustified | Default lowered to 25, configurable in `marketing_settings`. Cron carries a 45-second deadline budget and releases unprocessed claims for the next run. Sends are sequential to stay inside the provider rate limit | settings, cron |
| F16 | Dedicated queue lacks queue features | Kept the dedicated queue, and adopted the lease/attempt/backoff/dead-letter mechanics from the existing `claim_jobs` pattern rather than only `SKIP LOCKED` | `20260813120100` |
| F17 | Audience semantics ambiguous | Defined: include tags match ANY, exclude tags remove on ANY, empty include means all eligible. `audience_version` and `approved_recipient_count` stored at schedule time. Snapshot happens at promotion, which only occurs when due AND inside the send window, so a campaign cannot snapshot days early | core migration, rpcs |
| F18 | Short-link API cannot do the job | Confirmed: `getOrCreateShortLinkVariantInternal` hard-codes `channel: 'meta_ads'`. Links are pre-provisioned per campaign into `link_map` and passed into the renderer, which stays pure. `marketing_email` added to the `link_type` CHECK | `20260813120200`, `render.ts` |
| F19 | Fidelity test contradicts transforms | Rendering split into a pure stage (`renderCampaignHtml`) and a delivery stage (`applyDeliveryTransforms`). Fidelity compares the pure stage; delivery changes are asserted as an allow-listed diff. Entity encoding made canonical, so a Unicode apostrophe reproduces `&rsquo;` exactly | `render.ts`, `escape.ts` |
| F20 | Manual extraction unproven | The extraction script now proves its hand-chosen boundaries TILE the campaign file: contiguous, gapless, and concatenating every slice reproduces the source byte for byte. Fixture hashes and offsets are recorded in a manifest | `scripts/one-off/extract-email-blocks.ts` |
| F21 | Block count inconsistent | Real count is 26 modules (14 campaign-derived, 12 library-derived), not 18. All are built and individually proven | `registry.ts` |
| F22 | Campaigns need versioning/immutability | `content_schema_version`, `renderer_version`, `content_hash`, `locked_at`. No invalid `{}` default. Only drafts are editable; scheduling freezes the campaign | core migration, campaigns service |
| F23 | Unsubscribe attribution wrong | The sender appends the recipient id to the unsubscribe URL; the route validates it belongs to this contact and was actually sent, and falls back to last-touch. A missing or bogus value never blocks the opt-out | cron, unsubscribe route |
| F24 | Stats undefined, indexes missing | Metrics defined by TIMESTAMP columns (`delivered_at IS NOT NULL`) not by final status, because the webhook promotes status through delivered/opened/clicked. Denominator documented. Indexes added for pending claims, stale leases, due campaigns and unsubscribe attribution | core migration, campaigns service |
| F25 | Wrong permission model | New `marketing` module with `view/create/edit/delete/send/export/manage`. `send` gates scheduling, resuming, retrying and test sends, and managers do not get it. `messages.send_marketing` stays meaning bulk SMS | `20260813120400`, `src/types/rbac.ts` |
| F26 | Webhook contact link too weak | Webhook follows `email_messages.business_contact_id` and only falls back to normalised email | `20260813120200`, resend webhook |
| F27 | No kill switch or monitoring | `marketing_settings.sends_enabled` ships OFF and is checked inside the claim RPC, so it cannot be bypassed by a code path. `MARKETING_SEND_ENABLED` is a deploy-level hard off. Cron returns structured counts | core migration, config, cron |
| F28 | Import incomplete | Normalisation, in-file dedupe, existing-contact and do-not-contact screening, per-row decisions recorded in `marketing_import_batches`/`_rows`. Full name kept verbatim rather than split lossily | contacts service |
| F29 | Missing integrity constraints | FKs on every actor and campaign reference, canonical lowercase email enforced by trigger and CHECK, length and JSON size bounds, status-to-timestamp consistency CHECKs | core migration |
| F30 | Env validation loose | `getMarketingConfig()` parses and bounds every value and reports what is missing; the cron refuses to run rather than sending with a broken configuration | `marketing/config.ts` |
| F31 | Broadcasts not evaluated | Evaluated and rejected, reasoning recorded below | this document |
| F32 | Tests cannot prove the risky behaviour | Honest split: what is proven and what is not is listed below | test suite |
| F33 | Plain text and accessibility | Every block emits a plain-text part and the sender sends it. Shell keeps `lang="en-GB"`, table roles and alt text | blocks, render |
| F34 | Em dash rule too broad | Left as is. It is the owner's standing instruction and enforced by a hook, so it is not mine to narrow | n/a |

## F31: why a custom sender rather than Resend Broadcasts

Broadcasts would mean a second contact store at the provider, a second unsubscribe state to reconcile with ours, and no way to enforce the eligibility and do-not-contact rules that F01 and F02 require before each send. The per-recipient state, frequency cap and audit trail all have to live in our database anyway. Byte-exact HTML control also matters more here than usual, since the whole design contract is byte fidelity. The cost is that we own the queue, which is why the lease, retry and reconciliation work in F07 was done properly rather than sketched.

## Two review claims that needed correcting

1. **F06, `requireLog`.** The review implies setting `requireLog: true` would fix the logging gap. It would not: that flag throws AFTER the provider has accepted the email, and every call site converts the throw into `{ success: false }`. A sender that retried on that signal would send a second copy. Instead `sendEmail` now returns `emailMessageId` explicitly, and "sent but not logged" is its own `needs_review` state that is never retried.
2. **F15, cron count.** The review says 47 entries, the plan said 38 (copied from a stale CLAUDE.md). 47 was correct; the marketing cron makes 48.

## A bug the review process did not find, and how it surfaced

Running the SQL against the real database, rather than only reading it, caught a genuine
defect. `promote_due_marketing_campaigns()` declared `RETURNS TABLE (campaign_id uuid, ...)`,
which creates a PL/pgSQL variable named `campaign_id`. The insert inside it references the
`marketing_campaign_recipients` column of the same name, and Postgres raised
"column reference campaign_id is ambiguous" in the `ON CONFLICT` clause.

Nothing catches this earlier. `CREATE FUNCTION` accepts the body without resolving it, so the
migration applied cleanly and the function existed and looked correct. It would have thrown on
the first real campaign promotion. Fixed by renaming the output columns
(`20260813120300_marketing_email_rpc_fix.sql`).

The lifecycle was then exercised end to end in rolled-back transactions against production,
which confirmed:

- A five-contact audience promoted to exactly the two it should: the unreviewed contact, the
  objector and the wrong-tag contact were all excluded at snapshot.
- Claiming skipped the frequency-capped contact with `skip_reason = 'frequency_cap'` and left
  it unreserved, while claiming the eligible one and reserving its contact row.
- With the kill switch off, an open window and a ready recipient, claiming returned zero.
- Privilege check: `anon` and `authenticated` hold no table privileges and no EXECUTE on any of
  the new functions.

All probes rolled back; production holds zero contacts, zero campaigns and the kill switch off.

## What the tests prove, and what they do not

Proven in CI: every block reproduces its fixture byte for byte; the whole Christmas campaign reproduces the designer's 21KB file byte for byte through the composer; delivery transforms are an allow-listed diff; escaping and URL validation; content validation and linting; send-failure classification.

NOT proven in CI, because this repository mocks Supabase and has no integration database: PostgreSQL row locking and `SKIP LOCKED`, the cross-campaign frequency race, RLS and grant enforcement, and crash-and-restart behaviour around the provider call. These are the review's F32 point and it stands. The logic lives in SQL specifically so it is enforced by the database rather than by application code, and the queue is small enough (160 contacts) that the first real campaign is itself a safe test, but this is a genuine gap rather than a solved problem. A staging database with two connections is what would close it.
