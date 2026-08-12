# Event image variants: discovery

Date: 2026-08-12
Status: discovery only, no code written
Complexity: 4 (L) - schema change + 2 apps + public API contract + UI. Must be phased.

## 1. What actually happens today (verified live)

### The upload
There is exactly one image control on an event: `SquareImageUpload`, rendered by
`src/app/(authenticated)/events/_components/EventDrawer.tsx:622`. It is labelled
"recommended: 1080x1080px".

The upload action (`src/app/actions/event-images.ts`) does three things:
1. Puts the file in the public `event-images` bucket at
   `events/{event_id}/{image_type}/{timestamp}_{filename}`, always with
   `image_type = 'hero'`.
2. Inserts a row into `event_images`.
3. Writes the public URL to `events.hero_image_url` only.

Then the drawer (`EventDrawer.tsx:379-382`) copies that same URL into all three
columns on save:

```
formData.set('hero_image_url', heroImageUrl)
formData.set('thumbnail_image_url', heroImageUrl)
formData.set('poster_image_url', heroImageUrl)
```

### Live database proof
Production Supabase (`tfcasgxopxegwrabvwat`), 2026-08-12:

| metric | value |
|---|---|
| events total | 130 |
| with `hero_image_url` | 51 |
| with `thumbnail_image_url` | 51 |
| with `poster_image_url` | 51 |
| rows where hero = thumbnail = poster | **51 of 51** |
| with any `gallery_image_urls` | 0 |
| future events (date >= today) | 18 |
| future events with any image | **3** |

So the three "different" columns hold the identical square on every single row.
`poster_image_url` and `thumbnail_image_url` are labels with nothing behind them.

`event_images` holds 39 rows, all `image_type = 'hero'`, against 51 events with a
hero URL. The metadata table is already out of step with the columns and nothing
reads it.

### Storage
Bucket `event-images`: public, **10 MB file size limit**, MIME allowlist
`image/jpeg, image/jpg, image/png, image/webp, image/gif`. No PDF, no TIFF.

## 2. What the website actually receives (verified against production API)

Live call to `GET /api/events` on management.orangejelly.co.uk, 2026-08-12:

```
Cowboys & Queens Country Music Bingo  imageCount: 3  uniqueImages: 1
The Last Quiz of Summer               imageCount: 3  uniqueImages: 1
End of Summer Cash Bingo              imageCount: 3  uniqueImages: 1
Detention Disco: Back to School       imageCount: 0  uniqueImages: 0
Autumn Kick-Off Quiz Night            imageCount: 0  uniqueImages: 0
Big Sing Friday: Karaoke Night        imageCount: 0  uniqueImages: 0
```

`src/lib/api/schema.ts:227-232` builds the schema.org `image` array by pushing
hero, then thumbnail, then poster. Because all three are the same square, the
public API publishes **the same URL three times**. The website copies that array
straight into its Event JSON-LD (`lib/schema-helpers.ts:149`).

Google's Event structured data guidance asks for multiple aspect ratios
(1x1, 4x3, 16x9). We currently send 1x1 three times.

Also note: `heroImageUrl` / `thumbnailImageUrl` / `posterImageUrl` are emitted by
the **detail** route (`api/events/[id]/route.ts:300-302`) but **not** by the list
route. Confirmed absent from the live list response. The website's list-driven
pages therefore rely on `image[0]`.

### Where the website consumes images

| Consumer | Reads | Shape wanted |
|---|---|---|
| `app/events/[id]/page.tsx:407` hero | `heroImageUrl \|\| image[0]` | landscape would suit |
| `components/events/FeaturedEvent.tsx:111` | `getEventImage` | `aspect-square` |
| `components/events/RelatedEvents.tsx:98` | `getEventImage` | `aspect-square` |
| `components/events/EventListItem.tsx:54` | `getEventImage` | 120px thumb |
| `components/EventCountdownBanner.tsx:285` | hero, thumb, poster, image[0] | mixed |
| `app/events/[id]/social-image/route.ts` | `getEventImage` | 1200x1200 |
| `app/events/[id]/opengraph-image.tsx` | generated | 1200x630 |
| `lib/structured-data/event-schema.ts:86,187` | `image[0]`, `thumbnailImageUrl` | JSON-LD |

The website already builds a 1200x1200 social image by taking the square, blurring
a copy for the background and compositing the original on top
(`social-image/route.ts`). That whole trick exists **only because there is no
non-square asset**. A real landscape upload removes the need for it.

## 3. Live breakage risk to design around

`lib/event-image.ts` on the website resolves in this order:

```
image[0]  ->  posterImageUrl  ->  heroImageUrl  ->  thumbnailImageUrl
```

`posterImageUrl` is preferred over hero. If we start writing the **A4 print
poster** into `events.poster_image_url`, the website will try to serve a
print-resolution file as a web image, and `social-image/route.ts` will try to
download and resize it on every social crawl. That is a live regression.

**Rule: do not repurpose `poster_image_url` for the print poster.** Either leave
it alone or land the website change first.

## 4. Recommended variant set

The ask was square (have), story, A4 poster, Facebook event cover. Recommendation
below merges two of those and adds one, because Facebook's event cover and the
generic link-preview card are the same 1.91:1 shape, and the website's real gap is
a landscape hero.

| Variant | Ratio | Upload size | Web-served? | Used for |
|---|---|---|---|---|
| Square | 1:1 | 1080x1080 | yes | event cards, related events, list thumbs, IG/FB feed post |
| **Landscape** | 16:9 | 1920x1080 | yes | website event hero, YouTube, wide screens. **New, biggest website win** |
| Social / FB cover | 1.91:1 | 1920x1005 | yes | FB event cover, FB/LinkedIn/X link preview, OG image. Covers two of the asks with one file |
| Story | 9:16 | 1080x1920 | no (store) | IG/FB Stories and Reels covers, in-venue vertical screens |
| A4 poster | 1:1.414 | 2480x3508 @300dpi, or PDF | **no** | print only. Download from AMS, never sent to the website |

Optional, derived not uploaded: a 4:3 crop from the landscape via `sharp` (already
a dependency at `^0.34.5`, currently unused in `src/`). That is the only thing
needed to make the schema.org `image` array a genuine 1x1 / 4x3 / 16x9 triple
instead of the same square three times.

Do **not** auto-crop the designed variants from a single master. The whole point
is that each is laid out separately with its own text placement, and an automatic
crop would cut the copy.

## 5. Storage constraints that bite

- Bucket cap is 10 MB. A 300 dpi A4 PNG is routinely 20-40 MB. Either raise the
  bucket limit, require JPEG for print, or accept PDF.
- PDF is not on the bucket MIME allowlist. Adding print means adding
  `application/pdf`.
- Server actions in this project cap at 20 MB body. Large print files should
  upload browser-direct to Supabase Storage with a signed URL rather than through
  the server action, which sidesteps the cap entirely.

## 6. Schema options

**Option A - more columns on `events`.** Add `story_image_url`,
`landscape_image_url`, `social_cover_url`, `print_poster_url`. Simple, matches the
existing pattern. But it extends a set of columns that is already being misused,
and gives no place for per-variant alt text or file metadata.

**Option B (recommended) - use the `event_images` table properly.** It already
exists with `event_id`, `image_type` (plain `text`, so widening is free),
`storage_path`, `alt_text`, `caption`, `display_order`, `mime_type`,
`file_size_bytes`, `uploaded_by`, and it already has RLS (public SELECT, writes
gated on permission). Widen the `image_type` values to the variant set, keep
`events.hero_image_url` etc. populated as a denormalised cache so nothing on the
website breaks, and stop the column sprawl.

Option B also gives the "some for storage" requirement a natural home: variants
not marked web-served simply never reach the API, but staff can download them from
the event drawer.

## 7. Suggested phasing (score 4, must be split)

1. **Phase 1 - storage and schema.** Widen `event_images.image_type`, raise the
   bucket limit, add PDF to the allowlist. No user-visible change.
2. **Phase 2 - AMS upload UI.** Replace the single square control with a
   per-variant upload panel in the event drawer, plus download links. Keep writing
   `hero_image_url` exactly as today so the website is untouched.
3. **Phase 3 - API contract.** Add the new variant fields to both the list and
   detail routes (additive, so the website keeps working), and fix the schema.org
   `image` array to emit distinct ratios instead of the same URL three times.
4. **Phase 4 - website.** Consume the landscape hero and the 1.91:1 social cover,
   and retire the blur-composite workaround in `social-image/route.ts`.

## 8. Defects found in passing (not part of the ask)

- `src/app/api/events/[id]/route.ts:300-302` falls back to `event.image_url`. That
  column **does not exist** on the live `events` table. Harmless today because the
  route uses `.select('*')` so it reads `undefined`, but it is dead code that
  reads as if it were a real fallback.
- `src/types/api.ts:56` declares `image_url?: string | null` for the same
  non-existent column.
- `event_images` has 39 rows against 51 events with a hero URL, and nothing reads
  the table. Either adopt it (Option B) or drop it.
- 15 of the 18 upcoming events have no image at all.
