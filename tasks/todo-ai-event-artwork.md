# Event artwork branding: logo and QR placement, implementation plan

Spec: `docs/plans/2026-09-06-ai-event-artwork-generation-spec.md` (v3, generation removed)
Review of v2: `docs/plans/2026-09-06-ai-event-artwork-developer-review.md`

Scoped file rather than `tasks/todo.md`, which holds an unrelated in-flight
nav-pills plan with uncommitted changes.

## Ground rules

1. **No OpenAI, no image generation.** Removed from scope by the owner. There is
   no provider call, no spend, no budget, no feature flag.
2. **No migration is applied to production.** Draft, review, stop.
3. **Do not modify `upsert_event_image_variant` or `delete_event_image_variant`.**
   Branding columns are additive and nullable; the existing RPCs keep working.
4. **`sharp` always via `await import('sharp')`.** Never a static import.
5. Never `git add -A`. Another session is writing to this checkout.
6. `no-console` is an ESLint error; `console.warn` and `console.error` are allowed.
7. No `any` without a justifying comment. Explicit return types on exports.
8. Dates through `src/lib/dateUtils.ts`.
9. British English. No em dashes anywhere, including comments. A hook blocks them.
10. `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run test:utc` before
    any stream is called done.

## Done

- [x] **Geometry** `src/lib/events/artwork/geometry.ts`, 37 tests. Logo and QR
      rects, reserved areas, overlap rejection, 40mm minimum derived from
      millimetres (473px at A4, not 472). Shared by preview and compositor.
- [x] **Compositor** `src/lib/events/artwork/composite.ts`, 26 tests. Real sharp,
      real logo files, real qrcode. Logo placement verified by comparing the
      bounding box of painted pixels against `logoRect`, exact on all four edges
      of all four corners. A missing or alpha-less logo fails visibly. QR
      rendered at its target width, never resampled from 1200px.
- [x] **Poster link** `src/lib/events/artwork/poster-link.ts`, 16 tests. Channel
      `poster` with prefix `po`, enforced at runtime not just by a constant.
      Validates and repairs a stale destination while preserving the short code,
      so already-printed posters keep working. A failed repair never returns a
      stale link as usable.
- [x] **Composite output validation** `src/lib/events/artwork/output.ts`, 8 tests.
      Asserts branding did not change the image dimensions, deliberately NOT the
      variant's nominal target, since real uploads sit well below it.
- [x] **Timezone harness** `npm run test:utc` genuinely runs in UTC. Full suite
      green in both zones.
- [x] `next.config.mjs` names both logo files for the composite route in
      `outputFileTracingIncludes`.

## Removed in the pivot

- [x] Deleted `sizes.ts`, `prompt.ts`, `pricing.ts` and the six-table migration.
- [x] Deleted the partial `provider.ts` and `budget.ts` from the stopped streams.
- [x] Reverted the `imageModel` field added to `src/lib/openai/config.ts`.
- [x] Replaced `resize.ts` with `output.ts`.

## Done since

- [x] **A. Migration.** `supabase/migrations/20260906095746_event_image_branding.sql`.
      Ten nullable columns, eleven CHECKs, proved against a throwaway local
      Postgres cluster. **Drafted only, never applied.**
- [x] **B. Composite route and revert.** `branding-service.ts` plus
      `/api/events/[id]/artwork/composite`. Composites always from the stored
      original, geometry from real decoded dimensions, failed branding write
      republishes the original.
- [x] **C. Placement editor.** Full-screen `ArtworkBrandingModal`, corner and
      free logo placement, QR drag on the poster, keyboard and numeric fields
      throughout.
- [x] **D. Read path and clear-down.** Saved placement is read back and seeds the
      editor; a replacement upload clears all ten columns and removes the
      superseded original.
- [x] **E. Full gate.** 6368 tests green in both zones, lint clean, typecheck
      clean, production build succeeds with the route present and both logo files
      traced.

## Not covered by any test, and only a human can close these

- [ ] **Print and scan a branded A4 poster.** The 40mm minimum is enforced in
      three places and asserted arithmetically, but no sheet has been printed and
      no phone has scanned one. This is the acceptance criterion that matters
      most and it is not met.
- [ ] **Drive the editor on a real iPad.** Keyboard operation is tested in jsdom;
      pointer drag on iPadOS Safari is not, and HTML5 file drag is already known
      dead there.
- [ ] **Apply the migration**, which must land before this code deploys.

## Superseded

- [ ] **A. Migration.** New `supabase/migrations/<ts>_event_image_branding.sql`,
      timestamp newer than the latest applied. Additive only: eight nullable
      columns on `event_images` per spec section 5, each with its CHECK, plus a
      table CHECK requiring `logo_colour` whenever `logo_corner` is set, and an
      FK from `qr_short_link_id` to `short_links(id)` on delete set null.
      No `ALTER` of an existing column, no RPC change. Run
      `npx tsx scripts/security/assert-anon-surface.ts` afterwards and paste the
      output. **Never run `npx supabase db push`.**

- [ ] **B. Composite route and action.**
      `src/app/api/events/[id]/artwork/composite/route.ts`, `runtime = 'nodejs'`,
      `maxDuration = 300`, `requireModulePermission('events', 'edit')`.
      - Accepts a small JSON placement, never image bytes. Vercel's body limit is
        4.49MB and fires at the proxy before the function runs.
      - Reads the ORIGINAL from storage, never the previous composite, so
        branding cannot compound. This is the single most important behaviour in
        the stream and needs its own test.
      - First branding of a variant copies the current file to
        `events/{id}/{variant}/original-{ts}.png` and records
        `original_storage_path`.
      - Calls `resolvePosterLink` for a QR, and refuses with its reason when the
        event has no slug, is cancelled or is a draft.
      - Composites, validates with `validateCompositeOutput`, uploads, then calls
        the existing `upsert_event_image_variant` and finally one UPDATE for the
        branding columns. Delete the previous original when it is replaced.
      - A `revert` action restoring the original byte-identically and clearing
        the branding columns.
      - `logAuditEvent` on composite and on revert.

- [ ] **C. Placement editor UI.** Full-screen modal or its own route, not the
      640px drawer: an A4 preview at 600px wide is about 848px tall and fights
      the drawer's scroll.
      - 2x2 corner picker, white/black control, logo size slider, "no logo".
      - QR on print variants only: drag with `@dnd-kit` `PointerSensor` and
        `touch-action: none`, **plus** arrow-key nudges (1%, shift 5%), numeric
        X/Y/size fields and Reset. Drag is never the only way.
      - Show the resolved short URL as text so the destination is visible before
        printing.
      - Client-side scaled preview while dragging; debounce the authoritative
        server composite and cancel obsolete responses.
      - Native labelled controls, visible focus. Solve the global 44px rule with
        padding, not by replacing buttons with non-buttons. Avoid `md:grid-cols`
        on the corner grid: a global rule collapses it to one column below 820px.

- [ ] **D. Wiring and docs.**
      - "Branding" action on each tile in `EventImagePanel`, enabled once a file
        exists.
      - Fix the panel's contradictory copy: `EventImagePanel.tsx:495-497` claims
        uploads are immediate unconditionally while lines 330-334 say the
        opposite for a new event, and both render at once today.
      - `docs/agent-reference.md`: the new route.
      - Keep the five manual tiles and the copy-paste prompt box exactly as they
        are. The prompt box is still how artwork gets made.

- [ ] **E. Full gate.** `npm run lint`, `npx tsc --noEmit` (big heap),
      `npm test`, `npm run test:utc`, `npm run build`, then walk the spec's
      acceptance criteria and report any not covered.

## Explicitly not done

- No migration applied to production.
- No bulk repair of the reported 64 stale short links; only this event's poster
  link is validated and repaired.
- The `event-images` bucket stays public with its existing anon SELECT policy, so
  a branded poster is fetchable by URL before the event is announced, exactly as
  an unbranded one is today. Recorded, not fixed here.
- No printed-and-scanned verification yet. That needs a real printer.
