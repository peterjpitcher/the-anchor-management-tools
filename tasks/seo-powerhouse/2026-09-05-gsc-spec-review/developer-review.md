# Developer review: GSC indexing triage specification

**Assessment: not ready to implement unchanged.** The discovery note identifies real, bounded repairs, but contains two incorrect technical claims, conflicting scope and counts, and no complete release or acceptance contract. Correct these before turning it into implementation tickets. The verified event URL repairs can proceed independently of broader content strategy once their exact scope is approved.

**Review date:** 5 September 2026. **Status:** local report only. Original document unchanged. No application changes, database writes, GSC changes, deployments, bookings or messages.

## Scope and evidence

This reviews the supplied document, “GSC Why pages aren't indexed triage, 5 September 2026”, from technical and delivery perspectives. Section references below refer to that document. This is a specification review, not a replacement specification or a new site-wide SEO strategy.

The useful parts should remain: deliberate exclusions do not automatically need repair; existing redirect infrastructure should be reused; inaccurate event copy belongs at its source; and broader content decisions should be separate from immediate repairs.

Independent evidence collected for this review:

- Fetched the live sitemap and all 200 listed URLs. Each returned 200, one self-referencing canonical, and no blocking robots meta or `X-Robots-Tag` directive.
- Checked 214 distinct page/resource URLs in total, excluding the sitemap request. These include the named event failures, destinations, tag archives, stale sitemap and representative landmark page. Requests ran on 5 September 2026, 17:10:43 to 17:10:56 British Summer Time, with redirects unfollowed and at most five concurrent requests.
- Read website source at remote main commit `c3ba7d537ce247404c287c7ea1d44a51825970e2`. `git ls-remote` confirmed that this was current remote main. The local website checkout was 11 commits behind and had unrelated changes, so it was not used as the implementation baseline.
- Checked current Google documentation for indexing, canonicalisation, robots directives and sitemaps.

Evidence files: [HTTP results](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/seo-powerhouse/2026-09-05-gsc-spec-review/evidence/http-checks.json), [sitemap snapshot](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/seo-powerhouse/2026-09-05-gsc-spec-review/evidence/sitemap.xml), [quiz HTML snapshot](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/seo-powerhouse/2026-09-05-gsc-spec-review/evidence/quiz-page.html), [robots snapshot](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/seo-powerhouse/2026-09-05-gsc-spec-review/evidence/robots.txt), and [review metadata](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/seo-powerhouse/2026-09-05-gsc-spec-review/evidence/review-metadata.json). The original attachment SHA-256 is `7b40df80185b9294cabe069e87e1b312ae1d6b20955595bf80449099222e774e`.

**Limits:** the authenticated GSC console, its exports and historical validation logs were not independently inspected. The review does not verify the 631/204 GSC headline, past indexed status, impressions, clicks, bookings lost, the live database field values, or the full history of event renames. HTTP evidence is initial server HTML, not a browser accessibility or booking-flow test. No application tests, build, Googlebot logs or deployment logs were run or inspected. The website's production deployment ID and its correspondence to remote main remain unverified. An `x-vercel-id` request identifier in the evidence is not a deployment ID.

## Priorities and classification

- **P1:** resolve before executing the affected change; customer impact or a material delivery risk.
- **P2:** required clarification or correction before accepting the hand-off or closing the affected ticket.
- **P3:** optional improvement or separately scoped follow-up, not an immediate release blocker.

“Confirmed” means supported by the supplied text, current source or the captured live response. A confirmed omission is a gap in this specification, not proof that the live system lacks the capability. Hypotheses and optional improvements are explicitly labelled.

| ID | Priority | Type | Classification | Finding |
|---|---|---|---|---|
| F01 | P2 | Technical accuracy | Confirmed | Existing tag tests already exercise page metadata |
| F02 | P1 | Evidence and content | Confirmed discrepancy | The alleged dietary claim is an allowed navigation URL in the inspected HTML |
| F03 | P1 | Functional detail, data and accessibility | Confirmed omission | The event correction lacks a field-level change set |
| F04 | P1 | Scope and routing | Confirmed contradiction | Four redirects are requested, but five are described |
| F05 | P2 | Evidence quality | Confirmed | Counts and validation statements do not reconcile |
| F06 | P2 | Evidence and reproducibility | Confirmed limitation | Examples and a sitemap do not establish complete site coverage |
| F07 | P2 | SEO diagnosis | Unconfirmed assumptions | Several bucket verdicts infer causes that were not demonstrated |
| F08 | P2 | Acceptance criteria | Confirmed wording defect | Indexing on the next crawl is promised without control over it |
| F09 | P1 | Integration and caching | Confirmed omission | Saving the record is not the same as refreshing every public surface |
| F10 | P1 | Testing and user journeys | Confirmed omission | The release has no executable acceptance contract |
| F11 | P1 | Delivery and deployment | Confirmed omission | Three systems have no assigned release ownership |
| F12 | P2 | Policy and edge cases | Confirmed ambiguity | Tag policy is both prescribed and left undecided |
| F13 | P2 | Dependencies and error handling | Confirmed | The cited lifecycle policy contains superseded rules |
| F14 | P2 | GSC operations | Confirmed omission | Stale sitemap removal and validation need precise boundaries |
| F15 | P2 | Monitoring | Confirmed omission | There is no closure evidence or follow-up owner |
| F16 | P3 | Asset handling | Optional clarification | Image resources are conflated with unwanted web pages |
| F17 | P3 | Architecture and performance | Optional improvement | A build-only rename guard has known blind spots |
| F18 | P3 | Delivery simplification | Optional improvement | Separate small repairs from content and automation projects |

## Findings

### F01. The existing tag tests already exercise page metadata

**Priority/type/status:** P2, technical accuracy, confirmed. **Relevant section:** §3.4.

**Description:** The statement that the test proves nothing about production behaviour is incorrect. At the reviewed commit, `tests/seo-indexing.test.ts:599-606` checks the helper, calls the actual route's `generateMetadata()`, asserts `{ index: false, follow: true }`, and checks sitemap exclusion for the four broad tags. Deleting the page's robots rule outright would conflict with those assertions.

**Rationale and impact:** The real gap is that tags outside that set are not covered by this test. Misdescribing it risks deleting useful checks and overstates the benefit of the proposed work.

**Recommended action:** Preserve the existing page-metadata and sitemap assertions; extend coverage to valid tags outside the old set. Removing the unused production helper is reasonable after a whole-repository reference check. Keep normalisation coverage and correct the stale policy documentation that also references the helper.

**Open questions:** None. This conclusion comes from source inspection; the test suite was not executed during this review.

### F02. The alleged dietary claim is not supported by the inspected page

**Priority/type/status:** P1, evidence and content accuracy, confirmed discrepancy. **Relevant section:** §3.2.

**Description:** The captured page contains 18 raw matches for “accessible toilet”, but only two matches in extracted visible text. Both visible instances assert the facility exists. The only `gluten-free` match in the captured HTML is the navigation link `/food-menu/gluten-free`; its visible label is “NGCI options”. No visible dietary claim matching the specification was found.

**Rationale and impact:** Raw HTML includes repeated structured and serialised content. Counting all matches as separate editorial defects exaggerates the change. More seriously, the website SSOT expressly retains that dietary URL. Removing or renaming it would damage a valid link while leaving the actual accessibility problem unresolved.

**Recommended action:** Attribute every claimed defect to its actual field and rendered surface. Correct the confirmed accessibility assertions. Do not include the dietary link in the edit. If a stored event field contains a separate dietary assertion, capture that field as evidence before including it. The current source's prose matcher reads selected event fields, not the whole rendered navigation.

**Open questions:** None for the owner at review stage. Verification of the stored fields remains developer work before preparing the change set.

### F03. The event correction needs a complete, narrowly scoped change set

**Priority/type/status:** P1, functional detail, data and accessibility, confirmed omission. **Relevant section:** §3.2.

**Description:** “Correct the event copy” supplies no stable record ID, affected field list, before/after text or save-and-verify procedure. The live accessibility claim occurs in both descriptive copy and another visible response. Correcting one field could leave another assertion visible. Noindex does not prevent direct visitors from relying on the false facility information.

**Rationale and impact:** This is a customer access problem as well as an SEO problem. The website source scans `name`, `description`, `shortDescription`, `longDescription`, `about` and `highlights`; it treats `accessibility_notes` separately. FAQs, metadata and other displayed fields also need editorial inspection even where they do not trigger that matcher.

**Recommended action:** Resolve the record by stable ID, map each public assertion back to its source, and prepare approved SSOT-based replacements with a before-state snapshot. Preserve the event's slug, date, capacity, prices and booking settings. Use the existing authorised edit path and verify its result and audit record. Check for concurrent edits before saving. Do not assume that a truthful negative sentence will clear the prose matcher: unlike the accessibility-notes helper, `getBannedClaims()` does not handle negation. Keep an accurate access statement in a supported field and verify the resulting page.

**Open questions:** No new owner policy question is needed to identify false accessibility assertions. The exact live edit requires a concrete change set and explicit approval, which this review does not request or grant.

### F04. Four redirect entries and five described redirects are different scopes

**Priority/type/status:** P1, scope and routing, confirmed contradiction. **Relevant sections:** §1 and §3.1.

**Description:** The instruction says to add four entries, then also directs the July URL to the hub. Four same-event replacements are verified; July is a separate retirement decision. Both July slugs return 404, but that alone does not establish the event's deletion history or the best replacement.

**Rationale and impact:** A developer cannot know whether success means four or five redirect rules. The July decision should not delay the four clear repairs or be silently omitted.

**Recommended action:** Use this explicit routing schedule, with July's proposed outcome distinguished from the verified equivalents:

| Source | Proposed destination | Evidence and treatment |
|---|---|---|
| `/events/bingo-2026-11-18` | `/events/cash-bingo-2026-11-18` | 404 to 200, same dated event replacement |
| `/events/bingo-2026-09-30` | `/events/cash-bingo-2026-09-30` | 404 to 200, same dated event replacement |
| `/events/bingo-2026-09-02` | `/events/cash-bingo-2026-09-02` | 404 to 200, historical replacement |
| `/events/bingo-2026-05-20` | `/events/cash-bingo-2026-05-20` | 404 to 200, historical replacement |
| `/events/bingo-2026-07-29` | `/cash-bingo` | Proposed by the original; validate topical usefulness and record the disposition |

Require a 301 with the expected Location. Concrete rules run through middleware; a JSON edit alone is not end-to-end proof. Keep query attribution and host normalisation consistent with existing behaviour. Do not create an extra redirect for the nonexistent new July slug without evidence that it was actually published. Google recommends a clear replacement for moved content; irrelevant destinations can be treated as soft 404s. [Google site-move guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes).

**Open questions:** Owner decision D1 is raised in the accompanying chat. The four direct mappings are technically clear; their implementation remains outside this review.

### F05. The numerical summaries and validation descriptions conflict

**Priority/type/status:** P2, evidence quality, confirmed. **Relevant sections:** §1, §2 and §4.

**Description:** The ten reason counts do sum to 631. Several supporting totals do not:

- The asset components are `143 + 52 + 6 = 201`, not 195.
- `266 - 200 = 66`, not approximately 54; the subsequent categories total `23 + 20 + 11 + 3 = 57`.
- “The other 13” 404s explicitly accounts for only 11 individual URLs. July could explain one more, but that allocation is not stated.
- “Every bucket” shows Failed conflicts with Discovered showing Passed and Redirect error having passed.
- “Five items” mixes work packages and URLs. §3 contains four named work packages, potentially eight individual actions if five redirects, one content edit, one GSC removal and one test change are counted separately.

**Rationale and impact:** These discrepancies undermine the evidence used to dismiss most URLs and make estimates and sign-off ambiguous.

**Recommended action:** Reconcile against the original export, preserving unique URL identity and the GSC observation date. State four work packages separately from affected URLs and records. If lists are illustrative, label them as examples. Do not manufacture missing entries to make the arithmetic fit.

**Open questions:** None for the owner; the evidence author must reconcile the inventory.

### F06. The evidence does not establish complete site coverage

**Priority/type/status:** P2, evidence and reproducibility, confirmed limitation. **Relevant sections:** §2 and §6.

**Description:** Reading every displayed GSC example is not necessarily reading every affected URL. Google states that example lists may be incomplete even below 1,000 entries. Separately, a clean sitemap proves properties of its members; it cannot prove that all intended pages are included. The suppressed quiz is itself a page omitted from the inspected sitemap. [Google Page indexing report](https://support.google.com/webmasters/answer/7440203?hl=en).

**Rationale and impact:** “The sitemap is the current site” and unqualified zero-defect bucket verdicts overstate the audit's coverage. Missing valuable pages could remain outside the denominator.

**Recommended action:** Attach the original GSC exports or screenshots, exact filter settings, observation times, complete named-URL list and redirect traces. Compare sitemap membership with the published event inventory and intended static routes. Say “all displayed examples reviewed” and “all 200 submitted URLs passed these checks”. Our HTTP evidence corroborates that latter result, not the historical GSC dataset.

**Open questions:** None for the owner to complete this review. Obtaining the historical GSC evidence remains a hand-off dependency for stronger claims.

### F07. Some “ignore” verdicts infer causes without sufficient evidence

**Priority/type/status:** P2, SEO diagnosis, unconfirmed assumptions. **Relevant sections:** §1, §4 and §5.1.

**Description:** A current self-canonical on the Great Fosters page does not prove that Google considers all 17 landmark pages too similar. Nor does an event being in the past establish that Google's selected alternative canonical is appropriate. Likewise, crawled-but-unindexed pages are not automatically free of technical or content problems.

**Rationale and impact:** These verdicts could retire a commercially useful investigation or trigger content pruning on the wrong diagnosis. Canonical declarations are signals; Google's selected canonical needs separate evidence. [Google canonicalisation guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).

**Recommended action:** Label similarity as a hypothesis. Inspect the affected URL's last crawl, declared and selected canonicals, and the selected destination. For valuable remaining pages, review sitemap membership, internal links, current directives and GSC performance before choosing Monitor or a content task. Avoid demanding that every historical post be indexed, and do not infer lost revenue from a 404 without traffic or booking evidence.

**Open questions:** No immediate owner decision is required. The landmark content decision should remain deferred until its evidence is available.

### F08. Restored eligibility is not guaranteed indexing

**Priority/type/status:** P2, acceptance criteria, confirmed wording defect. **Relevant section:** §3.2.

**Description:** “The page indexes itself on the next crawl” promises a result the application cannot control.

**Rationale and impact:** A developer could complete the repair correctly yet fail the stated outcome. Conversely, someone could close the ticket after removing a phrase without verifying refreshed metadata and discovery.

**Recommended action:** Define the deliverable as accurate public copy, no unintended noindex, a correct canonical and expected sitemap membership after refresh. Record a later Google indexing check separately. Submission and crawl eligibility do not guarantee indexing. [Google crawling and indexing FAQ](https://developers.google.com/search/help/crawling-index-faq?hl=en).

**Open questions:** None. A suggested replacement sentence is provided below.

### F09. Data propagation and cache behaviour are unspecified

**Priority/type/status:** P1, integration and caching, confirmed omission. **Relevant sections:** §3.2 and §6.

**Description:** The specification stops at saving the management record. Current website source caches event detail requests for 300 seconds and revalidates the sitemap on a 3,600-second interval. Live responses included HIT and STALE cache states. Neither interval is a guaranteed maximum until every downstream layer and refresh outcome is checked.

**Rationale and impact:** A successful edit can leave the old claim and noindex in public responses. The list and detail API projections also differ: the sitemap source explicitly notes that list records omit `long_description`, so invoking the same strategy function does not guarantee equivalent decisions.

**Recommended action:** Document the supported refresh method, evidence collection point, expected observation window and escalation when stale content persists. Verify event detail, metadata, structured data, listing and sitemap independently. Do not disable caching globally or fetch every event detail just to solve this one record. The existing list/detail limitation should be documented, not silently expanded into an API redesign.

**Open questions:** None for the owner; the developer must confirm effective cache propagation before specifying a completion time.

### F10. Discovery checks have not become release acceptance tests

**Priority/type/status:** P1, testing and user journeys, confirmed omission. **Relevant sections:** §3 and §6.

**Description:** The document lists how the original state was inspected, but does not say what must pass after each change, under which environment or against which event states.

**Rationale and impact:** A redirect can pass a configuration test but fail at the edge, drop attribution, or land on a functioning page for the wrong date. A past event returning 200 must not offer tickets for that past date. An indexable page does not prove a working booking flow.

**Recommended action:** Adopt the acceptance matrix below. Use the website's Jest setup, not the management app's Vitest commands. Exercise new redirect mappings through middleware and then the deployed URLs; retain no-loop checks. Extend tag tests beyond the four broad tags. Use isolated fixtures for booking and dependency-failure tests. Any live booking, payment or message needs separate explicit authorisation, so a read-only check must be reported as such.

**Open questions:** None for this review. The implementer must name the isolated test environment and retain any unrun live booking check as an explicit limitation.

### F11. Release ownership, approval and rollback are missing

**Priority/type/status:** P1, delivery and deployment, confirmed omission. **Relevant sections:** status, §3 and §5.

**Description:** Website code, live management content and GSC settings are separate changes with different permissions. No person owns the final cross-system verification. Project lessons state that website production deployment is manual; a push to main alone is not proof of release.

**Rationale and impact:** The code could be merged while customers still see the old URLs. An event edit might unintentionally save stale values from a wider form. Rolling back a release cannot reliably erase redirects already cached by clients.

**Recommended action:** Assign a website developer, content editor/approver and GSC operator, with one release verifier. Prepare the whole concrete change list before requesting approval. Record the commit, production deployment ID and alias, the content revision/audit result, and the GSC operation separately. Keep a last known good deployment and an approved content revision. For content errors, prefer a corrective revision; do not blindly restore known-false copy merely to restore an old snapshot. Verify the current deployment model before executing it.

**Open questions:** None requiring a decision during review. Named owners and production permissions must be supplied before execution.

### F12. The tag test contract conflicts with the unresolved policy

**Priority/type/status:** P2, policy and edge cases, confirmed ambiguity. **Relevant sections:** §3.4 and §5.2.

**Description:** §3.4 mandates all tag archives remain noindex, while §5.2 asks whether that should remain the policy. “Every archive renders” is also too broad: current source redirects empty tags to `/blog/tags`, and legacy tag redirects have their own rules.

**Rationale and impact:** A test intended to protect current behaviour could accidentally become a permanent editorial decision, or fail against routes correctly returning redirects.

**Recommended action:** Define the scope as all valid, non-redirecting tag archives under the current policy. Check canonical and sitemap exclusion for those pages. Preserve normalisation, aliases and empty-tag behaviour as separate cases. Describe any new tests as current-behaviour protection pending a separate content decision unless the owner explicitly confirms the permanent policy.

**Open questions:** Owner decision D2 is raised in the accompanying chat. No tag indexability change is approved by this report.

### F13. The cited lifecycle policy contains superseded rules

**Priority/type/status:** P2, dependency and error handling, confirmed. **Relevant sections:** §3.1, §3.4 and §5.3.

**Description:** The referenced `tasks/gsc-indexing-fix/url-lifecycle-policy.md` still says API 404s and fetch errors redirect to `/whats-on`, and refers to selective tag exclusion using `isNoindexBlogTag()`. Current route source rethrows transient errors and returns `notFound()` for missing events; current tags are uniformly noindex.

**Rationale and impact:** The A-before-B replacement principle is useful, but following the whole policy literally could reintroduce permanent redirects during a temporary API outage. It also leaves misleading documentation behind if the helper is removed.

**Recommended action:** Update only the stale sections as part of the relevant implementation hand-off, with the current commit and approved policy. Preserve the distinction between missing content, deliberate retirement and transient failure. A failed dependency must not become a new permanent redirect. Do not broaden the task into a lifecycle rewrite.

**Open questions:** None for the owner unless a policy change, rather than documentation correction, is proposed.

### F14. GSC changes need precise scope and evidence

**Priority/type/status:** P2, GSC operations, confirmed omission. **Relevant sections:** §2 and §3.3.

**Description:** The old sitemap's 404 is independently confirmed. Its submission date, cached Success state and current GSC entry were not. “Owner action, one click” omits the exact submitted URL and the difference between deleting a sitemap submission and removing pages from Search. The blanket statement that certain categories can never pass validation is too absolute.

**Rationale and impact:** An operator could select the wrong property or sitemap, or judge a correct repair by the colour of an unrelated bucket.

**Recommended action:** Record the exact stale submission, inspect the current canonical sitemap entry and `robots.txt`, then remove only the obsolete submission after approval. Capture the result. Removing the entry does not remove discovered URLs from Search. Do not recreate an unnecessary endpoint to make an old submission green. Use validation only for the affected scope that was actually corrected; deliberate exclusions can remain. [Google Sitemaps report](https://support.google.com/webmasters/answer/7451001?hl=en), [Google Page indexing validation](https://support.google.com/webmasters/answer/7440203?hl=en).

**Open questions:** None for the owner now. The GSC operator must verify the exact current entry before preparing the approved action.

### F15. Closure criteria and monitoring ownership are absent

**Priority/type/status:** P2, monitoring and delivery, confirmed omission. **Relevant sections:** §4, §5 and §6.

**Description:** “Ignore” has no expiry or recheck trigger. There is no owner for checking refreshed content, the production redirects, Google's later processing or another renamed event.

**Rationale and impact:** The repair may remain half-released, and the same issue can recur without a clear recipient. A reduction in 631 is not a useful success condition because many exclusions are intentional.

**Recommended action:** Close application work on direct acceptance evidence. Assign a separate GSC review after fresh crawl data is available, with a named follow-up date selected at release. Measure the affected canonical URLs and relevant impressions/clicks where available; do not promise a ranking increase. Reopen on a valuable URL returning an unexpected 404, a redirect destination failing, or a future event unexpectedly becoming noindex. Use existing logging and checks before buying or building monitoring. Redact tokens and personal query values from retained logs.

**Open questions:** None for the owner now. A named reviewer and follow-up date are release dependencies, not a request to create an automation during this review.

### F16. Clarify image and build-asset treatment without widening the repair

**Priority/type/status:** P3, asset handling, optional clarification. **Relevant sections:** §2 and §4.

**Description:** “They must not be indexed” is stronger than the evidence for all Open Graph images, and `image/png` alone is not an indexing prohibition. A current robots file allowing static assets also does not prove that every failed asset belongs to a retired build.

**Rationale and impact:** An implementer could unnecessarily block social images or current rendering assets. The original recommendation to avoid a blanket asset fix is sensible; its explanation needs more precise scope.

**Recommended action:** Separate HTML page indexing, image discoverability and social-preview availability. Preserve crawlability of current CSS and required images. Only investigate asset failures that current pages still reference. If excluding a specific image resource is actually required, evaluate response headers and social previews separately; Google documents `X-Robots-Tag` for non-HTML resources. [Google robots directives](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).

**Open questions:** None needed for immediate repairs. A change to image-indexing policy is outside their scope.

### F17. A build-only event rename guard is not yet a design

**Priority/type/status:** P3, architecture and performance, optional improvement. **Relevant section:** §5.3.

**Description:** A database rename can become public between website builds. Sitemap disappearance can also represent a draft, cancellation, noindex decision or missing/incomplete feed. Current source deliberately excludes event fetches during a build and fills them on later revalidation. Comparing two build snapshots therefore cannot, by itself, prove a missing redirect.

**Rationale and impact:** The proposed check could miss the actual incident and fail unrelated releases. Fetching every detail record introduces avoidable fan-out and outage sensitivity.

**Recommended action:** First scope the publication lifecycle using stable event IDs and known-good inventories. Consider the simplest staff checklist or warning when a published slug changes. A later automated design must distinguish a read failure from deletion, handle repeat renames without chains, prevent duplicate/open redirects and assign responsibility for recording the old URL. Persistent slug history is an option, not a prerequisite for the immediate four redirects. Any schema proposal requires live schema review and its own migration plan and approval.

**Open questions:** None required now. The follow-up remains unestimated until its lifecycle and operating owner are defined.

### F18. Keep the immediate work independent of larger decisions

**Priority/type/status:** P3, delivery simplification, optional improvement. **Relevant sections:** §3 and §5.

**Description:** The note mixes immediate repairs, regression-test maintenance, content strategy and an automation concept.

**Rationale and impact:** Coupling them creates avoidable delays and makes “done” ambiguous. The 17-page cluster has no measured commercial case in the supplied evidence, and the rename guard lacks requirements.

**Recommended action:** Use four small work packages: exact redirect mappings, an approved event-content correction, obsolete GSC submission removal, and truthful test/documentation maintenance. Keep landmark content, future tag strategy and rename automation in separately owned follow-ups. No new database schema, public API, CMS, dashboard, broad copy rewrite or full-site redesign is required for those four packages.

**Open questions:** None. Separating scope is a delivery recommendation, not permission to prune or reindex content.

## Acceptance matrix for the developer

These are proposed requirements for the later implementation, not tests completed by this review.

| Area and journey | Required evidence |
|---|---|
| Old link to a future bingo event | Exact old path returns 301 to the mapped same-event URL. Destination returns 200 with that date and canonical, no unintended noindex, and a usable booking entry point. Confirm the event remains open before describing it as bookable. |
| Old link to a historical bingo event | Same-event destination returns 200, clearly says the event has ended and offers current related dates. No form or structured offer sells the past event. |
| Redirect variants | Test canonical host and apex host, existing scheme handling, supported trailing-slash behaviour and representative UTM/source query strings. Record actual hops and destination. Query strings are preserved by the current helper when the target has none. Test new rules through middleware, not only JSON inspection. |
| July retirement | Record its explicit disposition. If approved, 301 to the meaningful Cash Bingo hub, which returns 200 and offers current dates; otherwise retain a documented 404. Do not silently treat the speculative new July slug as a previously published URL. |
| Corrected quiz content | Before/after field diff tied to one stable record ID. Approved statements agree in visible body, FAQ/accessibility copy, metadata and structured data. Booking settings, slug, dates and financial fields remain unchanged. Noindex is cleared only after accurate source content is confirmed. |
| Event discovery and caches | After refresh, verify event detail, `/whats-on` and sitemap membership independently. Record cache state and observation time. Check the other upcoming events retain their intended state rather than assuming one corrected record proves the whole feed. |
| Missing versus unavailable event | Existing missing-event 404 and transient-error behaviour remains intact. In isolated tests, an API timeout or 5xx does not produce a newly cached permanent redirect or a successful empty replacement. |
| Blog tags | Existing and additional valid tag fixtures call actual route metadata and check sitemap exclusion. Include the four original tags and valid examples such as `heathrow`, `guides`, `seasonal` and `private-hire`. Keep legacy redirects, empty tags and normalisation as separate cases. Prove a removed or narrowed robots rule would fail an appropriate assertion. |
| GSC submission | Correct property and obsolete submitted URL captured before the operation; only that submission removed; canonical sitemap still accessible and submitted as intended. No page-removal request. |
| Customer interaction and accessibility | Browser smoke test at mobile and desktop sizes: old link reaches the right page, access information is consistent and readable, keyboard focus reaches the booking link/form, and no stale past-event booking CTA remains. Report exactly how far the booking journey was tested. |
| Release | Relevant Jest tests in London and UTC, redirect audit, lint, type check and a clean build for the changed website revision. Then re-run affected GETs against the production alias and record commit plus deployment ID. Review relevant errors during verification. A test-only PR does not itself need a customer-facing deployment unless it changes runtime output. |

## Delivery, dependencies and risks

**Recommended order:** reconcile the five-versus-four scope and incorrect technical statements; prepare the exact event edit; obtain one approval for the concrete changes requiring it; implement and verify the small website changes in an isolated checkout based on current remote main; execute the approved content and GSC actions; verify each public outcome; assign the later GSC check. The redirect and content packages can progress independently because this proposal does not rename the live event or change its API contract.

The working website checkout and management checkout both contain unrelated work. Do not overwrite their task files, sweep changes into a commit or deploy a stale checkout. Website runtime changes need the actual production deployment step. Database content changes take effect through the existing API and caches and are not rolled back by reverting a website commit.

| Major risk | Required control | Proposed accountable role |
|---|---|---|
| Visitors rely on false access information | Correct every affected public surface; verify the live statement before closing | Content editor and release verifier |
| Valid dietary URL altered because of a raw text match | Field-level evidence; preserve SSOT-approved URL and identifiers | Developer |
| Only four of five expected redirects delivered | Approved, explicit mapping/disposition list | Website developer and owner |
| Copy saved but stale noindex still served | Separate detail, listing and sitemap refresh checks | Release verifier |
| Code merged but never reaches production | Capture Ready deployment ID and production alias for the verified commit | Deployment owner |
| Test rewrite removes existing useful protection | Preserve page and sitemap assertions; extend to uncovered tags | Website developer |
| Noisy guard hides outages or blocks unrelated releases | Separate design; stable IDs; distinguish unavailable feed from removal | Follow-up owner |

**Security and data:** no new credentials, anonymous database access or schema migration are needed for the immediate work. Use the current permissioned edit path, avoid a broad service-role script, preserve auditability and check the current record before saving a prepared edit. Do not send test bookings or notifications to production to demonstrate an SEO correction. If a future slug-history design adds tables or public RPCs, it becomes a separate migration and access-control review. **No migration has been drafted or applied in this review.**

**Performance:** a small static redirect addition and test extension do not justify a new benchmark project. Keep redirect handling independent of the management API and avoid per-request or per-sitemap detail-fetch fan-out. The HTTP checks here used bounded concurrency, not a load test.

**Accessibility:** correcting the facility assertion is required. Browser checks should also confirm the information remains discoverable and booking controls remain keyboard usable. No UI redesign or full accessibility certification is implied by this task.

## Specific wording changes suggested

These are targeted suggestions only. The original has not been edited.

1. **§3.4:** “The current test checks page metadata and sitemap exclusion for four broad tags. Extend it to cover valid tags outside that set, while retaining those existing checks and removing the unused helper if no other consumer remains.”
2. **§3.2:** “The page contains false accessibility assertions. Verify their source fields and correct all affected public copy. In this review, the dietary match was an allowed navigation URL, not a visible event claim.”
3. **§3.2:** “After the corrected content reaches the public page, verify accurate copy, removal of the unintended noindex and expected sitemap membership. Google decides whether and when to index it.”
4. **§3.1:** “Add four redirects to the same events at their current URLs. Record the July URL's separate retirement disposition explicitly; if its proposed hub redirect is approved, the total is five rules.”
5. **§2:** “All 200 URLs in the inspected sitemap passed the stated technical checks. This does not establish that the sitemap contains every intended page or that Google has indexed every eligible page.”

## Overall readiness and next steps

**Technical readiness:** the four direct redirect targets and the live accessibility/noindex problem are substantiated. The existing mechanism is adequate for the immediate URL repairs. The tag-test diagnosis and dietary diagnosis need correction. Broader claims about Google's reasons remain hypotheses.

**Delivery readiness:** incomplete. The specification needs a single agreed scope, a record-level content change set, named owners, cache verification, acceptance tests and proof of production release. It is ready to be split into bounded tickets after those details are supplied; it is not ready for unrestricted implementation.

**Key required changes:** resolve F02-F04 before the event edits and redirect release; apply F09-F11 before declaring them complete; correct F01 and F12-F14 before the test/documentation and GSC work is accepted; reconcile F05-F08 and assign F15 so the hand-off remains evidence-based.

**Unresolved decisions:** D1 and D2 are raised in the accompanying chat, following the project rule that owner questions stay out of documents. Landmark strategy, any future tag-indexing change and a rename guard remain separately scoped work with no approval or commercial recommendation established here. Developer-owned gaps, including live field mapping, exact GSC entry, cache propagation and release ownership, must be resolved without turning them into unnecessary owner questions.

**Recommended next step:** use this review to prepare the small implementation tickets and a complete reviewable change list. Do not require the broad strategy follow-ups to finish first. No implementation approval is sought by this report.

**Done** - Separate developer review and current HTTP evidence delivered, local only. Original document and application files unchanged. No migrations applied.

**Next:** Resolve the specified requirements before implementation; later production changes require their concrete approved change set.
