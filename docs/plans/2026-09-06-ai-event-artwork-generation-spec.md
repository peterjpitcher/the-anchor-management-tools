# Event artwork branding: logo and QR placement, spec v3

- Date: 2026-09-06 (v3, rescoped by the owner: image generation removed)
- Status: revised for implementation
- History: v1 spec, v2 revised against `docs/plans/2026-09-06-ai-event-artwork-developer-review.md`, v3 rescoped
- Related: `docs/plans/2026-08-12-event-image-variants-spec.md`

---

## 0. What changed in v3, and why

The owner removed AI image generation from the scope. Artwork is still made outside the app; what the app gains is the ability to **place the venue logo and a QR code onto an uploaded image**, so those two manual steps stop being manual.

This deletes the hardest and riskiest two thirds of v2. Gone entirely:

- The OpenAI provider client, the generation prompt, request-size resolution and cost accounting.
- Spend ceilings, budget reservation and the kill switch. **There is no longer any per-press cost**, so the ceilings the owner approved on 2026-09-06 are moot and are not implemented.
- Attempts, leases, uncertain outcomes, transport retries and the whole exactly-once billing problem, which existed only because a lost provider response might have been charged.
- The six-table run schema, the private drafts bucket, the publish manifest, compare-before-replace, the cleanup cron, and the feature flag.
- The paid feasibility trial, and with it the unproven assumption that a model could hold the event copy accurately across four shapes.

The August 2026 decision at `docs/plans/2026-08-12-event-image-variants-spec.md:62` that ruled out generating variants from a master image therefore **stands unreversed**. v2 reversed it; v3 puts it back.

What survives from wave 1:

| Built | Fate |
|---|---|
| `geometry.ts` (286 lines, 37 tests) | **Survives untouched.** It is exactly this feature. |
| `poster-link.ts` (16 tests) | **Survives untouched.** The QR still needs a validated short link. |
| Timezone harness, `npm run test:utc` | **Survives.** Independently valuable, already green in both zones. |
| `resize.ts` | **Partially survives.** Its output-validation half is reused; its resize half is not needed. |
| `sizes.ts`, `prompt.ts`, `pricing.ts` | **Deleted.** Purely about generation. Nothing outside them imported them. |
| Migration `20260906120000` | **Deleted and replaced** by a much smaller additive one. Never applied to anything. |

## 1. Problem

Two manual steps remain after artwork is made outside the app:

1. The venue logo is added by hand to each image before upload.
2. The QR code is added by hand to the A4 poster.

Both are mechanical, both are easy to get subtly wrong (a QR too small, or with its quiet zone cropped, will scan on screen and fail off paper), and the QR has to come from the right short-link channel to be tracked at all.

## 2. Scope

**In scope:** upload a file to an artwork tile as today, then optionally place a logo and, on print variants, a QR code. The app composites and stores the result. Placement is remembered so it can be adjusted later without re-uploading.

**Out of scope:** generating artwork; changing the variant set, target sizes or the public API shape; bulk repair of stale short links; anything touching CheersAI's `/api/events/{id}/artwork` contract.

## 3. Which variants get what

| Variant | Logo | QR |
|---|---|---|
| square 1080x1080 | yes | no |
| landscape 1920x1080 | yes | no |
| social 1920x1005 | yes | no |
| story 1080x1920 | yes | no |
| print_poster 2480x3508 | yes | **yes** |

`isPrintVariant(variant)` returns true only for `print_poster` today, in one helper, so adding a future print variant is a one-line change. Restricting the logo to the poster later is likewise a one-line change to this table.

The logo is allowed on every variant because the owner's original complaint was adding it by hand to every image before upload. The QR is poster-only.

## 4. Flow

```
upload original ──► stored as the ORIGINAL, browser-direct signed URL (existing path)
                              │
                              ▼
                    placement editor: logo corner, colourway, size
                                      QR position and size (print only)
                              │
                              ▼
                    server composites with sharp, from the stored original
                              │
                              ▼
                    composited file becomes the live variant
                    original and placement are kept, so it can be re-placed
```

Bytes never pass through a request or response body. Vercel's platform limit is 4.49 MB, live-probed, and it is a proxy-level 413 that fires before the function runs, which is exactly why uploads already go browser-direct. The composite endpoint receives only a small JSON placement and reads the original from storage itself.

**Placement is stored, not baked and forgotten.** Re-placing the logo re-composites from the kept original. Without this, changing a corner would mean re-uploading, and the original would be lost the first time branding was applied.

## 5. Data model

One small additive migration on `event_images`. No new tables, no new bucket.

| Column | Type | Notes |
|---|---|---|
| `original_storage_path` | text null | the uploaded file before compositing; null means no branding was applied and `storage_path` IS the original |
| `logo_corner` | text null | CHECK in the four corners |
| `logo_colour` | text null | CHECK in (`white`,`black`); table CHECK requires it whenever `logo_corner` is set |
| `logo_width_frac` | numeric null | CHECK between 0.08 and 0.35 |
| `qr_centre_x_frac`, `qr_centre_y_frac` | numeric null | CHECK between 0 and 1 |
| `qr_width_frac` | numeric null | CHECK >= 0.1905 (40mm at A4) and <= 0.40 |
| `qr_short_link_id` | uuid null | references `short_links(id)` on delete set null |

All nullable, so every existing row stays valid and the existing RPCs keep working untouched. Coordinates are **fractions of the image edge, 0 to 1**, and every name ends in `_frac`.

`upsert_event_image_variant` and `delete_event_image_variant` are **not** modified. The composite path calls the existing upsert for the composited file, which already returns the replaced object to delete, then issues one small UPDATE for the branding columns. The two are not atomic; the failure mode is branding metadata missing while the image itself is correct, which is benign and is documented in the code.

When an original is replaced, the previous original is deleted explicitly, since nothing else references it.

## 6. Compositing

Server-side `sharp` via `await import('sharp')`, using `.composite()`. Geometry comes from `src/lib/events/artwork/geometry.ts` and is never recomputed anywhere else, so the browser preview and the server output cannot disagree.

### 6.1 Logo

Sources: `public/guest/anchor-logo-white.png` and `public/guest/anchor-logo-black.png`, both 934x421 RGBA with a real alpha channel.

- `public/logo-black.png` has **no alpha** and would stamp an opaque white rectangle. A test asserts the chosen source has an alpha channel.
- The composite route needs an `outputFileTracingIncludes` entry naming **both** files, or the serverless bundle ships without them. The white one has never shipped through a server-render path.
- **A missing or invalid logo asset fails visibly.** It must never quietly produce unbranded output. Only an explicit "no logo" choice omits a logo.
- Geometry: width `logo_width_frac` of the image width, clamped 0.08 to 0.35; height from the 934/421 aspect; inset 4% of the short edge from the chosen corner. The 0.35 ceiling keeps the logo inside its 934px native resolution on every canvas.

### 6.2 QR

- Link: `resolvePosterLink(eventId)` in `src/lib/events/artwork/poster-link.ts`, already built. Channel `poster`, `utm_source=poster`, `utm_medium=print`, `utm_content=poster_qr`, short-code prefix `po`. Not `toilet_poster`; not `partner_poster`, whose prefix is `pp`.
- That module validates and repairs the destination before the QR is composited. `generateSingleLink` returns an existing link without refreshing its destination, and discovery reported 64 of 819 event links stale in production including 2 of 40 poster links. The short code derives from the event UUID rather than the slug, so repairing the destination keeps already-printed posters working. A poster cannot be branded if the event has no slug, is cancelled or is a draft, and the editor says which.
- Rendered **directly at the target pixel width** with `QR_OPTIONS` from `src/lib/export/qr-pack.ts` (error correction H, margin 4, black on white). Never rendered at 1200px and resampled: rasterising at the target keeps module edges crisp.
- The 4-module quiet zone is an opaque white plate and is never trimmed or alpha-keyed. **The stated size includes the quiet zone.**
- Minimum size derived from millimetres with upward rounding: `ceil(2480 * 40 / 210)` = **473px**, which is 19.05% of the poster width. Default 50mm, 591px. A floor of 19.0% would be 39.9mm, under the minimum.
- Placement is validated server-side: inside the canvas with an inset margin, and not overlapping the logo plus a gap. The slider is not the enforcement point.
- The poster keeps `density: 300` so print software sizes it at A4, and the download flow says to print at actual size.

## 7. Interface

The existing five-tile panel in the event drawer **stays exactly as it is** for plain uploads. Branding is additive.

Each tile gains a **Branding** action, enabled once a file exists. It opens a placement editor. The drawer is 640px wide with an internal scroll and the DS Modal caps at 800px, so an A4 placement surface needs a full-screen modal or its own route: the poster preview at 600px wide is about 848px tall, which fights the drawer's own scrolling.

Editor contents:

- Live preview of the image at a scaled size.
- Logo: 2x2 corner picker, white/black segmented control, size slider, and a "no logo" option.
- QR, print variants only: drag to position, size slider, and the resolved short URL shown as text so the owner can see where it points before printing.
- Save, which composites and replaces the live variant; Revert to original, which restores the uploaded file and clears the branding.

Accessibility and input, carried over from the v2 review:

- Native labelled controls with visible focus. The global `min-height/min-width: 44px` rule below 820px is solved with padding, **not** by replacing buttons with non-buttons, which would remove keyboard semantics.
- The global rule forcing `grid-template-columns: 1fr !important` on any class list containing `md:grid-cols` below 820px means a 2x2 corner grid written with a breakpoint prefix silently collapses to one column. Avoid the prefix.
- QR drag uses `@dnd-kit` `PointerSensor` with `touch-action: none`, **plus** arrow-key nudges (1%, shift 5%), numeric X/Y/size fields and a Reset. Drag is an enhancement, never the only way.
- HTML5 file drag-and-drop does not work on iPadOS Safari, so the existing tile drop affordance is already dead there. Verify on device rather than assuming.
- Client-side scaled preview while dragging; the authoritative server composite is debounced and obsolete responses are cancelled.

The panel's contradictory copy is fixed regardless: `EventImagePanel.tsx:495-497` claims uploads are immediate unconditionally, while lines 330-334 say the opposite for a new event, and both render at once today.

## 8. Permissions and security

- `events:edit` for viewing and for compositing, matching the existing upload path.
- `events:manage` for the short-link repair, since that changes where an already-printed code points, and it is audit-logged.
- Storage paths are always constructed server-side from ids. An arbitrary path or URL is never accepted for a privileged read or composite.
- The `event-images` bucket is public and `event_images` carries an anon SELECT policy with `USING (true)` and no event-status filter. **That is unchanged by this feature**, but it means a branded poster is fetchable by URL before the event is announced, exactly as an unbranded one is today. Recorded, not fixed here.

## 9. Testing

Unit: geometry (done, 37 tests); QR minimum derived from millimetres, asserting 473 not 472; logo source has an alpha channel; QR and logo overlap rejection; preview and server geometry producing identical numbers.

Integration: composite determinism, so the same input and placement produce byte-identical output; a missing logo asset fails visibly; the quiet zone survives; poster density is 300; **re-placing composites from the original rather than from the previous composite**, otherwise branding compounds on itself, which is the worst bug available here; Revert restores the original exactly.

Short link (done, 16 tests): the channel is `poster` with prefix `po`, with a test that fails if `partner_poster` is used; a stale destination is repaired and the short code is unchanged; a failed repair never returns a stale link as usable.

Regression: `buildEventImageFields` still emits square first; `print_poster_url` never reaches `posterImageUrl`; `/api/events/{id}/artwork` unchanged.

Both zones: `npm test` and `npm run test:utc`.

Manual before release: a branded A4 poster printed at actual size and scanned on two phones, with the destination checked and not just the scan.

## 10. Phasing

| Phase | Scope |
|---|---|
| 0 | Delete `sizes.ts`, `prompt.ts`, `pricing.ts` and the v2 migration. Trim `resize.ts` to its validation half. |
| 1 | Additive migration: branding columns on `event_images`. |
| 2 | Compositor module (in flight, survives). |
| 3 | Composite server action and route, reading the original from storage. |
| 4 | Placement editor UI. |
| 5 | Wiring, docs, and the panel copy fix. |

No feature flag: there is no spend and no external dependency beyond a short link the app already mints, so the risk that justified a flag in v2 has gone.

## 11. Acceptance criteria

1. Uploading a file to a tile behaves exactly as it does today when no branding is applied.
2. Choosing a corner and colourway places the logo at that corner on any variant, with no upscaling above 0.35 of image width.
3. A missing logo asset fails visibly and leaves the existing image untouched, rather than publishing unbranded.
4. On the poster, a QR can be positioned freely, is at least 40mm at A4 (473px), keeps its white quiet zone, carries `utm_source=poster&utm_medium=print&utm_content=poster_qr`, resolves to the event's current canonical URL, and scans off a printed sheet on two phones.
5. Re-placing branding composites from the stored original, so branding never compounds.
6. Revert restores the uploaded original byte-identically and clears the branding.
7. A QR overlapping the logo, or outside the canvas, is refused server-side.
8. `image[0]` in the public API is still the square; `posterImageUrl` is never the A4 poster; CheersAI's artwork response is unchanged.
9. The whole flow is completable with keyboard only and on iPad Safari.
10. `npm test` and `npm run test:utc` both pass.

## 12. Risks

| Risk | Handling |
|---|---|
| Branding compounds if a re-composite reads the previous composite. | The original is stored separately and is always the composite source. Asserted by test. |
| Composite route ships without the logo files. | `outputFileTracingIncludes` for both files, visible failure not silent, verified on a preview deploy. |
| `sharp` is native; a composite working locally can fail cold on Vercel. | Phase 3 is deployed and verified before the UI depends on it. |
| A printed QR opens the wrong page after a slug rename. | Destination validated and repaired before compositing; the short code is preserved so printed copies keep working. |
| 934px logo is soft on a large poster placement. | Capped at 0.35 of width, inside native resolution on every canvas. |
| Orphaned originals accumulate. | The previous original is deleted explicitly when replaced. |
| Edits land on a dead duplicate component. | `EventImagePanel` imports from `event-image-variants`; two upload actions exist and only one is live. |
