# PayPal webhook verification: developer review

Date: 23 September 2026. Review only. Original specification and implementation unchanged.

## Executive assessment

**Specification readiness: Ready with specified conditions.** The proposed direction addresses two verified causes of rejection: an excessively short transmission window and inconsistent webhook ID selection. Implementing it literally would not yet provide reliable payment recovery. Correct the replay-retention assumption, protect replacement orders from delayed denials, and address or explicitly separate the refund recovery defect before enabling the affected paths.

**Production readiness: not established.** No change was implemented or deployed, no payment or refund was initiated, and no live webhook was replayed. Existing tests passing is not evidence that the proposed behaviour works.

The most consequential findings are:

1. Invoice event retention becomes 24 hours after successful processing, despite the claimed 30 days. A four-day acceptance window must not rely on that claim.
2. A delayed private-booking denial can clear a newer payment order. The specification excludes business handlers, but accepting older messages changes their operating conditions.
3. A refund can be marked completed before its booking update fails. A retry then skips that unfinished update.
4. The proposed health check misses post-verification failures and could report quiet when its own checks or email delivery failed.
5. Diagnostics need an explicit contract for lookup outages, invalid payloads and unavailable fields. Changing the shared verifier must preserve the excluded legacy caller's rejection behaviour.

There is no P0 finding. These issues justify narrow corrections and release gates, not a payment-platform redesign.

## Purpose, scope and evidence

The business outcome is that genuine PayPal payment events reach the correct records despite delayed delivery, and staff can detect and recover failures. Customers should not have to pay again because an asynchronous update failed. Managers and finance staff need accurate deposit, invoice and refund state. Developers and the owner need actionable diagnostics and a credible release proof.

This is a pre-implementation specification review supporting scope and acceptance decisions. The proposed work changes verification, ID resolution, logging, monitoring and configuration. Deposit policy, Stripe and normal payment processing are intended to remain unchanged. Their callers and downstream records still form part of the impact boundary.

### Materials actually checked

| Evidence | Version and extent |
|---|---|
| Supplied specification and review brief | Both pasted attachments, dated 23 September 2026 for the specification |
| Management app code | Local HEAD `e01d0d1fe3bef3db1c7bfcca7032685c7877e929`; local `origin/main` reference `981541da2c094ad525bc3e66a4d89e1df062828a`. Reviewed PayPal helper, six webhook routes, idempotency, refund helper, private deposit finalisation, relevant reconciliation, cron auth/alerting, environment documentation and schedule. Compared the material verifier/handler/refund/idempotency files against that main reference: no differences |
| Shared standards | Workspace and project CLAUDE.md, database rules and lessons. Existing communication suspension and cron alerting standards already cover important operational safeguards |
| Live database | Read-only schema/constraint queries and aggregate PayPal log queries on `tfcasgxopxegwrabvwat`, 23 September. No customer payload export |
| Live PayPal registry | OAuth authentication followed by GET of registered webhooks using this project's configured live app credentials. No registration or event mutation |
| Existing tests executed | Node 20.19.5: `npx vitest run tests/lib/paypalWebhookVerification.test.ts tests/api/paypalWebhookVerifiedUrl.test.ts tests/api/invoicePayPalWebhook.test.ts tests/api/paypalGeneralWebhookIdempotency.test.ts`. Result: **4 files, 22 tests passed** |
| Website dependency | Read-only search identified table/event booking and parking payment proxy routes in the paired website. Full website/browser journeys were not executed |
| Supplier contract | Official [PayPal webhook overview](https://developer.paypal.com/api/rest/webhooks/) and [simulator documentation](https://developer.paypal.com/api/rest/webhooks/simulator/), accessed 23 September |

Live evidence confirms 1,664 `signature_failed` private-booking rows, from 26 March to 22 September, and no recorded private-booking success. The 24 private-booking attempts dated 22 September all retain transmission time `2026-09-21T09:44:07Z`. This corroborates the stale timestamp problem for those retries, without establishing that every possible PayPal redelivery uses identical timestamp semantics.

Live registration matches the supplied three IDs and URLs: invoices, private bookings and table bookings. Parking, event bookings and the legacy URL are absent from this app's current registry. Registrations belong to a PayPal app, not simply the merchant account.

The live log table uses `processed_at`, not `created_at`; status is unconstrained text and `error_details` is JSONB. Its only table constraint returned was its primary key. The proposed status changes do not themselves require a schema migration.

Limitations: no deployed commit/deployment ID was independently identified; main was not fetched; production Vercel environment values and the claimed scheduled follow-up were not inspected. The nine-deposit/no-money-lost claim was not independently reconciled against provider settlement records. Describe it as the specification's sampled capture evidence, not a blanket assurance. No full build, full suite, browser journey or fault-injected runtime experiment was performed. Code findings below are verified control-flow observations, not claims of reproduced production incidents.

## Wider impact and dependency map

| Input or dependency | Changed behaviour | Downstream effect and invariant |
|---|---|---|
| PayPal app, environment, URL and subscriptions | Registry-first resolution and new registrations | Correct endpoint identity required. Do not infer identity from an untrusted Host header or mix live and sandbox credentials |
| Headers, JSON and verification API | Older messages admitted; errors distinguished | No payment mutation before explicit signature success; malformed input must remain rejected |
| Event ID, payload hash and idempotency rows | Retries can now reach handlers | Same event must not repeat business effects; different lifecycle events still need ordering guards |
| Browser capture and reconciliation jobs | Compete with newly functioning webhooks | Record each capture once; preserve amounts, currency, booking rules and existing communications guards |
| Private booking amendments, replacement orders and cancellations | Older captures/denials arrive against newer records | A stale event must not erase a newer order or reinstate a cancelled booking |
| Refund records and booking summaries | Previously rejected refunds can run | Refund ledger and visible refund status must converge after partial failure |
| Staff screens, invoice balances, guest confirmations and website payment flows | Consume changed records and notifications | No duplicate charge, contradictory confirmation, or silent paid-but-unrecorded exception |
| Logs, cron schedule and email provider | New health summary | Distinguish healthy, unhealthy and unable-to-check; alerting must respect suspension switches |
| Legacy webhook endpoint | Shares the changed verifier | Remains protected even though it has no current registration |

The website requires compatibility checks, not a presumed code change. No new public page, navigation, metadata, search, accessibility or consent feature is proposed. Staff usability here means clear error categories, accurate records and actionable alerts.

## Findings

Priority: P1 is a material correction at the stated gate; P2 is a meaningful issue to resolve or explicitly accept; P3 is optional. Certainty is stated separately.

### R01. Invoice replay retention contradicts C1

**P1 | Required correction | Data integrity and security | Confirmed code/specification conflict.** Resolve before enabling the four-day window for invoices. Owner: implementing developer.

`src/app/api/webhooks/paypal/invoices/route.ts:255` persists an idempotency response without a TTL. `src/lib/api/idempotency.ts:292` defaults that operation to 24 hours and overwrites `expires_at`. The initial 30-day claim does not preserve 30-day retention after success.

A valid event replayed after 48 hours can therefore re-enter invoice handling. This does not prove a duplicate payment: the invoice settlement path has separate capture-level protection. It does invalidate C1's central replay argument and can repeat other processing or audit effects.

**Smallest action:** pass the existing 30-day constant on invoice response persistence and test expiry at both claim and completion. Preserve existing atomic claims and stale-processing recovery; they already exist.

**Proposed wording:** "Every endpoint retains successfully processed event IDs for 30 days, including when the final response is persisted. A repeat delivery at 48 hours produces a duplicate acknowledgement without re-running business handling."

### R02. Delayed denial can erase a replacement private-booking order

**P1 | Required correction | Payment journey and ordering | Confirmed code path; occurrence not established.** Resolve before releasing delayed private-booking processing. Owner: payments developer.

`src/app/api/webhooks/paypal/private-bookings/route.ts:431` clears `paypal_deposit_order_id` by booking ID and unpaid state only. Example: order A is denied, staff issue B, then A's delayed denial arrives. B is cleared, disrupting the replacement checkout and its recovery lookup. Event-ID deduplication does not protect distinct A and B events.

**Smallest action:** require a matching current order ID before clearing it. The invoice handler already uses that guard at `invoices/route.ts:224`. A denial with no usable order identity should produce a diagnostic/manual-review outcome rather than clear an arbitrary current order.

**Verification:** A's delayed denial leaves B intact; B's denial clears B once; an already paid booking remains paid. This is a targeted exception to the "no handler behaviour change" boundary, not an invitation to alter deposit policy.

### R03. Refund retry can acknowledge an incomplete update

**P1 | Required correction or separately gated repair | Refund integrity and recovery | Confirmed code path; not reproduced live.** Resolve before claiming reliable refund recovery. Owner: payments developer, with owner agreement on scope separation.

`src/lib/paypal-refund-webhook.ts:144` returns immediately for an already completed refund. Lines 154 onwards first complete the refund row, then update its booking. If that second step fails, retry sees a completed refund and skips repair. Dashboard-created refunds have the same ordering at line 262 onwards.

Staff can see an incorrect refund summary even after a successful retry acknowledgement. Widening verification does not repair this. The helper is outside the proposed file list but directly supplies the advertised refund outcome.

**Smallest action:** make completed-refund processing converge the source booking's refund state, including the table-booking and parking derived fields already handled by the helper. Preserve total-of-completed-refunds semantics for partial refunds. Avoid issuing another provider refund during repair.

**Verification:** inject a failure after the refund row commits and before the booking update, retry the same event, and assert one refund row plus correct booking status. Exercise simultaneous delivery to subscribed refund routes, full/partial refunds and a later pending event after completion. A separate repair is acceptable only if this release is explicitly described as transport repair, with the refund limitation tracked and owned.

### R04. Diagnostic outcomes need a complete, compatible contract

**P1 | Required correction | API security and observability | Confirmed omissions; conditional compatibility risk.** Resolve before choosing the helper API. Owner: implementing developer.

C2 cannot always record an ID "used": missing headers should be rejected before resolution, and configuration failure has no ID. Invalid dates, future dates, malformed JSON and malformed PayPal responses have no specified classification. The verifier currently parses JSON before the routes' invalid-payload handling (`src/lib/paypal.ts:560`), so malformed JSON can emerge as a generic processing error.

The excluded legacy route calls the same boolean verifier at `src/app/api/webhooks/paypal/route.ts:118`. If the implementation changes its result to an object and leaves that caller's `!isValid` check, a failure object would be truthy. This is a foreseeable implementation trap, not a verified present authentication bypass.

**Smallest action:** define a discriminated diagnostic result with explicit success, or retain a boolean wrapper for the legacy caller. Specify validation order and nullable diagnostics. Separate malformed input, explicit remote `FAILURE`, upstream HTTP/transport errors and unexpected verification responses. Accept only explicit remote `SUCCESS`.

**Proposed wording:** "Record the selected webhook ID and source when available, otherwise null with the resolution state. Reject missing/invalid input before remote calls. Unexpected or unavailable remote verification never authorises processing. Preserve rejection behaviour in every shared-helper consumer."

**Verification:** all five route mappings plus legacy rejection; malformed JSON and date; missing headers with unavailable configuration; remote 401/429/500, timeout and malformed 200 response; no mutation on any non-success result.

### R05. Resolution conflates a missing registration with an outage

**P2 | Required clarification | Reliability and configuration | Confirmed helper behaviour.** Resolve before implementing C3 diagnostics. Owner: developer.

`src/lib/paypal.ts:624` returns null for both successful lookup with no match and failed lookup with no cache. It can also return an expired cached ID on errors. C3 would label these alike or use an environment fallback without recording the real cause. "Resolved or env" is insufficient to diagnose stale cache use.

**Smallest action:** preserve the lookup outcome and cache provenance. Keep the same endpoint's fallback, but never call a failed lookup proof of no registration. Use configured app URL and environment. Define ID rotation and negative-cache behaviour. An environment fallback cannot override a positively resolved ID, so documentation should call it a fallback, not an override.

Fetches in the token, registry and verification paths have no explicit timeout. Add a bounded verification-path deadline within the deployed function budget so a hanging dependency can produce the promised diagnostic and 500. Choose the value against deployment limits; this review does not invent a latency target.

**Verification:** cold/warm cache, expiry, missing registration, API outage, recreated ID, correct/stale/empty own fallback, other-endpoint fallback prohibited, live/sandbox separation and hanging HTTP requests. No new dependency or queue is needed.

### R06. Health must include processing failures and its own failures

**P1 | Required correction | Operations and recovery | Confirmed specification omission.** Resolve before accepting C4 as protection against a dead webhook. Owners: developer and operational responder.

C4 counts only the new verification categories. A valid event that then fails deposit finalisation or refund processing logs `error`, outside that list. `idempotency_persist_failed` and unresolved processing also matter. These can leave a registered, cryptographically valid endpoint operationally ineffective.

`src/lib/cron/alerting.ts:54` already provides a reusable alert helper, but it returns without email when the recipient is unset and logs failures without throwing. A failed PayPal list or database count must not become an empty healthy result. A suppressed alert must not be described as delivered.

**Smallest action:** return an explicit healthy/unhealthy/unknown result; include processing failures and legacy `signature_failed` during transition; aggregate attempts by source/status while distinguishing repeated attempts from unique events where identity exists. Include actionable identifiers and counts, not guest payloads. Surface lookup/count/send failures in cron output and logs, respecting all communication kill switches. Verify the configured responder and normal alert delivery before relying on email.

**Verification:** healthy and quiet; failure observed; provider list unavailable; database unavailable; recipient absent; send rejected or suspended; processing error after valid signature. Daily detection is reasonable here if the owner accepts that delay. A successful daily check does not prove traffic delivery when no relevant event occurred.

### R07. Registration and scheduling instructions are incomplete

**P2 | Required correction | Integration and delivery | Confirmed omissions.** Resolve before registration/monitor release, without blocking helper development. Owners: developer prepares the matrix; owner authorises live configuration.

C4 does not define the required event set per endpoint. Actual handlers differ: table bookings do not handle `PAYMENT.CAPTURE.DENIED`; invoices do; private/parking support refund pending/failed; event bookings support a different refund lifecycle set. The current private registration lacks some lifecycle events its handler recognises. Confirm supplier-supported event names rather than subscribing to every string found in code.

**Smallest action:** one reviewed endpoint/event matrix shared by health checks and dashboard instructions, including handling of wildcard subscriptions. An unknown URL should be reported for review, never automatically deleted. Add `vercel.json` to scope and verify the deployed daily schedule; creating a route does not schedule it.

C5's "four" variables can mean four additions to the existing table-booking variable, but document all five mappings. `.env.example:99` currently claims fallback to `PAYPAL_WEBHOOK_ID`, contradicting C3. Correct that text and explain fallback behaviour consistently.

**Verification:** missing endpoint, missing required event, wildcard, unknown URL, correct app/environment and deployed cron authentication/schedule. Newly registering endpoints can immediately activate processing and customer communications, so do it only after the relevant regression checks and explicit owner approval.

### R08. Existing tests do not prove the proposed boundary

**P1 | Required correction | Testing and security | Confirmed test gap.** Resolve in implementation acceptance. Owner: developer.

The table-booking route suite mocks the verifier. Returning true from that mock for a 48-hour message does not test C1. The real helper suite, `tests/lib/paypalWebhookVerification.test.ts:36`, currently expects a six-minute message to fail. Existing URL tests also deliberately expect private bookings to reject absent registration despite configured IDs, conflicting with C3's newly introduced fallback.

**Smallest action:** extend real-helper tests with mocked HTTP, then parameterise routing/error/logging contracts across all five endpoints. Deliberately update conflicting assertions. Retain tests of the legacy caller and downstream idempotency/recovery. Cover exactly four days, either side, invalid dates and future skew; do not simply widen the current absolute-value check to accept four-day future timestamps without a decision. Recommended policy: separate past retry age from small future clock-skew tolerance.

Run the specified quality gates and existing London/UTC date conventions. Full gates before each of three prescribed commits are a delivery convention, not product behaviour; no new end-to-end framework is necessary.

### R09. Live proof and historical recovery need separate closure criteria

**P2 | Required release clarification | Finance and operations | Confirmed omission plus supplier correction.** Resolve before release sign-off. Owners: owner/finance and release developer.

PayPal retries any non-2xx response, including 400 and 401, up to 25 attempts over three days. The proposed 500 distinguishes unavailability correctly, but does not uniquely enable retries. Correct the "silently dropped" rationale. Manual resending is available through PayPal, so absence of a stored signature prevents local reconstruction, not every provider-assisted resend. [PayPal overview](https://developer.paypal.com/api/rest/webhooks/).

The simulator cannot be verified by the remote verify-signature API and is unsuitable as proof of this implementation. Use real app-generated sandbox transactions for integration proof. [PayPal simulator](https://developer.paypal.com/api/rest/webhooks/simulator/).

A single `received`/`success` pair proves only that one event path. It may represent an already-recorded capture or an unhandled event. Require a matching private-booking event ID, explicit verification evidence and the expected record outcome. Fresh delivery remains useful but does not prove delayed retries, denials or refunds.

The fix cannot recover six months of exhausted deliveries automatically. The specification's nine captures do not establish the absence of historic refund/denial discrepancies. First perform a bounded read-only comparison of affected provider events and app records; any resend, refund or record repair needs separate explicit approval. No blanket backfill is recommended.

**Verification:** record deployment ID, exact eligible event and disposition, record state and absence of duplicate effects. Keep unmatched, old and cancelled-booking events visible for staff resolution. Code rollback cannot undo booking mutations, audit entries, emails or SMS already emitted.

### R10. Log absence is not delivery evidence, and new logging needs minimisation

**P2 | Required correction | Evidence and privacy | Confirmed code/specification mismatch.** Resolve in C2 design and report wording. Owner: developer.

`src/app/api/webhooks/paypal/event-bookings/route.ts` has no `webhook_logs` writer. Its missing source cannot prove it never received a delivery. Current missing registration is independently verified and sufficient to justify registration work. The invoice route also lacks an equivalent terminal success log, so success criteria cannot assume uniform existing logging.

Add consistent source, event identity where safely parsed, verification result and terminal processing outcome across routes. Retain signature-presence-only logging. Do not automatically copy full request body storage into the event route: that would add a new location for potential personal data, which shared standards require the owner to approve. Minimal diagnostic metadata is sufficient for this change.

**Verification:** event and invoice outcomes are visible; logging failures have a server-log fallback; secrets, signatures and guest details are absent from new diagnostics and alert email. Existing retention policy was not assessed, and a log-retention redesign is not required for this fix.

## Critical scenarios and acceptance additions

| Scenario | Required observation or proposed expectation | Covers |
|---|---|---|
| Correct signature, fresh or 48-hour transmission | Real verifier accepts and the intended route processes once | C1, C2, R08 |
| Four-day boundary; future/malformed date | Explicit past-age and future-skew policy; invalid dates do not become remote failures | R04, R08 |
| Missing header plus unavailable registry | Local input error wins without an unnecessary provider request | R04, R05 |
| Stale env ID with successful resolution | Registered endpoint ID selected; diagnostics prove provenance | C3 |
| Verification FAILURE, HTTP error or malformed response | Explicit rejection versus unavailability, no business writes | R04 |
| Same invoice event after 48 hours | Duplicate acknowledgement, unchanged ledger and side effects | R01 |
| Browser capture, cron and webhook overlap | One capture recorded, no duplicate confirmation; active claims remain retriable | R01, R08 |
| Old denial after replacement checkout | Replacement order retained; paid state never downgraded | R02 |
| Refund write succeeds, booking write fails, retry follows | Booking converges with one refund record; no new provider refund | R03 |
| Different refund routes process one app event concurrently | Cross-route duplicate handling converges; no duplicate refund record | R03 |
| Capture arrives after cancellation, completion or amount amendment | No automatic resurrection or silent acknowledgement of missing money; surfaced exception | R06, R09 |
| Post-verification failure or missing outcome | Health report flags it, rather than treating valid signatures as success | R06, R10 |
| Wrong app/environment, unknown URL, absent event subscription | Actionable configuration report; no auto-registration or deletion | R07 |
| Health dependencies unavailable or email suspended | Unknown/unhealthy result and visible failure, no claimed email delivery | R06 |
| Real sandbox capture/refund and approved live proof | Verify both transport evidence and actual record outcome | R09 |

The private deposit finaliser checks cancelled/completed state and current amount before its already-recorded return (`src/services/private-bookings/payments.ts:441`). Delayed captures can therefore legitimately need manual review after amendments or cancellation. Preserve those business protections; do not weaken them merely to obtain a success log. Distinguish payment receipt, booking confirmation and contract state.

Existing records retain existing business rules. Recently pending events need concurrency/ordering coverage. Exhausted historical deliveries need the separate reconciliation decision. Future bookings remain subject to unchanged deposit thresholds and waivers. A rollback changes future handling only.

## Decisions and ownership

These are implementation/release decisions, not permission to mutate production. No user answer is needed to complete this review.

| Decision to record | Recommendation and trade-off | Owner and gate |
|---|---|---|
| Boundary for the denial and refund corrections | Include the small guards/repair in separately reviewable changes. If refund repair is deferred, limit the release claim and retain an owned manual exception process | Owner and developer, before affected release |
| Future timestamp policy and unavailable diagnostic fields | Keep a short separate future-skew allowance; use null plus cause when an ID/status cannot exist | Developer, before helper implementation |
| Required subscriptions and fallback mappings | Use the reviewed per-endpoint matrix and documented same-endpoint fallbacks, with no generic fallback | Developer prepares, owner approves live registrations |
| Daily alert response and historical review | Name the recipient/responder; begin with read-only discrepancy checks rather than automatic replay | Owner/finance, before operational sign-off |
| Live proof and manual resend | Prefer naturally arriving eligible event; authorise a specific resend only after assessing current booking state | Owner and release developer, after deployment |

## Simplification and optional improvements

Reuse existing cron authentication, email alerting, idempotency claims and log schema. Keep verification and resolution diagnostics in small shared helpers while leaving domain handlers separate. One aggregate daily alert is adequate; no dashboard, queue, new table or supplier is justified by this review.

**P3 optional O01:** coalesce concurrent cache-miss registry requests within a process if observed traffic makes repeated lookups material. Current evidence does not justify a distributed cache or load-testing project. Provider and database request counts will rise when new listeners are registered; PayPal sends subscribed app events to each listener, so domain filtering and lightweight rejection should remain intact.

Prescribing three commits is not essential to the outcome. A cohesive verifier/resolver change and a separate monitoring/configuration change are reasonable, with the narrow handler safeguards independently reviewable. Do not delay the transport diagnosis work while waiting for unrelated historical finance decisions.

## Coverage and final challenge

| Area | Review outcome |
|---|---|
| Product and staff/customer journeys | Accurate payment state and visible exceptions assessed; ordering/recovery findings above |
| UX/content/accessibility | No new UI. Alert clarity and staff recovery matter; no material navigation, responsive, keyboard or SEO change identified |
| Data/lifecycle/concurrency | Existing/new/historical events, partial refunds, retries, replacements and cancellation assessed by code; runtime fault injection remains required |
| Security/privacy | Signature trust boundary, shared callers, replay duration, environment identity and diagnostic minimisation reviewed; no security certification |
| Integration/reliability/performance | Registry dependence, cache, timeout, fan-out and provider retry contract assessed; production latency/load not measured |
| Observability/operations | Log coverage, processing failures, scheduling and alert failures reviewed; production alert delivery and responder unverified |
| Delivery | Configuration sequencing, owner approvals, compatibility, rollback limits and live proof assessed |
| Financial audit | Sample capture claim not independently reconciled; historical discrepancy review remains separate |
| AI, licensing, exports, search, training programme | No material feature-specific requirement identified; unrelated redesign excluded |

Final challenge: a competent developer could implement every listed change and still leave staff with a stale refund summary, erase a replacement payment order, and receive no health warning because signatures now pass. R02, R03 and R06 close those specific gaps. A valid-signature fixture and a green build alone would miss them.

Proceed with diagnostic contracts, helper tests and monitor preparation. Before affected release, resolve R01-R04 and R06-R08, record R05/R09/R10 details, run the expanded acceptance checks, then obtain the existing required authorisation for live deployment/configuration and any historical mutations. No schema migration is proposed or pending from this review.

**Done** - Separate developer review delivered, local only. Only this report was created; the supplied specification, implementation, configuration and existing task files were deliberately left unchanged.

**Next:** Incorporate the stated corrections into the implementation brief, then implement and verify under separate authorisation.
