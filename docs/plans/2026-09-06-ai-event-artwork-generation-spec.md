# AI event artwork generation, spec v2

- Date: 2026-09-06 (v2, revised against the developer review of the same date)
- Status: revised for implementation behind a feature flag. No paid provider call and no production migration is authorised by this document.
- Review: `docs/plans/2026-09-06-ai-event-artwork-developer-review.md`, findings F01 to F30
- Supersedes a decision in: `docs/plans/2026-08-12-event-image-variants-spec.md` section 3

---

## 0. Decisions taken, and their standing

The review lists eight owner decisions (D1 to D8) as unresolved. They were put to the owner and not individually answered; the instruction was to revise, plan and build. Under the standing rule "proceed with the recommendation where safe", each is taken as below. **Every one is a recorded assumption, not an owner approval, and each is reversible by a config change or a small scoped edit.**

| Ref | Decision taken | Reversibility |
|---|---|---|
| D1 | **The uploaded square is preserved, not regenerated.** Four adaptations are generated. | Config: `GENERATE_SQUARE` flag. |
| D2 | **Explicit partial publication** with durable per-variant outcomes and compare-before-replace. | Atomic publication would need the two RPCs rewritten; deliberately avoided. |
| D3 | **Poster option B**, 1600x2272 generated, 194 dpi at A4. | Env: `EVENT_ARTWORK_POSTER_PROFILE=standard\|high`. |
| D4 | **Conservative spend ceilings**, enforced server-side: $1.00 per run, $3.00 per event per day, $10.00 per day globally. | Env vars. **These numbers are invented by the developer and need owner approval before the flag is enabled.** |
| D5 | `events:manage` for anything that spends money or changes live artwork; `events:edit` for viewing a draft and free re-compositing. | Constants in one module. |
| D6 | **The selected poster link's destination is validated and repaired for this event only**, before the poster can be approved. Bulk repair of the other stale links stays a separate task. | Scoped to one function. |
| D7 | **Feature flag.** First enabled release includes generation, review, branding, QR, publication recovery and cleanup. The copy-paste prompt fallback is **retained**, not removed. | Env: `EVENT_ARTWORK_AI_ENABLED`. |
| D8 | **No paid feasibility trial is run.** Provider behaviour is covered by recorded-fixture contract tests. The trial remains an owner-authorised step before the flag is switched on. | Owner action, section 18. |

## 1. Problem

Making artwork for one event is five manual steps outside this app: make the square, copy `buildVariantPrompt()` into ChatGPT with it attached, add the logo by hand, add the QR to the A4 poster by hand, then upload five files into five tiles. Only 5 of 130 events have the full set; 55 have a square.

The ask: upload one square, have the app generate the rest through OpenAI (re-composed, not cropped), choose a logo corner and colourway, place the QR on the poster, save, and have that become the event's standard artwork.

## 2. What discovery changed about the brief

Three findings from discovery. Each is a repo or provider fact.

**2.1 The August 2026 spec explicitly ruled this out.** `docs/plans/2026-08-12-event-image-variants-spec.md:62` lists "generating variants from a master image" as out of scope, because auto-cropping cuts the copy. The copy-paste prompt is the deliberate deliverable of commit `a8627de7`. This spec reverses that decision on the grounds that a generative model re-composes rather than crops, which was the original objection. The reversal is recorded here and in section 21.

**2.2 "A4 at 300dpi" has never been true in production.** Discovery reports all five live posters at 1055x1491 (about 128 dpi across A4) with no pHYs density chunk, and every live artwork file at roughly 1.57 megapixels. **This is an unverified discovery claim** (review F, evidence standard) and is used here only to justify choosing the cheaper poster profile, never to justify scope. The upload gate checks aspect ratio and never pixels, which is why nothing flagged it.

**2.3 No OpenAI image model returns any of the five target sizes.** Verified by calculation against the provider's published constraints. A `sharp` resize step is mandatory. Section 5.

## 3. Scope

In scope: generate four adaptations from an approved square; review each full size; place a logo (corner, colourway, size) and a QR (poster only); publish to the five existing variants; recover from every failure path; bound and account for spend; clean up after itself.

Out of scope, deliberately:

- Changing the variant set, their target sizes, or the public API shape.
- Exposing the composited poster to CheersAI. `EVENT_ARTWORK_VARIANTS` already excludes `print_poster`; it stays excluded.
- Retiring the legacy `thumbnail_image_url`, `poster_image_url` and `gallery_image_urls` columns. Paired website change.
- Bulk repair of the reported 64 stale short links. Only this event's poster link is validated and repaired (D6).
- The wider historical orphan report for `event-images`. This feature cleans up only what it creates.
- Deterministic text compositing as an alternative to generated text (review F30). Recorded as the fallback design if generation proves unreliable.
- Any Orange Jelly branding on event artwork.

## 4. The variant set

`EVENT_IMAGE_VARIANTS` (`src/lib/events/imageVariants.ts`) stays the contract.

| Variant | Target | Produced how | Real consumers |
|---|---|---|---|
| square 1:1 | 1080x1080 | **Owner's upload, resized only** (D1) | Every website card, listing, tile, countdown, fallback hero, schema.org `image[0]`, the site's own 1200x1200 og composite, CheersAI, the `thumbnail_image_url` and `poster_image_url` mirrors. Load-bearing. |
| landscape 16:9 | 1920x1080 | generated | Website event-page hero, schema.org `image[1]`, CheersAI landscape |
| social 1.91:1 | 1920x1005 | generated | schema.org `image[2]` and the `/valentines-day` og image only. **Not the event og:image**, which the site composites from the square. Its real use is the manual Facebook event cover. |
| story 9:16 | 1080x1920 | generated | CheersAI stories only. Never web-served. |
| print_poster A4 | 2480x3508 | generated | Nothing in code. Download only. The one that needs the QR. |

**Four billed generations per run, not five** (F01). The owner's approved square is the source and is published unchanged apart from a resize. It is also the reference image for all four adaptations, so it remains available for comparison by definition.

## 5. Generation sizes and the resize contract

### 5.1 Provider constraints

`gpt-image-2` accepts arbitrary sizes subject to: both edges multiples of 16; max edge 3840; long:short ratio at most 3:1; total pixels between 655,360 and 8,294,400. Outputs above 3,686,400 pixels are documented as experimental. `gpt-image-1`, `gpt-image-1.5` and `gpt-image-1-mini` accept only `1024x1024`, `1536x1024` and `1024x1536`.

Every one of our targets is illegal as-requested: 1080, 1005 and 3508 are not multiples of 16, and 2480x3508 is 8,699,840 pixels, 4.9% over the cap.

`gpt-image-2` is the **preferred** model. The older models are not ruled out mathematically (F09): with a sufficiently aggressive resize they could serve some shapes. They are rejected on quality grounds, because reaching 16:9 from 3:2 means discarding a quarter of the frame, which reintroduces exactly the cropping the August spec objected to. Recorded as a judgement, not an impossibility.

### 5.2 Request sizes

Ask for the smallest legal size whose ratio is within 0.5% of the target, then resize down.

| Variant | Request | MP | Ratio error | Resize |
|---|---|---|---|---|
| landscape | 1936x1088 | 2.11 | 0.09% | down to 1920x1080 |
| social | 1920x1008 | 1.94 | 0.30% | down to 1920x1005 |
| story | 1088x1936 | 2.11 | 0.09% | down to 1080x1920 |
| print_poster, `standard` | 1600x2272 | 3.64 | 0.19% | **up** to 2480x3508 |
| print_poster, `high` | 2416x3424 | 8.27 | 0.19% | up to 2480x3508 |

All non-poster requests sit below the experimental threshold. The poster `standard` profile also does. `high` does not, and is roughly four times the cost.

Both poster profiles upscale. **This is an explicit quality trade-off, not an oversight** (F14): `standard` upscales x1.55 from a native 194 dpi, `high` upscales x1.026 from a native 292 dpi. The general rule "downscaling is safe, upscaling is not" applies to the four screen variants; the poster is the stated exception because no legal size reaches 2480x3508.

A table-driven test asserts every resolved request size satisfies all four numeric constraints, so changing a target fails loudly rather than silently producing a 400.

### 5.3 Resize contract (F14)

`sharp`, dynamically imported. Exactly:

```
.resize(targetW, targetH, {
  fit: 'cover',            // ratio error is under 0.5%, so the crop is under 0.5% of one edge
  position: 'centre',
  kernel: 'lanczos3',
  withoutEnlargement: false,   // the poster upscales deliberately
})
.png({ compressionLevel: 9 })
```

- **Accepted crop:** at most 0.5% of one edge, which is under 10px on a 1920px edge. Documented and asserted by test, so nobody later swaps in `fit: 'fill'` (stretch) or `fit: 'contain'` (letterbox) without noticing.
- **Colour:** input is sRGB 8-bit; no profile conversion. Metadata is stripped except as below.
- **Density:** the poster is written with `.withMetadata({ density: 300 })` so print software sizes it at A4 without the operator choosing scaling. The four screen variants carry no density.
- **`optimiseImage` is not used.** Correction to v1: `src/lib/expenses/imageProcessor.ts:146` resizes only when an edge **exceeds** 2000, so the 1920px edges were never at risk. Only the 2480x3508 poster would have been downsized. `validateFileType` and `extensionForMimeType` from that module are reused; `optimiseImage` is not.
- **Verification after resize:** decode the output and assert exact width, height, format and byte size before it is stored. Browser-reported dimensions are never trusted (F13).

## 6. State machine

### 6.1 Runs

States: `draft` -> `publishing` -> `published` | `partially_published`; and `draft` -> `discarded`.

**One active run per event**, where active is `status IN ('draft','publishing')`, enforced by a partial unique index. This closes F04: v1's index covered only `draft`, so a second draft could be created the moment a run entered `publishing`.

Creating a run is atomic get-or-create. A duplicate create returns the existing run with `409` and its id, never a raw `23505`.

Each run carries `revision`, bumped on every placement or source change. Every mutating request sends the revision it read; a mismatch returns `409` with the current state. This is what stops two tabs overwriting each other's placements.

**The source is immutable once a generation attempt has succeeded.** Replacing the square requires discarding the run and starting a new one, which the UI states plainly. Without this, a generated set can silently belong to a different source than the square that gets published.

### 6.2 Attempts (F05, F07, F19)

Three levels, deliberately: a run has five variants; a variant has many immutable attempts; the variant points at the current one.

```
event_artwork_runs
  └── event_artwork_variants        (5 per run, mutable pointers + approval)
        └── event_artwork_attempts  (immutable, append-only, one per billed call)
```

An attempt is claimed by inserting a row with a fresh `claim_token` and `lease_expires_at`, then a conditional update on the variant that sets `current_attempt_id` only if the variant is not already claimed by a live lease. Only the winner calls the provider.

**Immutable attempt paths**: `runs/{runId}/{variant}/gen-{attemptNo}.png`. A late completion writes to its own path and its conditional completion (`WHERE current_attempt_id = :thisAttempt`) fails, so it cannot overwrite a newer result. Copied from the voucher renderer, which uses `render-{attempt}.pdf` for the same reason.

**Lease is longer than the route budget.** `maxDuration` is 300s; the stale threshold is **600s**, matching `STALE_RENDER_TIMEOUT_MS` in `src/app/api/vouchers/batches/[id]/render/route.ts:30`. v1's 300s lease left no recovery margin (F05).

**Attempt outcomes are four, not two:** `succeeded`, `failed`, `uncertain`, `abandoned`.

`uncertain` is the one that matters (F05). If the provider call is made and the response is lost, or decoding or storage fails after a `200`, the attempt is recorded `uncertain` with any request id captured. **An uncertain attempt is charged as if it succeeded** for budget purposes and is **never** retried automatically. The editor shows "this attempt may have been charged" and requires a deliberate Regenerate. The spec makes no exactly-once claim about provider billing, because the provider offers no mechanism for one.

**Transport retries are separate from Regenerate** (F05). Inside one attempt, at most **2** transport retries on `5xx` and `429` with bounded backoff. A Regenerate is a new attempt, and attempts per variant are capped at **6**, which is a spend guard rather than a reliability guard.

**Regenerating keeps the previous result** (F19). `current_attempt_id` moves only when the new attempt succeeds. A failed regeneration leaves the previously selected artifact selected and reviewable. Unselected attempts expire under the retention policy.

### 6.3 Approval binding (F07)

`placement_hash` = a stable hash of (source object hash, generation attempt id, logo corner, logo colour, logo scale, QR position, QR size, short link id, poster profile).

A composite is stored at `runs/{runId}/{variant}/composite-{placementHash}.png`, so it is content-addressed and immutable. Approval records `approved_placement_hash` on the variant.

Any change to the source, the generation, the event copy, the logo or the QR changes the hash and **invalidates the approval** for the affected variants. Publish refuses a variant whose `approved_placement_hash` does not match its current `placement_hash`. Signed URLs are minted per hash, so a stale browser preview cannot be mistaken for the current one.

Publish freezes a **manifest**: the exact `(variant, placement_hash, composite_path)` triples reviewed. While `status = 'publishing'`, placement and generation endpoints return `409`.

### 6.4 Publication (F06, D2)

Explicit partial publication, per variant, durable.

`event_artwork_publications` records per variant: `expected_previous_url`, `published_url`, `outcome` (`pending`, `published`, `skipped_conflict`, `failed`), `error`, timestamps.

Before replacing a variant, the current `events.<cache_column>` is compared with `expected_previous_url` captured when the manifest froze. A mismatch means someone uploaded manually in the meantime; the variant is marked `skipped_conflict` and **is not overwritten**. This is the compare-before-replace the review asked for.

A run that finishes with any variant not `published` ends in `partially_published`, and the editor shows exactly which succeeded, which conflicted and which failed. Retry re-attempts only unresolved variants.

**Discard is not rollback.** Discarding removes unpublished draft work. Published artwork is not reverted, because the previous object has already been deleted by the existing RPC path. The UI says this in those words.

### 6.5 Operation table (F18)

| Operation | Permission | Cost | Preconditions | On failure |
|---|---|---|---|---|
| `createRun` | `events:manage` | free | no active run | returns existing run, 409 |
| `uploadSource` | `events:manage` | free | run `draft`, no successful attempt | source rejected, run unchanged |
| `setPlacement` | `events:edit` | free | run `draft`, revision matches | 409 with current state |
| `generateVariant` | `events:manage` | **paid** | run `draft`, budget reserved, corner chosen | attempt `failed` or `uncertain`, others untouched |
| `composite` | `events:edit` | free | attempt `succeeded` | composite fails visibly, draft retained |
| `approve` | `events:edit` | free | composite matches current hash | no-op |
| `publish` | `events:manage` | free | all approvals current | per-variant outcome recorded |
| `retryPublish` | `events:manage` | free | run `partially_published` | unresolved variants only |
| `discard` | `events:manage` | free | not `publishing` | idempotent |

Every operation reads durable state first. Nothing resumes work on page load; the editor polls a single status endpoint with bounded backoff and shows a delayed state after 45s. Closing the tab **does not** cancel a provider call already in flight, and the editor says so.

Distinct, separately handled failures: `rate_limited` (retryable), `quota_exhausted` (not retryable, tells the owner to check billing), `moderation_blocked` (never auto-retried, shows the `moderation_stage` and categories), `invalid_request`, `provider_unavailable`, `uncertain`, `budget_exceeded`, `not_configured`.

## 7. Data model

All tables `public`, RLS enabled, **no `anon` grant**, `authenticated` denied, service role only. Written exclusively through server code using the admin client after a permission check. `assert-anon-surface.ts` is run after the migration.

### 7.1 `event_artwork_runs`

| Column | Type | Constraint |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `event_id` | uuid not null | fk `events(id)` on delete cascade |
| `status` | text not null default `'draft'` | check in (`draft`,`publishing`,`published`,`partially_published`,`discarded`) |
| `revision` | int not null default 1 | |
| `source_storage_path` | text null | |
| `source_sha256` | text null | |
| `model` | text not null | |
| `quality` | text not null | check in (`low`,`medium`,`high`) |
| `poster_profile` | text not null default `'standard'` | check in (`standard`,`high`) |
| `logo_corner` | text null | check in (`top_left`,`top_right`,`bottom_left`,`bottom_right`) or null for no logo |
| `logo_colour` | text null | check in (`white`,`black`); not null when `logo_corner` is not null |
| `logo_width_frac` | numeric not null default 0.22 | check between 0.08 and 0.35 |
| `qr_centre_x_frac`, `qr_centre_y_frac` | numeric null | check between 0 and 1 |
| `qr_width_frac` | numeric null | check between 0.1905 and 0.40 |
| `short_link_id` | uuid null | fk `short_links(id)` on delete set null |
| `event_copy_snapshot` | jsonb null | |
| `prompt_version` | text not null | |
| `created_by`, `created_at`, `updated_at`, `published_at`, `discarded_at` | | |

Indexes: partial unique on `event_id` where `status in ('draft','publishing')`; `(status, updated_at)` for cleanup.

**Coordinates are fractions of the image edge in the range 0 to 1**, named `_frac`, never percentages. v1 called them percentages and described them as fractions (F23). `qr_width_frac`'s floor of 0.1905 is derived in section 9.2.

### 7.2 `event_artwork_variants`

`(run_id, variant)` unique. Holds `status`, `current_attempt_id`, `approved_placement_hash`, `composite_path`, `claim_token`, `lease_expires_at`, `attempt_count`.

### 7.3 `event_artwork_attempts`

Append-only, never updated except to set a terminal outcome. Holds `variant_id`, `attempt_no`, `claim_token`, `outcome`, `storage_path`, `requested_size`, `provider_request_id`, `input_text_tokens`, `input_image_tokens`, `output_image_tokens`, `cost_usd`, `cost_basis` (`calculated`, `estimated`, `unknown`), `error_code`, `error_detail`, timings.

### 7.4 `event_artwork_publications`

Per variant per publish attempt, as section 6.4.

### 7.5 `event_artwork_spend`

One row per reservation. `(scope, scope_key, day)` where scope is `run`, `event` or `global`. Reserved before every paid call, reconciled after. This is the budget enforcement point, not a report.

### 7.6 Private bucket `event-artwork-drafts`

Not public. Objects at `events/{eventId}/runs/{runId}/...`. Storage policies deny `anon` and `authenticated` entirely; all access is server-side with the service role, and the browser receives **short-lived signed URLs (300s)** minted by an endpoint that verifies the caller's permission **and** that the requested path belongs to the run and event they asked for. Paths are always constructed server-side from ids; an arbitrary path or URL is never accepted (F12).

Signed URLs are bearer credentials until they expire, so: 300s lifetime, an authorised refresh endpoint, `Cache-Control: private, no-store` on editor responses, and they are never logged.

Bucket limits: 25 MB per object, `image/png` and `image/jpeg` only.

### 7.7 What does not change

No new value in `event_images.image_type`. No CHECK constraint change, no partial unique index change, no `CREATE OR REPLACE` of `upsert_event_image_variant` or `delete_event_image_variant`. Publishing writes the five existing variants through the existing action. `buildEventImageFields`, `buildEventImageList` and `/api/events/{id}/artwork` are untouched.

## 8. Provider contract (F09)

`POST {baseUrl}/images/edits`, `multipart/form-data`, plain `fetch`, matching the repo's no-SDK convention.

| Field | Value |
|---|---|
| `model` | `getOpenAIConfig().imageModel`, new field, env `OPENAI_IMAGE_MODEL`, default `gpt-image-2` |
| `image` | **one** file: the source square bytes read server-side from the drafts bucket |
| `prompt` | section 10, under 32,000 chars |
| `size` | the resolved request size, section 5.2 |
| `quality` | run's quality |
| `output_format` | `png` |
| `n` | `1` |

`input_fidelity` is **not sent**: the provider documents it as unsettable on `gpt-image-2`, which processes image inputs at high fidelity automatically. `stream` and `partial_images` are not used.

Response: JSON, `data[0].b64_json` and `usage`. Decoding is bounded: the base64 string is rejected above 40 MB before decode. The decoded buffer is validated (section 5.3) before storage. The effective model returned by the API is recorded on the attempt, so a snapshot change is visible after the fact.

Timeouts, all separate (F05): provider request 240s, storage write 30s, route budget 300s, lease 600s.

Error handling follows the documented shape: `error.type = "image_generation_user_error"` with `error.code` as the stable discriminator; `moderation_blocked` carries optional `moderation_details.moderation_stage` and `categories`. Branch on `error.code` first.

The existing `retry(fetch, RetryConfigs.api)` idiom is **not** used: it is `maxAttempts: 5`, and it is a no-op for HTTP errors anyway because `fetch` resolves rather than rejects on a 500. The explicit pattern from `src/app/actions/event-content.ts:100-146` is used, capped at 2.

## 9. Compositing

Server-side, `sharp` via `await import('sharp')`, `.composite()`. Preview and final output use the **same** geometry functions, exported from one pure module and unit tested (F16).

### 9.1 Logo

Source: `public/guest/anchor-logo-white.png` and `public/guest/anchor-logo-black.png`, both 934x421 RGBA with a real alpha channel.

- `public/logo-black.png` has **no alpha** and would stamp an opaque white rectangle. A test asserts the chosen source has an alpha channel.
- The composite route gets an `outputFileTracingIncludes` entry naming **both** files. The white one has never shipped through a server-render path.
- **Failure is visible, not graceful** (F24). Correction to v1: if a logo was selected and its file cannot be read, the composite **fails** with a clear error, the live artwork is untouched and the draft is retained. Only an explicit "no logo" choice omits a logo. The graceful-degradation pattern in `src/lib/pdf/document-logo.ts` is right for a PDF footer and wrong here, where branding is an acceptance criterion.

Geometry, derived not fixed (F16). Logo aspect is 934/421 = 2.2185.

```
logoW = round(imageW * logo_width_frac)
logoH = round(logoW / 2.2185)
inset = round(min(imageW, imageH) * 0.04)
```

Reserved rectangle passed to the prompt is derived from the **maximum permitted** logo at that corner, not a fixed 30% by 18%:

```
reservedW = (imageW * 0.35) + 2*inset
reservedH = ((imageW * 0.35) / 2.2185) + 2*inset
```

On a 1920x1080 landscape that is 723px by 346px, which is 37.7% of width and 32.0% of height. v1's fixed 30%/18% understated the height badly.

Upper bound 0.35 keeps the logo within its 934px native resolution on every variant.

### 9.2 QR (F15)

- **Link:** `EventMarketingService.generateSingleLink(eventId, 'poster')`, get-or-create, channel `poster` (`utm_source=poster`, `utm_medium=print`, `utm_content=poster_qr`, prefix `po`). Not `toilet_poster`, not `partner_poster` (prefix `pp`). `short_links` is service-role-write-only, so the admin client is required.
- **Destination validation (D6, F17):** before a poster can be approved, the selected link's `destination_url` is compared with the event's current canonical URL. A mismatch is repaired in place, which keeps the short code and therefore keeps already-printed posters working. If the event has no slug, is cancelled, or is not published, the poster cannot be approved and the editor says why. `generateSingleLink` returns an existing link without refreshing it, so this check is this feature's own responsibility, not something it can assume.
- **Rendering:** `QRCode.toBuffer(url, { ...QR_OPTIONS, type: 'png', width: targetPx })` from `src/lib/export/qr-pack.ts`: error correction H, margin 4, black on white. **The QR is rendered directly at the target pixel width, never rendered at 1200px and resampled.** v1 said "composite unmodified" while defaulting to 591px, which is a contradiction (F15); rasterising at the target keeps module edges crisp with no resampling.
- The rendered PNG's 4-module quiet zone is an opaque white plate. It is never trimmed or alpha-keyed. **The stated size includes the quiet zone.**
- **Minimum size, derived from millimetres with upward rounding:**

```
QR_MIN_MM = 40, A4_WIDTH_MM = 210
minFrac = 40 / 210 = 0.190476...
minPx   = ceil(posterWidthPx * 40 / 210) = ceil(2480 * 40/210) = ceil(472.38) = 473
```

v1's 19.0% was 39.9mm, below its own stated minimum, and 472px was a floor rather than a ceiling. Both corrected. Default is 50mm (`qr_width_frac` 0.2381, 591px).

- Poster only. The poster is written with `density: 300`, and the download flow tells the operator to print at actual size.
- **Overlap prevention:** the QR rectangle must not intersect the logo rectangle plus a gap of `inset`, and must sit fully inside the poster with an `inset` margin. Enforced server-side, not only in the slider.

### 9.3 Reserved zones in the prompt (F03)

**The logo corner and colourway are chosen before generation.** This is the material workflow change from v1, which reserved a corner the owner had not yet picked. The editor defaults to `bottom_right` / `white` and the owner can change it before pressing Generate.

The prompt states the reserved rectangle for the chosen corner (section 9.1) and, for the poster, a reserved band covering the default QR area.

After generation the owner may move the QR anywhere. Moving it **outside** the reserved band is allowed but raises a visible warning on the composite, because nothing can guarantee a freely placed overlay misses the copy. The editor is the enforcement; the spec makes no promise that any placement produces an acceptable layout.

The numeric clear-space and minimum-size rules here are **this spec's proposal, not an approved brand standard**. All three design briefs list a clear-space rule under "what we need back".

## 10. Event copy policy (F08)

The prompt carries the literal event copy, which `buildVariantPrompt()` today does not. That alone should improve results.

Precedence: **the event record is authoritative**, not text already in the square.

Fields and rules:

| Field | Rule |
|---|---|
| name | required, passed in quotes |
| date | required, `formatDateInLondon` |
| start time | required |
| doors, end, last entry | optional, included when set |
| price | `is_free` true renders "Free"; a numeric price renders the amount; **`is_free` false with a null price renders nothing at all**, never "Free" and never "£0". `src/app/actions/event-content.ts:655` already makes this distinction. |
| venue | fixed |

A long name (over 60 chars) is flagged before generation rather than silently truncated.

**The authoritative copy is shown to the owner on the source step**, so a mismatch between the square and the event record is caught before money is spent.

`event_copy_snapshot` and `prompt_version` are stored on the run. If the event's name, date, times or price change between approval and publish, affected approvals are invalidated and the editor requires re-review.

**Source screening:** the source step asks the owner to confirm the square carries no existing QR code and no third-party branding, since the model will faithfully reproduce both. This is a checkbox and a warning, not automated detection, and the spec says so.

## 11. Source and output validation (F13)

**Source:** `image/png`, `image/jpeg` or `image/webp`; magic-byte validated server-side with `validateFileType`; at most 25 MB and 50 megapixels decoded; square within the existing 5% tolerance; minimum 1080x1080 so the published square is not an upscale; EXIF orientation applied then all metadata stripped; animated files rejected. Browser-reported dimensions are never trusted. An abandoned source upload is cleaned up and never becomes a live image.

**Output:** every generated buffer is independently decoded and checked for exact dimensions, format and byte size before storage. A provider response that decodes to the wrong size is `failed`, not silently accepted.

## 12. Cost, accounting and budget

### 12.1 Accounting (F10)

Provider `usage` is **tokens, not dollars**. Cost is calculated from versioned rates for image output, image input and text input, held in one module with an effective-from date, and recorded per **attempt**, including failed downstream saves and deliberate regenerations.

`cost_basis` is explicit: `calculated` when usage was returned, `estimated` when it was not but the request shape is known, `unknown` when the outcome is uncertain. **Missing usage is recorded as `unknown`, never as zero.** v1's "better to log zero than a wrong number" is withdrawn: it hides spend.

Ledger writes to `ai_usage_events` use an idempotent key of `attempt_id`, carry event, run, variant, attempt and initiating user, and a failed ledger write is retried by the cleanup cron rather than dropped. `calculateOpenAICost` in `src/lib/openai.ts:86` is **not** used; it falls back to chat pricing for unknown models.

The claim that current AI spend is negligible is **not** used to justify anything: `generateEventSeoContent` logs nothing at all, so the historical figure is known to be incomplete.

### 12.2 Budget enforcement (F11, D4)

Visible cost is not bounded cost. Before every paid call, a spend **reservation** is written in the same transaction as the attempt claim. If the reservation would breach a ceiling, the call is refused with `budget_exceeded` and nothing is charged. Reservations are reconciled to actual cost afterwards; an `unknown` outcome holds its estimated reservation rather than releasing it.

| Ceiling | Default | Env |
|---|---|---|
| per run | $1.00 | `EVENT_ARTWORK_MAX_RUN_USD` |
| per event per day | $3.00 | `EVENT_ARTWORK_MAX_EVENT_DAY_USD` |
| global per day | $10.00 | `EVENT_ARTWORK_MAX_DAY_USD` |
| concurrent paid calls | 4 | `EVENT_ARTWORK_MAX_CONCURRENT` |

**These figures are the developer's proposal and need owner approval before the flag is enabled** (D4). They are deliberately tight: at medium quality a run is roughly $0.30 to $0.50, so $1.00 allows one run plus a couple of regenerations.

`EVENT_ARTWORK_AI_ENABLED=false` is a kill switch that disables generation while leaving compositing, publishing and the manual upload path working.

The estimated cost is shown before Generate and before every paid Regenerate.

Indicative cost per run of four adaptations, poster on `standard`: high roughly $0.70 to $1.20, **medium roughly $0.25 to $0.40 (default)**, low roughly $0.03 to $0.05. These are ranges because non-square sizes cost less per megapixel than square ones and reference-image input is charged separately; real figures come from `usage` on the first runs.

## 13. Interface

**A full-screen editor at `/events/[id]/artwork`.** Not the drawer: it is 640px wide with an internal scroll, and it inherits `maxDuration = 100` from `src/app/(authenticated)/events/page.tsx`.

**Entry (F20):** the event must exist. From the create-event drawer the button is disabled with "Save the event first, then add artwork". From an existing event it opens from the artwork panel and from the Marketing tab, and returns to where it came from.

Four steps on one page:

1. **Source.** File input **and** drop zone, not drop-only. Shows the authoritative event copy (section 10) and the source screening checkbox.
2. **Brand.** Corner (2x2), colourway, logo size. Chosen **before** Generate (F03).
3. **Generate.** Estimated cost, then one button. Four tiles fill in independently, each with status, a full-size view, Regenerate and a specific error message.
4. **Place and publish.** QR drag on the poster, live preview, per-variant approval, then Publish. Publish shows per-variant outcomes.

Accessibility and input (F20):

- Every control is a native labelled element. Where the global `min-height/min-width: 44px` rule below 820px would distort the corner picker, it is solved with padding and `data-touch-targets`, **not** by replacing buttons with non-buttons.
- The QR has keyboard nudges (arrows 1%, shift-arrows 5%), numeric X/Y/size fields, and a Reset placement button. Drag is an enhancement.
- Drag uses `@dnd-kit` `PointerSensor` with `touch-action: none`, as `DraggableBookingBlock.tsx:106` does. iPad Safari is verified on device, not assumed.
- Per-variant status is announced politely, once per transition, not on every poll.
- Visible focus, sensible focus management on step change, and a page that works at 200% zoom.
- Essential event facts remain available as text outside the images.

Performance (F21):

- Dragging composites **client-side on a scaled-down preview**; the authoritative server composite is debounced at 400ms and obsolete responses are cancelled and ignored.
- Tiles load scaled previews; full-size is on demand.
- Polling backs off, and shows a delayed state after 45s.
- The CSP `connect-src` allows only self, Supabase and PayPal, so the browser cannot fetch a provider URL. Generated bytes reach Supabase first, which the pipeline does anyway.

**One route handler, one validated `variant` parameter** (F21), not five near-identical routes.

**The existing five-tile panel and the copy-paste prompt box both stay** (D7, F25). The prompt box is removed only after the owner confirms the new flow is working. The panel's contradictory copy is fixed regardless: `EventImagePanel.tsx:495-497` claims uploads are immediate unconditionally while lines 330-334 say the opposite for a new event, and both render at once today.

## 14. Cleanup and retention (F22)

A weekly cron, `/api/cron/event-artwork-cleanup`, bounded and repeatable, dry-run by default per the `scripts/` convention:

- Runs terminal for more than 30 days measured from `published_at` / `discarded_at`: delete every object under the run prefix, listed from the Storage API rather than inferred.
- Runs in `draft` untouched for more than 14 days: mark `discarded`, then delete on the next pass.
- Runs stuck in `publishing` with an expired lease for more than 60 minutes: move to `partially_published` and alert. Never deleted while a lease is live.
- Superseded attempt objects for a still-active run: delete once older than 7 days and not `current_attempt_id`.
- Failed `ai_usage_events` ledger writes: retried.
- Deletion failures are recorded and retried rather than dropped.

**Event deletion** cascades the rows and would erase the paths cleanup needs, so a storage manifest is written per run and an `event_artwork_tombstones` row survives the cascade to carry the prefix for later deletion.

Accounting and audit rows are retained under a separate policy and are not deleted by this cron.

Basic cleanup ships in the first enabled release, not a later phase.

## 15. Monitoring (F28)

Every log line and audit event carries `event_id`, `run_id`, `variant`, `attempt_id` and the provider request id. Never the source bytes, never a signed URL, never the API key.

Recorded per attempt: duration, result code, usage-accounting status, publish outcome.

Alerts: any `uncertain` attempt; a run in `publishing` for over 60 minutes; three consecutive generation failures; a ledger write unresolved for 24 hours; cleanup backlog over 200 objects. Alerts go to `CRON_ALERT_EMAIL`, the existing channel.

A stuck-run view lists active runs with their leases. A short runbook covers: disable generation (`EVENT_ARTWORK_AI_ENABLED=false`, which leaves manual uploads working), release a stuck lease, reconcile an uncertain charge against the provider dashboard.

## 16. Testing (F27)

**`test:utc` does not exist and cannot simply be added.** `vitest.config.ts` hardcodes `env: { TZ: 'Europe/London' }`, which would override a `TZ=UTC` prefix. The config must read `process.env.TZ ?? 'Europe/London'` first, then `"test:utc": "TZ=UTC vitest run"` works. A test asserts the process is actually in the expected zone, so the harness cannot silently lie. This is a workspace standard the repo is missing, so it is fixed here.

Unit: size resolution against all four provider constraints, table-driven; resize contract including the accepted crop and rejecting `fill`/`contain`; QR minimum derived from millimetres with upward rounding (473px, not 472); logo and reserved-box geometry, with preview and server maths asserted identical; QR/logo overlap rejection; logo source has an alpha channel; prompt includes name, date, time and the price rule for all three price cases; cost calculated from versioned rates with `unknown` never coerced to zero; budget reservation refuses at the ceiling.

Integration, provider mocked with recorded fixtures: the full state machine; concurrent claim; stale takeover cannot overwrite a newer result; `uncertain` is recorded and never auto-retried; `moderation_blocked` not retried; regenerate-then-fail keeps the previous artifact; approval invalidated by source, placement and event-copy change; publish manifest frozen; compare-before-replace skips a conflicted variant; partial publish retries only unresolved variants; discard cannot be revived by a late completion.

Database concurrency: real Postgres, two writers, asserting one active run and one current claim. Not mocked.

Authorisation: ordinary staff and anonymous callers denied on every endpoint including the signing endpoint; a signed-URL request for another event's run refused.

Regression: `buildEventImageFields` still emits square first; `print_poster_url` never reaches `posterImageUrl`; `/api/events/{id}/artwork` still returns square, story and landscape only.

Both zones: `npm test` and `npm run test:utc`.

Manual, before the flag is enabled: cold deployed route with `sharp` and the traced logo files; iPad Safari; printed A4 QR scanned on at least two phones with the destination checked, not just the scan.

The acceptance and recovery matrix from the review (its section "Required acceptance and recovery matrix") is adopted verbatim as the release gate.

## 17. Phasing (F25, D7)

Internal deployment milestones are separated from owner-visible release. **Everything ships behind `EVENT_ARTWORK_AI_ENABLED`, default off.**

| Phase | Scope | Visible? |
|---|---|---|
| 0 | `vitest.config.ts` TZ fix and `test:utc` script | no |
| 1 | Migration: four tables plus spend and tombstones, RLS, grants, private bucket. `assert-anon-surface.ts` clean. | no |
| 2 | Pure modules: size resolution, resize contract, logo and QR geometry, prompt builder, cost rates. Fully unit tested, no I/O. | no |
| 3 | Provider client and the generate route with claim, attempts, uncertain handling and budget reservation. Fixture-tested. | no |
| 4 | Compositor plus `outputFileTracingIncludes`, verified on a preview deploy. | no |
| 5 | Publish, compare-before-replace, partial outcomes, retry, discard. | no |
| 6 | Editor page: source, brand, generate, place, approve, publish, accessibility. | no |
| 7 | Cleanup cron, monitoring, alerts, runbook. | no |
| 8 | Owner-authorised paid trial, then enable the flag. | **yes** |

Nothing is owner-visible until phase 8, which is deliberate: a technically deployed milestone must not be mistaken for a usable release.

## 18. Deployment gates (F26)

- **Named owner:** Peter Pitcher for print acceptance, spend ceilings and the go-live decision. Implementation and review by this session.
- **Migration:** drafted here, reviewed under the `prod-migrate` skill, applied **only** on the owner's explicit go-ahead. Additive only: new tables and a new bucket, nothing altered or dropped.
- **The two production migration versions with no local file** (`20260905124506`, `20260905124510`) are reconciled **read-only** first. A broad `db push` is never run to make the local directory match, since `db push` applies any untracked migration.
- **Runtime parity:** deployed Node and `sharp` versions, function settings, `OPENAI_IMAGE_MODEL` availability in the project, and the logo tracing entries are all verified on a preview deploy before phase 8.
- **Preview isolation:** the trial runs against preview credentials, never production keys.
- **Rollback:** set `EVENT_ARTWORK_AI_ENABLED=false`. Tables and data are retained. Rollback never drops tables while attempts may still be settling.
- Release evidence names the exact migration versions and deployment ids.

## 19. Risks

| Risk | Handling |
|---|---|
| The model will not reproduce the event copy accurately across four shapes. The provider documents this limitation. | The prompt now carries the literal copy, which today's does not. Every variant is reviewed. Phase 8's trial is where this is actually tested, before the flag goes on. If it fails, the fallback design is deterministic text compositing, recorded as out of scope for now. |
| Duplicate provider charges after a lost response. | Cannot be eliminated; the provider offers no idempotency for this endpoint. Recorded as `uncertain`, charged against budget, never auto-retried, surfaced to the owner and alerted on. |
| Poster at 194 dpi disappoints in print. | Phase 8 prints one before the flag goes on. `high` is an env change. |
| 934px logo is soft on a large poster placement. | Capped at 0.35 of width, within native resolution on every variant. |
| Composite route ships without the logo files. | Tracing entry for both files, failure is visible not silent, verified on a preview deploy in phase 4. |
| `sharp` is native; a composite that works locally can fail cold on Vercel. | Phase 4 is deployed and verified alone before anything depends on it. |
| Mixed live artwork after a partial publish. | Durable per-variant outcomes, compare-before-replace, retry of unresolved only, and the editor states the mixed status plainly. |
| A printed QR opens the wrong page after a rename. | This event's poster link destination is validated and repaired before approval. Bulk repair stays separate. |
| Edits land on a dead duplicate component. | `EventImagePanel` imports from `event-image-variants`; two upload actions exist and only one is live. Confirm before touching either. |
| Spend ceilings were invented by the developer. | Flag stays off until the owner approves them. |

## 20. Acceptance criteria

1. Uploading a square and pressing Generate produces four adaptations at exactly the target pixel dimensions; the published square is the owner's own image, resized only.
2. Every variant is reviewable full size before anything is published.
3. Discarding a run leaves existing live artwork byte-identical.
4. The selected corner and colourway are applied with no upscaling above 0.35 of image width, and a missing logo file fails visibly rather than publishing unbranded.
5. The poster QR is at least 40mm at A4 (473px at 2480px wide), carries `utm_source=poster&utm_medium=print&utm_content=poster_qr`, resolves to the event's current canonical URL, and scans off a printed sheet on two phones.
6. Regenerating one variant does not touch or re-bill the other three, and a failed regeneration leaves the previous result selected.
7. Two tabs cannot create two active runs, and a stale worker cannot overwrite a newer result.
8. A lost provider response is recorded as `uncertain`, counted against budget, and never retried automatically.
9. Every attempt's cost appears in `ai_usage_events` attributed to event, run, variant, attempt and user, with `cost_basis` never silently zero.
10. Exceeding a spend ceiling refuses the call before it is made.
11. A publish that fails part-way records exactly which variants published, which conflicted and which failed, and retry touches only the unresolved ones.
12. A manual upload during publication is not silently overwritten.
13. `image[0]` is still the square; `posterImageUrl` is never the A4 poster; CheersAI's artwork response is unchanged.
14. No draft object is reachable without a valid short-lived signed URL, and no signing endpoint will sign another event's path.
15. The whole workflow is completable with keyboard only and on iPad Safari.
16. `npm test` and `npm run test:utc` both pass, and the harness proves it ran in two different zones.

## 21. Response to the developer review

| Finding | Resolution |
|---|---|
| F01 four vs five images | D1: square preserved, four generated. Applied throughout. |
| F02 missing decisions | Section 0 records all eight as dated developer assumptions with reversibility, not approvals. |
| F03 logo chosen after prompt | Corner and colourway now chosen **before** Generate; free movement afterwards warns rather than promising a good layout. |
| F04 draft uniqueness | Active = `draft` or `publishing`; atomic get-or-create; revision checks; immutable source after first success. |
| F05 exactly-once billing | Withdrawn. Four attempt outcomes including `uncertain`; 600s lease vs 300s route; immutable attempt paths; conditional completion; transport retries separated from Regenerate. |
| F06 publication contract | D2: explicit partial publication, durable per-variant outcomes, compare-before-replace, scoped retry, discard is not rollback. |
| F07 preview not bound to bytes | `placement_hash`, content-addressed composites, approval bound to the hash, frozen publish manifest. |
| F08 event copy policy | Section 10, including the three-way price rule and copy-change invalidation. |
| F09 API contract | Section 8 fully specifies the request, decoding bound and error branching. "Only viable model" softened to a judgement. |
| F10 cost accounting | Versioned rates for output, image input and text input; `cost_basis`; "log zero" withdrawn. |
| F11 bounded cost | Section 12.2: server-side reservation, three ceilings, concurrency cap, kill switch, estimate before spend. Numbers flagged for approval. |
| F12 permissions and storage | Section 6.5 matrix, D5, server-constructed paths, 300s signed URLs, no-store, never logged. |
| F13 validation | Section 11, separate source and output contracts. |
| F14 resize ambiguity | Section 5.3 explicit fit, position, kernel, accepted crop, density. v1's `optimiseImage` claim corrected. |
| F15 QR geometry | Rendered at target width, not resampled; minimum derived from mm with upward rounding to 473px; size includes quiet zone; density 300 and print-at-actual-size. |
| F16 reserved boxes | Derived from maximum logo geometry, not fixed percentages; overlap prevention; one shared geometry module. |
| F17 printed-link durability | D6: this event's link validated and repaired before approval; missing or unpublished destinations block approval. |
| F18 failure states | Section 6.5 operation table plus the distinct error taxonomy and bounded polling. |
| F19 regeneration | Immutable attempts; `current_attempt_id` moves only on success. |
| F20 entry and accessibility | Section 13: event must exist, file input alongside drop, keyboard nudges and numeric fields, native controls, on-device iPad check. |
| F21 performance | Client preview while dragging, debounced authoritative composite, on-demand full size, one parameterised route. |
| F22 cleanup | Section 14: abandoned drafts, stuck publishing, tombstones for event deletion, ships in the first enabled release. |
| F23 data model | Section 7: checks, defaults, FK behaviour, `_frac` naming, immutable attempts, no summed-cost race. |
| F24 graceful degradation | Reversed. A missing selected logo now fails visibly. |
| F25 phasing | Section 17: nothing owner-visible until phase 8; prompt fallback retained. |
| F26 deployment gates | Section 18: named owner, read-only migration reconciliation, preview isolation, flag-based rollback. |
| F27 acceptance tests | Section 16: `test:utc` genuinely fixed at the config level; adverse-path, concurrency, authz and print tests; review matrix adopted verbatim. |
| F28 monitoring | Section 15. |
| F29 rights and disclosure | Section 10 source screening; section 13 states that the source is sent to an external provider; prompts carry only public event information. |
| F30 smaller pilot | Phase 8 is exactly that trial, and it gates the flag. |
