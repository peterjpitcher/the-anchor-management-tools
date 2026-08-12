# Event image variants: specification

Date: 2026-08-12
Version: 3, owner decisions applied
Status: **approved, in build**
Related: [discovery](./2026-08-12-event-image-variants-discovery.md) ·
[developer review](./2026-08-12-event-image-variants-developer-review.md)
Complexity: 4 (L). Five independently deployable phases.

Owner decisions, all confirmed:
- Five variants, with the Facebook event cover and the social link preview merged
  into one 1.91:1 asset.
- The A4 poster may be a PDF.
- Remove the separate Upload button. Attaching a file uploads it immediately.
- Fix the live category delete bug first, and any other problem found while
  building. Shipped as phase 0, commit `3a71d915`.
- Story and print files may be publicly reachable by URL. See 5.5.
- Event categories are in scope and get fixed too. See 7.4.

Version 2 changes, all from the developer review, all verified against live code
and production data before being accepted. Finding-by-finding resolutions are in
the appendix.

- Uploads go **browser-direct to Supabase Storage via a signed URL**, not through a
  server action. The 15 MB figure in version 1 was unsafe: AMS runs on Vercel,
  whose serverless request body limit is far below it, and no file over 3.08 MB has
  ever been uploaded to prove otherwise. Receipts and employee right-to-work
  already use this exact pattern in this codebase.
- The schema.org `image` array stays **square-first**, so no phase can change what
  the website's square card slots render.
- **Category images are a shared fallback, never event-owned.** This fixes a live
  production bug, see section 5.4.
- Database writes move into **RPCs** so the metadata row and the cache column
  cannot disagree, and delete now clears the reference before removing the file.
- The drawer gains a real **unsaved-changes guard**. Version 1 claimed one already
  existed. It does not.

---

## 1. Problem

One square image is uploaded per event and copied into three columns that claim to
be different things. The website and Google therefore receive the same square URL
three times, there is no landscape asset for the event hero, and there is nowhere
to keep the print and story artwork that gets made for every event anyway.

Separately, the upload control has a two-step "choose then upload" flow. Choosing a
file and closing the drawer silently discards it.

## 2. Goals

1. Upload and store five distinct artwork variants per event.
2. Serve the right shape to the right surface on the-anchor.pub.
3. Keep the print poster and story artwork in one findable place, downloadable
   from AMS, and absent from the public API.
4. Attaching a file uploads it. No second click, nothing silently lost.
5. Nothing on the live website changes appearance until the website itself is
   deployed to use the new artwork.

## 3. Out of scope

- Auto-cropping or generating variants from a master image. Each is designed
  separately with its own text layout.
- A derived 4:3 crop for Google. Three genuinely different ratios is enough.
- Per-variant alt text. Dropped entirely from v1, see appendix F16. The single
  shared `events.image_alt_text` is unchanged.
- Gallery images. The variant work must not break them, but adds nothing.
- Bulk backfill of artwork for the 15 upcoming events with no image. Content job.
- Idempotency keys, operation dashboards and alert thresholds. This is a
  single-venue tool with a handful of editors, see appendix F18 and F24.

---

## 4. The variant set

| Key | Name shown to staff | Ratio | Target size | Web-served | Accepts | Cap |
|---|---|---|---|---|---|---|
| `square` | Square | 1:1 | 1080x1080 | yes | JPEG, PNG, WebP | 10 MB |
| `landscape` | Landscape | 16:9 | 1920x1080 | yes | JPEG, PNG, WebP | 10 MB |
| `social` | Social / Facebook cover | 1.91:1 | 1920x1005 | yes | JPEG, PNG, WebP | 10 MB |
| `story` | Story | 9:16 | 1080x1920 | no | JPEG, PNG, WebP | 10 MB |
| `print_poster` | A4 poster (print) | 1:1.414 | 2480x3508 at 300dpi | no | JPEG, PNG, PDF | 25 MB |

"Web-served" means the URL is emitted on the public API. `story` and
`print_poster` are never emitted and are reachable only from AMS.

### 4.1 Aspect ratio checking

Target sizes are guidance, not a hard requirement, with one exception: the ratio
is checked so a file cannot land in obviously the wrong tile. Tolerance is **±5%**
on the ratio. Outside that, the upload is refused with a message naming the
expected and the actual shape, for example "Landscape expects a 16:9 image. That
file is 1:1. Did you mean the Square tile?"

Dimensions are read in the browser before upload. Because the file goes
browser-direct to storage, the server never holds the bytes and cannot
independently verify them. That is accepted: the threat being defended against is
a staff member picking the wrong file, not a hostile uploader. Uploading is already
gated on the `events` / `edit` permission.

PDFs are not ratio-checked, since page geometry is not readable in the browser
without a parser. Any PDF within the size cap is accepted for `print_poster`.

### 4.2 Upload mechanism

Version 1 routed uploads through the existing server action. That was wrong.
AMS is deployed on Vercel, where the serverless request body limit is well under
the 15 MB the spec assumed, and `next.config.mjs` setting
`serverActions.bodySizeLimit: '20mb'` does not raise the platform limit. Every
image in production is under 3.08 MB, so the current 10 MB allowance has never
actually been tested at the top of its range.

Uploads therefore go **browser-direct to Supabase Storage using a signed upload
URL**, the pattern already used by `src/services/receipts/receiptMutations.ts:1310`
and `src/app/actions/employeeActions.ts:774`. Three steps:

1. `requestEventImageUpload(eventId, variant, fileMeta)` checks the permission,
   validates type, size and ratio, decides the storage path, and returns
   `{ path, token }` from `createSignedUploadUrl`.
2. The browser calls `uploadToSignedUrl(path, token, file)` directly. The file
   never passes through a serverless function.
3. `confirmEventImageUpload(eventId, variant, path)` records the metadata, updates
   the cache column, removes the previously stored object, and writes the audit
   entry.

If step 3 never runs, for example because the tab is closed mid-upload, the object
is orphaned in storage and referenced by nothing. Section 9.4 covers the sweep.

Storage path stays `events/{event_id}/{variant}/{timestamp}_{filename}`.

---

## 5. Data model

`event_images` holds one row per event per singleton variant: storage path, MIME
type, byte size, uploader, timestamps. `events` keeps denormalised URL columns as
the read cache, which is what the public API and the AMS panel both read.

### 5.1 Live schema facts this must work around

- `event_images_image_type_check` restricts `image_type` to
  `hero, thumbnail, poster, gallery`. Must be widened before any new value is
  written.
- The upload action's Zod enum allows `primary`, which that constraint rejects.
  Latent bug, fixed by driving both from one shared config (section 5.6).
- `event_images` has 39 rows across 36 distinct `(event_id, image_type)` pairs.
  Three duplicate pairs, so a unique index needs a dedupe first.
- 51 events have a hero URL but only 36 have a metadata row. **The metadata table
  is not, and cannot cheaply become, the source of truth.** Section 5.3.
- 16 of those 51 events point at a storage object owned by a *category*, not by
  themselves. Section 5.4.

### 5.2 Migration 1: `event_image_variants` (purely additive)

```sql
-- 1. Widen the allowed variant list. Every currently valid value is retained, so
--    this migration is safe to apply ahead of any code deploy and safe to roll
--    code back under. Legacy values are removed in phase 5, not before.
alter table event_images drop constraint event_images_image_type_check;
alter table event_images add constraint event_images_image_type_check
  check (image_type in (
    'square','landscape','social','story','print_poster',
    'gallery','hero','thumbnail','poster'
  ));

-- 2. Map existing rows onto the new vocabulary.
update event_images set image_type = 'square' where image_type = 'hero';

-- 3. Dedupe the singleton variants only. Gallery is intentionally excluded: it is
--    a multi-row type and deduping it would destroy data in any environment that
--    has it. Storage objects are NOT deleted here, so this cannot break a live
--    image. Deleted rows are copied to a backup table first.
create table event_images_dedupe_backup_20260812 as
select * from event_images where false;

with ranked as (
  select id, row_number() over (
           partition by event_id, image_type order by created_at desc, id desc
         ) as rn
  from event_images
  where image_type in ('square','landscape','social','story','print_poster')
)
insert into event_images_dedupe_backup_20260812
select ei.* from event_images ei join ranked r on r.id = ei.id where r.rn > 1;

delete from event_images ei
using event_images_dedupe_backup_20260812 b where b.id = ei.id;

-- 4. Partial unique index: singleton variants only, so gallery keeps its
--    multiplicity and its display_order ordering.
create unique index event_images_singleton_variant_uniq
  on event_images (event_id, image_type)
  where image_type in ('square','landscape','social','story','print_poster');

-- 5. Denormalised read cache on events.
alter table events
  add column landscape_image_url text,
  add column social_image_url    text,
  add column story_image_url     text,
  add column print_poster_url    text;

comment on column events.landscape_image_url is '16:9 artwork, website hero';
comment on column events.social_image_url    is '1.91:1 artwork, Facebook event cover and link preview';
comment on column events.story_image_url     is '9:16 artwork. Never emitted by the public API';
comment on column events.print_poster_url    is 'A4 print artwork, image or PDF. Never emitted by the public API';

-- 6. Storage bucket. The guard matters: an UPDATE that matches nothing still
--    reports success, so a typo would silently leave PDF unsupported.
do $$
declare n int;
begin
  update storage.buckets
  set file_size_limit = 26214400,
      allowed_mime_types = array[
        'image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf'
      ]
  where id = 'event-images';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'event-images bucket not updated, % rows affected', n;
  end if;
end $$;
```

`hero_image_url`, `thumbnail_image_url` and `poster_image_url` are not touched.

### 5.3 Which table is authoritative

Version 1 called `event_images` canonical. Production data says it cannot be:
15 events have a live image with no metadata row, so a panel reading only that
table would show an empty Square tile for an event that visibly has artwork on the
website.

The rule instead:

- **`events.*_image_url` is authoritative for "which file is this event using".**
  It is complete today and is what the API and website read.
- **`event_images` is supplementary**, holding file name, size, MIME type and
  uploader for the rows that have it. The panel shows that detail when present and
  simply omits it when not.
- Both are written together by the RPC in section 6.2, so everything uploaded from
  now on has both.

This removes the need for a reconciliation migration entirely. No backfill, no
unresolved-row report, no waiting for counts to reach zero.

### 5.4 Category images are shared, and deleting one today is a live bug

Verified in production on 2026-08-12: of the 51 events with a hero image, **16
point at a storage object under `categories/`, not their own folder**. New events
inherit `event_categories.default_image_url` at creation
(`src/app/actions/events.ts:254-256`) and the URL is copied as-is.

One Cash Bingo category object is shared by **8 events**.

`deleteEventImage` currently deletes the storage object for whatever URL it is
handed. Pressing the delete button on any one of those 8 events removes the file
and breaks the image on the other 7, on the category default, and on every future
event that would have inherited it. That is a live one-click data-loss bug in
production today, not something this spec introduces.

The ownership model:

- An event **owns** an object only if its storage path starts with
  `events/{that event id}/`.
- Anything else is **inherited**. The panel labels it "From category: {name}" and
  offers Download but **no Delete**. The control to remove it is "Use a different
  image", which uploads a replacement into the event's own folder.
- Delete never removes a storage object the event does not own. It clears the
  event's own reference only.
- A `print_poster` or `story` is never inherited, because categories have no such
  fields.

The panel derives ownership from the path, so this works for the 16 existing
events with no migration.

### 5.5 Privacy position

`event-images` is a public bucket and `event_images` has an anonymous SELECT
policy. Keeping a URL off the public API therefore makes an object **unlisted, not
private**: anyone holding the URL can fetch it.

**Owner decision, 2026-08-12: public is acceptable.** These files are event
marketing artwork that gets posted publicly anyway, so unlisted-but-reachable is
the right trade and avoids a private bucket, signed download URLs and their expiry
handling. Recorded as a deliberate decision, not an oversight.

If pre-announcement artwork ever needs to be genuinely confidential, that is a
separate piece of work: private bucket, authorised download route, and removal of
the anonymous SELECT policy.

### 5.6 One shared variant configuration

`src/lib/events/imageVariants.ts` exports a single typed `EVENT_IMAGE_VARIANTS`
record: key, display label, ratio, target dimensions, accepted MIME types, size
cap, whether it is web-served, and its cache column on `events`. Action validation,
the UI panel and the tests all read it. A contract test asserts its keys match the
database CHECK constraint, so the two cannot drift.

---

## 6. Server actions and RPCs

All in `src/app/actions/event-images.ts`. Permission stays `events` / `edit`.
Audit logging on every upload and delete.

### 6.1 Actions

| Action | Does |
|---|---|
| `requestEventImageUpload(eventId, variant, fileMeta)` | Permission check, validate MIME/size/ratio against `EVENT_IMAGE_VARIANTS`, build the path, return `createSignedUploadUrl` result |
| `confirmEventImageUpload(eventId, variant, path, fileMeta)` | Calls the upsert RPC, then best-effort deletes the returned old object, then audit log |
| `deleteEventImage(eventId, variant)` | Calls the delete RPC, then best-effort deletes the returned object, then audit log |
| `getEventImages(eventId)` | Returns per-variant state: URL, ownership (owned / inherited), and file metadata where a row exists |
| `requestCategoryImageUpload(categoryId, fileMeta)` | Category equivalent of the above, square only |
| `confirmCategoryImageUpload(categoryId, path, fileMeta)` | Sets `default_image_url`, removes the previous object if unreferenced |
| `deleteCategoryImage(imageUrl, categoryId)` | **Shipped early** in `3a71d915`. Clears `default_image_url`, removes the object only once no event inherits it |

`deleteEventImage` replaces the current `(imageUrl, entityId)` signature. Deleting
`square` clears the three legacy columns, matching today. Any other variant clears
only its own column.

### 6.2 Why RPCs

Storage and Postgres cannot share a transaction, so the goal is not atomicity
across both. It is that **the two database writes never disagree**, and that
**storage is only ever touched in the safe order**.

`upsert_event_image_variant(p_event_id, p_variant, p_storage_path, p_file_name,
p_mime_type, p_file_size_bytes, p_uploaded_by) returns text`

- Locks the event row (`select ... for update`).
- Upserts the `event_images` row on the partial unique index.
- Updates the cache column, or the three legacy columns when the variant is
  `square`.
- Returns the **previous** storage path, or null.

`delete_event_image_variant(p_event_id, p_variant) returns text`

- Locks the event row.
- Clears the cache column first, then deletes the metadata row.
- Returns the storage path to remove, or null when the object is inherited.

Both are `security definer`, `search_path = public`. Per this project's Supabase
notes, new public functions are granted EXECUTE to `anon` and `authenticated` by
default, so both migrations must
`revoke execute ... from public, anon, authenticated` and grant to `service_role`
only. They are called with the admin client from a server action that has already
checked the permission.

### 6.3 Failure behaviour, stated exactly

| Step fails | Result |
|---|---|
| `requestEventImageUpload` | Nothing has happened. Tile unchanged, error shown |
| Browser upload to signed URL | A new object may exist, referenced by nothing. Tile unchanged, error shown. Swept by 9.4 |
| Upsert RPC | New object orphaned, old image still live and still referenced. Tile reverts, error shown |
| Old-object cleanup after a committed upsert | **Success.** The replacement is live and correct. The old object is orphaned and swept by 9.4. A cleanup failure must never be reported to the user as a failed upload |
| Delete RPC | Nothing removed. Tile unchanged, error shown |
| Object removal after a committed delete | **Success.** The reference is gone, the file is orphaned and swept by 9.4 |

The ordering guarantee this buys: **a reference is never left pointing at a deleted
file.** An orphaned file is always preferred to a broken live image.

### 6.4 Concurrent writes

`select ... for update` on the event row serialises two editors racing the same
variant. Last write wins, and the loser's object becomes an orphan rather than
corrupting the winner's row. Given the number of people who edit events here, that
is sufficient. Client-generated operation IDs and idempotency tokens are
deliberately not built.

---

## 7. AMS interface

`SquareImageUpload` is replaced by `EventImagePanel`, rendered in `EventDrawer.tsx`
where the current control sits (line 622). One tile per variant, in section 4
order.

### 7.1 Tile states

Every state is explicit, because a fetch failure rendering as an empty tile would
invite someone to re-upload over an image that already exists.

| State | Shown |
|---|---|
| Loading | Skeleton, not an empty tile |
| Load failed | Error text and Retry, never an empty tile |
| Empty | Dashed target, "Add {label}", target size as help text |
| Owned image | Thumbnail in the variant's own ratio, Download, Delete |
| Owned PDF | Document card with file name and size, Download, Delete |
| Inherited | Thumbnail, "From category: {name}", Download, **no Delete**, "Use a different image" |
| Uploading | Progress, tile disabled |
| Failed | Previous state restored, inline error, Retry |
| Queued | Local preview, "Uploads when you save" |

Thumbnails render in the variant's own aspect ratio, so a wrong shape is obvious
at a glance.

### 7.2 Auto-upload

1. Choosing a file uploads it immediately. There is no Upload button.
2. Type, size and ratio are validated first. A rejected file never starts an upload
   and never changes the tile.
3. On success the tile swaps and a toast names the variant.
4. On failure the tile reverts to exactly its previous state, with a retry.
5. Choosing a file on a filled tile replaces it. **Replacement is immediate and
   permanent: the previous file is deleted and cannot be recovered from AMS.** The
   tile says so, and the confirm dialog appears for replacement as well as delete.
   Version 1 claimed replacement was trivially undone. It is not.
6. The panel uploads at most **two** tiles concurrently, so five large files on
   venue wifi queue rather than compete.
7. Uploads are saved immediately and are **not** undone by pressing Cancel on the
   rest of the drawer. The panel states this.

### 7.3 Unsaved events, and the drawer lifecycle

Version 1 assumed an existing unsaved-changes guard and a drawer that stays open
after create. Verified: neither is true. `EventDrawer.tsx:421` calls `onSave()`
immediately after `createEvent`, and `EventsClient.tsx:366` closes the drawer.
There is no dirty state, no close guard and no `beforeunload` handler anywhere in
the drawer.

So this has to be built, not assumed:

- The drawer tracks dirty state, including queued files.
- Closing via Cancel, backdrop or Escape with unsaved changes asks to confirm.
  A `beforeunload` handler covers reload and tab close.
- On create, the drawer **stays open**, switches to edit mode with the new event
  id, and uploads the queue with per-tile progress. `onSave()` is called so the
  list refreshes behind it, but the drawer does not close.
- The drawer closes only on explicit user action. If every queued upload succeeded
  it offers to close; if any failed it stays open showing which, with retries.
- Queued files live in component state only. They do **not** survive a reload, and
  the `beforeunload` prompt is what protects against that.

### 7.4 Event categories

Categories are **in scope**, per the owner's decision on 2026-08-12.

They keep a single square image, not the five-variant panel. What they gain:

- **Auto-upload**, so the Upload button is gone in both places.
- **Their own delete action** with reference checking. Shipped ahead of the rest of
  this work in commit `3a71d915`, because the previous behaviour was a live bug.
  `deleteCategoryImage` clears `default_image_url`, then removes the storage object
  only once no event still inherits it.
- **Queued upload before first save**, matching 7.3, so a file attached to a new
  category is not silently discarded either.

`SquareImageUpload` keeps serving categories, upgraded to auto-upload. It is no
longer used by events, which move to `EventImagePanel`.

### 7.5 Accessibility

- A real labelled `<input type="file">` per tile, keyboard operable, visible focus.
  Drag and drop is a progressive enhancement only, never the sole route.
- Controls carry the variant in their accessible name: "Download landscape image",
  not "Download".
- Progress and errors are announced via `aria-live="polite"`, errors associated
  with their tile.
- Status is never conveyed by colour alone.
- Focus returns to the tile after a dialog closes.
- Verified at 200% zoom and with VoiceOver on iPad, which is what the team uses.
- 44px minimum touch targets.

---

## 8. Public API

All changes are additive, and none of them changes what any current consumer
renders.

### 8.1 Field matrix

| JSON field | List | Detail | Source | Null rule |
|---|---|---|---|---|
| `image` | yes | yes | see 8.3 | omitted when empty |
| `image_alt_text` | yes | yes | `events.image_alt_text` | null |
| `heroImageUrl` | **new** | existing | `hero_image_url` | null |
| `thumbnailImageUrl` | **new** | existing | `thumbnail_image_url` \|\| `hero_image_url` | null |
| `posterImageUrl` | **new** | existing | `poster_image_url` \|\| `hero_image_url` | null |
| `squareImageUrl` | new | new | `hero_image_url` | null |
| `landscapeImageUrl` | new | new | `landscape_image_url` | null |
| `socialImageUrl` | new | new | `social_image_url` | null |
| `storyImageUrl` | never | never | internal | absent |
| `printPosterUrl` | never | never | internal | absent |

The three legacy camelCase fields are added to the list route because it emits none
today, which is why the website's list pages fall back to `image[0]`. Their values
on the detail route are unchanged, minus the dead `|| event.image_url` fallback
(section 8.4).

`squareImageUrl` deliberately reads `hero_image_url`. The square is what that
column has always held.

### 8.2 Values are unchanged

For an event that has only a square, which is every event in production today,
every field the website already reads returns exactly what it returns now.

### 8.3 The schema.org `image` array, ordered square-first

Version 1 put landscape first. That was a live regression: `lib/event-image.ts`
takes the first non-empty `image` entry ahead of every named field, and
`RelatedEvents.tsx:82` reads `image[0]` straight into an `aspect-square` slot with
`object-cover`. Landscape-first would have cropped the sides off designed artwork
on live cards, before any website deploy.

The order is **square, landscape, social, then gallery**, de-duplicated, with nulls
and blank strings dropped.

`image[0]` therefore stays square for as long as a square exists, so no phase can
change what an existing consumer renders. Google gets its multiple ratios from the
array containing three entries, not from their order.

### 8.4 Dead code cleared

- `src/app/api/events/[id]/route.ts:300-302` falls back to `event.image_url`, a
  column that does not exist on the live `events` table. Removed.
- The `image_url` at `src/types/api.ts:56` is **not** the same thing. Discovery
  called it a second reference to the non-existent column; it is actually a menu
  dish field, and dishes really do have `image_url`. Left alone.

---

## 9. Testing

### 9.1 Actions and RPCs
- Each variant writes its own cache column and no other. Uploading `print_poster`
  provably leaves `poster_image_url` untouched.
- Uploading `square` still writes all three legacy columns.
- Ratio outside ±5% is refused, inside is accepted, PDF skips the check.
- PDF accepted for `print_poster`, refused for every web variant.
- Delete on an **inherited** image clears the event reference and removes no
  storage object. Asserted against a `categories/` path, the live bug in 5.4.
- Failure injected after each boundary in the 6.3 table produces the stated result.
  Specifically: a failed old-object cleanup reports **success**.
- Two concurrent upserts on one variant serialise, and the winner's row points at
  an object that still exists.

### 9.2 API contract
Response fixtures for four event shapes: legacy square-only, no image, partial
variants, all variants. Each asserts the full field matrix, that `image[0]` is the
square, that `image` de-duplicates, and that `storyImageUrl` and `printPosterUrl`
appear nowhere in the serialised body.

### 9.3 Panel and drawer
- Choosing a file uploads with no further interaction.
- A rejected file does not change the tile and does not call the action.
- A failed upload restores the previous tile state.
- A failed `getEventImages` renders the error state, never an empty tile.
- An inherited tile offers no Delete.
- Queued files upload after create, and the drawer stays open.
- The unsaved-changes guard fires on Cancel, backdrop, Escape and reload.

### 9.4 Migration and operations
- `npx supabase db push --dry-run`, then rehearsal on a production-like copy.
- Postflight assertions: bucket size limit and MIME list, the CHECK constraint's
  exact value list, the partial index, the four new columns, and dedupe backup
  row count matching rows removed.
- `src/types/database.generated.ts` regenerated, `src/types/database.ts` and the
  manual `Event` interface in `EventDrawer` updated. Build proves it.
- A scheduled weekly cron reports objects under `events/*/` referenced by no
  event and no metadata row. Report only in this release; it does not delete.
  This is what catches the orphans that 6.3 deliberately accepts.
- Structured logging on every upload and delete: event id, variant, byte size,
  duration, and the failure stage from the 6.3 table. No signed URLs logged.

### 9.5 Website
- Resolver tests per surface against old-shape and new-shape API responses.
- Social route output asserted at the declared dimensions and content type.

---

## 10. Phasing

**Phase 0 - the live delete bug. Shipped, commit `3a71d915`.** Deleting an event
image no longer removes a storage object the event does not own, both paths clear
the reference before touching storage, and categories have their own delete action
with reference checking. Independent of everything below and safe to deploy alone.

**Phase 1 - database and storage. Written, verified, NOT applied.** Migration 1
(5.2) plus the two RPCs, in
`supabase/migrations/20260812100000_event_image_variants.sql`. Purely additive,
every legacy value retained, safe to apply before any code deploy.

Verified by running it against a throwaway PostgreSQL 17 cluster seeded with the
shapes production actually contains, then asserting the dedupe keeps the row the
event points at, gallery rows survive, the unique index is genuinely partial, a
print poster never reaches `poster_image_url`, square still writes all three
legacy columns, an inherited category image reports nothing to delete, and unknown
variants and missing events are rejected. Confirmed re-runnable.

**It has not been pushed to production.** Applying it needs the owner's explicit
go-ahead.

**Phase 2 - AMS panel.** Shared variant config, the three upload actions,
`EventImagePanel`, signed direct upload, ownership handling, the drawer
unsaved-changes guard and the stay-open-after-create lifecycle. Staff can upload
and download all five variants. The website is untouched, because only `square`
writes the legacy columns and the API has not changed yet.

**Phase 3 - public API.** New fields on both routes, legacy camelCase fields added
to the list route, `image` array de-duplicated and square-first, dead `image_url`
references removed. Verified as no-visual-change: `image[0]` is still the square.

**Phase 4 - website.** `lib/api/events.ts` gains the new optional fields. Named
resolvers replace the single context-free helper.

Two corrections found while building this phase, both from checking `main`
rather than the working tree:

- **The social-image route does not exist in production.**
  `app/events/[id]/social-image/route.ts` and `lib/event-image.ts` live only on
  unmerged fix branches, not on `main`, which is what deploys. So there is no
  blur-composite workaround to retire and no 1200x1200 metadata mismatch to fix.
  `lib/event-image.ts` is created fresh by this phase. Whoever merges those fix
  branches will need to reconcile the two versions.
- **Phase 4 is based on `main`, not on the current working branch.** The website
  working tree sits on unmerged seasonal work. Basing there would have coupled
  this change to it and broken the independently-deployable rule.

Resolvers by surface:

| Resolver | Prefers | Consumers |
|---|---|---|
| `getEventSquareImage` | `squareImageUrl`, then legacy hero/thumbnail | `RelatedEvents`, `FeaturedEvent`, `EventListItem`, `EventCountdownBanner` |
| `getEventHeroImage` | `landscapeImageUrl`, then square | `events/[id]/page.tsx:407`, karaoke, quiz-night, music-bingo, cash-bingo, valentines-day |
| `getEventSocialImage` | `socialImageUrl`, then square | `events/[id]/social-image/route.ts` |

`lib/event-image.ts` stops preferring `posterImageUrl` first, which is only correct
today by accident: the moment `poster_image_url` meant what its name says, the
website would have served a print-resolution poster on every page and every social
crawl.

Link previews use `getEventSocialImage`. The social-image transform described in
version 2 is not part of this phase, because the route it referred to is not in
production (see above).

**Phase 5 - cleanup, after the rollback window.** Drop `hero`, `thumbnail` and
`poster` from the CHECK constraint, drop the dedupe backup table, and remove
`primary` from any remaining code path. Deliberately separated from the website
cutover so a code rollback stays safe throughout phases 2 to 4.

Phase 4 is the only phase needing a website deploy and must land after phase 3.

---

## 11. Acceptance criteria

1. An event can hold five distinct artwork files, one per variant.
2. Attaching a file uploads it with no second click, and no failure leaves a tile
   in a misleading state.
3. A file attached before the event is first saved uploads on save, and the drawer
   stays open until the user closes it.
4. A 20 MB print PDF uploads successfully in production.
5. Story and print URLs appear in no public API response.
6. `events.poster_image_url` never contains a print asset.
7. Deleting an event's image never removes a storage object the event does not own,
   proven against one of the 16 events on a category object.
8. No reference is ever left pointing at a deleted file, at any failure point in
   the 6.3 table.
9. For an event with all three web variants, `image` returns three different URLs
   and `image[0]` is the square.
10. After phase 3 and before phase 4, every website surface renders exactly the
    image it rendered before.
11. the-anchor.pub renders landscape on the event hero and the 1.91:1 asset on
    social previews.
12. Lint, typecheck, tests and build pass in both repositories.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Print poster served as a web image | Own column, never emitted, regression test |
| Landscape crops designed artwork on square cards | `image` array is square-first, criterion 10 |
| Deleting an event image breaks 7 other events | Ownership derived from storage path, delete refuses non-owned objects |
| Reference left pointing at a deleted file | Cache column cleared before storage removal, always |
| Metadata row and cache column disagree | Both written in one RPC under a row lock |
| Large upload rejected by the platform | Browser-direct signed upload, the file never enters a serverless function |
| Migration lands before or rolls back under a code deploy | Phase 1 retains every legacy value, cleanup deferred to phase 5 |
| Orphaned objects accumulate | Accepted by design as the safe failure mode, weekly reconciliation report |
| Wrong shape uploaded to a tile | ±5% ratio check, plus previews in the variant's own ratio |
| Queued files lost on reload | `beforeunload` guard, and the limitation is stated in the panel |

---

## Appendix: developer review resolutions

| ID | Verdict | Resolution |
|---|---|---|
| F01 | Accepted, verified | Confirmed against `RelatedEvents.tsx:82` and `lib/event-image.ts`. `image` array is now square-first (8.3), criterion 10 |
| F02 | Accepted, verified | 51 vs 36 confirmed. `events` columns are authoritative, `event_images` supplementary (5.3). No reconciliation migration needed |
| F03 | Accepted, and worse than reported | 16 events on category objects, one shared by 8. Live bug today. Ownership model in 5.4 |
| F04 | Accepted | Upsert RPC under a row lock, storage cleanup after commit, failure matrix in 6.3 |
| F05 | Accepted | Delete RPC clears the reference first, removes the object after commit |
| F06 | Accepted as a decision, not a build | Owner confirmed public is acceptable. Unlisted, not private, recorded in 5.5 |
| F07 | Accepted, verified | No guard exists. Drawer lifecycle and guard specified in 7.3 |
| F08 | Accepted, then brought back in scope | Owner asked for categories to be fixed too. Dedicated actions with reference checking, delete already shipped in `3a71d915` (7.4) |
| F09 | Accepted | Partial unique index on singleton variants, dedupe excludes gallery |
| F10 | Accepted | Phase 1 retains every currently valid value, cleanup moved to phase 5 |
| F11 | Accepted | Replacement now confirms and is stated as permanent (7.2 item 5) |
| F12 | Accepted in part | ±5% ratio check with a stated threat model (4.1). Direct-to-storage means the file never enters function memory, so decompression risk largely evaporates. PDF geometry not checked |
| F13 | Accepted | Field matrix in 8.1, fixtures in 9.2 |
| F14 | Accepted | Social route transforms to 1200x630 JPEG so declared metadata stays true |
| F15 | Accepted | Consumer-to-resolver matrix in phase 4 |
| F16 | Accepted | Per-variant alt text dropped from v1 entirely |
| F17 | Accepted in part | Download is a plain link to the public object with a `download` attribute. No signed URLs needed given 5.5. iPad Safari verification is in 7.5 |
| F18 | Accepted in part | Row lock serialises writers (6.4). Idempotency keys not built, single-venue tool |
| F19 | Accepted | Bucket assertion, postflight checks, dedupe backup table, type regeneration (9.4) |
| F20 | Accepted in part | Sections 9.1 to 9.5. Cross-repo E2E and CI Supabase integration not adopted, disproportionate here |
| F21 | Accepted in part | Five phases with cleanup last, explicit ordering. Feature flags and named deploy owners not adopted for a two-person team |
| F22 | Accepted, and it was the most valuable finding | Verified: nothing over 3.08 MB has ever been uploaded. Browser-direct signed upload (4.2) removes the platform limit from the design |
| F23 | Accepted | Accessibility contract in 7.5 |
| F24 | Accepted in part | Structured failure-stage logging and a weekly reconciliation report (9.4). No dashboards or alert thresholds |
| F25 | Accepted in part | Tile lifecycle states in 7.1. Event-deletion orphans are caught by the 9.4 report rather than a bespoke cascade |
| F26 | Not adopted | The privacy argument dissolves under 5.5, and 5.3 makes `events` the read source for all five tiles. Consistency beats removing two nullable columns |
| F27 | Accepted | Shared `EVENT_IMAGE_VARIANTS` config with a contract test against the DB constraint (5.6) |
