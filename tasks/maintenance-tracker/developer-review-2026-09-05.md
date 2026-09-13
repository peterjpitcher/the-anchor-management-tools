# Maintenance and improvements tracker: developer review

Date: 2026-09-05

**Owner decisions received:** the [approved decision addendum](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/maintenance-tracker/owner-decisions-2026-09-05.md) now governs implementation. It resolves D1 to D8 and supersedes this review's proposed staff/reporter access, separate Monday digest, phase 2 email deferral and related acceptance scenarios. All interactive access is super-admin only. All outstanding maintenance items must appear in the existing Friday 09:00 London manager email to `manager@the-anchor.pub`, preserving its other content. The findings below remain the historical review of the original specification; use the addendum's revised acceptance requirements when implementing. Technical feasibility and verification work remains outstanding.

**Readiness: suitable for design refinement, not ready to implement unchanged.** The basic scope is proportionate: one item table, notes, photos, an area list and simple filters. The main blockers are the proposed upload path, incomplete audit guarantees, permissions on creation, deletion semantics and reminders that omit undated work. These can be resolved without introducing a project management system.

This is a separate review of the supplied specification. It does not amend or approve that specification. No feature code, migrations, production data or messages were changed.

## Evidence and limits

Reviewed the complete attachment, current working-tree code at base commit `759f1471357ae3a7d5e5b59f51bc4593e8aba2c8`, relevant migration precedents, and current official platform documentation. Existing unrelated working-tree changes were left alone.

Read-only catalogue queries against the linked production Supabase project `tfcasgxopxegwrabvwat` confirmed:

- No public table name matched maintenance, repair, defect, snag, asset or equipment. This supports a new tracker, but is not proof that no related behaviour exists elsewhere.
- Role assignments match the discovery: four super-admin assignments, one `foh_staff`, one `portal_shift_manager`; manager, staff and Deputy have none. These are assignments, not proof of distinct active users or account usage.
- The quoted table areas and venue spaces match production.
- `user_has_permission` returns true for super-admin users before checking explicit permissions.
- Recruitment notes have authenticated SELECT/INSERT policies, a service-role ALL policy and no non-internal triggers. Their creator foreign key has no `ON DELETE SET NULL` clause.
- The live audit schema has `old_values`, `new_values`, actor and timestamp fields. An existing `(resource_type, resource_id, created_at DESC)` index can support the proposed timeline. Ordinary maintenance permission alone does not currently authorise reading everyone else's audit rows.

No maintenance implementation exists to exercise. This review did not run a maintenance browser flow, apply DDL, test a deployed HEIC conversion, or send a digest. Findings about code are static observations; projected failure paths are identified as such, not presented as observed production incidents. No tenancy repair allocation was verified against a lease.

Source attachment SHA-256: `0c9d815f1f741ff2b11ac9424c180eeb9e20357504fe8a64323e954e1f4968f2`.

## Classification

- **P1:** settle before implementing the affected design or committing a release estimate.
- **P2:** specify and verify before accepting the affected phase.
- **P3:** optional improvement or simplification; not a release blocker.
- **Confirmed:** demonstrable omission, contradiction or mismatch in the specification, current code or live catalogue. It does not mean an unbuilt feature has failed in production.
- **Unconfirmed assumption:** requires a targeted proof or owner decision.
- **Optional:** a recommendation beyond the minimum necessary correction.

Each finding includes its section, type, evidence, impact, action and open-question disposition. Owner questions D1 to D8 are raised in the accompanying chat, rather than embedded as unanswered questions in this file. References to them below do not record an agreed decision. Technical unknowns are expressed as developer validation tasks.

## Findings

### F01. The proposed 20MB server-action upload exceeds the hosting limit

**P1 | Confirmed mismatch | Technical feasibility | Sections 2, 4.6, 7, 9**

**Description and rationale:** `next.config.mjs` allows a 20MB server-action body, but this does not raise Vercel's documented 4.5MB function request limit. Server-side compression happens after that limit is encountered. The existing `src/app/actions/event-image-variants.ts` explicitly explains this and uses browser-direct storage uploads. Multipart overhead also means a 20MB file is not a 20MB request.

**Impact:** some ordinary phone photos and the stated maximum cannot use the proposed production path. The request may fail before the action can produce its normal error response.

**Recommended action:** prefer the existing signed-upload pattern for originals, followed by server-side verification and processing from private storage. Authorise the upload and finalisation separately, bound object size and processing resources, and expose only validated output. If a smaller client-compressed path is chosen, prove its accepted formats and maximum request size first. [Vercel function limits](https://vercel.com/docs/functions/limitations).

**Open questions:** no owner decision needed to respect the hosting limit; developer must prove the selected path on the target deployment.

### F02. HEIC support is asserted more strongly than the evidence permits

**P1 | Unconfirmed assumption | Runtime dependency | Sections 2, 7, 9, 10**

**Description and rationale:** `optimiseImage()` contains a HEIC-to-JPEG branch, but decoding support depends on the native build. Existing image tests mock all of Sharp and pass an empty buffer as the HEIC fixture, so they prove method calls, not conversion. Sharp's maintainers state that prebuilt binaries do not support HEIC/HEVC in the referenced discussion. [Sharp maintainer response](https://github.com/lovell/sharp/issues/4472), [installation guidance](https://sharp.pixelplumbing.com/install/).

**Impact:** the primary phone-photo requirement remains a feasibility risk despite the helper already existing. No deployed failure was reproduced in this review.

**Recommended action:** make a real iPhone HEIC decode, rotate, resize and JPEG display test in the target Linux runtime an early gate. Confirm package and native codec availability. If that fails, select and validate a supported converter before estimating the remaining upload work. The current helper also accepts PDF and returns it unchanged; maintenance must reject PDF explicitly rather than copying its full allowlist.

**Open questions:** developer feasibility proof outstanding; no automatic approval to reduce required photo support.

### F03. Immediate photo upload has no parent-item lifecycle

**P1 | Confirmed gap | User journey and data integrity | Sections 4.5, 7**

**Description and rationale:** the new-item form uploads immediately, yet a photo requires an item ID. The document defines neither a saved parent nor a temporary owner before the item form is submitted. Closing the page or failing validation has no defined outcome.

**Impact:** implementations will either create invisible drafts, lose selected images or leave unlinked storage objects.

**Recommended action:** save the small item first and immediately offer photo capture on its detail page. Preserve the saved item if the attachment fails. If pre-save capture is essential, specify temporary ownership, finalisation, cancellation and expiry cleanup explicitly.

**Open questions:** D1, approval of the simpler save-first journey.

### F04. Audit events are neither automatic nor guaranteed by the cited helper

**P1 | Confirmed mismatch | Audit integrity | Sections 2, 5**

**Description and rationale:** `src/services/audit.ts` inserts only values explicitly provided by callers. It logs insertion errors and catches exceptions without propagating failure. Item updates and audit writes are separate operations. `getRecruitmentCandidateTrail()` returns changed key names from `new_values`, not before-and-after values, and its audit query error is not surfaced. Copying it cannot deliver the stated guaranteed field-level history.

**Impact:** a saved change can lack its promised history; a failed trail read can look like an empty trail. The example “Reported to With Greene King” requires data and rendering absent from the cited reader.

**Recommended action:** define the event contract, including creation, changed fields, old/new values, actor, time, success status and stable event identity. For the promised guarantee, commit the mutation and event in the same database transaction through a suitably authorised database operation or trigger. Do not merely throw after a separately committed item update. Surface history read failures and define how retries avoid duplicate events.

**Open questions:** no owner question needed if the existing audit promise stands; developer must select and test an atomic implementation.

### F05. Hard deletion contradicts the preserved audit trail

**P1 | Confirmed contradiction | Retention and destructive operations | Sections 4.4, 4.5, 5, 6**

**Description and rationale:** managers may delete items while notes and photo metadata cascade from the parent. Missing child DELETE policies do not protect the promised history from parent deletion. Service-role operations also bypass the authenticated restrictions. Deleting metadata does not define removal of stored photo bytes.

**Impact:** evidence can disappear, while chargeable or sensitive files may remain orphaned. The claim of database-wide immutability is inaccurate.

**Recommended action:** use `cancelled` for erroneous or abandoned records in phase 1 and omit ordinary hard deletion. Provide a controlled, attributed correction/redaction procedure for wrongly uploaded or sensitive material. Specify retention and object cleanup together. Do not add an archive subsystem unless cancellation is insufficient. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

**Open questions:** D2, retention and exceptional removal policy.

### F06. Email snapshots do not make creator deletion work

**P2 | Confirmed mismatch | Referential integrity | Sections 2, 4.2, 4.4, 4.5**

**Description and rationale:** the live recruitment creator foreign key references `auth.users(id)` without `ON DELETE SET NULL`. The snapshot preserves text, but does not itself permit deletion of a referenced user. Copying that definition would retain this limitation. Item and photo creator foreign-key behaviour is not specified at all.

**Impact:** account removal can be blocked, or later cleanup can accidentally remove attribution.

**Recommended action:** state the intended behaviour for each actor reference. If records must survive user removal, use nullable actor IDs with an appropriate deletion rule while retaining a server-derived identity snapshot under the agreed retention policy. Validate creator removal in an isolated database. This is a maintenance design correction, not authorisation to alter recruitment tables.

**Open questions:** D2 covers retention; developer must make foreign keys match the agreed behaviour.

### F07. Reporters can create items, but protected creation fields are undefined

**P1 | Confirmed ambiguity | Authorisation | Sections 6, 7, 12**

**Description and rationale:** only managers may set costs, status and contractor, but the create form says everything beyond four minimum fields is optional. It does not state which fields a reporter may submit. A permission-only INSERT policy controls whether a row can be inserted, not which submitted business values are acceptable.

**Impact:** hiding fields in the UI may still allow crafted requests or direct Data API inserts to create completed, costed or contractor-assigned records. Creator identity and timestamps can also be forged unless constrained.

**Recommended action:** specify separate reporter and manager input contracts. Suggested reporter fields are kind, title, description, area, priority and spotted date. Set protected defaults and identity server-side. Define manager authority over title, description, kind, area and priority too. Make direct database grants and policies enforce the same restrictions, or close direct mutation access and use a constrained server/database path. Bind photo paths and child rows to an existing authorised item.

**Open questions:** D3, intended access population and field visibility; server enforcement itself is mandatory.

### F08. Role naming and staff access do not match “any staff member”

**P2 | Confirmed gap | Access and navigation | Sections 2, 6, 7, 12**

**Description and rationale:** the real `portal_shift_manager` role is omitted from the permission table. The authenticated layout redirects users with no management permissions to `/portal/shifts`. Adding a grant can therefore change which shell they reach, not just expose one button. In addition, `ActionType` in `src/types/rbac.ts` has no `report` action; adding only `ModuleName` is insufficient.

**Impact:** an intended reporter may be excluded, or portal staff may be moved into an unintended interface. Typed permission calls will need a broader change than stated.

**Recommended action:** map intended users to actual roles and test the entry route for each. If portal access is included, provide a deliberate restricted entry journey. Update both relevant type unions and inspect permission administration displays. State whether `manage` includes viewing/reporting or relies on all three explicit grants.

**Open questions:** D3, especially inclusion of portal-only staff.

### F09. Audit visibility and private fields need an explicit read contract

**P2 | Confirmed omission | Security and privacy | Sections 4, 5, 6, 7**

**Description and rationale:** current audit RLS does not make another user's maintenance events readable merely through `maintenance.view`. Conversely, copying the recruitment admin-client reader without an item permission check would bypass RLS. The proposed staff-wide view also includes costs, contractor contacts, actor emails and potentially sensitive photographs; no field visibility policy is stated.

**Impact:** staff may see an incomplete history or more information than intended. Hiding a cost field while returning it in audit JSON or summary totals would defeat any later visibility restriction.

**Recommended action:** authorise timeline access to the specific maintenance item, select only required event fields, and avoid granting staff general audit access. Decide data visibility across page payloads, photos, timeline, totals and future email. Render user text as text, validate contact links and exclude contact details, photo contents and signed tokens from operational logs.

**Open questions:** D3 for visibility; D2 for retention and redaction.

### F10. The only phase 1 reminder misses undated items

**P1 | Confirmed goal gap | Operational workflow | Sections 1, 7, 8**

**Description and rationale:** target date is optional, but the badge includes only overdue or soon-due items. An undated critical item can remain invisible to the only reminder mechanism. A delayed phase 2 makes this gap indefinite.

**Impact:** the simplest reporting path can defeat the central purpose of preventing forgotten work.

**Recommended action:** preserve quick reporting but include an explicit undated/untriaged queue in phase 1, with a manager responsible for reviewing it. Let the badge link to the exact attention filter it counts. Critical must have a defined operational response; logging it should not imply that anyone has been alerted or a dangerous area has been made unavailable. An assignee field and emergency messaging service are not required to establish that procedure.

**Open questions:** D4, who reviews new and undated work and the urgent-item procedure.

### F11. Digest ageing cannot be derived reliably from the stated fields

**P1 for phase 2 design | Confirmed gap | Data semantics | Sections 4.2, 5, 8**

**Description and rationale:** “with Greene King for more than twenty-one days” requires the start of the current waiting spell, not the initial report date. An unrelated edit changes `updated_at`; a child note need not change it. “Reported over thirty days ago with no activity” could mean never touched or inactive for thirty days. Re-entry into waiting and backdated reporting are unaddressed.

**Impact:** reminders can chase too early, never chase, or mark actively managed work as neglected.

**Recommended action:** define current status-entry time and meaningful activity precisely. Meaningful activity should include agreed edits, notes and photos but not passive views. Choose either explicit maintained timestamps or a reliable event-derived query, after checking existing schema patterns. Define calendar-day boundaries, current waiting spell and the treatment of on-hold and terminal items. Phase 1 should retain the events required for phase 2.

**Open questions:** no extra owner decision required beyond D4 and D7; developer must turn the chosen rules into examples and acceptance tests.

### F12. Completion, reopening and scheduling are incomplete

**P1 | Confirmed gap | State lifecycle | Sections 4.2, 4.3, 7**

**Description and rationale:** `done` requires a completion date without specifying how the transition obtains one. Reopening can leave an old completion date on an active item. `scheduled` promises a booked contractor and diary date, but no appointment field exists and `target_date` is optional. Target date and appointment date are different concepts.

**Impact:** valid user actions may fail, or the screen may promise a booking that was never recorded.

**Recommended action:** define simple manager transitions with done defaulting to today's London date, editable for late recording. Preserve previous completion in history when reopening and define whether the current completion field clears. Specify cancelled-to-open behaviour and whether closed items still accept notes/photos. Either soften `scheduled` to mean arranged with details in a note, or add an explicit scheduling requirement only if needed. Do not imply Google Calendar synchronisation.

**Open questions:** D6, status list and meaning of scheduled.

### F13. Summary totals do not have business definitions

**P2 | Confirmed ambiguity | Reporting and budgeting | Sections 4.2, 7, 8**

**Description and rationale:** open, overdue and estimated spend outstanding lack complete predicates. Landlord items may have costs; null estimates are different from zero. The document does not state currency, VAT basis, whether filters change summaries or whether on-hold items count. Actual cost is a recorded amount, not a reconciled payment ledger.

**Impact:** the owner can mistake a partial estimate for the pub's total financial commitment, or see different totals in the list and digest.

**Recommended action:** define each total with worked examples. A reasonable proposed spend total is estimates for our non-terminal items, with an explicit number of uncosted items and a stated treatment of on-hold work. Treat responsibility-to-confirm separately. Define overdue using London dates, including today's boundary, and distinguish operational estimates from invoices or payments.

**Open questions:** D5, cost basis and ownership of totals. Do not assume a VAT treatment without confirmation.

### F14. Constraints, defaults and immutable fields are incomplete

**P2 | Confirmed omission | Validation and data quality | Sections 4.1 to 4.6, 7**

**Description and rationale:** text enumerations are described without explicit CHECK requirements. Most text lengths, whitespace handling, actor nullability, FK deletion rules and timestamp generation are unspecified. `updated_at` does not update by itself. The reference generator is not defined beyond its first four-digit example.

**Impact:** direct writes can create invalid states, long inputs can burden storage/rendering, and dates/reference values can become inconsistent.

**Recommended action:** specify database and Zod validation together: nonblank bounded text, enum checks, positive file sizes, unique storage paths, FK behaviour, immutable IDs/reference/creator fields, timestamp defaults and update mechanism. Cover sequence concurrency, gaps and values beyond 9,999 without truncation. Define future spotted/completion/taken dates and blank-to-null handling. Test changing `reported_on` when an existing target date would become invalid; do not silently move the target.

**Open questions:** developer to document consistent validation messages; no new owner question beyond D5 and D6.

### F15. Area management lacks permissions and historical behaviour

**P2 | Confirmed omission | Administration | Sections 4.1, 6, 7, 12**

**Description and rationale:** `/settings/maintenance` has no stated permission rule. `maintenance.manage` and `settings.view` are distinct permissions, so page placement alone does not ensure managers can find it. Case-sensitive uniqueness permits cosmetic duplicates; inactive area behaviour is undefined. The proposed extra area names remain unverified suggestions.

**Impact:** managers can be unable to administer the list, or old records can lose a usable area label/filter.

**Recommended action:** authorise area administration explicitly and provide a reachable link. Retain inactive areas on existing items and historical filters, reject them for new selection, and define rename behaviour. Trim and normalise names for uniqueness. Retain an active fallback and handle an area being deactivated while a form is open. No historical name snapshots are needed unless historical labels matter operationally.

**Open questions:** D8, seed list approval.

### F16. Camera capture is a hint, not a complete mobile journey

**P2 | Confirmed overstatement | Usability | Sections 2, 7**

**Description and rationale:** `capture="environment"` is presented as a guarantee of rear-camera launch. Browser support and picker behaviour vary. The specification also supports old photos via `taken_on` but omits a clear gallery journey. [MDN capture reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture).

**Impact:** some users cannot select an existing image, cancel cleanly or recover when capture is unavailable.

**Recommended action:** provide Take photo and Choose existing photo controls, progressively enhanced with capture. Specify selection cancellation, repeat selection of the same file, progress, per-photo failure/retry and permitted file count. Test on the actual supported iOS and Android devices, plus desktop. Define uploaded date versus supplied taken date and the ordering used in the grid/timeline.

**Open questions:** D1 governs save ordering; supported-device testing is a developer acceptance task.

### F17. Upload cleanup and processing limits stop halfway

**P2 | Confirmed omission | Reliability, security and resource use | Sections 4.5, 4.6, 7, 10**

**Description and rationale:** removing an object after metadata failure is only one branch. Cleanup itself can fail; a request can time out after storage succeeds; finalisation can run twice; permissions or parent status can change mid-upload. A bucket MIME list is not proof that file contents have been decoded safely. No photo count, aggregate limit or processing concurrency is specified.

**Impact:** orphan storage, duplicate photos, excessive memory use or unvalidated originals can accumulate.

**Recommended action:** define a bounded upload/finalisation state machine with unique paths and retry identity. Keep unvalidated originals private and unavailable through the photo reader. Verify detected content, decoded dimensions, output size and MIME; use bounded processing concurrency. Record failed cleanup for reconciliation with a defined temporary-file lifetime. Restrict ordinary object overwrite/delete and ensure compensation works for reporters without granting them general deletion rights. Keep each successful attachment when a later one fails.

**Open questions:** developer to select documented limits and validate realistic photos; D2 covers deliberate removal/retention.

### F18. Signed photo display needs expiry and rendering rules

**P2 | Confirmed omission | Integration and privacy | Sections 4.6, 7**

**Description and rationale:** a one-hour signed URL expires while a detail page is open. There is no renewal or failure behaviour. `next.config.mjs` permits Next Image remote optimisation for `/storage/v1/object/public/**`, not the proposed private signed path. This is conditional on using Next Image, not proof that ordinary image elements will fail.

**Impact:** photos can appear broken after inactivity or fail through the chosen image component. Shared signed URLs can remain usable for their validity period after app access changes.

**Recommended action:** authorise URL generation, regenerate expired URLs, define failed-image UI, and persist paths rather than signed URLs. Deliberately choose native image rendering or an appropriately configured private-image strategy; review shared optimiser/browser caching. Use lightweight thumbnails or bounded loading rather than all full-size photos at once. Do not place signed URLs or private images directly into the digest.

**Open questions:** no owner question unless immediate revocation is required; developer must document the chosen expiry trade-off.

### F19. Save, retry and concurrent-edit outcomes are undefined

**P2 | Confirmed gap | Error handling | Sections 7, 10**

**Description and rationale:** there are no outcomes for item/note save failure, a response lost after commit, session expiry, permission revocation or two managers editing the same record. “Editable in place” does not define save/cancel boundaries.

**Impact:** duplicate items/notes, overwritten changes or lost typing can occur, while the user cannot tell which parts saved.

**Recommended action:** explicit save/cancel states, retained inputs on failure, clear partial-success messages and idempotent create/note retries. Detect conflicting updates using a version or checked timestamp and offer reload/reapply. Do not add offline synchronisation; state that saving needs a connection and preserve local form input during recoverable errors. Distinguish not found, denied and temporary read failure without revealing restricted records.

**Open questions:** none; these are acceptance behaviours.

### F20. List, timeline and photo queries are unbounded in the design

**P2 | Confirmed omission | Performance and navigation | Sections 4, 5, 7, 8**

**Description and rationale:** no pagination, default ordering, search semantics or filter persistence is specified. Copying recruitment's fixed 200-note/100-event limits would silently omit older history. Adding a query to `Promise.all` does not make its database cost negligible.

**Impact:** older evidence can disappear, mobile pages become slow and nav counts can add load to every app session.

**Recommended action:** bounded list/photo/timeline pages with stable tie-breaking, explicit “load older” behaviour, debounced title/reference search and preserved filters on return. Specify global versus filtered totals and search wildcard handling. Choose item indexes from actual list/count predicates, including target/status and area access; reuse the existing audit composite index. Measure representative data sizes and agree a latency budget before sign-off. Avoid an external search service for this scope.

**Open questions:** none; developer to document measured limits and query plans before release.

### F21. The nav-count integration has missing security and refresh details

**P2 | Confirmed mismatch | Integration | Sections 2, 8, 9**

**Description and rationale:** the current sidebar uses `navCount`, not the specified `countById` map. Changes also require `OutstandingCounts`, `EMPTY_COUNTS`, client fixtures and cache invalidation. The shared count endpoint authenticates but returns the complete admin-computed count object; hiding a badge is not response-level permission filtering. Current count code also describes badges as work staff can act on, which is not automatically true for a future contractor visit or landlord wait.

**Impact:** stale badges, type/test omissions or disclosure of a maintenance count to users lacking maintenance access. A permanently uncleared badge can undermine attention.

**Recommended action:** reuse the batch/cache, but strip unauthorised counts outside the shared cache. Do not cache user-specific filtering globally. Invalidate the relevant tags after mutations and ensure the badge links to matching actionable results. Define on-hold and landlord-wait treatment and an unavailable-count state rather than presenting query failure as zero.

**Open questions:** D4 informs attention semantics; exact wiring is a developer task.

### F22. Accessibility has no acceptance criteria

**P2 | Confirmed omission | Accessibility | Section 7**

**Description and rationale:** mobile-first layout does not cover keyboard use, labels, screen-reader errors, status announcements, colour-independent badges, focus management or photo descriptions.

**Impact:** some staff cannot complete the reporting or editing journey reliably, especially through inline edits and uploads.

**Recommended action:** adopt an explicit accessibility target and verify labelled inputs, keyboard-operable controls, visible focus, error association, upload status announcements, meaningful photo alternatives, sufficient contrast, zoom/reflow and touch targets. Ensure mobile cards and desktop tables expose the same information. Include empty, no-results, loading and error states. A short manual keyboard and screen-reader pass should accompany automated checks. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

**Open questions:** none; developer to include the acceptance checks without introducing extra workflow steps.

### F23. Deferred permission grants are not an activation gate

**P1 | Confirmed mismatch | Release control | Sections 6, 9**

**Description and rationale:** live `user_has_permission` and `PermissionService.checkUserPermission()` grant super-admin access without explicit permission rows. A delayed migration B can withhold navigation entries but does not necessarily block a direct route or action after code deployment. Permission results are also cached, and client permissions are seeded into context rather than continuously refreshed.

**Impact:** the four super-admin assignments can access a feature before the intended release check, and newly granted staff can see stale navigation. The two migrations create two operational approval windows rather than a complete activation mechanism.

**Recommended action:** retain schema-before-consumer compatibility, but define whether super-admin-only smoke access is intentional. If strict disablement is required, use an explicit module gate applied to pages, actions, counts and jobs. Verify the installed code before staff grants, then invalidate/refresh permission state. Do not claim permission migration B alone prevents access.

**Open questions:** no user decision needed for this review; the release owner must approve the concrete activation and migration plan before application.

### F24. Migration verification, rollback and concurrent work are underspecified

**P2 | Confirmed omission | Deployment and recovery | Section 9**

**Description and rationale:** the plan names schema then code then grants but omits executing DDL against an isolated database, explicit object grants beyond the sequence, generated types, partial deployment recovery and rollback after data exists. The working tree already contains unrelated changes and pending migrations, so an unqualified database push could include other work.

**Impact:** drift, failed inserts, accidental unrelated release or data loss on rollback. A dry-run listing alone would not prove SQL executes.

**Recommended action:** create an isolated branch/checkout for implementation, inspect current applied migration history and dependencies, and review the exact pending set. Execute both migrations in a non-production database; test table/sequence/storage/function grants and RLS under real roles. Apply via the production migration procedure with explicit approval each time, then check migration history, types and anon surface. On code rollback, preserve additive tables/data, disable access as needed and stop the digest; do not drop evidence-bearing tables. Record commit, production deployment ID, migration versions and smoke-test evidence.

**Open questions:** no current approval requested; the later developer must present a concrete release bundle.

### F25. The required UTC test command does not exist

**P1 for the stated test plan | Confirmed mismatch | Test infrastructure | Section 10**

**Description and rationale:** `package.json` contains no `test:utc` script, while `vitest.config.ts` sets `TZ` to Europe/London. Simply prefixing the existing suite with a UTC environment variable is not sufficient evidence that the worker actually runs in UTC.

**Impact:** the required gate cannot currently be executed as written, and apparent two-zone coverage may test London twice.

**Recommended action:** explicitly add a configurable test timezone or a dedicated UTC configuration during implementation. Assert the effective worker timezone, then execute the same relevant tests in both environments. Distinguish client/server timezone tests from testing the actual SQL default in Postgres.

**Open questions:** none; this is required test setup, not optional extra functionality.

### F26. The tests omit the release-critical user and permission paths

**P2 | Confirmed gap | Acceptance testing | Sections 9, 10**

**Description and rationale:** listed tests concentrate on helpers and a few constraints. They omit reporter creation, manager triage, direct permission bypass, actual photo decoding, retries, concurrent edits, completed/reopened work, count consistency and the deployment sequence. RLS UPDATE/DELETE denial can return zero affected rows rather than an exception, so “is refused” needs a data-state assertion.

**Impact:** green tests could coexist with an unusable or unauthorised feature.

**Recommended action:** use the acceptance matrix below. Run database behaviour with actual roles and inspect resulting state; use mocked dependencies for failure injection but real codecs and browsers for the corresponding integration paths. Prove append-only behaviour through every permitted mutation channel, not only one authenticated query. Include the existing expenses upload regression if the shared helper changes.

**Open questions:** none; production mutation-based smoke tests must use an explicitly approved test record and account.

### F27. The digest precedent carries more dependencies than a cron route

**P2 before phase 2 | Confirmed gap | Email integration and delivery | Sections 8, 9, 12**

**Description and rationale:** the checklist route uses checklist-specific settings, an outbox, weekly idempotency, an outbox processor and a queue job. It is not a generic send helper. Copying the route requires deciding whether those domain-specific dependencies are appropriate. Recipient, empty-email behaviour, duplicate section membership, retries and missed schedule recovery are unspecified. Hour gating alone does not recover a missed Monday run.

**Impact:** duplicate or missing email, delivery to an assumed address, or accidental coupling to checklist feature switches.

**Recommended action:** define the smallest supported delivery path with a durable per-week/per-recipient identity, retry policy, no successful-send duplication, bounded catch-up and failure visibility. Reuse generic queue/email facilities where suitable; do not silently reuse checklist settings or tables. Define section overlap, terminal/on-hold exclusions, no-results behaviour and authenticated detail links. Escape user text. Verify the cron bearer, London schedule across DST and communication suspension policy. Calendar integration is mentioned as phase 2 elsewhere but is absent from this build step; keep it explicitly excluded unless separately approved.

**Open questions:** D7, whether to commission phase 2 and the exact verified recipient. No sending is authorised by this review.

### F28. Operational monitoring and support ownership are absent

**P2 | Confirmed omission | Observability and operations | Sections 7 to 10**

**Description and rationale:** a user-visible upload error is specified, but there is no operational record for audit failures, failed cleanup, count failures, repeated conversion failures or a missed digest. No one is named to review these failures or new undated items.

**Impact:** staff can repeatedly encounter a broken path while the owner sees an apparently empty queue or receives no reminder.

**Recommended action:** structured operation/item correlation IDs, explicit provider error fields, and metrics/logs for create, upload, finalisation, audit, cleanup and digest outcomes. Avoid file contents, contacts and signed credentials in logs. Record last successful digest and distinguish delivery failure from an empty result. Use existing monitoring facilities and a short support runbook rather than building a new dashboard. Assign an operational owner and a rollback/escalation path.

**Open questions:** D4 for operational ownership; developer selects existing monitoring hooks.

### F29. The preparatory image refactor is not a proven ten-minute dependency

**P3 | Optional simplification | Scope and estimation | Sections 2, 9**

**Description and rationale:** moving a helper may improve naming, but does not establish codec support or change the user's outcome. The quoted time omits consumer/test verification. Calling the upload path “solved” and the count addition “almost nothing” similarly hides the material checks above.

**Impact:** an optimistic plan can understate the critical path and enlarge a release unnecessarily.

**Recommended action:** retain the helper temporarily or extract it as a separately verified preparatory change. Estimate by deliverables and risks after the real upload proof, not by file count. Keep the shim until all actual consumers and tests are checked.

**Open questions:** none; developer may choose the least disruptive verified approach.

### F30. Keep the useful scope limits and narrow discovery claims

**P3 | Optional clarification | Delivery and scope | Sections 2, 3, 11**

**Description and rationale:** one item table and free-text contractors are appropriate. The absence of a maintenance table does not establish “nothing to collide with”: `table_holds` already contains maintenance semantics in allocation tests, and the feature shares app-wide permissions, storage, counts and audit services. The general description of landlord repair liability is not a verified contractual allocation.

**Impact:** a reader may assume recording a critical fault blocks bookings or automatically establishes who pays.

**Recommended action:** say there is no dedicated tracker, while naming shared dependencies. Explicitly keep booking availability changes, emergency alerts, contractor communications, calendar sync, asset registers and receipt reconciliation outside this release. Keep `to_confirm` as the responsibility default; do not auto-classify liability from an area. Use one agreed triage process before introducing assignees, approvals or a contractor database.

**Open questions:** D4 for operational handling; no contractual allocation should be inferred from this review.

## End-to-end consistency checks

| Journey | Gap in the current specification | Required acceptance outcome |
|---|---|---|
| Bartender logs a broken fitting without a date | Protected creation fields, parentless photo, no reminder | One saved item with server-controlled defaults; photo can retry independently; item enters triage |
| Manager records landlord responsibility and waits | Responsibility does not define start of waiting | Waiting spell begins on the status transition; editing cost does not restart its age |
| Item leaves and re-enters landlord waiting | No current-spell rule | The second waiting spell is counted consistently, with earlier history retained |
| Two managers edit the same item | No conflict outcome | Later editor sees a conflict rather than silently replacing unseen changes |
| Work is completed, reopened and completed again | Completion date lifecycle absent | Current state/date remain coherent and both completion events remain in history |
| Photo storage succeeds but finalisation fails | Cleanup failure/retry not defined | Item remains intact; retry does not duplicate; leftover original is tracked for cleanup |
| Reporter leaves the organisation | Creator FK prevents assumed deletion behaviour | Retained records and identity snapshots follow the agreed account-removal policy |
| Item is logged twice by mistake | Hard deletion conflicts with history | Mistake can be cancelled/corrected without destroying the trail |
| Permissions are granted after deployment | Super-admin bypass and stale context | Direct access follows the actual activation policy; intended staff see refreshed navigation |
| Monday digest is retried after delivery | Hour gate is not a delivery guarantee | No duplicate send; failure and catch-up state remain inspectable |

## Minimum acceptance matrix

These are requirements for implementation verification, not tests performed during this review.

| Gate | Evidence required |
|---|---|
| Feasibility | Real JPEG, PNG, WebP and iPhone HEIC through the selected production-like upload path; orientation, metadata removal, output size and display verified; oversized/corrupt/PDF inputs rejected clearly |
| Permissions | Anonymous, unrelated authenticated user, reporter and manager checked against pages, actions, direct table access, signed URL issuance, upload finalisation and area management; no forged actor/protected creation fields |
| Database | Both migrations actually execute in isolation; constraints, FK deletion behaviour, sequence grants and concurrent references exercised; denied note mutations leave original content intact |
| Audit | Successful mutations retain actor and before/after event atomically; injected audit failure follows the defined transaction outcome; history read errors are visible; older history can be loaded |
| Core journey | Create issue and improvement, add note/photo, triage, change responsibility, record costs, complete, reopen and cancel using the real UI under reporter/manager accounts |
| Date semantics | London summer midnight, UTC worker, both DST boundaries, today/overdue boundaries, seven/fourteen-day windows and status re-entry; database default tested separately |
| Failure recovery | Network interruption before/after commit, duplicate submit, failed storage/metadata/cleanup, expired session and signed URL, permission change mid-upload and concurrent edits |
| Accessibility and mobile | Actual phone capture/gallery/cancel/retry, keyboard and screen-reader checks, error focus, zoom/reflow, equivalent card/table content |
| Performance | Bounded list/timeline/photos, realistic volume measurements, indexed predicates, batch count cache behaviour and per-user response filtering |
| Release | Clean lint/typecheck/test/build gates, deployment tied to commit and alias, exact migration versions, authorised smoke record, affected logs inspected, rollback rehearsed without dropping records |
| Phase 2 | Confirmed recipient, rendered fixture email, suspension/auth checks, one delivery per identity, repeated invocation, missed-window handling and failure monitoring; no real send without approval |

## Specific wording corrections suggested

These replace only the named claims if the specification owner accepts them; the source document remains unchanged.

1. **Section 2, upload size:** “The framework body limit does not override the hosting request limit. Validate the production upload path before implementation; use browser-direct private storage upload where originals exceed the function limit.”
2. **Sections 2 and 4.4, audit precedent:** “The recruitment notes pattern restricts ordinary authenticated edits. The maintenance design must separately define parent deletion, privileged operations, creator removal and atomic field-change history.”
3. **Section 5, automatic events:** “Every authorised maintenance mutation must write a defined event containing actor, time and changed values. The mutation and required event must succeed or fail together.”
4. **Section 7, new-item photos:** “Save the item first, then offer immediate photo capture. Attachment failure must not discard the saved item, and retries must not create duplicate attachments.” This depends on D1.
5. **Section 8, phase 1 attention:** “The attention view includes open work due for action and undated work awaiting triage. The badge and linked list use the same agreed rules.” This depends on D4.
6. **Section 9, activation:** “Permission inserts are not a strict activation switch for super-admin users. Verify intended direct-route access, then grant staff access and refresh permissions after the deployment is confirmed.”

## Overall readiness and delivery recommendation

**Do not begin the full implementation from this document unchanged.** It is ready for a small feasibility check and a bounded clarification pass. No demonstrated issue requires splitting issues and improvements into separate systems, adding project planning machinery or expanding integrations.

Required before the main build:

1. Prove the deployed upload and HEIC path, then settle save ordering and cleanup.
2. Define atomic history, deletion/correction and actor retention together.
3. Define reporter creation fields, read visibility, actual staff roles and timeline access.
4. Add phase 1 triage for undated work; agree completion/reopening, status age and summary predicates.
5. Correct the UTC test setup and replace migration-B-as-activation with an explicit release procedure.

The unresolved business decisions are referenced by D1 to D8 and raised in chat. They concern photo ordering, retention, staff access/visibility, triage, cost basis, statuses, the optional digest and seed areas. Technical unknowns should be closed by the developer through proofs, not passed to the owner as implementation choices.

**Major risks:** phone-photo failure in the hosting runtime; changes without durable history; loss of evidence through deletion; reporter privilege bypass; undated work remaining invisible; and release/cron behaviour that differs from the assumed permission and scheduling model.

Recommended sequence:

1. Close the upload feasibility proof and owner decisions, then produce a short decision addendum and field/state/permission matrix. Do not rewrite the entire specification to introduce extra scope.
2. Build and verify the smallest vertical slice in an isolated environment: reporter creates one item, attaches a real photo, manager changes status, both see the authorised history and attention result.
3. Complete lists, areas, costs, recovery, accessibility and the acceptance matrix; review the exact migration/deployment bundle.
4. Obtain the required production approvals, apply the schema before consumers, verify the actual deployment, enable intended access and run the authorised smoke path. Keep rollback additive and data-preserving.
5. Commission the digest separately after its recipient, delivery semantics and monitoring are agreed. Calendar work remains outside that phase unless explicitly added.

**Review status: delivered locally only.** Only this report was created. The attachment, original local plan, application files, shared task tracking and all existing unrelated changes were deliberately left untouched. No maintenance migration was created or applied, and no deployment was made.
