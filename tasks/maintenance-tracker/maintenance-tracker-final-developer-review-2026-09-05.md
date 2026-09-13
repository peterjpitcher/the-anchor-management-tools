# Maintenance and improvements tracker: final critical review and developer handoff

Date: 2026-09-05

**Final consolidated review, incorporating all owner feedback.** This is the single document to give the developer. It includes the critical findings, approved decisions, required corrections, acceptance criteria and delivery recommendations. The developer does not need the earlier review or decision addendum. The original specification remains unchanged.

**Readiness: the business scope is settled, but the original specification is not ready to implement unchanged.** The principal technical dependencies are the real photo/HEIC upload path, durable audit history, super-admin-only enforcement and identifying the existing Friday managers email. These should be resolved before committing a full delivery estimate. The single item table, notes, photos, editable areas and simple filters remain a proportionate design.

## 1. Approved requirements

These decisions are final owner feedback and take precedence over conflicting proposals in the original specification. Do not ask the owner to approve them again.

| Topic | Agreed requirement |
|---|---|
| Photo journey | Save the item first, then add photos. Attachment failure must not discard the item. |
| Mistakes and deletion | Cancel mistaken items rather than ordinarily deleting them. Exceptional removal must be controlled and attributed, and only a super-admin may perform it. |
| Access | Super-admins only for all interactive actions, including viewing, creating, editing, notes, photos, history, costs and area administration. Other roles have no maintenance access. |
| Weekly email | Include all outstanding issues and improvements in the existing Friday managers email at 09:00 Europe/London to manager@the-anchor.pub, alongside everything already in that email. |
| Email scope | Extend the existing email as part of this delivery. No separate Monday maintenance digest and no optional phase 2 deferral of this requirement. |
| Cost basis | Show our open estimates separately from unknown costs, in pounds including VAT. Unknown is not zero. |
| Statuses | Keep all eight statuses. Record scheduled visit details in notes initially; no calendar integration. |
| Areas | Use the approved fifteen editable seed areas listed below. |

The recipient and schedule come directly from the owner's feedback. Delivery to that mailbox is an approved system operation; it does not grant the mailbox account interactive app access. Detail links must still require a super-admin login.

Approved statuses: `reported`, `quoting`, `awaiting_landlord` (displayed as With Greene King), `scheduled`, `in_progress`, `on_hold`, `done`, `cancelled`.

Approved areas: Main Bar, Dining Room, Kitchen, Cellar, Toilets (Ladies), Toilets (Gents), Toilets (Accessible), Beer Garden and Terrace, Car Park, Exterior and Building, Function Room, Staff Areas, Plant and Utilities, Signage, Other.

**Outstanding means every item other than done or cancelled.** The email must include both kinds, all priorities, all responsibility values, undated work, on-hold work and future-dated work. Age and due-date filters must not remove items. List each once and retrieve the complete set, not just the first UI or database page.

Recommended email presentation is a compact maintenance section with reference, title, area, status, priority, responsibility, target date (or unset) and an authenticated detail link. This presentation is a developer recommendation, not an additional owner-supplied fact. Preserve the existing email even when no maintenance items are outstanding. On maintenance-read failure, retain its other sections and visibly mark maintenance unavailable rather than implying the count is zero. If the existing email has other recipients, verify that maintenance content is not automatically shared beyond the approved mailbox.

## 2. Evidence and verification limits

This report consolidates the source inspection, read-only production catalogue checks and platform documentation review conducted on 2026-09-05. The inspected working tree had base commit `759f1471357ae3a7d5e5b59f51bc4593e8aba2c8` and unrelated uncommitted work. Recheck changed code before implementation.

Read-only checks against production Supabase project `tfcasgxopxegwrabvwat` confirmed:

- No public table name matched maintenance, repair, defect, snag, asset or equipment. This supports a dedicated new tracker but is not proof that no related behaviour exists.
- Four super-admin role assignments, one FOH staff assignment and one portal shift manager assignment; manager, staff and Deputy had none. These are role assignments, not evidence of account activity.
- The quoted existing table areas and venue spaces matched production. The wider maintenance seed list is separately approved by the owner.
- `user_has_permission` returns true for super-admin users before checking explicit permission rows.
- Recruitment notes have authenticated SELECT/INSERT policies, a service-role ALL policy and no non-internal triggers. Their creator foreign key has no ON DELETE SET NULL clause.
- The audit schema contains before/after values, actor and timestamps. Its existing `(resource_type, resource_id, created_at DESC)` index can support the proposed trail.

Existing Friday email integration remains unverified. Source inspection found:

| Inspected source | Observed behaviour |
|---|---|
| `src/app/api/cron/private-bookings-weekly-summary/route.ts` | Normal sends gated to Monday, default 09:00 London; hourly cron invocation; bookings, pending SMS and stale outcomes in its payload. |
| `src/app/api/cron/checklists-weekly-summary/route.ts` | Monday 09:00 London via the checklist outbox. |
| `vercel.json`, rota manager alert | Sunday at 18:00 UTC; no Friday-specific cron entry found in the inspected configuration. |

Searches of source, tasks, documentation and scripts did not identify the combined Friday email described by the owner. This is a limit of the inspected checkout, not a claim that the email does not exist or is broken. The developer must locate the actual producer, deployed version or existing external integration and capture its current content before extending it. Do not substitute either Monday email by assumption.

No maintenance browser flow, deployed HEIC conversion, database mutation, migration or email send was performed for this review. Technical code findings are static observations unless explicitly attributed to the live catalogue. Predicted failure paths are not reported as observed production incidents. No lease-based repair responsibility was verified. Implementation verification remains required.

Original specification attachment SHA-256: `0c9d815f1f741ff2b11ac9424c180eeb9e20357504fe8a64323e954e1f4968f2`.

## 3. Priority and finding types

- **P1:** resolve before implementing the affected design or promising a full release estimate.
- **P2:** specify and verify before acceptance of the feature.
- **P3:** optional simplification or improvement; not a release blocker.
- **Confirmed:** a demonstrated omission, contradiction or mismatch in the original specification, inspected source or catalogue, not an assertion that an unbuilt feature failed in production.
- **Resolved:** the owner has selected the direction; implementation and verification may remain.
- **Unconfirmed assumption:** requires a technical proof, not a repeated owner approval.

Each finding includes the original specification section, description, rationale, impact, priority, type, recommended action and decision/remaining-work disposition. There are no unanswered owner questions in this handoff. Remaining technical choices are developer tasks, identified explicitly rather than disguised as approved business decisions.

## 4. Findings and required responses

### F01. The proposed 20MB server-action upload exceeds the hosting limit

**P1 | Confirmed mismatch | Technical feasibility | Sections 2, 4.6, 7, 9**

**Description and rationale:** `next.config.mjs` allows a 20MB server-action body, but this does not raise Vercel's documented 4.5MB function request limit. Server-side compression happens after that limit is encountered. The existing `src/app/actions/event-image-variants.ts` explicitly explains this and uses browser-direct storage uploads. Multipart overhead also means a 20MB file is not a 20MB request.

**Impact:** some ordinary phone photos and the stated maximum cannot use the proposed production path. The request may fail before the action can produce its normal error response.

**Recommended action:** prefer the existing signed-upload pattern for originals, followed by server-side verification and processing from private storage. Authorise the upload and finalisation separately, bound object size and processing resources, and expose only validated output. If a smaller client-compressed path is chosen, prove its accepted formats and maximum request size first. [Vercel function limits](https://vercel.com/docs/functions/limitations).

**Decision / remaining work:** No owner decision outstanding. Developer must prove the selected upload path on the target hosting runtime.

### F02. HEIC support is asserted more strongly than the evidence permits

**P1 | Unconfirmed assumption | Runtime dependency | Sections 2, 7, 9, 10**

**Description and rationale:** `optimiseImage()` contains a HEIC-to-JPEG branch, but decoding support depends on the native build. Existing image tests mock all of Sharp and pass an empty buffer as the HEIC fixture, so they prove method calls, not conversion. Sharp's maintainers state that prebuilt binaries do not support HEIC/HEVC in the referenced discussion. [Sharp maintainer response](https://github.com/lovell/sharp/issues/4472), [installation guidance](https://sharp.pixelplumbing.com/install/).

**Impact:** the primary phone-photo requirement remains a feasibility risk despite the helper already existing. No deployed failure was reproduced in this review.

**Recommended action:** make a real iPhone HEIC decode, rotate, resize and JPEG display test in the target Linux runtime an early gate. Confirm package and native codec availability. If that fails, select and validate a supported converter before estimating the remaining upload work. The current helper also accepts PDF and returns it unchanged; maintenance must reject PDF explicitly rather than copying its full allowlist.

**Decision / remaining work:** No owner decision outstanding. Real HEIC conversion remains an unverified technical dependency; do not silently reduce format support.

### F03. Save the item before uploading photos

**P1 | Confirmed original gap, owner decision resolved | User journey and data integrity | Sections 4.5, 7**

**Description and rationale:** The original form uploaded immediately although each photo required a saved item ID. The owner has approved saving the item first, then adding photos. This removes the need for pre-save drafts or temporary parent ownership.

**Impact:** Without the agreed ordering, validation failure or page abandonment can leave invisible items, lost photos or unlinked objects.

**Recommended action:** After a successful item save, open its detail page and offer immediate photo capture or gallery selection. Keep the saved item intact if a photo fails. Display each attachment result and support safe retry. Do not implement pre-save photo uploading.

**Decision / remaining work:** Owner decision settled. Implement and verify save-first capture and independent attachment recovery.

### F04. Audit events are neither automatic nor guaranteed by the cited helper

**P1 | Confirmed mismatch | Audit integrity | Sections 2, 5**

**Description and rationale:** `src/services/audit.ts` inserts only values explicitly provided by callers. It logs insertion errors and catches exceptions without propagating failure. Item updates and audit writes are separate operations. `getRecruitmentCandidateTrail()` returns changed key names from `new_values`, not before-and-after values, and its audit query error is not surfaced. Copying it cannot deliver the stated guaranteed field-level history.

**Impact:** a saved change can lack its promised history; a failed trail read can look like an empty trail. The example “Reported to With Greene King” requires data and rendering absent from the cited reader.

**Recommended action:** define the event contract, including creation, changed fields, old/new values, actor, time, success status and stable event identity. For the promised guarantee, commit the mutation and event in the same database transaction through a suitably authorised database operation or trigger. Do not merely throw after a separately committed item update. Surface history read failures and define how retries avoid duplicate events.

**Decision / remaining work:** No owner decision outstanding. Developer must implement and verify atomic mutation/history behaviour and history-read errors.

### F05. Hard deletion contradicts the preserved audit trail

**P1 | Confirmed original contradiction, owner decision resolved | Retention and destructive operations | Sections 4.4, 4.5, 5, 6**

**Description and rationale:** the original specification allowed managers to delete items while notes and photo metadata cascade from the parent. Missing child DELETE policies do not protect the promised history from parent deletion. Service-role operations also bypass the authenticated restrictions. Deleting metadata does not define removal of stored photo bytes.

**Impact:** evidence can disappear, while chargeable or sensitive files may remain orphaned. The claim of database-wide immutability is inaccurate.

**Recommended action:** use `cancelled` for erroneous or abandoned records in phase 1 and omit ordinary hard deletion. Provide a controlled, attributed correction/redaction procedure for wrongly uploaded or sensitive material. Specify retention and object cleanup together. Do not add an archive subsystem unless cancellation is insufficient. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

**Decision / remaining work:** Owner approved cancellation instead of ordinary deletion and controlled exceptional removal. All interactive removal authority is super-admin only. Implement the redaction/cleanup procedure without treating cancellation as deletion.

### F06. Email snapshots do not make creator deletion work

**P2 | Confirmed mismatch | Referential integrity | Sections 2, 4.2, 4.4, 4.5**

**Description and rationale:** the live recruitment creator foreign key references `auth.users(id)` without `ON DELETE SET NULL`. The snapshot preserves text, but does not itself permit deletion of a referenced user. Copying that definition would retain this limitation. Item and photo creator foreign-key behaviour is not specified at all.

**Impact:** account removal can be blocked, or later cleanup can accidentally remove attribution.

**Recommended action:** state the intended behaviour for each actor reference. If records must survive user removal, use nullable actor IDs with an appropriate deletion rule while retaining a server-derived identity snapshot under the agreed retention policy. Validate creator removal in an isolated database. This is a maintenance design correction, not authorisation to alter recruitment tables.

**Decision / remaining work:** Ordinary evidence preservation is settled. Developer must specify actor-FK deletion behaviour and preserve trusted snapshots; the owner has not supplied a numerical retention period.

### F07. Enforce super-admin-only access on every path

**P1 | Confirmed original ambiguity, owner decision resolved | Authorisation | Sections 6, 7, 12**

**Description and rationale:** The owner has replaced the original reporter/manager permission split with super-admins only for all actions, including viewing. A hidden nav item or generic maintenance permission check alone is not the complete role boundary.

**Impact:** Non-super-admin users could otherwise obtain records, counts, photos or mutation access through direct requests, even when the UI hides the feature.

**Recommended action:** Apply the super-admin requirement to pages, actions, query responses, database policies, photo upload/finalisation, URL signing, timeline and area administration. Deny manager, staff, FOH and portal-only roles. A maintenance permission granted to a different role must not override this restriction. Bind creator identity and timestamps to trusted server/database values; validate all editable fields. Keep privileged database clients server-side.

**Decision / remaining work:** Owner decision settled. No staff reporting flow, portal expansion or reporter-specific field matrix is required. Verify role enforcement and resistance to crafted inputs.

### F08. Simplify permission wiring without opening staff access

**P2 | Resolved scope, implementation detail remains | Access and navigation | Sections 2, 6, 7, 12**

**Description and rationale:** The original plan added a maintenance module and a report action, although ActionType in src/types/rbac.ts does not include report. The broader staff and portal journeys that motivated that split are now excluded.

**Impact:** Blindly following the original matrix adds unnecessary types, grants and interface paths, and contradicts the agreed access policy.

**Recommended action:** Use the smallest permission representation consistent with existing navigation and administration patterns while enforcing the actual super-admin role. Reuse existing action names where appropriate; add any required module/action types consistently. Do not grant maintenance access to other roles or change the staff portal shell. Test a super-admin and each excluded role.

**Decision / remaining work:** Owner decision settled. Developer chooses minimal internal wiring; all user-facing access remains super-admin only.

### F09. Protect audit and photo reads as well as item edits

**P2 | Confirmed implementation gap | Security and privacy | Sections 4, 5, 6, 7**

**Description and rationale:** The existing recruitment trail reader uses an admin client. Copying it without a super-admin check would bypass normal database restrictions. Audit rows, actor emails, contractor contacts and photos require the same access boundary as the item.

**Impact:** Restricted information can leak through history, signed URLs, aggregate responses or raw JSON despite protected edit controls.

**Recommended action:** Authorise access to the specific item before reading its history or issuing photo URLs. Select only required event fields and avoid widening general audit access. Apply the role boundary to totals and all payloads. Render user text as text, validate contact links, and keep contact details, photo contents and signed tokens out of operational logs. The expressly approved Friday email is a system delivery to the manager mailbox; it does not grant its reader app access.

**Decision / remaining work:** Visibility policy is settled: super-admin-only interactive access. Developer must implement equivalent protection across all read paths.

### F10. Include undated work in the agreed Friday email

**P1 | Confirmed original goal gap, owner decision resolved | Operational workflow | Sections 1, 7, 8**

**Description and rationale:** The original phase 1 reminder counted only items with due dates while target date was optional. The owner has now required all outstanding items in the existing Friday 09:00 London managers email to manager@the-anchor.pub, alongside its existing content.

**Impact:** Deferred or date-filtered maintenance reminders would still omit undated, on-hold or distant work and fail the agreed purpose.

**Recommended action:** Include every issue and improvement whose status is neither done nor cancelled, regardless of priority, date, responsibility or activity. Preserve all existing email sections. Keep undated work visible in the app and make the nav badge link to the same narrower date filter it counts. The email is a required part of this delivery, not an optional later digest. Do not imply that logging a critical item sends an immediate alert or blocks bookings.

**Decision / remaining work:** Owner decision settled. No separate human triage assignee or emergency notification service was specified; do not invent one. Complete the Friday integration before feature sign-off.

### F11. Remove obsolete age filters from email inclusion

**P3 | Optional simplification enabled by owner decision | Data semantics | Sections 4.2, 5, 8**

**Description and rationale:** The original digest selected landlord waits over twenty-one days and inactivity over thirty days without defining current status age or meaningful activity. The approved email instead includes all outstanding items.

**Impact:** Implementing the former age predicates adds avoidable schema/query complexity and can wrongly exclude work from the complete list.

**Recommended action:** Do not use age or inactivity as an inclusion filter. Retain ordinary event timestamps and field history. Dedicated status-entry/activity fields are unnecessary solely for the approved email. If age labels are added later, define current waiting spell, re-entry and meaningful activity before calculating them.

**Decision / remaining work:** Original age-based inclusion is superseded. No further owner decision or specialised ageing machinery is needed for this release.

### F12. Define completion and reopening while keeping eight statuses

**P1 | Confirmed remaining lifecycle gap | State lifecycle | Sections 4.2, 4.3, 7**

**Description and rationale:** The owner approved all eight statuses and recording scheduled visit details in notes. The done constraint still needs a UI transition, and reopening must not leave an incoherent current completion date. A target date is not an appointment time.

**Impact:** Valid actions can fail or present misleading completion/scheduling information.

**Recommended action:** Use simple super-admin transitions. Default completion to today in London, editable for late recording. Recommended behaviour is to clear the current completed_on value when reopening while retaining prior completion events in history. Define cancelled-to-open behaviour and whether closed items accept further notes/photos. Record scheduled visit details in notes; do not imply a calendar event exists. Document date validation and avoid a complex transition engine.

**Decision / remaining work:** Status list and scheduling approach settled. Developer must specify and test completion/reopening and closed-item behaviour.

### F13. Define totals using the approved cost basis

**P2 | Confirmed original ambiguity, partly resolved | Reporting and budgeting | Sections 4.2, 7, 8**

**Description and rationale:** The owner approved our open estimates in pounds including VAT, with unknown costs kept separate. The original document left currency, VAT, ownership and null amounts undefined. Actual cost remains a recorded amount rather than a reconciled payment.

**Impact:** Incorrect grouping can inflate the pub budget or present missing estimates as zero.

**Recommended action:** Define open as non-terminal, including on_hold. Sum non-null estimates on open items with responsibility us and separately count uncosted items. Show landlord and responsibility-to-confirm amounts separately. Apply GBP including VAT consistently to monetary entry and display; do not invent tax calculations. Recommended list summaries follow the active filters and are labelled as filtered when applicable. Define overdue as target_date before today in London on an open item; due today is not overdue. Reuse these predicates where applicable and test worked examples.

**Decision / remaining work:** Owner cost decision settled. Developer must document summary/filter behaviour and test null, zero, on-hold and ownership cases.

### F14. Constraints, defaults and immutable fields are incomplete

**P2 | Confirmed omission | Validation and data quality | Sections 4.1 to 4.6, 7**

**Description and rationale:** text enumerations are described without explicit CHECK requirements. Most text lengths, whitespace handling, actor nullability, FK deletion rules and timestamp generation are unspecified. `updated_at` does not update by itself. The reference generator is not defined beyond its first four-digit example.

**Impact:** direct writes can create invalid states, long inputs can burden storage/rendering, and dates/reference values can become inconsistent.

**Recommended action:** specify database and Zod validation together: nonblank bounded text, enum checks, positive file sizes, unique storage paths, FK behaviour, immutable IDs/reference/creator fields, timestamp defaults and update mechanism. Cover sequence concurrency, gaps and values beyond 9,999 without truncation. Define future spotted/completion/taken dates and blank-to-null handling. Test changing `reported_on` when an existing target date would become invalid; do not silently move the target.

**Decision / remaining work:** No owner decision outstanding on cost basis or statuses. Developer must document validation boundaries and consistent errors.

### F15. Use the approved areas with durable historical behaviour

**P2 | Confirmed original omission, partly resolved | Administration | Sections 4.1, 6, 7, 12**

**Description and rationale:** The owner approved the fifteen editable seed areas and super-admin-only administration. Name normalisation, inactive areas and concurrent deactivation still need defined behaviour.

**Impact:** Cosmetic duplicate names can accumulate, or existing records can lose meaningful labels and filters.

**Recommended action:** Seed the approved list in this report. Make settings reachable to super-admins and deny other roles. Trim and normalise names for uniqueness. Keep inactive areas visible on existing items and historical filters, but reject them for new selection. Handle an area deactivated while a form is open. Recommend current area names on existing items rather than adding historical label snapshots; retain the audit record of area changes.

**Decision / remaining work:** Owner seed and access decisions settled. Developer must implement deactivation, rename and validation behaviour.

### F16. Camera capture is a hint, not a complete mobile journey

**P2 | Confirmed overstatement | Usability | Sections 2, 7**

**Description and rationale:** `capture="environment"` is presented as a guarantee of rear-camera launch. Browser support and picker behaviour vary. The specification also supports old photos via `taken_on` but omits a clear gallery journey. [MDN capture reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture).

**Impact:** some users cannot select an existing image, cancel cleanly or recover when capture is unavailable.

**Recommended action:** provide Take photo and Choose existing photo controls, progressively enhanced with capture. Specify selection cancellation, repeat selection of the same file, progress, per-photo failure/retry and permitted file count. Test on the actual supported iOS and Android devices, plus desktop. Define uploaded date versus supplied taken date and the ordering used in the grid/timeline.

**Decision / remaining work:** Save-first ordering is approved. Developer must verify supported devices, gallery selection and recovery.

### F17. Upload cleanup and processing limits stop halfway

**P2 | Confirmed omission | Reliability, security and resource use | Sections 4.5, 4.6, 7, 10**

**Description and rationale:** removing an object after metadata failure is only one branch. Cleanup itself can fail; a request can time out after storage succeeds; finalisation can run twice; permissions or parent status can change mid-upload. A bucket MIME list is not proof that file contents have been decoded safely. No photo count, aggregate limit or processing concurrency is specified.

**Impact:** orphan storage, duplicate photos, excessive memory use or unvalidated originals can accumulate.

**Recommended action:** define a bounded upload/finalisation state machine with unique paths and retry identity. Keep unvalidated originals private and unavailable through the photo reader. Verify detected content, decoded dimensions, output size and MIME; use bounded processing concurrency. Record failed cleanup for reconciliation with a defined temporary-file lifetime. Restrict ordinary object overwrite/delete and ensure cleanup compensation is restricted to its authorised operation rather than opening general deletion access. Keep each successful attachment when a later one fails.

**Decision / remaining work:** Cancellation and exceptional removal are settled. Developer must select resource limits and verify retry, finalisation and cleanup failures.

### F18. Signed photo display needs expiry and rendering rules

**P2 | Confirmed omission | Integration and privacy | Sections 4.6, 7**

**Description and rationale:** a one-hour signed URL expires while a detail page is open. There is no renewal or failure behaviour. `next.config.mjs` permits Next Image remote optimisation for `/storage/v1/object/public/**`, not the proposed private signed path. This is conditional on using Next Image, not proof that ordinary image elements will fail.

**Impact:** photos can appear broken after inactivity or fail through the chosen image component. Shared signed URLs can remain usable for their validity period after app access changes.

**Recommended action:** authorise URL generation, regenerate expired URLs, define failed-image UI, and persist paths rather than signed URLs. Deliberately choose native image rendering or an appropriately configured private-image strategy; review shared optimiser/browser caching. Use lightweight thumbnails or bounded loading rather than all full-size photos at once. Do not place signed URLs or private images directly into the digest.

**Decision / remaining work:** No further owner decision requested. Developer must document signed-URL expiry/revocation limits and verify the chosen private-image rendering path.

### F19. Save, retry and concurrent-edit outcomes are undefined

**P2 | Confirmed gap | Error handling | Sections 7, 10**

**Description and rationale:** there are no outcomes for item/note save failure, a response lost after commit, session expiry, permission revocation or two super-admins editing the same record. “Editable in place” does not define save/cancel boundaries.

**Impact:** duplicate items/notes, overwritten changes or lost typing can occur, while the user cannot tell which parts saved.

**Recommended action:** explicit save/cancel states, retained inputs on failure, clear partial-success messages and idempotent create/note retries. Detect conflicting updates using a version or checked timestamp and offer reload/reapply. Do not add offline synchronisation; state that saving needs a connection and preserve local form input during recoverable errors. Distinguish not found, denied and temporary read failure without revealing restricted records.

**Decision / remaining work:** No owner decision outstanding. Implement and test the specified recovery and conflict behaviours.

### F20. List, timeline and photo queries are unbounded in the design

**P2 | Confirmed omission | Performance and navigation | Sections 4, 5, 7, 8**

**Description and rationale:** no pagination, default ordering, search semantics or filter persistence is specified. Copying recruitment's fixed 200-note/100-event limits would silently omit older history. Adding a query to `Promise.all` does not make its database cost negligible.

**Impact:** older evidence can disappear, mobile pages become slow and nav counts can add load to every app session.

**Recommended action:** bounded list/photo/timeline pages with stable tie-breaking, explicit “load older” behaviour, debounced title/reference search and preserved filters on return. Specify global versus filtered totals and search wildcard handling. Choose item indexes from actual list/count predicates, including target/status and area access; reuse the existing audit composite index. Measure representative data sizes and agree a latency budget before sign-off. Avoid an external search service for this scope.

**Decision / remaining work:** No owner decision outstanding. Developer must document bounded loading, measured performance and query plans.

### F21. The nav-count integration has missing security and refresh details

**P2 | Confirmed mismatch | Integration | Sections 2, 8, 9**

**Description and rationale:** the current sidebar uses `navCount`, not the specified `countById` map. Changes also require `OutstandingCounts`, `EMPTY_COUNTS`, client fixtures and cache invalidation. The shared count endpoint authenticates but returns the complete admin-computed count object; hiding a badge is not response-level permission filtering. Current count code also describes badges as work staff can act on, which is not automatically true for a future contractor visit or landlord wait.

**Impact:** stale badges, type/test omissions or disclosure of a maintenance count to users lacking maintenance access. A permanently uncleared badge can undermine attention.

**Recommended action:** reuse the batch/cache, but strip unauthorised counts outside the shared cache. Do not cache user-specific filtering globally. Invalidate the relevant tags after mutations and ensure the badge links to matching actionable results. Define on-hold and landlord-wait treatment and an unavailable-count state rather than presenting query failure as zero.

**Decision / remaining work:** Only super-admins may receive maintenance counts. The Friday email independently includes all outstanding items; developer must align the nav count with its own linked filter.

### F22. Accessibility has no acceptance criteria

**P2 | Confirmed omission | Accessibility | Section 7**

**Description and rationale:** mobile-first layout does not cover keyboard use, labels, screen-reader errors, status announcements, colour-independent badges, focus management or photo descriptions.

**Impact:** some staff cannot complete the reporting or editing journey reliably, especially through inline edits and uploads.

**Recommended action:** adopt an explicit accessibility target and verify labelled inputs, keyboard-operable controls, visible focus, error association, upload status announcements, meaningful photo alternatives, sufficient contrast, zoom/reflow and touch targets. Ensure mobile cards and desktop tables expose the same information. Include empty, no-results, loading and error states. A short manual keyboard and screen-reader pass should accompany automated checks. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

**Decision / remaining work:** No owner decision outstanding. Include keyboard, screen-reader, mobile and error-state verification.

### F23. Replace the staff-grant release sequence

**P1 | Confirmed mismatch, scope simplified | Release control | Sections 6, 9**

**Description and rationale:** Live user_has_permission and PermissionService.checkUserPermission grant super-admin access before checking explicit permission rows. The original deferred migration B is therefore not a strict activation gate. Staff grants are now explicitly excluded.

**Impact:** A feature can be directly accessible to super-admins after code deployment even if navigation/permission inserts are delayed. Following the original staff-grant step would violate the approved scope.

**Recommended action:** Deploy schema before code that reads it. Plan super-admin smoke access deliberately. If the release needs a disabled state, enforce an explicit gate on pages, actions, counts and the maintenance email section; do not assume missing permission rows disable it. Use only the metadata/grants needed for super-admin operation and refresh cached navigation when appropriate. Do not implement a later staff-access release.

**Decision / remaining work:** Access scope settled. Developer must present the concrete activation and rollback procedure with the release bundle.

### F24. Migration verification, rollback and concurrent work are underspecified

**P2 | Confirmed omission | Deployment and recovery | Section 9**

**Description and rationale:** the plan names schema then code then grants but omits executing DDL against an isolated database, explicit object grants beyond the sequence, generated types, partial deployment recovery and rollback after data exists. The working tree already contains unrelated changes and pending migrations, so an unqualified database push could include other work.

**Impact:** drift, failed inserts, accidental unrelated release or data loss on rollback. A dry-run listing alone would not prove SQL executes.

**Recommended action:** create an isolated branch/checkout for implementation, inspect current applied migration history and dependencies, and review the exact pending set. Execute every migration in the revised release bundle in a non-production database; test table/sequence/storage/function grants and RLS under real roles. Apply via the production migration procedure with explicit approval each time, then check migration history, types and anon surface. On code rollback, preserve additive tables/data, disable maintenance access and its email section as needed while preserving the existing Friday email; do not drop evidence-bearing tables. Record commit, production deployment ID, migration versions and smoke-test evidence.

**Decision / remaining work:** No new production approval requested in this review. Developer must present and verify the exact isolated migration/deployment bundle.

### F25. The required UTC test command does not exist

**P1 for the stated test plan | Confirmed mismatch | Test infrastructure | Section 10**

**Description and rationale:** `package.json` contains no `test:utc` script, while `vitest.config.ts` sets `TZ` to Europe/London. Simply prefixing the existing suite with a UTC environment variable is not sufficient evidence that the worker actually runs in UTC.

**Impact:** the required gate cannot currently be executed as written, and apparent two-zone coverage may test London twice.

**Recommended action:** explicitly add a configurable test timezone or a dedicated UTC configuration during implementation. Assert the effective worker timezone, then execute the same relevant tests in both environments. Distinguish client/server timezone tests from testing the actual SQL default in Postgres.

**Decision / remaining work:** No owner decision outstanding. Make both timezone test runs real and verify the effective worker timezone.

### F26. The tests omit the release-critical user and permission paths

**P2 | Confirmed gap | Acceptance testing | Sections 9, 10**

**Description and rationale:** listed tests concentrate on helpers and a few constraints. They omit super-admin creation and triage, direct permission bypass, actual photo decoding, retries, concurrent edits, completed/reopened work, count consistency and the deployment sequence. RLS UPDATE/DELETE denial can return zero affected rows rather than an exception, so “is refused” needs a data-state assertion.

**Impact:** green tests could coexist with an unusable or unauthorised feature.

**Recommended action:** use the acceptance matrix below. Run database behaviour with actual roles and inspect resulting state; use mocked dependencies for failure injection but real codecs and browsers for the corresponding integration paths. Prove append-only behaviour through every permitted mutation channel, not only one authenticated query. Include the existing expenses upload regression if the shared helper changes.

**Decision / remaining work:** User population and email scope are settled. Use the acceptance matrix in this report; any production mutation smoke test needs an explicitly approved test record.

### F27. Locate and extend the existing Friday managers email

**P1 | Confirmed integration dependency, source unverified | Email integration and delivery | Sections 8, 9, 12**

**Description and rationale:** The owner specified the existing Friday 09:00 Europe/London email to manager@the-anchor.pub, preserving everything already in it. Source inspection found a Monday private-bookings digest, a Monday checklist digest and a Sunday rota alert, but did not identify the combined Friday email. This does not establish that the email is absent or broken.

**Impact:** Copying a Monday route or creating another digest risks duplicate email, lost existing sections, incorrect timing or missing maintenance information.

**Recommended action:** Identify the actual Friday producer in deployed source or the existing integration before changing it. Capture current content, recipients, schedule and retry protection. Extend that producer with all outstanding maintenance items, once each, and preserve other sections. Reuse its delivery and duplicate-send protection. Verify Friday 09:00 London in summer and winter. Escape text and retain authenticated links. Do not automatically disclose maintenance data to additional recipients, silently truncate the list, suppress the existing email when maintenance is empty, or represent a failed query as zero items. On maintenance-read failure, retain other content and clearly mark the section unavailable with operational error reporting. Do not add a separate Monday digest or defer this requirement to optional phase 2.

**Decision / remaining work:** Owner schedule, recipient, scope and complete-list inclusion are settled. Developer must locate the existing producer and prove its extension. No email was sent during this review.

### F28. Monitor failures without building another management system

**P2 | Confirmed omission | Observability and operations | Sections 7 to 10**

**Description and rationale:** The original plan specifies a user-visible upload error but no operational visibility for audit failures, failed cleanup, conversion failures, count errors or failed weekly maintenance sections.

**Impact:** Users can encounter repeated faults while the owner sees missing history or apparently no outstanding work.

**Recommended action:** Use structured operation/item correlation IDs, explicit provider errors and existing monitoring for save, upload, finalisation, audit, cleanup and email-section outcomes. Keep sensitive content and signed credentials out of logs. Distinguish a failed maintenance query from an empty result and preserve the existing Friday email content. Add a short support and rollback procedure to the release handoff. Do not invent a separate triage assignee, new dashboard or emergency alert service.

**Decision / remaining work:** The weekly visibility requirement is settled. Developer must choose existing monitoring hooks and record operational recovery steps.

### F29. The preparatory image refactor is not a proven ten-minute dependency

**P3 | Optional simplification | Scope and estimation | Sections 2, 9**

**Description and rationale:** moving a helper may improve naming, but does not establish codec support or change the user's outcome. The quoted time omits consumer/test verification. Calling the upload path “solved” and the count addition “almost nothing” similarly hides the material checks above.

**Impact:** an optimistic plan can understate the critical path and enlarge a release unnecessarily.

**Recommended action:** retain the helper temporarily or extract it as a separately verified preparatory change. Estimate by deliverables and risks after the real upload proof, not by file count. Keep the shim until all actual consumers and tests are checked.

**Decision / remaining work:** Optional. Developer may choose the least disruptive verified helper placement; do not make a cosmetic move a release prerequisite.

### F30. Keep the useful scope limits and narrow discovery claims

**P3 | Optional clarification | Delivery and scope | Sections 2, 3, 11**

**Description and rationale:** one item table and free-text contractors are appropriate. The absence of a maintenance table does not establish “nothing to collide with”: `table_holds` already contains maintenance semantics in allocation tests, and the feature shares app-wide permissions, storage, counts and audit services. The general description of landlord repair liability is not a verified contractual allocation.

**Impact:** a reader may assume recording a critical fault blocks bookings or automatically establishes who pays.

**Recommended action:** say there is no dedicated tracker, while naming shared dependencies. Explicitly keep booking availability changes, emergency alerts, contractor communications, calendar sync, asset registers and receipt reconciliation outside this release. Keep `to_confirm` as the responsibility default; do not auto-classify liability from an area. Use the existing Friday managers email for the agreed weekly visibility; do not add assignees, approval workflows or a contractor database.

**Decision / remaining work:** Scope limits remain. No tenancy liability, emergency procedure or extra assigned staff member may be inferred from the tracker.

## 5. End-to-end acceptance matrix

These are implementation gates, not tests already performed. Each must be demonstrated through the relevant real path; mocked helper tests alone are insufficient for browser, database or native-code behaviour.

| Area | Required evidence |
|---|---|
| Core journey | A super-admin creates an issue and an improvement, adds a note/photo, changes responsibility and costs, schedules through notes, completes, reopens and cancels. The list, detail, history and counts remain consistent. |
| Excluded roles | Anonymous users and authenticated manager, staff, FOH and portal-only users cannot read or mutate maintenance through pages, direct actions, database access, counts, upload finalisation, signed URLs or area settings. A maintenance grant alone must not defeat super-admin-only access. |
| Save-first photos | Saving produces one durable item before photo capture. A failed attachment leaves it intact; repeated finalisation or a lost response does not duplicate items/photos. |
| Real image path | JPEG, PNG, WebP and real iPhone HEIC through the production-like path, checking rotation, resize, metadata removal, output size and display. Reject oversized, corrupt, unsupported and PDF inputs clearly. |
| Upload recovery | Storage succeeds but metadata fails; cleanup fails; session expires; permissions change; parent changes; request repeats. Successful photos remain and unresolved objects are tracked for controlled cleanup. |
| Audit | Required event and mutation succeed or fail together. Test old/new values, actor identity, creation, status/cost/date changes, cancellation, visible history-read failure and loading older events. |
| Cancellation/removal | Ordinary mistakes are cancelled without deleting evidence. Exceptional removal follows the super-admin-only attributed path. Stored bytes and metadata are handled together. |
| Actor removal | Test the intended creator foreign-key behaviour in isolation and verify retained identity snapshots rather than assuming email text overrides a foreign key. |
| Concurrent editing | Two super-admins edit one record; unseen changes are not silently overwritten. The conflict and retry messages preserve recoverable input. |
| Status and dates | Eight statuses, done requires completion, reopen keeps coherent current fields and historic events. Exercise London summer midnight, UTC workers, both DST transitions, due today/overdue boundaries and backdated reporting. |
| Costs | GBP including VAT; our open estimates only in our total; null separate from zero; landlord/unknown responsibility separate; on-hold handled consistently. |
| Areas | Fifteen approved seeds; only super-admins administer; whitespace/case duplicates, renamed/inactive areas and deactivation during a form are handled. Existing items retain usable labels and filters. |
| Complete Friday list | Include both kinds, every non-terminal status, all priorities/responsibilities, undated, on-hold and distant dates. Exclude done/cancelled. Fetch all pages and list each item once. |
| Preserve existing email | Compare before/after fixtures showing all existing sections retained. An empty maintenance set does not suppress the email. Failed maintenance loading is explicit without discarding other content. Additional recipients do not receive new data by accident. |
| Email timing/delivery | Exactly the approved Friday 09:00 London schedule in summer and winter and manager@the-anchor.pub destination. Repeated invocation does not duplicate the combined email. Verify existing cron auth, communication controls, delivery errors and recovery. |
| Accessibility | Actual phone camera and gallery selection, cancellation/retry, keyboard and screen-reader operation, labels, visible focus, status announcements, error focus, contrast, zoom/reflow and equivalent mobile/desktop information. |
| Performance | Bounded interactive lists, photos and timelines; stable paging; realistic data measurements; indexed predicates; shared nav cache with role-specific filtering outside it. Email completeness is not limited by UI pagination. |
| Database/release | Revised migrations execute in isolation with role-based grants/constraints; sequence works concurrently and beyond 9,999. Run lint, typecheck, both timezone test suites and a clean build. Verify deployed commit/alias, deployment ID, migration history and an explicitly approved smoke record. |
| Rollback | Preserve additive tables and entered evidence. Disable/revert maintenance functionality and its email section as needed while retaining the rest of the existing Friday email. No blanket drop or deletion. |

## 6. Specific wording changes for the original specification

The original document has not been rewritten. These are targeted replacement statements reflecting the review and the owner's settled decisions.

1. **Sections 2 and 7, upload:** “The framework body-size setting does not override hosting limits. Prove the deployed photo-upload and HEIC processing path; use browser-direct private uploads where originals exceed the function request limit.”
2. **Section 7, creation:** “Save the item first, then offer photo capture or selection. Attachment failures and retries must not discard or duplicate the saved item.”
3. **Sections 4.4, 5 and 6, history and deletion:** “Items are cancelled rather than ordinarily deleted. Notes and field-change history are retained. Exceptional removal is controlled and attributed to a super-admin. Required mutation events commit atomically with the change.”
4. **Section 6, permissions:** “The maintenance feature is accessible only to super-admins for every interactive action, including viewing, creating, editing, notes, photos, costs, history and area administration. Other roles receive no maintenance access.”
5. **Section 4.2 and list summaries, money:** “Costs are recorded and displayed in pounds including VAT. Our open estimates and unknown costs are shown separately; landlord and unconfirmed responsibility amounts do not inflate our total.”
6. **Section 4.3, scheduling:** “Keep all eight statuses. Record scheduled visit details in notes initially; changing status does not create a calendar event.”
7. **Section 8, email:** “Include every outstanding issue and improvement in the existing Friday 09:00 Europe/London managers email to manager@the-anchor.pub, alongside all existing content. Outstanding excludes only done and cancelled. Include undated and on-hold items. Extend the existing email rather than creating a separate maintenance digest.”
8. **Section 9, release:** “Deploy the required schema before consuming code, enforce super-admin-only access and verify activation explicitly. Do not use grants to other staff roles as a release step. Complete the existing Friday email integration before final acceptance.”
9. **Section 10, testing:** “Provide a real UTC test configuration and exercise super-admin access, denied other roles, native photo processing, audit atomicity, recovery and the complete existing Friday email. A passing build alone does not establish working behaviour.”
10. **Section 12, owner decisions:** “Photo ordering, cancellation, super-admin-only access, Friday email integration, cost basis, eight statuses and the editable seed list have been approved. They are no longer open approval questions.”

## 7. Readiness, risks and recommended delivery

**Overall assessment:** the business decisions are resolved and the feature remains achievable without a project-management system. The specification requires technical corrections before a reliable implementation estimate or release commitment. Resolving business scope is not evidence that the feature is implemented or tested.

### Required work before the main build

1. Prove real phone uploads and HEIC decoding in the target runtime. Resolve the hosting request limit and storage/finalisation recovery design.
2. Locate the actual existing Friday email producer. Verify its deployed source, complete current content, recipients, schedule and retry protection; record the concrete integration point.
3. Define the transactional audit operation, actor references, cancellation and exceptional-removal mechanism together.
4. Apply one super-admin-only access model across UI, actions, database, storage, history and counts; remove the original staff-grant sequence.
5. Document completion/reopening, validation, monetary predicates, area lifecycle and retry/conflict behaviour as acceptance examples. Implement actual London and UTC test runs.

### Major risks

- Large phone photos or HEIC decoding can fail despite an existing helper and green mocked tests.
- Separate audit writes can leave saved changes without promised evidence; parent deletion can erase history.
- Generic permissions or privileged readers can undermine the explicit super-admin-only rule.
- Selecting the wrong email producer can duplicate reminders, alter an unrelated schedule or lose existing email content.
- Incomplete pagination or old ageing filters can omit outstanding items from the approved Friday list.
- Shared working-tree changes and pending migrations can leak unrelated work into the release if the developer does not isolate the change.

### Opportunities to simplify

Keep one items table with a kind discriminator, child notes/photos, editable areas and free-text contractor details. Do not add a contractor database, assignment engine, complex status workflow, separate reminder service, asset register, recurring maintenance, receipt linkage, booking availability automation or calendar integration. Save-first capture eliminates draft ownership work. The all-outstanding Friday list eliminates special age-based inclusion machinery. Super-admin-only access eliminates the reporter/manager UI split. Extract the image helper only if it improves the verified implementation rather than becoming a cosmetic release dependency.

### Recommended sequence

1. Complete the two feasibility/integration proofs for uploads and the Friday email. Record developer choices against this report; do not re-open settled owner decisions.
2. Build a minimal vertical slice in an isolated branch/environment: one super-admin creates an item, uploads a real photo, changes status and sees the durable history. Verify denied access for other roles.
3. Complete lists, areas, costs, recovery, accessibility and the existing Friday email extension, with fixtures preserving its other content. Pass the full acceptance matrix.
4. Present the exact migration and deployment bundle for the required production approvals. Apply schema before its consumers, verify the deployed commit and production alias, exercise the authorised smoke path and record the deployment ID and migration versions.
5. Verify the complete Friday email through an approved delivery path, preserving duplicate-send protection and existing sections. Provide the support/rollback handoff and tidy only the feature's branch after successful release verification.

### Unresolved decisions and handoff status

No further owner answers are required to complete this review. The remaining unknowns are technical validation tasks: deployed codec support, the actual Friday email integration, atomic history design and detailed lifecycle/recovery choices. If later evidence reveals a genuine scope trade-off, present that concrete choice to the owner rather than silently reducing the approved requirements.

**Review complete, local document only.** This report consolidates all critical findings and all owner feedback. It does not claim feature completion: no implementation, migration, deployment or email send was performed as part of the review. The original specification is unchanged. This is the sole review handoff document needed by the developer.
