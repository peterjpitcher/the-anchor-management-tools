# AI event artwork: developer specification review

Date: 6 September 2026. Status: review complete, local only. Implementation not approved by this review.

The specification is suitable for a tightly scoped feasibility trial, but is not ready for implementation as written. Its strongest choices are private drafts, deterministic logo and QR compositing, per-variant generation, and preserving the public image contract. Its weakest areas are recovery after uncertain provider outcomes, publication semantics, spend enforcement and the relationship between generation, placement and approval.

The original specification has not been rewritten. Suggested replacement wording appears separately below.

## Scope and evidence

Reviewed the supplied [original attachment](/Users/peterpitcher/.codex/attachments/7b1a5e9c-f238-44a4-907c-5c23790b7bec/pasted-text.txt), sections 1 to 14 and its appendix, against local application code and current official provider documentation. This is a technical and delivery review, not a production incident report or implementation test.

Local HEAD was `759f1471357ae3a7d5e5b59f51bc4593e8aba2c8`, 18 commits behind the existing `origin/main` reference `78e11232dbdc5a80eae3afcc907ddfd2689e30e6`. The reviewed core image, QR and optimisation files were not listed among those intervening changes. The workspace contains unrelated work, which was preserved. Neither Git reference establishes what production currently runs.

No paid image request, live database query, migration, deployment, message or live artwork change was performed. The specification's event counts, image dimensions in production, historical spend, stale-link counts, orphan counts, deployed Node version and missing production migration history remain unverified discovery claims. Do not treat those figures as confirmed by this report. Attach dated queries or measurements and their deployment/project identifiers before using them to justify scope or cost.

Official references checked:

- [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation): supports the stated size constraints and identifies outputs above 3,686,400 pixels as experimental. All six proposed request sizes pass the four numeric constraints, checked by calculation. Poster B is 3,635,200 pixels and poster A is 8,272,384 pixels. The guide also documents input fidelity, base64 output, variable latency and image error handling.
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing): image and text inputs have separate charges from image outputs. Reference-image edits therefore need more than an output-only estimate.
- [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2): confirms image editing support and identifies a dated snapshot. Availability in this application's OpenAI project was not tested.
- [Vercel function limits](https://vercel.com/docs/functions/limitations): documents the 4.5 MB request/response limit and runtime-dependent duration limits. The platform supports a 300-second route in applicable configurations; that does not prove this project's route or workload will finish within it.
- [Supabase bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals): private objects support authorised downloads as well as expiring signed URLs. Public object retrieval bypasses access controls.

Priorities: **P1** must be resolved before the affected implementation or release; **P2** must be specified and verified before general release; **P3** optional improvement. No P0 production emergency has been verified. “Confirmed gap” means a defect or omission in the specification, not proof of a live application fault. Decision references D1 to D8 refer to questions raised in the accompanying chat; no answer is assumed here. Findings without a decision reference need developer specification work, not a further owner question.

## Findings

### F01. Four generated images and five generated images are different products

**Priority/type:** P1, contradiction. **Evidence:** confirmed specification issue. **Sections:** 1, 3, 5, 8, 12.

**Description and rationale:** The goal says one square produces four generated variants. The pipeline and acceptance criteria regenerate the square too. This changes the owner's approved source and adds a billed request. Consistency across five separate calls is an aspiration, not a guaranteed result.

**Impact:** Different acceptance tests, spend estimates and expectations about retaining the original design.

**Recommended action:** Settle the square policy before modelling the run. Prefer preserving the source square in the first release, with explicit resizing if needed, and generating four adaptations. If five generations are selected, state that clearly everywhere and keep the original available for comparison. **Decision dependency:** D1.

### F02. Referenced owner decisions are absent from the handoff

**Priority/type:** P1, missing decisions. **Evidence:** confirmed gap. **Sections:** 2.1, 4.3, 7, 8, 13, appendix.

**Description and rationale:** The supplied document refers to questions 1, 3, 4, 5, 6 and 7, but includes neither their text nor owner answers. A draft recommendation is not an approved reversal of the August scope.

**Impact:** A developer cannot distinguish a settled requirement from a provisional assumption or confidently estimate the release.

**Recommended action:** Obtain the decisions in chat, then record the resulting decisions and date in a single developer handoff. Do not reconstruct missing approvals. **Decision dependencies:** D1 to D8.

### F03. Logo placement is chosen after the prompt needs it

**Priority/type:** P1, workflow contradiction. **Evidence:** confirmed gap. **Sections:** 4.4, 5, 7.3, 8.

**Description and rationale:** The prompt reserves the chosen logo corner, but the owner chooses that corner after generation. Moving the logo or QR can cover text, even when compositing itself is free. A bottom-quarter reservation cannot protect every freely chosen QR position.

**Impact:** Correctly implemented controls can produce unusable artwork or require another paid generation to make room.

**Recommended action:** Select the intended corner before generation, document the initial default and warn when later placement falls outside the reserved area. Keep movement possible only with a fresh visible composite review. Define collision and out-of-bounds behaviour; do not promise that moving overlays will always produce an acceptable layout. No additional owner decision required beyond the chosen release scope.

### F04. A unique draft row does not prevent managers overwriting each other

**Priority/type:** P1, concurrency/data integrity. **Evidence:** confirmed design gap. **Sections:** 6.1, 9.2, 12.

**Description and rationale:** One draft per event prevents duplicate rows but does not lock placements or source changes. Once a run enters `publishing`, the partial index permits a second draft. Two tabs can also use the same draft with different source uploads.

**Impact:** Lost edits, mismatched source and output, or publication of a mixture of managers' work.

**Recommended action:** Define one active run across draft and publishing states, atomic get-or-create, conflict responses, run revision checks, and explicit resume/discard behaviour. Bind each generation to an immutable source revision. Return the existing run on duplicate creation rather than a generic database error.

### F05. A lease cannot guarantee exactly-once provider billing

**Priority/type:** P1, reliability/financial risk. **Evidence:** confirmed missing failure contract. **Sections:** 6.2, 9.2 to 9.4, 12.

**Description and rationale:** OpenAI may complete and charge while the function loses the response or fails to save it. Taking over an expired lease can submit the same work again. A 300-second lease matching the route's maximum duration leaves no recovery margin. The specified conditional update only explains the initial pending claim, not safe takeover.

**Impact:** Duplicate charges and an earlier worker overwriting a later result. “Reload-safe” and “one run” are insufficient guarantees.

**Recommended action:** Use attempt identifiers, immutable attempt paths and conditional completion tied to the current claim. Define provider timeout, storage timeout, lease expiry and takeover separately. Record uncertain outcomes explicitly and require a budget-aware retry decision. Do not claim exactly-once external charging without documented provider support. Separate automatic transport attempts from deliberate Regenerate revisions so the cap of two does not disable normal iteration.

**Code evidence:** The [voucher renderer](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/vouchers/batches/[id]/render/route.ts:30) uses a ten-minute stale threshold, attempt-count comparisons and immutable attempt filenames. The proposed claim is an adaptation, not an exact copy of a proven image-generation workflow.

### F06. Publication has no resumable transaction contract

**Priority/type:** P1, functional/data integrity. **Evidence:** confirmed specification gap and code behaviour. **Sections:** 5, 6.4, 10, 12.

**Description and rationale:** The existing [confirmation action](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/event-image-variants.ts:165) updates one variant and its cache columns, then deletes its previous owned object. It does not commit all five variants together. The spec explicitly allows partial success but stores no per-variant publication outcome, expected previous version or completion record.

**Impact:** A timeout after three successes leaves mixed live artwork and a run that cannot reliably say what to retry. Repeated confirmation or manual uploads during publication can overwrite newer work. Discard after partial publication cannot restore the original artwork.

**Recommended action:** Choose and document publication semantics. The smaller scope is explicit partial publication with durable per-variant outcomes, compare-before-replace checks, retry of only unresolved variants, and clear mixed-set status. If all-or-nothing publication is required, the promise that existing RPCs remain untouched must be reconsidered. Separate “discard unpublished work” from rollback of published work. **Decision dependency:** D2.

### F07. The reviewed preview is not bound to the published bytes

**Priority/type:** P1, approval/versioning. **Evidence:** confirmed gap. **Sections:** 6, 7, 8, 12.

**Description and rationale:** Variant status `ready` says nothing about the placement version, source version or whether a regenerated image has been reviewed. Fixed filenames also risk stale signed-URL or browser previews.

**Impact:** The owner may approve one image and publish a different composite or an unreviewed regeneration.

**Recommended action:** Track generation and composite revisions, use immutable paths, and persist approval against the exact artifact hash or revision. Changes to source, generation, text, logo or QR invalidate affected approvals. Freeze the publication manifest and disable conflicting edits while it is publishing. Publish only those exact reviewed artifacts.

### F08. Event text has no precedence or stale-data policy

**Priority/type:** P1, functional/content accuracy. **Evidence:** confirmed gap. **Sections:** 4.4, 5, 12.

**Description and rationale:** The source square may disagree with the event record or already contain logos, QR codes and extra copy. “Price or Free” does not cover an unknown price. Existing [event content code](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/event-content.ts:655) distinguishes `is_free` from a missing numeric price. Doors, start, end, last entry, ticket conditions and long titles also need rules.

**Impact:** Wrong prices or dates can be faithfully reproduced across all variants; duplicate branding or competing QR codes can survive generation.

**Recommended action:** Show the authoritative copy before generation, distinguish free from unknown, and define required and optional fields. Save an event-copy snapshot and prompt version. Detect relevant event edits before publication and require re-review. Explain whether source text is preserved, replaced or omitted. Reject or flag embedded QR codes and existing branding for owner review rather than assuming they disappear.

### F09. API integration details and feasibility are not proven

**Priority/type:** P1, dependency/assumption. **Evidence:** confirmed missing contract; account feasibility unverified. **Sections:** 4, 9, 11.

**Description and rationale:** The size maths is sound, but the spec does not fully define the image-edit request, reference-image transfer, output format, response decoding or actual account access. Five calls plus retries require real account rate-limit evidence. The older-model aspect-ratio comparison tests native output, not a fully specified resize strategy, so “only viable model” is stronger than the evidence supports.

**Impact:** A substantial build may precede discovery of access, latency, cost or quality problems.

**Recommended action:** Specify one image per edit request, source bytes or a supported input mechanism, explicit model/quality/size/output format and bounded decoding. Pin or record the effective model version. Do not copy unsupported older-model parameters. Before phase 0, run an owner-authorised representative feasibility trial with actual artwork, all target shapes, measured cost, latency and printed output. Retain GPT Image 2 as the preferred model without claiming alternatives are mathematically impossible. **Decision dependency:** D3 for print quality; paid trial requires its own authorisation.

### F10. Cost accounting contradicts the pricing model

**Priority/type:** P1, financial correctness. **Evidence:** confirmed contradiction. **Sections:** 6, 9.1, 10, 12.

**Description and rationale:** Usage is token information, not a dollar amount to sum directly. A fixed per-image price cannot accurately price arbitrary sizes and source-image inputs. “Better to log zero” contradicts the acceptance criterion for real cost and hides unknown spend. The existing [chat cost helper](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/openai.ts:86) does fall back to chat pricing, so avoiding it is justified.

**Impact:** Misleading spend reports and ineffective budget limits.

**Recommended action:** Store usage and cost per attempt, including failed downstream saves and deliberate regenerations. Calculate with versioned image-output, image-input and text-input rates from [official pricing](https://developers.openai.com/api/docs/pricing), including cached categories when reported. Distinguish estimated, calculated and unknown cost. Use an idempotent accounting key and reconcile failed ledger writes. Preserve event, run, variant, attempt and initiating user attribution. Do not use historical incomplete logging as evidence that current AI spend is negligible.

### F11. Visible cost is not bounded cost

**Priority/type:** P1, missing safety requirement. **Evidence:** confirmed gap. **Sections:** 3, 9, 12.

**Description and rationale:** There are no actual run, event or global spend limits, no reservation across parallel requests and no limit on new runs or manual regenerations. Two attempts per variant does not bound cumulative spend.

**Impact:** Accidental or repeated authorised calls can materially exceed the expected cost.

**Recommended action:** Define owner-approved limits, server-side budget reservation before each paid call, release/reconciliation rules and behaviour when usage is unknown. Add global concurrency/rate controls and a feature-specific generation kill switch. Show the estimate before Generate and each paid Regenerate. Keep free compositing available when generation is disabled. **Decision dependency:** D4; monetary limits must be supplied or explicitly approved, not invented by the developer.

### F12. Permissions and private storage are underspecified

**Priority/type:** P1, security/authorisation. **Evidence:** confirmed gap and permission mismatch. **Sections:** 6.3, 7.2, 8, 11.

**Description and rationale:** The spec alternates between owner and managers. Existing [upload requests](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/event-image-variants.ts:61) require `events:edit`; the proposed QR wrapper uses `events:manage`. There is no permission matrix for viewing drafts, creating runs, generating, signing, compositing, publishing or discarding.

**Impact:** A user can enter the workflow but fail part-way through, or a broadly authorised signing endpoint can disclose another event's draft.

**Recommended action:** Apply the chosen permission server-side to every operation, verify event/run/path relationships, and recheck before publication. Define table grants, RLS and storage policies explicitly, including anonymous and ordinary staff denial. Generate storage keys server-side; never accept an arbitrary URL/path for privileged download or compositing. Protect cookie-authenticated route mutations against cross-site requests. Signed URLs are bearer access until expiry: use short lifetimes, authorised refresh and private/no-store editor responses. Avoid logging them. **Decision dependency:** D5.

### F13. Source validation and output validation need separate contracts

**Priority/type:** P2, security/data validation. **Evidence:** confirmed gap. **Sections:** 5, 6.3, 9.5, 12.

**Description and rationale:** A square upload has no byte, decoded-pixel, MIME, orientation, animation or minimum-quality rules. The existing aspect check allows unknown dimensions, appropriate to parts of the manual workflow but insufficient for decoded generated output.

**Impact:** Expensive malformed inputs, excessive memory use, corrupted previews or unexpected formats can reach generation or publication.

**Recommended action:** Specify supported raster inputs, server-side magic-byte/decode validation, pixel and byte ceilings, EXIF orientation handling, metadata stripping and behaviour for transparent/animated files. Set bucket restrictions too. After generation, independently verify exact dimensions, format, file size and successful decoding. Do not trust browser-supplied dimensions. Upload failures and abandoned source uploads need cleanup without creating a live image.

### F14. Resize instructions do not specify how pixels are preserved

**Priority/type:** P2, technical ambiguity. **Evidence:** confirmed gap and factual correction. **Sections:** 4.2, 4.3, 9.5.

**Description and rationale:** Source and target ratios differ, so one uniform scale cannot produce every exact target without cropping or padding; stretching is another distinct choice. The poster recommendation also conflicts with the general statement that upscaling is unsafe. The claim that a 2000-pixel cap downsizes 1920-pixel edges is incorrect: [the optimiser](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/expenses/imageProcessor.ts:146) resizes only when an edge exceeds 2000.

**Impact:** Implementers may silently crop text, distort artwork or select inconsistent output behaviour.

**Recommended action:** State the exact resize fit, positioning, interpolation, colour handling and accepted sub-percent crop or padding. Identify poster upscaling as an explicit quality trade-off. Avoid the receipt optimiser for the poster; correct the explanation about the other variants. Test actual pixels and text clearance, not only aspect ratio.

### F15. Physical QR size and compositing instructions disagree

**Priority/type:** P2, print correctness. **Evidence:** confirmed calculation and ambiguity. **Sections:** 7.2, 10, 12.

**Description and rationale:** Nineteen per cent of 210 mm is 39.9 mm, below the stated 40 mm minimum. At 2480 pixels across A4, rounding up requires 473 pixels. A 1200-pixel QR cannot be composited “unmodified” at the default roughly 591-pixel size. Printer fit-to-page can shrink it again.

**Impact:** Tests can pass the proposed percentage floor while failing the physical acceptance criterion; unsuitable resampling can soften QR modules.

**Recommended action:** Derive the minimum from physical page width with upward pixel rounding. Clarify whether size includes the quiet zone. Preserve the white plate while explicitly defining QR rendering/resizing, preferably with crisp module boundaries. Supply a download and print-at-actual-size workflow, density metadata or a clearly sized printable output, and test the final printed sheet on multiple phones. QR destination verification must accompany scan verification. **Decision dependency:** D3 for poster quality.

### F16. Reserved logo boxes do not cover allowed placements

**Priority/type:** P2, layout inconsistency. **Evidence:** confirmed calculation. **Sections:** 7.1, 7.3.

**Description and rationale:** A logo at 35% width exceeds a reservation of 30% width. On a 1920x1080 landscape, its 934:421 ratio gives approximately 303 pixels height, above the proposed 194-pixel reservation, before any inset. A bottom-corner logo may also conflict with the QR.

**Impact:** The prompt and compositor disagree even if the model follows instructions exactly.

**Recommended action:** Derive reserved rectangles from the maximum actual logo geometry, inset and clear space for each variant. Define QR/logo overlap prevention and minimum/maximum placement bounds server-side. Use identical coordinate maths for preview and final output. Treat these dimensions as proposed design rules, not an approved brand standard.

### F17. Printed-link durability cannot remain an unrelated risk

**Priority/type:** P1, dependency/acceptance contradiction. **Evidence:** current code behaviour confirmed; live stale counts unverified. **Sections:** 7.2, 12 to 14.

**Description and rationale:** [generateSingleLink](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/event-marketing.ts:616) returns an existing link rather than refreshing its destination. Correct future destination after a slug change is required by the acceptance criteria but repairs are provisionally out of scope. Missing slug, cancelled/deleted event and concurrent link creation also lack outcomes.

**Impact:** The printed QR can scan perfectly while opening the wrong or unavailable page.

**Recommended action:** Include correctness of the selected poster link and future rename behaviour in this feature's release dependency. Validate the canonical destination and tracking fields before approving the poster. Handle missing/unpublished destinations explicitly. Keep any historical bulk repair as a separately authorised task; it is not necessary to repair every old link to define correctness for new posters. **Decision dependency:** D6.

### F18. Failure states and browser recovery are incomplete

**Priority/type:** P1, reliability/user journey. **Evidence:** confirmed gap. **Sections:** 6, 8, 9.

**Description and rationale:** Missing cases include closing the tab mid-run, reload before all requests start, expired session or signed URL, offline polling, source replacement during generation, stuck publishing, provider quota exhaustion and generated bytes saved without their database record. A route per variant does not itself resume work after navigation.

**Impact:** Paid output can become inaccessible, progress can remain stuck, and Retry can submit unnecessary calls.

**Recommended action:** Specify operation/state transition tables and structured responses for start, poll, resume, regenerate, composite, publish and discard. Distinguish retryable rate limits from exhausted quota, invalid input, moderation, missing configuration and uncertain provider outcomes. Use bounded backoff and timeout budgets. Recovery must inspect durable state before launching work. Explain that closing the page does not guarantee cancellation of billing. Block late completions from reviving discarded runs.

### F19. Regeneration destroys the useful comparison unless revisions are kept

**Priority/type:** P2, functional gap. **Evidence:** confirmed omission. **Sections:** 6.2, 8.

**Description and rationale:** One row and one fixed draft path per variant offer no defined way to keep the current usable result while trying another. It is unclear whether a failed regeneration replaces a ready image with a failed state.

**Impact:** The owner can lose an acceptable result while attempting an improvement.

**Recommended action:** Keep the last selected artifact while a new attempt runs. On success, require selection/review; on failure, retain the previous selection. Use immutable attempt artifacts and expire unselected ones under the retention policy. This does not require a full permanent design-history UI.

### F20. The editor omits important entry and accessibility journeys

**Priority/type:** P2, functional/accessibility. **Evidence:** confirmed gap. **Sections:** 8, 12.

**Description and rationale:** A new unsaved event has no ID for the route. File picking, keyboard QR movement, non-drag placement, screen-reader progress, focus management, zoom and error announcements are not specified. Replacing buttons with non-button elements to avoid CSS can remove keyboard semantics.

**Impact:** The feature can be unusable from the create-event drawer, on touch devices or with assistive technology.

**Recommended action:** Require saving the event first and provide a clear return path. Keep an ordinary file input alongside drop support. Use labelled native controls, visible focus, keyboard nudges or coordinate fields, reset placement and appropriately sized touch targets. Announce per-variant status without excessive live updates. Test iPad Safari directly; the spec's categorical drag-and-drop claim is not a substitute for device verification. Reuse the existing event alt-text process and keep essential event facts available as text outside images.

### F21. Live preview and five parallel generations need performance limits

**Priority/type:** P2, performance/operability. **Evidence:** confirmed omission. **Sections:** 7, 8, 9.4, 11.

**Description and rationale:** Server compositing on every pointer movement can flood functions; full-resolution images in every tile can overwhelm a tablet. Concurrent source decoding, base64 output and Sharp buffers increase memory use. A voucher PDF render does not establish image-provider latency.

**Impact:** Slow interaction, excessive function/storage usage and timeouts despite nominal duration configuration.

**Recommended action:** Use a lightweight scaled preview while dragging and debounce authoritative server composites, cancelling obsolete preview responses. Load full-size images on demand. Set measured concurrency, request-size and memory budgets, bounded polling and a user-facing delayed state. Measure cold/warm generation and compositor timings in the actual deployment configuration. Interpret the payload rule as browser-to-app bodies; server-to-provider image data still has to travel somewhere.

The [queue defaults](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/unified-job-queue.ts:73) permit environment overrides and the queue implements a heartbeat. Its drainer's 60-second declaration is a real constraint, but the specification's precise production retry timings are not established by reading defaults. Retaining per-variant routes is reasonable; five separate route implementations are unnecessary if one validated variant parameter can share the same handler.

### F22. Cleanup misses abandoned runs and event deletion

**Priority/type:** P2, retention/operations. **Evidence:** confirmed gap. **Sections:** 6.1 to 6.3, 11.

**Description and rationale:** Only published and discarded runs are eligible after 30 days. Abandoned drafts and stuck publishing runs can remain indefinitely. Deleting an event cascades database rows but does not delete storage objects; it can erase the paths cleanup needs. “Older than 30 days” lacks a reference timestamp.

**Impact:** Unbounded storage and retention of unpublished material, or accidental deletion during slow publication.

**Recommended action:** Define terminal timestamps, stale-draft policy, storage manifests/tombstones and protection for active leases. Include source, draft, composite and superseded attempt objects. Use bounded, repeatable Storage API cleanup with dry-run reporting and retryable deletion records. Retain accounting/audit data according to a separate policy. Basic cleanup must ship with the first usable generation release; the wider historical orphan report can remain separate.

### F23. Data model lacks enforceable invariants and audit detail

**Priority/type:** P2, data design. **Evidence:** confirmed gap. **Sections:** 6, 9.

**Description and rationale:** Statuses are listed as text without explicit checks. QR coordinates are called percentages but described as fractions. Foreign-key delete behaviour, numeric bounds, model/prompt versions, lifecycle timestamps and attempts' usage history are incomplete. Summed cost on the run can race across parallel writers.

**Impact:** Impossible states, coordinate conversion errors, lost accounting and difficult support diagnosis.

**Recommended action:** Define nullability, checks, defaults, foreign-key behaviour and coordinate units; allowlist variants and configuration server-side. Define required fields by state and indexes for event lookup, claims and cleanup. Record immutable attempts and append-only lifecycle audit events, including initiating user and system completion. Aggregate or atomically update cost. Verify the live schema and dependent views before drafting migration SQL; this report does not certify migration compatibility.

### F24. Graceful degradation can publish an incomplete poster

**Priority/type:** P1, error-handling contradiction. **Evidence:** confirmed specification risk. **Sections:** 7.1, 12, 13.

**Description and rationale:** The risk section recommends a graceful-degradation logo pattern while acceptance requires the selected logo and QR. It does not distinguish an explicit no-logo selection from failure to load the selected asset.

**Impact:** A missing bundled file can silently produce unbranded output that appears successfully published.

**Recommended action:** Fail compositing visibly when a selected required asset cannot load. Preserve the existing live image and the editable draft. Test both missing logo and QR-render failure on the deployed route. Only an explicit no-logo choice should omit a logo. Record a separate “no QR” product choice if such posters are ever allowed; do not infer one from an error.

### F25. Release phases do not deliver the promised first usable workflow

**Priority/type:** P1, delivery/scope. **Evidence:** confirmed contradiction. **Sections:** 3, 8, 11, 12.

**Description and rationale:** Phase 4 offers publication without logo or QR controls, although the core ask includes both. It does not list the publication implementation separately. Cleanup follows feature completion. Removing the copy-paste prompt at editor launch also weakens the external fallback before the new workflow has proved itself.

**Impact:** A technically deployed milestone can be mistaken for a usable or complete release, and create extra manual work.

**Recommended action:** Separate internal deployment milestones from owner-visible release. Keep generation-only behind a feature flag; include publication, minimum branding, QR, failure handling, budget enforcement and basic cleanup in the first public release unless a reduced pilot is explicitly accepted. Retain the prompt fallback initially. **Decision dependency:** D7.

### F26. Deployment and migration gates need explicit ownership

**Priority/type:** P1, delivery/dependency. **Evidence:** confirmed gap; reported live drift unverified. **Sections:** 11, 13.

**Description and rationale:** There is no named release owner, approved migration procedure, preview-data isolation, runtime parity check, rollback sequence or go/no-go evidence. Missing migration filenames cannot establish live history drift on their own.

**Impact:** Preview testing could use production credentials, a blanket database push could include unrelated pending migrations, or rollback could remove the only recovery route while calls continue.

**Recommended action:** Assign implementation, review, print acceptance and release ownership. Verify deployed Node/Sharp, function settings, OpenAI project access, secrets and tracing. Reconcile live migration history read-only, then follow the production migration skill with separate owner approval for application. Deploy additive schema and flagged code; validate anon access remains unchanged. Roll back by disabling new generation/publication and retaining recoverable data, not dropping tables. Identify exact migrations and deployment IDs in release evidence. Never run a broad push merely to make the local directory match.

### F27. Acceptance tests miss the most expensive failure paths

**Priority/type:** P1, testing/delivery. **Evidence:** confirmed gap and missing command. **Sections:** 10 to 12.

**Description and rationale:** The listed tests largely cover happy paths and simple mocks. [package.json](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/package.json:18) has no `test:utc` script. An aspect-ratio pass does not prove exact dimensions, print quality or approved bytes.

**Impact:** A green suite could still allow duplicate charges, unauthorised access or wrong live artwork.

**Recommended action:** Add the acceptance matrix below and prove the timezone harness actually uses both zones. Run real database concurrency tests in an isolated environment, provider contract tests with recorded/mock responses, browser tests, and an explicitly authorised paid trial. Include cold deployed Sharp tracing and paper QR tests. Do not mark success based on lint/build alone.

### F28. Monitoring stops at spend logging

**Priority/type:** P2, observability/support. **Evidence:** confirmed gap. **Sections:** 6, 9, 11.

**Description and rationale:** No alert conditions, operational owner or reconciliation view is specified for stuck leases, uncertain charges, partial publication, ledger failures or cleanup backlog.

**Impact:** Failures may remain invisible until the owner encounters them again, and cannot easily be traced across services.

**Recommended action:** Correlate event/run/variant/attempt/provider request IDs. Record durations, result codes, usage-accounting status and publish outcomes without secrets or source-image data. Define alerts for persistent failures and unresolved financial outcomes, a stuck-run view and a short recovery runbook. State who investigates and how to disable generation without affecting manual uploads.

### F29. Source-image rights and provider disclosure are unaddressed

**Priority/type:** P2, privacy/content governance. **Evidence:** confirmed omission, not a verified legal breach. **Sections:** 4.4, 5, 6.3.

**Description and rationale:** Uploaded artwork may contain performer photography, third-party branding or private information and is sent to an external provider. “Private bucket” does not describe that transfer or provider retention.

**Impact:** Users may submit inappropriate source material or assume it never leaves this app.

**Recommended action:** Document the permitted source material, responsibility for usage rights and the actual provider data settings before release. Keep prompts limited to necessary public event information; do not attach internal notes by default. Provide a brief explanation in the source step and define application retention/deletion without promising deletion from systems the app does not control.

### F30. A smaller pilot could test the central assumption earlier

**Priority/type:** P3, optional improvement. **Evidence:** recommendation, not a defect. **Sections:** 4, 8, 11, 13.

**Description and rationale:** A full editor is a costly way to learn whether the model can preserve real event copy and design. More pixels alone do not establish better perceived print quality.

**Impact:** Potentially avoids building controls around an unreliable generation step.

**Recommended action:** First compare representative generated variants with the existing manual output, tracking usable-first-result rate, correction effort, billed attempts and printed readability. Fixed initial branding and a default QR position can keep the trial small. If text remains unreliable, consider deterministic text compositing as a later design alternative, with an explicit scope decision rather than silently expanding this build.

## Required acceptance and recovery matrix

| Scenario | Required result |
| --- | --- |
| Two tabs create a run with different sources | One active run; explicit conflict or resume; no silent source replacement |
| Two workers claim one variant | One current claim; stale completion cannot replace the selected result |
| Provider succeeds, storage or response fails | Uncertain/failed save recorded; no automatic assumption that a new request is free |
| Provider 429, exhausted quota, moderation, malformed output | Distinct bounded recovery; no inappropriate automatic retries |
| Regenerate a ready variant, then fail | Previously selected artifact remains available; other variants unchanged |
| Close/reopen editor or expire login | State recovers from the server; no duplicate generation on page load |
| Change logo, source, QR or event date after review | Relevant approval becomes stale; publication requires current review |
| Third publication fails after two successes | Exact durable outcome shown; retry follows the agreed partial/atomic policy |
| Manual upload while a generated run is publishing | Version conflict handled; newer artwork is not silently overwritten |
| Discard during generation or after partial publication | Late output cannot reactivate run; published content follows the agreed rule |
| Ordinary staff/anonymous user requests a draft or another run path | Denied; no leaked signed URLs or privileged storage access |
| Missing bundled logo or QR failure | Visible compositor failure; live artwork retained |
| Maximum source dimensions and concurrent generations | Bounded memory/time, useful error, no stalled permanent claims |
| Final A4 download printed through supported workflow | Minimum QR physical size and readable event copy; correct destination and tracking |
| Slug rename after printing | Same printed code reaches intended event through the agreed durable-link behaviour |
| Event deletion or expired draft cleanup | No live/shared objects removed; orphan recovery and accounting retained |
| Public website, schema images and CheersAI consumers | Square-first and existing exclusions retained after publication and recovery |
| Keyboard, touch, file picker, mobile zoom and screen reader | Full workflow possible without drag-only controls |
| UTC and London date tests | Confirmed different test environments; consistent event date/time output |

## Suggested wording changes only

These replacements are recommendations for the developer's next specification revision, not edits to the supplied document.

- **Section 9.2:** “Claims prevent concurrent local attempts for the same revision. A lost provider response can leave charging uncertain; this is recorded and is not retried automatically as a known-free operation.”
- **Sections 6 and 12:** “Publish accepts an immutable manifest of currently reviewed artifact revisions. Recovery reports the durable outcome for each variant and never substitutes a newly generated artifact without review.”
- **Section 9.1:** “Record token usage per attempt and calculate cost using versioned image and text rates. Missing usage is recorded as unknown, not zero.”
- **Section 6.3/12:** “Unpublished artwork is inaccessible to anonymous users without a valid signed URL. Authorised application access follows the documented permissions and URL-expiry policy.”
- **Section 7.2:** “Preserve the QR's opaque white quiet zone during rendering and resizing. Derive its minimum pixel width from at least 40 mm at the specified print size, rounding upward.”
- **Section 9.5:** “Image bytes do not pass through browser-to-application request or response bodies. The server retrieves the source and handles provider output directly before storing validated artifacts.”

## Readiness, decisions and next steps

**Readiness:** not ready for a reliable fixed-scope implementation estimate or production release. Ready for decision closure and an authorised feasibility trial. No fundamental incompatibility with the current stack was established.

**Required changes:** settle generated-square and publication policies; complete state transitions and versioned approvals; specify truthful accounting and enforced budgets; define permissions and private storage; include durable poster-link behaviour; correct print geometry; move minimum cleanup and failure handling into the first usable release; add deployment and adverse-path acceptance gates.

**Unresolved owner decisions:** D1 square policy; D2 partial versus atomic publication; D3 poster quality and paper acceptance; D4 spend ceilings; D5 eligible staff; D6 poster-link scope; D7 first visible release and fallback; D8 limited paid feasibility-trial authorisation. The actual questions accompany the report in chat. Recommendations remain provisional until answered.

**Major risks:** duplicate charges after uncertain outcomes; stale or mixed published artwork; inaccurate printed copy; working QR pixels with an invalid destination; public exposure through an overbroad draft-signing endpoint; release tests using production credentials; cleanup arriving after storage accumulation has begun. These are specification-derived risks, not verified current incidents.

**Recommended sequence:**

1. Record owner decisions, then revise only the relevant specification clauses and acceptance criteria.
2. Run the small authorised feasibility trial and record quality, cost and timing evidence before committing to the full implementation.
3. Have the developer complete the state, API, permissions, accounting and publication contracts and estimate against them.
4. Validate additive migrations in isolation; obtain separate production migration approval when the exact migration is ready.
5. Build behind a feature flag, retaining the manual upload and prompt fallback. Deliver generation, review, branding, QR, publication recovery and cleanup as a complete pilot workflow.
6. Complete the acceptance matrix, deployed cold-start test and physical print acceptance; release with a named owner, rollback switch and monitoring.

**Done** - Separate developer review delivered, local only. Original specification and application code unchanged; no migration created or applied.

**Next:** Owner decisions and developer specification revision, followed by a separately authorised feasibility trial.
