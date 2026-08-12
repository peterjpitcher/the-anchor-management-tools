# Developer review: Event image variants specification

Date: 2026-08-12  
Reviewed specification: `2026-08-12-event-image-variants-spec.md`  
Review scope: technical design, user journeys, data, security, reliability, accessibility, performance, testing, operations, migration and delivery across AMS and the-anchor.pub.  
Original specification changed: **no**.

## 1. Executive assessment

**Readiness: not ready for implementation.**

The proposed variant set and the decision to keep the legacy square fields during rollout are sensible. The draft also correctly identifies the danger of putting a print poster in `poster_image_url`.

However, implementation should not start until the P0 findings below are resolved. In its current form:

- Phase 3 can change live square slots to landscape before the website is updated.
- `event_images` cannot become canonical without reconciling missing and shared category images.
- The promised upload and delete safety cannot be achieved by the described sequence of separate storage and database calls.
- Story and print files described as AMS-only remain publicly readable.
- The queued-new-event flow conflicts with the current drawer, which closes and unmounts immediately after creation and has no unsaved-changes guard.

The work is larger than a normal complexity-4 change. It includes a data repair, a storage security decision, a new upload state machine, two applications, a public contract change and coordinated deployment.

## 2. Classification

Priority meanings:

- **P0 — blocker:** resolve before implementation starts.
- **P1 — required:** resolve before release; design can proceed in parallel.
- **P2 — important:** address or explicitly accept before release.
- **P3 — optional:** useful simplification or follow-up.

Finding status meanings:

- **Confirmed issue:** supported by the specification or current code/schema.
- **Unconfirmed assumption:** plausible but needs an explicit decision or environment check.
- **Optional improvement:** not required for correctness, but reduces risk or complexity.

## 3. Findings summary

| ID | Priority | Status | Type | Title |
|---|---|---|---|---|
| F01 | P0 | Confirmed issue | Functional / delivery | Phase 3 is not independently safe |
| F02 | P0 | Confirmed issue | Data / migration | The proposed canonical table is incomplete and unreconciled |
| F03 | P0 | Confirmed issue | Data ownership | Category-default images can be shared but are treated as event-owned |
| F04 | P0 | Confirmed issue | Reliability | Replace safety is not achievable with the described operations |
| F05 | P0 | Confirmed issue | Reliability | Delete can leave a live URL pointing at a deleted object |
| F06 | P0 | Confirmed issue | Security / privacy | AMS-only files remain public |
| F07 | P0 | Confirmed issue | Functional / UX | The queued-new-event flow conflicts with the current drawer lifecycle |
| F08 | P1 | Confirmed issue | Functional | Category auto-upload and delete have no complete contract |
| F09 | P1 | Confirmed issue | Data model | The unique index breaks gallery multiplicity |
| F10 | P1 | Confirmed issue | Delivery / compatibility | Phase 1 removes currently accepted legacy values too early |
| F11 | P1 | Confirmed issue | UX / data loss | Replacement is destructive and is not trivially undoable |
| F12 | P1 | Confirmed issue | Security / functional | File identity, dimensions and document shape are not validated |
| F13 | P1 | Confirmed issue | API contract | The exact public response contract is ambiguous |
| F14 | P1 | Confirmed issue | Website / social | “Serve social directly” conflicts with current metadata and route behaviour |
| F15 | P1 | Confirmed issue | Website | The website consumer migration is incomplete |
| F16 | P1 | Confirmed issue | Metadata / accessibility | Per-variant alt text and replacement metadata have no defined lifecycle |
| F17 | P1 | Confirmed issue | Functional / security | Download behaviour is not specified |
| F18 | P1 | Confirmed issue | Concurrency / reliability | Same-variant races and retries are not handled |
| F19 | P1 | Confirmed issue | Migration / delivery | Migration verification, rollback and type updates are incomplete |
| F20 | P1 | Confirmed issue | Testing | The test plan misses the highest-risk failure paths |
| F21 | P1 | Confirmed issue | Delivery | Cross-repository rollout and rollback are under-specified |
| F22 | P2 | Unconfirmed assumption | Performance / hosting | Upload limits and runtime capacity are not proved |
| F23 | P2 | Confirmed issue | Accessibility | The panel lacks an accessibility interaction contract |
| F24 | P2 | Confirmed issue | Monitoring / operations | There is no operational monitoring or cleanup plan |
| F25 | P1 | Confirmed issue | Lifecycle | Whole-event deletion and missing-variant journeys are not covered |
| F26 | P3 | Optional improvement | Simplification | Do not denormalise internal-only URLs |
| F27 | P3 | Optional improvement | Simplification | Delay legacy cleanup and centralise variant rules |

## 4. Detailed findings

### F01 — Phase 3 is not independently safe

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / delivery
- **Relevant sections:** 3, 8.3, 10 Phase 3, 10 Phase 4, goals 2 and 5
- **Description:** Phase 3 changes the schema.org `image` array to `landscape`, then `social`, then `square`, while the current website treats `image[0]` as the general event image. This changes square cards to landscape before Phase 4 is deployed.
- **Rationale:** `lib/event-image.ts` chooses the first non-empty `event.image` value before legacy fields. `RelatedEvents.tsx` also reads `image[0]` directly into an `aspect-square` slot. Several campaign pages do the same. This conflicts with the claim that Phase 3 needs no website change and leaves the system unchanged. It also conflicts with the stated reason not to auto-crop designed artwork: `object-cover` will crop the landscape asset in square slots.
- **Impact:** Copy may be cut off on live cards. Phase 3 is not independently deployable, and goal 5 is not met.
- **Recommended action:** Keep `square` first in `image` until every website consumer uses an explicit field, or split Phase 3 into: (a) add optional fields only; (b) update the website; (c) publish the final multi-ratio `image` array. Add a cross-version compatibility test for every adjacent phase pair.
- **Open questions:** Is `image` primarily a website fallback contract or only schema.org data? Must its ordering remain backward-compatible for unknown consumers?

### F02 — The proposed canonical table is incomplete and unreconciled

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data / migration
- **Relevant sections:** 5, 5.1, 5.2, 6.3, 9 Migration
- **Description:** The migration maps and deduplicates existing metadata rows but does not backfill events whose legacy URL exists without an `event_images` row. It also keeps the newest metadata row without checking whether that row matches the URL currently stored on `events`.
- **Rationale:** Discovery records 51 events with a hero URL, but only 36 distinct event/type pairs in `event_images` after the three duplicates are accounted for. Up to 15 existing event images will therefore appear missing in a panel that reads the new canonical table. Keeping the newest row is not proof that its object is the URL currently served from `events`.
- **Impact:** Staff can see an empty Square tile while the website has an image, download the wrong object, or replace/delete against the wrong metadata. The table is not canonical after Migration 1.
- **Recommended action:** Add a data-reconciliation migration or controlled backfill. For each event, compare the current legacy URL to `event_images.storage_path`; prefer the row that matches the live URL, repair its metadata from `storage.objects`, and report rows that cannot be resolved. Do not enable the new panel until reconciliation counts are zero or explicitly waived. Record before/after counts and exceptions.
- **Open questions:** Can every current public URL be safely mapped back to this bucket? What should happen to externally hosted or missing objects? Who approves unresolved rows?

### F03 — Category-default images can be shared but are treated as event-owned

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data ownership
- **Relevant sections:** 5, 6.2, 7.3, 7.4; existing event creation behaviour
- **Description:** New events inherit category image URLs, but those objects belong to the category and may be referenced by many events. The specification does not distinguish an event-owned upload from an inherited shared asset.
- **Rationale:** Current event creation copies `event_categories.default_image_url` into the event legacy columns without creating an `event_images` row. Backfilling such URLs as event rows would make the same category object appear owned by multiple events. Deleting one event variant could then physically delete an object still used by the category and other events.
- **Impact:** A delete or category replacement can break images across multiple events. The panel may also mislabel an inherited image as a missing event upload.
- **Recommended action:** Define ownership explicitly. A safe model is: show a category image as a labelled fallback, create metadata only for event-owned objects under `events/{eventId}`, and never delete a category object from an event action. Decide whether an event should track later category-image changes or retain the copied URL. Add reference checks before any physical deletion of a shared object.
- **Open questions:** Is a category image a live fallback or a snapshot taken at event creation? What does “Delete Square” mean when a category fallback exists? Should replacing a category image preserve older objects while events still reference them?

### F04 — Replace safety is not achievable with the described operations

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability
- **Relevant sections:** 5, 6.1, 9 Upload action, 12 Risks
- **Description:** The specification says the metadata row and denormalised event column are written “inside one operation”, then describes separate storage upload, row update, event update and storage delete calls. No exact sequence makes all of these atomic.
- **Rationale:** Storage and Postgres cannot share one transaction. If the metadata swap succeeds but the event-column update fails, the canonical row and cache disagree. If the event column changes first and metadata fails, the reverse happens. The current rollback logic is for a newly inserted row and cannot simply be reused after updating an existing row.
- **Impact:** Failed uploads can be reported incorrectly, leave orphan files, show a different image in AMS and the API, or lose the old reference.
- **Recommended action:** Specify a failure-safe protocol. Recommended: upload the new object; call one database RPC that locks the variant row, atomically upserts all metadata and updates the event cache, and returns the old storage path; after commit, delete the old object as best-effort cleanup. If the RPC fails, delete only the new object. A cleanup failure must not turn a committed replacement into a reported upload failure. Test failure after every boundary.
- **Open questions:** Is a database RPC acceptable? How long should an old object be retained for recovery? Where are failed cleanup jobs recorded and retried?

### F05 — Delete can leave a live URL pointing at a deleted object

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability
- **Relevant sections:** 6.2, 9 Delete action, 12 Risks
- **Description:** The draft says to delete the metadata row and storage object, then null the event column. If the final event update fails, the website still has a URL to an object that no longer exists.
- **Rationale:** The current implementation already follows this unsafe order. Its metadata rollback does not help after the storage object has been deleted.
- **Impact:** A transient database failure can create an immediate broken image on the live website.
- **Recommended action:** Reverse the risk. Use one database transaction/RPC to clear the event cache and delete the metadata row while returning the storage path. Delete the object only after the database commit. A storage-delete failure leaves an unreachable orphan, which is safer than a broken live URL, and should be queued for cleanup.
- **Open questions:** Should delete offer a short undo window? What user message is shown when the database change succeeds but object cleanup is delayed?

### F06 — AMS-only files remain public

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / privacy
- **Relevant sections:** 2 goal 3, 4 “Web-served”, 5.2, 6.3, 8.1, acceptance criterion 4
- **Description:** Not returning a URL from the management API does not make an object AMS-only. The `event-images` bucket is public, `event_images` has an anonymous SELECT policy, and the migration adds story and print URLs to the `events` row.
- **Rationale:** Anyone with an object URL can read a public bucket object. Anonymous Supabase clients can also query `event_images`, including storage paths and metadata. Some events are anonymously readable through the existing pending-booking RLS policy, so new internal URL columns can also leak through direct table queries. URL obscurity is not access control.
- **Impact:** Print PDFs and story artwork can be publicly accessed or indexed/shared outside AMS. Uploader identifiers and filenames may also be exposed.
- **Recommended action:** Decide the real security requirement. If “AMS-only” means private, put story and print in a private bucket, remove anonymous metadata access, authorise `getEventImages`, and issue short-lived signed download URLs. Do not put internal-only URLs on `events`. If public-but-unlinked is acceptable, say that clearly and accept the risk explicitly.
- **Open questions:** Are print and story assets confidential before an event announcement? Is public direct access acceptable? What signed-URL lifetime is suitable for iPad downloads?

### F07 — The queued-new-event flow conflicts with the current drawer lifecycle

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / UX
- **Relevant sections:** 7.3, acceptance criterion 3
- **Description:** The draft assumes an existing unsaved-changes guard and a tile that remains visible after the first successful save. Neither is true today.
- **Rationale:** `EventDrawer` calls `onSave()` immediately after `createEvent`. Both current parents close and unmount the drawer. There is no dirty-state or close guard in the drawer. Although `createEvent` returns the new event ID, the draft does not say how the drawer changes from create mode to edit mode, waits for queued uploads, or stays open on a partial failure.
- **Impact:** Queued files can be lost when the drawer unmounts, or uploads may run without a UI that can show progress/retry. The “nothing silently lost” goal is not met.
- **Recommended action:** Define an explicit create/upload state machine. At minimum: keep File objects in drawer state; mark them as dirty; on successful create, retain the drawer, set the new event ID, upload the queue, show per-file results, and only close on an explicit user action or after an agreed all-success rule. Add guards for Cancel, backdrop/Escape close, route navigation, reload and browser close. A simpler alternative is to create a draft event before accepting attachments.
- **Open questions:** Must files survive a page reload or only drawer close? Should event creation wait for every upload? Does one failed upload prevent automatic close? Can users edit other fields while the queue runs?

### F08 — Category auto-upload and delete have no complete contract

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional
- **Relevant sections:** 6.1, 6.2, 7.4, acceptance criteria
- **Description:** Categories are said to inherit auto-upload, but the new delete signature only supports `(eventId, variant)`. Categories have no `event_images` metadata row from which to find an old storage path, and the new-category queue is not specified.
- **Rationale:** The same component currently calls the event delete action with a category ID, which is already incorrect. The proposed change does not define a category-specific delete, replacement cleanup, queued save, retry or audit flow.
- **Impact:** Category delete may fail or target the wrong table. Replacements can leak old objects, and new-category files can still be lost.
- **Recommended action:** Either make category behaviour a separate, fully specified work item, or define dedicated `uploadCategoryImage` and `deleteCategoryImage` actions with ownership, save, replacement and cleanup rules. Add category acceptance criteria and tests. Do not claim the trap is removed until the new-category path is covered.
- **Open questions:** Is auto-upload for categories required in this release? Where should category image metadata live? Must old category objects remain because existing events reference them?

### F09 — The unique index breaks gallery multiplicity

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data model
- **Relevant sections:** 5, 5.2
- **Description:** The CHECK constraint retains `gallery`, but the unique index on `(event_id, image_type)` permits only one gallery row per event.
- **Rationale:** `event_images` has `display_order`, and the existing schema and API model gallery as multiple images. The dedupe query would also delete additional gallery rows in any non-production environment containing them.
- **Impact:** Existing or future gallery functionality becomes impossible, and migration behaviour differs by environment.
- **Recommended action:** Use a partial unique index for singleton variants only, for example `WHERE image_type IN ('square','landscape','social','story','print_poster')`, or formally remove gallery support and migrate it elsewhere. Limit deduplication to singleton types.
- **Open questions:** Is `gallery` still a supported future feature? Can legacy `thumbnail` and `poster` rows exist outside production?

### F10 — Phase 1 removes currently accepted legacy values too early

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / compatibility
- **Relevant sections:** 5.1, 5.2, 6.1, 10 Phase 1, 10 Phase 4
- **Description:** Migration 1 keeps `hero` but removes `thumbnail` and `poster`, even though the currently deployed server action accepts both. It also fails if such rows exist in local, test or staging databases.
- **Rationale:** An “independently deployable” database phase should accept every value the old deployed code can validly write. `primary` is already a known invalid value and can be removed from code, but `thumbnail` and `poster` are valid under the current database constraint.
- **Impact:** Hidden callers or another environment can fail after Phase 1. Rolling back Phase 2 code could also become unsafe after the cleanup constraint lands.
- **Recommended action:** Make Phase 1 purely additive: retain all currently valid values. Deploy code that stops writing them, observe for at least the rollback window, then remove them in a later cleanup migration. Keep `hero` longer than Phase 4 unless removal has real value.
- **Open questions:** Are there API callers besides the current UI? How long is the production rollback window? Do staging and local data contain other legacy types?

### F11 — Replacement is destructive and is not trivially undoable

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** UX / data loss
- **Relevant sections:** 7.2 items 6 and 7, 6.1 replace semantics
- **Description:** The rationale for no replacement confirmation says replacement is trivially undone by uploading again, but the old object is deleted. The user can restore it only if they still possess the old source file.
- **Rationale:** This is the same irreversible characteristic used to justify confirming delete. Auto-upload also persists immediately even if the user later presses Cancel on other event edits.
- **Impact:** A mistaken file selection can permanently remove the only stored copy, and Cancel has surprising side effects.
- **Recommended action:** Choose one clear rule: confirm replacement; retain the old object/version for a defined recovery window with Undo; or state plainly that replacement is immediate and irreversible. Make the drawer explain that uploads are saved immediately and are not rolled back by Cancel.
- **Open questions:** Is object version history wanted? How long may old versions be retained? Should selecting a filled tile open a replacement confirmation before upload starts?

### F12 — File identity, dimensions and document shape are not validated

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / functional
- **Relevant sections:** 4, 6.1, 7.2, 9 Upload action, 12 Risks
- **Description:** The draft validates claimed MIME type and byte size only. It presents target sizes and aspect ratios but does not say whether they are required, recommended or checked.
- **Rationale:** Browser `File.type` can be spoofed. A small compressed image can have extreme dimensions and exhaust decoders. A user can upload a square file to Landscape and still pass acceptance criterion 6 because the URL differs. PDFs may be multi-page, encrypted, non-A4 or landscape. The stated wrong-shape mitigation cannot work for PDFs because they have no preview.
- **Impact:** Wrong artwork can reach the website, image optimisation can fail, and crafted files can consume excessive memory. Print output may not be usable.
- **Recommended action:** Define validation policy per variant: signature sniffing, accepted encodings, animated-image rule, minimum/maximum dimensions or megapixels, aspect-ratio tolerance, orientation, and whether target pixels are exact or guidance. For PDF, decide page count, page size, orientation and encryption rules. Validate server-side; client checks are only early feedback.
- **Open questions:** Are near-ratio exports allowed? Is 300 DPI metadata required or only 2480×3508 pixels? Are WebP social cards supported by all intended crawlers? Are animated images intentionally excluded?

### F13 — The exact public response contract is ambiguous

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** API contract
- **Relevant sections:** 8.1–8.4, 9 API contract, acceptance criteria 4, 6 and 7
- **Description:** Section 8.1 lists only three new fields, but also says all three legacy camelCase fields will be added to the list route. The required order and normalisation of `image`, the fate of `imageUrl`, and absent-versus-null behaviour are not fully defined.
- **Rationale:** These details affect existing consumers and snapshot compatibility. “Drops nulls” does not cover blank strings or malformed gallery values. “Legacy fields byte-for-byte unchanged” applies only to square-only events and does not define list-route additions.
- **Impact:** AMS and website developers can implement different contracts. Payloads, types and fallbacks may diverge between list and detail routes.
- **Recommended action:** Add a field matrix for list and detail routes with exact JSON names, types, null/absence rules, source columns and deprecation status. Define stable `image` ordering, gallery ordering, string trimming and deduplication. Include `imageUrl` explicitly. Add response contract fixtures for old, square-only, partial-variant and all-variant events.
- **Open questions:** Are legacy camelCase fields really needed on the list route? Must `image[0]` remain square? Is `imageUrl` a supported contract or dead compatibility code?

### F14 — “Serve social directly” conflicts with current metadata and route behaviour

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Website / social
- **Relevant sections:** 4 social variant, 10 Phase 4, acceptance criterion 8
- **Description:** The current social route always returns a generated 1200×1200 JPEG, and page metadata declares 1200×1200 and `image/jpeg`. The proposed uploaded asset is 1920×1005 and may be JPEG, PNG or WebP. “Serve it directly” does not say whether to redirect, proxy or transform it.
- **Rationale:** A direct redirect or byte proxy can make the declared dimensions and MIME type false. A resize changes the implementation and output format. Cache headers, failure fallback and content-length handling also differ.
- **Impact:** Social crawlers can receive misleading metadata, stale assets or unsupported formats. Tests may pass locally but previews can be wrong.
- **Recommended action:** Specify one behaviour. Recommended: proxy or transform the approved asset to a documented 1.91:1 output, set the real content type and dimensions in metadata, preserve the current fallback, and version the URL on image replacement. If redirecting, update metadata to the uploaded object’s real format and dimensions and test crawler behaviour.
- **Open questions:** What exact output size is required: 1200×630, 1920×1005 or original? Are PNG and WebP allowed for link previews? What is the cache invalidation target after replacement?

### F15 — The website consumer migration is incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Website
- **Relevant sections:** Discovery consumer table, 10 Phase 4
- **Description:** Phase 4 mentions the event page hero, `lib/event-image.ts` and the social route, but several consumers bypass the helper or need a surface-specific choice.
- **Rationale:** Current direct consumers include `RelatedEvents`, `EventCountdownBanner`, cash bingo, karaoke, music bingo, quiz night and Valentine’s pages. `RelatedEvents` reads `image[0]` into a square slot. Other pages prefer legacy hero or `image[0]` and may want either landscape or square.
- **Impact:** Some surfaces continue using the wrong shape, or their behaviour changes unexpectedly when the API array order changes.
- **Recommended action:** Create a consumer-to-variant matrix and update every consumer deliberately. Prefer small named resolvers such as `getEventSquareImage`, `getEventLandscapeImage` and `getEventSocialImage` rather than one context-free helper. Add tests for each resolver and at least the main card, hero and social surfaces.
- **Open questions:** Which variant should countdown banners and campaign landing-page heroes use? Should all square slots fall back to legacy thumbnail before landscape?

### F16 — Per-variant alt text and replacement metadata have no defined lifecycle

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Metadata / accessibility
- **Relevant sections:** 3, 5, 6.1, 6.3, 7.1, 8.2
- **Description:** The draft says per-variant alt text is stored, but the panel has no field for entering or editing it. Replacement also does not define which row fields change or stay.
- **Rationale:** `event_images` has `alt_text`, `caption`, `uploaded_by`, `created_at` and `updated_at`. An in-place row update could show the original upload time and uploader for a replacement unless these semantics are explicit. Copying the shared event alt text at upload time can later become stale.
- **Impact:** Metadata becomes misleading, accessibility data is empty or inconsistent, and developers may implement different preservation rules.
- **Recommended action:** Either remove per-variant alt text from the v1 promise, or specify its UI and synchronisation. Define replacement rules for filename, MIME, size, uploader, original-created time, last-replaced time, alt text and caption. Return `created_at` and `updated_at` by their real names or add a real `uploaded_at` field.
- **Open questions:** Should replacement preserve variant alt text? Is the shared event alt text copied, linked or independent? Which timestamp should the tile display?

### F17 — Download behaviour is not specified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / security
- **Relevant sections:** 2 goal 3, 6.3, 7.1, acceptance criterion 4
- **Description:** “Download control” does not define whether the browser opens, previews or downloads the original file, what filename is used, or how authorisation works.
- **Rationale:** A cross-origin public URL may ignore the HTML `download` attribute. PDFs commonly open inline. If internal files move to a private bucket, the control needs a signed URL or authorised proxy and must handle expiry.
- **Impact:** The core staff journey may not work on iPad, and private files can be exposed by a permanent link.
- **Recommended action:** Define an authorised download action or route that returns a short-lived signed URL or streams with `Content-Disposition: attachment; filename=...`. Preserve a safe original filename, set `X-Content-Type-Options: nosniff`, and test JPEG, PNG, WebP and PDF on iPad Safari.
- **Open questions:** Should images open in a preview or always download? Is offline reuse of a signed link required? What filename should be used after multiple replacements?

### F18 — Same-variant races and retries are not handled

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Concurrency / reliability
- **Relevant sections:** 6.1, 7.2 item 8, 9 Upload action
- **Description:** Disabling one tile prevents a double-click in one browser, but does not prevent two tabs, two staff users, a client retry or an uncertain network response from replacing the same variant concurrently.
- **Rationale:** Two writers can both read the same old path, upload new objects and then update/delete in conflicting order. A unique index prevents duplicate rows but does not stop one request deleting the object selected by another request. A retry after a committed-but-lost response can replace twice.
- **Impact:** The winning row can point at a deleted object, storage can leak, or a user’s upload can be silently overwritten.
- **Recommended action:** Serialise writes per `(event_id, variant)` in the database RPC, return and compare a row version, and use a client-generated operation ID for idempotent retries. Treat unique-conflict and lost-response paths explicitly. Add two-writer tests.
- **Open questions:** Is last-write-wins acceptable if the winning file is always safe? Should users be warned that another upload replaced theirs?

### F19 — Migration verification, rollback and type updates are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Migration / delivery
- **Relevant sections:** 5.2, 9 Migration, 10
- **Description:** The plan checks only a dry run, the unique index and row counts. It omits bucket assertions, constraint/value checks, data reconciliation, rollback steps and application type regeneration.
- **Rationale:** `UPDATE storage.buckets ... WHERE id = 'event-images'` succeeds with zero affected rows. New columns must be added to generated database types and the manual `Event` interface used by `EventDrawer`. A SQL dry run does not exercise live duplicates, shared category URLs or storage metadata. Rolling back code after new rows exist is different from rolling back the schema.
- **Impact:** A migration can appear successful while PDF/size settings are unchanged, builds can fail, and rollback can reject new values or lose access to uploaded variants.
- **Recommended action:** Add preflight and postflight SQL with expected counts and assertions for bucket settings, constraints, indexes, columns and unresolved metadata. Rehearse on a production-like copy. Regenerate `src/types/database.generated.ts`, update `src/types/database.ts`, and document code-first/schema-first rollback for every phase. Back up the rows affected by dedupe before deletion.
- **Open questions:** What is the approved Supabase type-generation command? Can production be restored from a migration backup quickly? Who verifies storage settings after deploy?

### F20 — The test plan misses the highest-risk failure paths

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing
- **Relevant sections:** 9, 11 criterion 9
- **Description:** The listed unit tests are useful but do not prove authorisation, transaction boundaries, phase compatibility, real browser behaviour or production-like migration outcomes.
- **Rationale:** Mocked call-order tests cannot prove database atomicity. The main risks need failure injection and integration coverage.
- **Impact:** The suite can pass while live rollout still leaks private files, breaks square cards, loses a replacement or discards queued files.
- **Recommended action:** Add:
  - migration tests with duplicates, missing rows, legacy types and category-shared paths;
  - RLS and private-download tests for anonymous, viewer and editor roles;
  - failure injection after upload, DB swap, cache update, audit and cleanup;
  - concurrent same-variant upload and idempotent retry tests;
  - category create/replace/delete tests;
  - new-event save failure, queue failure, retry, close, reload and navigation tests;
  - list/detail API contract fixtures and internal-field non-exposure tests;
  - website resolver, OG MIME/dimension, cache-busting and old/new API compatibility tests;
  - keyboard/screen-reader checks and a real iPad Safari smoke test;
  - an end-to-end smoke test across both deployed repositories.
- **Open questions:** Is a Supabase integration test environment available in CI? Who owns the cross-repository end-to-end test?

### F21 — Cross-repository rollout and rollback are under-specified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery
- **Relevant sections:** 10, 11 criterion 9, 12 Risks
- **Description:** The four phases do not name deploy owners, compatibility windows, feature flags, rollback triggers or the exact order of migration, AMS, API and website releases.
- **Rationale:** Phase 4 actually combines a website deploy and an AMS/database cleanup. Removing `hero` at the same time reduces rollback safety. Website API reads are cached for up to five minutes and social assets have longer cache headers, but no propagation expectation is stated.
- **Impact:** A partial deploy or rollback can leave incompatible versions live. Incidents may be harder to stop because the UI exposes features as soon as code lands.
- **Recommended action:** Use an explicit release matrix and a feature flag for the new panel/API consumption. Recommended order: additive schema and reconciliation; AMS saved-event upload behind a flag; queue/category work; additive API fields while preserving `image[0]`; website explicit-field rollout; final `image` array change; delayed cleanup after the rollback window. Define go/no-go checks and rollback for each step.
- **Open questions:** Can both repositories deploy independently on demand? What are their cache purge controls? Who owns the final production smoke test and content sign-off?

### F22 — Upload limits and runtime capacity are not proved

- **Status:** Unconfirmed assumption
- **Priority:** P2
- **Type:** Performance / hosting
- **Relevant sections:** 4 Size caps, 7.2 item 8, 12 Risks
- **Description:** The 15 MB decision relies on a 20 MB Next.js Server Action limit, but the hosting platform’s request limit, multipart/Action overhead, timeout and memory behaviour are not confirmed. The story variant has no stated cap because it is neither “web” nor `print_poster`.
- **Rationale:** The current action buffers the complete file in application memory. Five concurrent tiles can send at least 45 MB plus the undefined story allowance, and poor iPad connections increase duration and retry risk.
- **Impact:** Valid uploads can fail before reaching the action, time out, or consume excessive instance memory. User-facing limits can disagree with the platform.
- **Recommended action:** Set a story cap explicitly, confirm platform limits in the deployed environment, and load-test realistic concurrent uploads. Leave enough headroom for request encoding. Consider limiting panel concurrency to two. If the platform cannot safely handle the target, use one authorised signed-upload path for all variants rather than a special path for only PDF.
- **Open questions:** What hosts AMS and what are its hard body/time limits? How many concurrent editors are realistic? What p95 upload time is acceptable on venue Wi-Fi?

### F23 — The panel lacks an accessibility interaction contract

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility
- **Relevant sections:** 7.1, 7.2
- **Description:** Minimum touch size is specified, but keyboard use, focus, accessible names, announcements and error association are not.
- **Rationale:** A dashed drop target can easily become a mouse-only `div`. Upload progress and failure toasts may not be announced. Repeated “Download” and “Delete” labels need the variant name for screen-reader users.
- **Impact:** Keyboard and assistive-technology users may be unable to upload or understand state. Automated checks may not catch the full interaction problem.
- **Recommended action:** Require a labelled native file input or keyboard-operable button, optional drag/drop enhancement, visible focus, `aria-live` progress/error text, variant-specific control names, meaningful preview alt text, focus restoration after confirmation, and non-colour status cues. Test at 200% zoom and with VoiceOver on iPad/macOS.
- **Open questions:** Must drag-and-drop be supported, or is the visual only a chooser? What grid layout should be used so a tall Story preview remains usable on iPad?

### F24 — There is no operational monitoring or cleanup plan

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Monitoring / operations
- **Relevant sections:** 6, 9, 10, 12
- **Description:** The plan mentions audit logging and UI toasts but no metrics, structured failure stages, alerting, orphan detection or post-deploy observation.
- **Rationale:** Expected partial failures include new-object cleanup failure, old-object cleanup failure, metadata/cache mismatch, signed-download failure and stale website caches. Audit logging itself must not make a successful mutation appear failed.
- **Impact:** Storage leaks and broken references can accumulate unnoticed. Support cannot tell whether a retry is safe.
- **Recommended action:** Log operation ID, event, variant, size, duration and failure stage without logging signed URLs. Track upload success/failure, cleanup backlog, orphan counts and API fallback use. Add a scheduled reconciliation report comparing rows, columns and objects. Define alerts and a post-deploy dashboard/checklist. Make audit/telemetry failure non-fatal after the primary mutation commits.
- **Open questions:** What existing logger/error tracker should receive these events? Who owns orphan cleanup? What thresholds should page the developer versus create a task?

### F25 — Whole-event deletion and missing-variant journeys are not covered

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Lifecycle
- **Relevant sections:** 2, 6.2, 7, 10, 11
- **Description:** The specification covers deletion of one tile but not deletion of the event, category changes, partial variant sets, initial panel-load failure or publication rules.
- **Rationale:** Deleting an event cascades `event_images` metadata but does not remove storage objects in the current service. Five variants increase the leak. The draft also does not say whether variants are optional, whether a draft can be published without them, or how an inherited category square is displayed. A failed `getEventImages` call could otherwise look like five empty tiles.
- **Impact:** Storage accumulates permanently, staff can make wrong decisions from a false empty state, and release acceptance is unclear for events with only some artwork.
- **Recommended action:** Define the complete lifecycle: initial loading/error/retry; inherited versus uploaded state; allowed partial sets; any publish warnings; category change; event cancellation; event deletion; and retention/cleanup of all owned objects. Never render fetch failure as empty. Add acceptance criteria for these paths.
- **Open questions:** Are all five variants optional? Is Square required before an event becomes scheduled? Should cancelled/deleted event artwork be retained for audit or removed after a retention period?

### F26 — Do not denormalise internal-only URLs

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification
- **Relevant sections:** 5, 5.2, 6.1, 8.1
- **Description:** `story_image_url` and `print_poster_url` are added to `events` even though the public API must never read them and the AMS panel already loads `event_images`.
- **Rationale:** These columns duplicate canonical data, add synchronisation and privacy risk, and are not needed to avoid a public API join. Only landscape and social need a denormalised public read cache. Square can continue to use legacy columns.
- **Impact:** Removing the two columns reduces migration, transaction, security and testing scope.
- **Recommended action:** Keep story and print only in `event_images` and private storage. Add only `landscape_image_url` and `social_image_url` to `events`. If convenient AMS reads are needed, use the authorised `getEventImages` action.
- **Open questions:** Is any non-AMS process expected to query story or print URLs directly from `events`?

### F27 — Delay legacy cleanup and centralise variant rules

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification
- **Relevant sections:** 4, 5.2, 6.1, 7, 10 Phase 4
- **Description:** The design repeats variant keys, MIME rules, limits, labels, columns and dimensions across SQL, Zod, action logic, UI and tests, while also scheduling an early removal of `hero`.
- **Rationale:** Repeated rules drift easily. Removing an accepted value brings little benefit but weakens rollback.
- **Impact:** A shared typed configuration reduces implementation mistakes, and delayed cleanup lowers release risk.
- **Recommended action:** Define one TypeScript `EVENT_IMAGE_VARIANTS` configuration used by action validation and UI. Contract-test it against the database constraint. Keep legacy database values through a full observation/rollback period and make cleanup a later maintenance task, not part of the website cutover.
- **Open questions:** Is strict removal of legacy values required for compliance or only tidiness?

## 5. Required wording changes

These are targeted wording changes, not a rewrite of the original specification.

1. Replace “Both are written by the same server action inside one operation” with wording that describes the database RPC transaction and separate best-effort storage cleanup. A server action is not an atomic transaction.
2. Replace “a failure at any step leaves the previous image live” with an explicit failure matrix. That statement is not true for the current described replace sequence.
3. Replace “Replacing is trivially undone by uploading again” unless old-version retention or a real Undo action is added.
4. Replace “existing unsaved-changes guard” with a requirement to build and test one.
5. Clarify “AMS-only” as either private and authorised, or public-but-not-linked.
6. Define the story size cap.
7. State whether target dimensions and ratios are required or recommended, including PDF page rules.
8. Add exact list/detail API field matrices and preserve `image[0]` compatibility until the website migration is complete.
9. Clarify that category-default objects are shared fallbacks, not event-owned uploads.
10. Change Phase 4 cleanup to a later phase after the rollback window.

## 6. Unresolved decisions

The following decisions need owner or technical-lead confirmation:

1. Are story and print files genuinely private, or merely absent from the website API?
2. Is `image[0]` a backward-compatible square fallback, or may its meaning change?
3. Are target dimensions enforced, and with what tolerance?
4. What PDF files are allowed: one page only, A4 only, portrait only, unencrypted only?
5. Should replacement require confirmation, retain versions, or offer Undo?
6. Should queued files survive only drawer close, or also reload/navigation/browser crash?
7. Does the drawer remain open after event creation and partial upload failure?
8. Are all five variants optional, and are there publication warnings or requirements?
9. Is a category image inherited dynamically or copied as a permanent snapshot?
10. What should event deletion do with owned artwork and how long should it be retained?
11. Will the website social route proxy, redirect or transform the social asset?
12. What are the real hosting request, timeout and memory limits?

## 7. Major risks

1. **Live visual regression:** landscape becomes `image[0]` before square consumers are updated.
2. **Broken live image:** storage deletion succeeds before the event cache is cleared.
3. **Data mismatch:** `event_images` and the `events` cache point at different objects.
4. **Shared asset deletion:** an event delete removes a category object used elsewhere.
5. **Private asset exposure:** print/story objects and metadata remain publicly readable.
6. **Silent queued-file loss:** the create drawer closes before post-save uploads finish.
7. **Concurrent replacement corruption:** one writer deletes another writer’s winning object.
8. **Deployment dead end:** schema cleanup prevents a safe code rollback.
9. **Platform upload failure:** nominal 15 MB files exceed a real hosting/request limit.
10. **Operational drift:** orphan storage objects grow without reconciliation or alerts.

## 8. Recommended next steps

1. Resolve F01–F07 and update the specification before coding.
2. Run a production data preflight that classifies every current image as event-owned, category-shared, missing or external.
3. Decide the private-storage model and the exact upload/delete transaction protocol.
4. Produce the API field matrix and website consumer-to-variant matrix.
5. Redesign the new-event lifecycle or split queued uploads into a later phase.
6. Re-scope category auto-upload as a complete path or remove it from this release.
7. Add a release compatibility and rollback matrix for both repositories.
8. Expand the acceptance criteria and tests using F20 and F25.
9. Re-estimate after these decisions. A safer delivery plan will likely have more than four phases, with schema cleanup last.

## 9. Suggested readiness gate

Move the specification from draft to implementation-ready only when:

- every P0 finding has an agreed design;
- the data preflight and reconciliation plan have expected counts;
- internal-file privacy is explicit and tested;
- the cross-version rollout matrix proves no phase changes square consumers early;
- upload and delete failure protocols are written step by step;
- the new-event and category state machines are defined;
- API and website field/consumer matrices are complete;
- rollback, monitoring and end-to-end test owners are named.
