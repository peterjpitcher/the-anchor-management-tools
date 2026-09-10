# Spec: table talker media format for events

Drafted 2026-09-09, approved by the owner 2026-09-10 with the answers below.
Discovery ran against `origin/main` and the live production database
(`the-anchor-management-tools`), not a stale local branch.

## The answer in one line

Staff upload ONE slim table talker panel as a sixth media format, brand it with
the logo and QR editor that already exists, and then download an A4 landscape
PDF that lays the same branded panel out three times with cutting gaps. AMS does
the tiling, so branding is applied once and lands correctly on all three panels.

## Owner decisions, 2026-09-10

1. The panel is DL portrait (99 x 210 mm), three across an A4 landscape sheet.
2. Sheets are printed on the office printer, so a 5 mm unprintable margin is
   respected all round.
3. The table talker QR carries its own `table_talker` short link (`tt` prefix),
   so its scans are reported separately from the poster's.
4. The smallest printed table talker QR is 15 mm.
5. The print sheet cannot be downloaded until the panel has been through the
   branding step.
6. Added by the owner: the copyable image-tool prompt in the Event artwork
   section of the event drawer must ask for the new slim format too.

## Why one panel and not a ready made three up sheet

The branding editor treats an uploaded file as one canvas. A three up sheet
would get one logo and one QR across the whole page, so two of the three panels
would carry no code. One panel, branded, then tiled by the server, is the only
version where the existing branding pipeline is correct without changing its
core.

## Current state, verified

- Five variants, defined once in `src/lib/events/imageVariants.ts`: square,
  landscape, social, story, print_poster. Validation, the upload panel, the
  public API mapping, the prompt and the tests all read that one definition.
- Branding is live. Migration `20260906095746_event_image_branding` is applied
  and real events carry branding written on 7 and 8 September. Three later
  migrations lowered the QR floor to 10% of the width and fixed its comment.
- Placement is computed only in `src/lib/events/artwork/geometry.ts`, shared by
  the browser preview and the server compositor. It now carries the logo drop
  shadow, the BOOK NOW strip beside the QR, and snap to centre.
- The compositor always works from the stored ORIGINAL, never from a previous
  composite, and a branding failure is visible rather than silent.
- A PDF cannot be branded (`source_unsupported`), so the table talker is image
  only.
- 45 events already have a `tt` table talker short link. The QR on a branded
  table talker reuses that same code (get or create), so any table talker code
  already printed from the designer QR pack stays consistent.

## The format

| Thing | Value |
|---|---|
| Sheet | A4 landscape, 297 x 210 mm |
| Outer margin | 5 mm left and right, about 7 mm top and bottom |
| Gap between panels | 5 mm, two of them |
| Printed panel | 92.3 x 195.9 mm, three across |
| Artwork uploaded | DL portrait, 99 x 210 mm, 1169 x 2480 px |
| Print resolution | about 321 dpi from a full size upload |
| Lowest accepted | 150 dpi, which is 546 px wide |

Derivation: 297 minus two 5 mm margins minus two 5 mm gaps is 277, divided by
three is 92.33 mm. At the DL ratio (210 / 99) that panel is 195.87 mm tall,
inside the 200 mm printable height, so the row is centred with about 7 mm above
and below.

The artwork is fitted inside its slot without cropping or stretching. The upload
check allows a file to sit up to 5% off the DL shape, so an off-shape file is
centred in its slot and the crop marks follow the artwork's real edges, never
the slot's.

### Cutting

Corner crop marks at every panel corner: thin grey lines that start 1 mm clear
of the artwork and point outwards, so none ever lands on a panel. Cutting on the
marks means two cuts per gap and three identical panels. The marks in the gaps
always print; the ones in the outer margin can be clipped by some printers,
which is harmless because the outer cuts follow the artwork's own edge.

The PDF has to be printed at actual size (100%). The download button says so,
because most print dialogs default to fit to page, which shrinks every panel.

## How it works end to end

1. Event drawer, Event artwork: a sixth tile, "Table talker (print)".
2. Upload one DL panel image. The shape is checked as it is for every other
   size. PNG, JPG or WebP only.
3. Branding opens the existing full screen editor with the logo controls and,
   because this is a print size, the QR controls. The QR points at the event's
   `tt` short link and shows its printed size in millimetres as it is resized.
4. Save stamps the logo and QR onto the panel exactly as it does the poster.
5. "Print sheet" on the tile downloads the A4 landscape PDF with the branded
   panel three times. It stays disabled, with the reason shown, until the panel
   is branded.
6. The prompt box above the tiles now lists the slim table talker with its exact
   size, so an image tool produces a file the tile will accept.

## The prompt

`buildVariantPrompt()` already lists every size except the square, so adding
the variant adds its line. Three changes make that line right:

- The "at 300 dpi" suffix is keyed to the print sizes, not hardcoded to the
  poster, so the table talker line gets it too.
- The table talker line carries a short composition note: tall and slim, stack
  the elements vertically rather than shrinking the square layout to fit.
- The line reads: `Slim table talker for print: DL portrait (99 x 210 mm),
  1169 x 2480 px at 300 dpi`, followed by the note.

The panel heading also changes to say the story, A4 poster and table talker are
kept for download, not shown on the website.

## Changes, file by file

### New

- `src/lib/events/artwork/print-sheet.ts`: pure sheet geometry in millimetres,
  no imports. Slot rectangles, the fitted artwork rectangles and the crop mark
  segments. Also the printed panel width the QR minimum is measured against.
- `src/lib/events/artwork/table-talker-pdf.ts`: builds the PDF with `pdf-lib`,
  embedding the branded image once and drawing it three times.
- `src/app/api/events/[id]/artwork/table-talker-sheet/route.ts`: `GET`, Node
  runtime, `events:view`, admin client. Refuses unless the live file is a
  branded composite, refuses below 150 dpi, returns `application/pdf` named
  `{event}-table-talkers-a4.pdf`.
- Tests beside each, plus a migration parity test.
- `supabase/migrations/<timestamp>_event_image_table_talker.sql`.

### Changed

- `src/lib/events/imageVariants.ts`: the `table_talker` variant, a `print` block
  on every print size (printed width, QR minimum, QR channel, names), and the
  prompt changes above.
- `src/lib/events/artwork/geometry.ts`: QR validation takes the surface's
  minimum instead of assuming the poster's.
- `src/lib/events/artwork/composite.ts`: passes each variant's minimum.
- `src/lib/events/artwork/branding-service.ts`: `isPrintVariant()` reads the
  config; the QR link comes from the variant's channel; the table talker cache
  column joins the event select.
- `src/lib/events/artwork/poster-link.ts`: a general `resolvePrintLink(eventId,
  channel)` for `poster` or `table_talker`. `resolvePosterLink(eventId)` stays as
  the poster case, and every poster message and audit reason is unchanged.
- `ArtworkBrandingModal.tsx`: QR controls on any print size, with that size's
  minimum, channel and printed millimetres.
- `EventImagePanel.tsx`: the Print sheet button, the effective print resolution
  on the table talker tile, and the heading copy.
- `EventArtworkDownloadsCard.tsx`: the print sheet beside the plain download.
- `src/app/actions/event-image-variants.ts`, `src/types/database.ts`,
  `src/types/database.generated.ts`: the new cache column.
- `src/lib/events/__tests__/imageVariants.test.ts`: the variant list mirror.
  (The spec draft said two test files held this list. Only this one does; the
  co-located `imageVariants.test.ts` covers download names only.)

### Unchanged on purpose

- The composite route. Its Zod bounds are the database floor and ceiling; the
  stricter table talker minimum is a print rule enforced by the compositor,
  which answers 422 with a sentence the editor shows verbatim, the same way it
  reports a QR that is too close to the logo.
- The poster's density metadata. Only the poster gets it; the table talker's
  print path is the PDF, which fixes the physical size itself.
- The public API and the website. The table talker is `webServed: false`, the
  public routes map image fields explicitly, and nothing the website reads
  changes. No website deploy.

## Migration

`<timestamp>_event_image_table_talker.sql`, additive, in one transaction:

1. Widen `event_images_image_type_check` to include `table_talker`.
2. Add `events.table_talker_url text`, commented as never emitted by the API.
3. Recreate the partial unique index `event_images_singleton_variant_uniq`,
   whose `WHERE` names the singleton variants.
4. `CREATE OR REPLACE` `upsert_event_image_variant` and
   `delete_event_image_variant`: each has a hardcoded variant list and a
   hardcoded cache column chain.
5. Re-issue the grants: revoke from public, anon and authenticated, grant to
   `service_role` only, exactly as the original migration did.
6. An assertion block that fails the migration if any of the above is missing.

Order: apply the migration BEFORE the code deploys. The new code selects
`table_talker_url` on paths every tile uses, and PostgREST answers a missing
column with a 400, which would take the whole artwork panel down, not just the
new tile. After applying: `npx tsx scripts/security/assert-anon-surface.ts`.

## Tests

- Sheet geometry: page size, three identical slots, exact positions, all inside
  the printable area, off-shape artwork centred, crop marks clear of every panel.
- PDF: real `pdf-lib`, one embedded image drawn three times at the expected
  points, A4 landscape page, title carries the event name.
- Route: 401 and 403, 404, refuses an unbranded panel, refuses under 150 dpi,
  returns a PDF with the right headers.
- QR minimum: a code legal on the poster but under 15 mm on a table talker is
  refused with the table talker figure; the poster floor is unchanged.
- Print link: a table talker mints `tt`, a poster `po`, never crossed; every
  poster message is byte for byte what it was.
- Migration parity: the variant list in the newest CHECK, both RPC allow lists
  and the unique index all equal the config.
- Prompt: the slim line, its size and dpi, five lines in all.
- Both `npm test` and `npm run test:utc`.

## Change from the draft

The draft proposed a grey footer line in the bottom margin. Dropped: on an
office printer the margins outside the artwork are mostly in the unprintable
zone, so the line would be clipped or crowd the cut. The event name goes in the
PDF's title instead, where it shows in the print dialog and the file name.

## Risks

- Only a printed, cut and scanned sheet proves the 15 mm QR, the panel size and
  the holder fit. This is not done until one has been printed.
- A low resolution upload prints soft. The tile shows the effective dpi and the
  sheet refuses below 150.

## Out of scope

- Other print formats (bar strut, toilet poster, partner poster).
- Any change to how the A4 poster looks or validates.
- Image generation, which the owner removed from scope earlier.
