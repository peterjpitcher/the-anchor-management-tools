# AI event artwork generation, implementation plan

Spec: `docs/plans/2026-09-06-ai-event-artwork-generation-spec.md` (v2)
Review: `docs/plans/2026-09-06-ai-event-artwork-developer-review.md`

Written to a scoped file rather than `tasks/todo.md`, which currently holds an
unrelated in-flight nav-pills plan with uncommitted changes.

## Ground rules for every stream

1. **Everything ships behind `EVENT_ARTWORK_AI_ENABLED`, default off.** Nothing is
   owner-visible until phase 8.
2. **No paid provider call.** Not in tests, not in a script, not "just once to check".
   The provider is exercised only through recorded fixtures. Phase 8 is the owner's
   authorised trial and is not part of this build.
3. **No migration is applied to production.** Draft the SQL, review it, stop.
4. **Do not touch the five live artwork variants' write path.** No change to
   `event_images.image_type`, its CHECK constraint, its partial unique index, or
   either RPC. Publishing reuses `confirmEventImageUpload`.
5. **`sharp` is always `await import('sharp')`.** Never a static import.
6. `no-console` is an ESLint error; `console.warn` and `console.error` are allowed.
7. No `any` without a justifying comment. Explicit return types on exports.
8. Dates through `src/lib/dateUtils.ts`. Never raw `new Date()` for user-facing dates.
9. British English in all copy. No em dashes anywhere, including comments.
10. Run `npm run lint`, `npx tsc --noEmit` and `npm test` before claiming a stream done.

## Wave 0, foundation

- [ ] **S0. Timezone harness.** `vitest.config.ts` hardcodes `env: { TZ: 'Europe/London' }`,
      so a `TZ=UTC` prefix is silently overridden. Change it to
      `TZ: process.env.TZ ?? 'Europe/London'`, add `"test:utc": "TZ=UTC vitest run"` to
      `package.json`, and add a test asserting the process really is in the expected
      zone so the harness cannot lie. Check `vitest.screening.config.ts` (new upstream)
      for the same defect and fix it the same way if present.
      Files: `vitest.config.ts`, `vitest.screening.config.ts`, `package.json`,
      `tests/harness/timezone.test.ts`.

- [ ] **S1. Migration.** New file `supabase/migrations/<ts>_event_artwork_runs.sql`,
      timestamp newer than the latest applied. Additive only.
      - `event_artwork_runs`, `event_artwork_variants`, `event_artwork_attempts`,
        `event_artwork_publications`, `event_artwork_spend`, `event_artwork_tombstones`,
        exactly as spec section 7, including every CHECK, default, FK action and index.
      - Partial unique index on `event_artwork_runs(event_id) WHERE status IN ('draft','publishing')`.
      - RLS enabled on all six. **No grant to `anon` or `authenticated`.** Service role only.
      - Private storage bucket `event-artwork-drafts`, 25 MB limit,
        `image/png` and `image/jpeg` only, storage policies denying both `anon` and
        `authenticated`.
      - Then run `npx tsx scripts/security/assert-anon-surface.ts` and paste the output
        into the stream's completion note. Do **not** run `npx supabase db push`.
      Depends on: nothing. Blocks: S9 onward.

## Wave 1, pure modules (parallel, no I/O)

All under `src/lib/events/artwork/`. Each is pure, fully unit tested, and imports
nothing that touches the network, the filesystem or the database.

- [ ] **S2. `sizes.ts`.** Resolve each variant to a provider request size. Export the four
      `gpt-image-2` constraints as named constants (edges multiple of 16, max edge 3840,
      ratio at most 3:1, pixels 655,360 to 8,294,400) and a `validateRequestSize()` that
      checks all four. Table-driven test asserting every resolved size passes, so changing
      a target in `imageVariants.ts` fails loudly. Poster profiles `standard`
      (1600x2272) and `high` (2416x3424) from `EVENT_ARTWORK_POSTER_PROFILE`.
      Spec 5.1, 5.2.

- [ ] **S3. `geometry.ts`.** Pure maths, shared by the browser preview and the server
      compositor, so the two can never disagree.
      - Logo aspect 934/421. `logoRect(imageW, imageH, corner, widthFrac)` with
        `inset = round(min(w,h) * 0.04)`; `widthFrac` clamped to 0.08 to 0.35.
      - `reservedLogoRect()` derived from the **maximum** permitted logo (0.35), not a
        fixed percentage. Test the review's case: 1920x1080 gives 723x346.
      - `qrMinWidthPx(posterWidthPx)` = `ceil(posterWidthPx * 40 / 210)`. Assert it is
        **473** at 2480, not 472.
      - `qrRect(...)` from `_frac` centre and width, clamped inside the canvas with an
        `inset` margin.
      - `rectsOverlap(qr, logo, gap)` used to reject a colliding placement.
      Spec 9.1, 9.2. **Coordinates are fractions 0 to 1, named `_frac`, never percentages.**

- [ ] **S4. `prompt.ts`.** `buildAdaptationPrompt(event, variant, reservedRect, copy)`.
      Carries the literal event copy in quotes, which today's `buildVariantPrompt()` does
      not. Price rule has three branches: `is_free` true renders "Free"; a numeric price
      renders the amount; **`is_free` false with a null price renders nothing** (never
      "Free", never "£0"), matching `src/app/actions/event-content.ts:655`. States the
      reserved rectangle. Exports `PROMPT_VERSION` and `buildEventCopySnapshot()`.
      Flags a name over 60 chars. Spec 10.
      **Leave `buildVariantPrompt()` in place**, it is the retained fallback.

- [ ] **S5. `pricing.ts`.** Versioned rate table with an effective-from date, covering
      image output, image input and text input tokens. `calculateAttemptCost(usage, model, size)`
      returning `{ costUsd, basis }` where basis is `calculated` / `estimated` / `unknown`.
      **Missing usage returns `unknown`, never zero.** Do not import or extend
      `calculateOpenAICost` in `src/lib/openai.ts:86`, which falls back to chat pricing.
      Spec 12.1.

- [ ] **S6. `resize.ts`.** `resizeToVariant(buffer, variant)` using the exact contract in
      spec 5.3: `fit: 'cover'`, `position: 'centre'`, `kernel: 'lanczos3'`,
      `withoutEnlargement: false`, `png({ compressionLevel: 9 })`, and
      `withMetadata({ density: 300 })` for the poster only. Plus
      `validateGeneratedImage(buffer, variant)` decoding and asserting exact width,
      height, format and byte size. Tests must reject a swap to `fit: 'fill'` or
      `'contain'` and assert the accepted crop stays under 0.5% of an edge.
      `sharp` dynamically imported. Do not use `optimiseImage`.

## Wave 2, services (depend on wave 1 and S1)

- [ ] **S7. `provider.ts`.** `POST {baseUrl}/images/edits`, `multipart/form-data`, plain
      `fetch`, no SDK. Exactly the fields in spec section 8, `n: 1`, one input image,
      `output_format: 'png'`, **no `input_fidelity`** (unsettable on `gpt-image-2`).
      Add `imageModel` to `getOpenAIConfig()` in `src/lib/openai/config.ts` reading
      `OPENAI_IMAGE_MODEL`, default `gpt-image-2`.
      Bounded decode: reject base64 over 40 MB before decoding.
      Error taxonomy branching on `error.code` first: `rate_limited`, `quota_exhausted`,
      `moderation_blocked` (carry `moderation_stage` and `categories`), `invalid_request`,
      `provider_unavailable`, `uncertain`.
      Timeouts: provider 240s. **Do not use `RetryConfigs.api`** (5 attempts, and a no-op
      for HTTP errors since `fetch` resolves on 500). Use the explicit pattern from
      `src/app/actions/event-content.ts:100-146`, capped at 2 transport retries.
      Tests use recorded fixtures only. **No live call.**

- [ ] **S8. `budget.ts`.** Reservation against `event_artwork_spend` in the same
      transaction as the attempt claim. Three ceilings from env with the spec's defaults
      (`EVENT_ARTWORK_MAX_RUN_USD` 1.00, `EVENT_ARTWORK_MAX_EVENT_DAY_USD` 3.00,
      `EVENT_ARTWORK_MAX_DAY_USD` 10.00) plus `EVENT_ARTWORK_MAX_CONCURRENT` 4.
      Refuse with `budget_exceeded` before any call. Reconcile to actual afterwards; an
      `uncertain` outcome **holds** its estimated reservation rather than releasing it.
      Day boundaries via `dateUtils`, London. Spec 12.2.

- [ ] **S9. `src/services/event-artwork.ts`.** The state machine, spec section 6.
      - Atomic get-or-create run; duplicate returns the existing run and `409`.
      - `revision` checks on every mutation.
      - Source immutable once any attempt has succeeded.
      - Claim: insert an attempt with a fresh `claim_token` and a **600s**
        `lease_expires_at` (not 300s), conditional update of the variant.
      - Immutable attempt paths `runs/{runId}/{variant}/gen-{attemptNo}.png`.
      - Conditional completion `WHERE current_attempt_id = :thisAttempt`, so a late
        completion cannot overwrite a newer result.
      - Four outcomes: `succeeded`, `failed`, `uncertain`, `abandoned`. `uncertain` is
        never auto-retried.
      - `current_attempt_id` moves only on success, so a failed regeneration keeps the
        previous artifact.
      - Attempts capped at 6 per variant.
      - `placement_hash` over (source sha, attempt id, logo corner, colour, width frac,
        QR centre and width frac, short link id, poster profile).
      Admin client only, after a permission check. `logAuditEvent` on every state change.

- [ ] **S10. `composite.ts`.** `sharp` `.composite()`, dynamically imported.
      - Logo from `public/guest/anchor-logo-{white,black}.png`. A test asserts the chosen
        file has an alpha channel (`public/logo-black.png` does not and would stamp a
        white box).
      - **A missing selected logo file fails visibly.** Do not copy the graceful
        degradation in `src/lib/pdf/document-logo.ts`; branding is an acceptance criterion.
        Only an explicit no-logo choice omits a logo.
      - QR rendered **directly at the target pixel width** with
        `QRCode.toBuffer(url, { ...QR_OPTIONS, type: 'png', width: targetPx })` using
        `QR_OPTIONS` from `src/lib/export/qr-pack.ts` (ECL H, margin 4). Never rendered at
        1200px and resampled. Never trim the white quiet zone.
      - Reject an overlapping or out-of-bounds placement server-side.
      - Output path `runs/{runId}/{variant}/composite-{placementHash}.png`, content
        addressed and immutable.
      - Add `outputFileTracingIncludes` entries in `next.config.mjs` for **both** logo
        files, naming the composite route. The white one has never shipped through a
        server-render path.

- [ ] **S11. `poster-link.ts`.** `resolvePosterLink(eventId)`:
      `EventMarketingService.generateSingleLink(eventId, 'poster')` (get-or-create, channel
      key `poster`, prefix `po`, **not** `partner_poster`/`pp`), then **validate and repair
      the destination** against the event's current canonical URL, keeping the short code so
      printed posters keep working. `generateSingleLink` returns an existing link without
      refreshing it, so this is this feature's own job.
      Block approval when the event has no slug, is cancelled, or is unpublished, with a
      specific reason. Admin client (`short_links` is service-role-write-only).
      Scope: this event's poster link only. **Do not** bulk-repair the other stale links.

## Wave 3, routes and actions (depend on wave 2)

- [ ] **S12. Generate route.** `src/app/api/events/[id]/artwork/generate/route.ts`.
      **One handler with a validated `variant` parameter**, not five routes.
      `export const runtime = 'nodejs'`, `export const maxDuration = 300`.
      `requireModulePermission('events', 'manage')`. Order: permission, run and revision
      check, budget reservation, claim, provider call, validate, resize, store, complete,
      ledger write, audit. Every failure path from spec 6.5.

- [ ] **S13. Composite and signing endpoints.**
      - Composite: `events:edit`, free, idempotent on `placement_hash`.
      - Signing: mints **300s** signed URLs, verifies the caller's permission **and** that
        the path belongs to the run and event requested. Paths are always built
        server-side from ids; an arbitrary path or URL is never accepted.
        `Cache-Control: private, no-store`. Never log a signed URL.
      - Status endpoint for the editor's bounded polling.

- [ ] **S14. Publish, retry and discard.** `src/app/actions/event-artwork.ts`.
      - Freeze the manifest of `(variant, placement_hash, composite_path)`; reject
        placement and generation with `409` while `publishing`.
      - Refuse any variant whose `approved_placement_hash` is stale.
      - **Compare-before-replace**: if `events.<cache_column>` no longer equals
        `expected_previous_url`, mark `skipped_conflict` and do not overwrite.
      - Publish through the existing `confirmEventImageUpload` path. Mirror the square
        into `thumbnail_image_url` and `poster_image_url` as the drawer does.
      - Record per-variant outcomes; end `partially_published` if any is unresolved;
        retry touches only unresolved variants.
      - Discard removes unpublished work only, and never revives from a late completion.
        The UI must say discard is not rollback.

- [ ] **S15. Cleanup cron.** `src/app/api/cron/event-artwork-cleanup/route.ts`,
      `cron-auth.ts` bearer, plus its `vercel.json` schedule (weekly). Everything in spec
      section 14: terminal runs after 30 days, abandoned drafts after 14, stuck
      `publishing` after 60 minutes (alert, never delete under a live lease), superseded
      attempts after 7 days, failed ledger writes retried, tombstones for deleted events.
      Bounded, repeatable, listed from the Storage API, dry-run by default with
      `RUN_EVENT_ARTWORK_CLEANUP_MUTATION=true` per the `scripts/` convention.

## Wave 4, interface (depends on wave 3)

- [ ] **S16. Editor page.** `src/app/(authenticated)/events/[id]/artwork/page.tsx` plus
      components. Four steps: Source, Brand, Generate, Place and publish. Spec section 13.
      - **Corner and colourway are chosen before Generate**, not after.
      - Estimated cost shown before Generate and before every paid Regenerate.
      - File input **and** drop zone, never drop-only.
      - QR: `@dnd-kit` `PointerSensor` with `touch-action: none`, **plus** arrow-key nudges
        (1%, shift 5%), numeric X/Y/size fields and Reset placement.
      - Client-side scaled preview while dragging; authoritative server composite
        debounced 400ms with obsolete responses cancelled.
      - Native labelled controls with visible focus. Solve the global 44px rule with
        padding, **not** by replacing buttons with non-buttons.
      - Polite per-variant status announcements, once per transition.
      - Bounded polling, delayed state after 45s, and copy stating that closing the tab
        does not cancel a call already in flight.
      - Works at 200% zoom and on iPad Safari.

## Wave 5, wiring

- [ ] **S17. Wiring and docs.**
      - Button in `EventImagePanel` and the Marketing tab, hidden unless
        `EVENT_ARTWORK_AI_ENABLED`. Disabled on an unsaved event with
        "Save the event first, then add artwork".
      - **Keep** the five manual tiles and the copy-paste prompt box.
      - Fix the panel's contradictory copy: `EventImagePanel.tsx:495-497` claims uploads
        are immediate unconditionally while lines 330-334 say the opposite for a new
        event, and both render at once today.
      - `.env.example`: `OPENAI_IMAGE_MODEL`, `EVENT_ARTWORK_AI_ENABLED`,
        `EVENT_ARTWORK_POSTER_PROFILE`, the three spend ceilings,
        `EVENT_ARTWORK_MAX_CONCURRENT`.
      - `docs/agent-reference.md`: new routes, cron and env vars.
      - Runbook: `docs/runbooks/event-artwork.md`, spec section 15.

## Wave 6, verification

- [ ] **S18. Full gate.** `npm run lint`, `npx tsc --noEmit` (needs a big heap),
      `npm test`, `npm run test:utc`, `npm run build`. Then the review's acceptance and
      recovery matrix, walked case by case with the test that covers each, and any gap
      reported rather than quietly skipped.

## Explicitly not done in this build

- No paid provider call, so generation quality is unproven. Phase 8 is the owner's.
- No migration applied to production.
- No bulk repair of the reported 64 stale short links.
- No historical orphan report for `event-images`.
- The flag stays off. The spend ceilings need owner approval first.
