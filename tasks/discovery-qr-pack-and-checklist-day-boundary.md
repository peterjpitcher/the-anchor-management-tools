# Discovery: designer QR pack + checklist 5am day boundary

Date: 2026-08-15. Read-only discovery. No code changed.

---

## Change 1: batch QR download for the designer

### Headline

Roughly 70% of this already exists. Every event can already have a per-channel
QR short link, `poster` and `table_talker` are already two of the channels, and
there is already a per-event "Download QR" button. The events table already has
a markdown `brief` column written for exactly this purpose. What is missing is
the batch: pick a date range, get one zip.

### What already exists

| Thing | Where | Note |
|---|---|---|
| Channel catalogue | `src/lib/short-links/channels.ts:27-49` | 23 print channels incl. `poster` (`:28`) and `table_talker` (`:30`) |
| Event channel config | `src/lib/event-marketing-links.ts:121-126, 222-230` | adds `tier: always_on \| on_demand` and a short-code prefix per channel |
| Short link creation | `src/services/event-marketing.ts:124-138` | looks up by `metadata @> {event_id, channel}`, else inserts with retries |
| QR generation (server) | `src/services/event-marketing.ts:557, 635` | `QRCode.toDataURL(shortUrl, { margin: 1, scale: 8 })` |
| QR generation (client) | `src/app/(authenticated)/short-links/_components/qr-download.ts:1-19` | `errorCorrectionLevel: 'H', margin: 2, width: 640` |
| Per-event download UI | `src/components/features/events/EventMarketingLinksCard.tsx:110-118` | single PNG per channel, `${channel}-${shortCode}.png` |
| Destination URL | `src/lib/event-marketing-links.ts:79-97` | `https://www.the-anchor.pub/events/${slug}` plus UTMs |
| Short link base | `src/lib/short-links/base-url.ts:1-19` | `https://l.the-anchor.pub/${code}` |
| Backfill cron | `src/app/api/cron/backfill-marketing-links/route.ts` | only backfills `always_on` channels |

### The zip pattern to copy

`src/app/api/invoices/export/route.ts` is near-identical in shape (date range in,
zip out) and is the template:

- `:4-5` `export const runtime = 'nodejs'` and `maxDuration = 300`
- `:14-45` ISO date validation, `MAX_EXPORT_WINDOW_DAYS = 366`, filename sanitiser
- `:163` `new JSZip()`, `:212` `zip.file('invoices/${n}.pdf', buf)` (subfolders are just path prefixes)
- `:229` a README.txt at the root
- `:232` `zip.generateAsync({ type: 'arraybuffer' })`
- `:255-260` `new NextResponse(zipContent, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="..."' })`
- `:236-253` audit log wrapped in try/catch

Client side, the download handler to mirror is
`src/app/(authenticated)/events/_components/EventsClient.tsx:309-347`
(fetch, then `.blob()`, objectURL, anchor click, revoke).

The alternative streaming pattern (`archiver` plus PassThrough) is in
`src/app/api/receipts/export/route.ts:91-116` if the zip gets large.

### Where to hang the UI

`src/app/(authenticated)/events/_components/EventFilterPanel.tsx` already has
`dateFrom` / `dateTo` state (`:7-12`), two date pickers (`:75-90`), an
`onExportDateRange` prop (`:19-20`) and an "Export CSV" button (`:92-103`). A
sibling "Download QR pack" button is a drop-in. The live events page is
`src/app/(authenticated)/events/page.tsx` importing `./_components/EventsClient`
(line 12). There is no dead duplicate here.

### The brief

`events.brief` is already markdown, CRLF line endings, 2.4k to 5.4k characters,
written in house voice with venue address, times and price. All 12 upcoming
events have it populated. This is the .md content; it just needs a header block
of structured fields appended or prepended.

Fields worth putting in the .md: `name`, `date`, `time`, `end_time`,
`doors_time`, `last_entry_time`, category name, `performer_name`,
`performer_type`, `price` / `is_free`, `capacity`, `short_description`,
`brief`, `image_alt_text`, `accessibility_notes`, the public event URL, and the
short link plus destination URL for each QR included.

### Live data findings

- 16 events in the next 120 days. All have `brief`, `short_description` and `performer_name`.
- **Only 7 of 16 have any print QR links.** The other 9 have just the 4 to 5
  `always_on` digital links. `poster` and `table_talker` are `on_demand`
  (`src/lib/event-marketing-links.ts:121-126`), so they only exist where a human
  clicked Generate.
- Image coverage is thin: 2 of 12 have `hero_image_url`, 1 of 12 has `print_poster_url`.
- Older links carry legacy labels ("Poster QR", "Table Talker QR") vs newer
  ("Poster", "Table Talker"). Match on `metadata->>'channel'`, never on label.

### Gotchas

1. **Missing links must be generated during the export**, or 9 of 16 folders come
   out empty. `generateLinks` / `generateSingleMarketingLink` requires
   `events:manage` (`src/app/actions/event-marketing-links.ts:18`), while the CSV
   export is gated on `events:export OR events:manage`
   (`src/app/api/events/export/route.ts:136-141`).
2. **Vercel timeout.** Default 15s. Set `maxDuration`. N events x M channels x
   (QR render plus possible DB insert) adds up fast.
3. **Print resolution.** Existing QRs are `scale: 8` (about 296px) or `width: 640`.
   Too small for print. Use `width: 2048` and/or emit SVG via
   `QRCode.toString(url, { type: 'svg' })`, which is the vector format a designer
   actually wants.
4. Data URL to Buffer: `Buffer.from(dataUrl.split(',')[1], 'base64')`.
5. Sanitise folder names; reuse `sanitizeFilename` at
   `src/app/api/events/export/route.ts:44-52`. No `/` in folder names.
6. Normalise the CRLF in `brief` when writing the .md.
7. Cap the date window and return 404 on an empty range, as invoices does (`:158-160`).

---

## Change 2: checklists should roll at 5am, not midnight

### Headline

This is a bug, not a missing feature. The checklists engine already runs on a
configurable business day, currently set to 6am, and closing tasks already stay
completable until 5am. One helper on the staff screen ignores the setting and
rolls at London midnight, so the tasks vanish from view at 00:00 while the
engine still considers them live and due.

### Proof from production

`checklist_settings.business_day_start_hour = 6` (live value).

`src/lib/checklists/window.ts:44-53` already documents the exact problem the
owner is describing, and sets `CLOSING_GRACE_END_HOUR = 5`.

Live instance data confirms closing tasks are given until 05:00 the next
morning, e.g. business_date 2026-08-15, slot `close`, `grace_until` = 2026-08-16
05:00 London.

Over the last 27 nights with closing tasks:

| Metric | Count |
|---|---|
| Nights where every closing task was marked missed | 4 |
| Nights where at least one closing task was missed | 7 |
| Nights with any completion recorded after midnight | 1 |
| Individual closing tasks completed after midnight | 5 |

The near-total absence of post-midnight completions, despite a grace window that
runs to 05:00, is the signature of the tasks being invisible rather than being
ignored. The 5 that did land after midnight are consistent with a screen that
was loaded before midnight and left open.

### The defect

`src/app/actions/checklists.ts:18-20`

```ts
function todayBusinessDate(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}
```

Plain London calendar date. It never reads `business_day_start_hour`. Call sites:
`:68` (`getTodayChecklist`, the staff screen) and `:398` (the mid-shift prompt).

### Everywhere the boundary is decided

Honours the setting (correct today):

| file:line | role |
|---|---|
| `src/lib/checklists/window.ts:34-40` | `businessDayBounds(date, startHour)` |
| `src/lib/checklists/window.ts:73,83` | `expandInstants` rejects a close past the day end |
| `src/lib/checklists/generation.ts:137,224` | which instances exist, and the `grace_until` clamp |
| `src/lib/checklists/jobs/generate.ts:65-68` | `businessDateOfInstant`, i.e. which day a completion counts for |
| `src/lib/checklists/jobs/sweep.ts:36-37` | current business date; locks anything older |

Ignores it and rolls at midnight (to fix):

| file:line | impact |
|---|---|
| `src/app/actions/checklists.ts:18-20` | the primary defect |
| `src/app/actions/checklists.ts:68` | staff screen task set |
| `src/app/actions/checklists.ts:398` | mid-shift prompt |
| `src/app/actions/checklists-admin.ts:817` | `regenerateToday()` targets the wrong day between 00:00 and the boundary |
| `src/app/(authenticated)/checklists/manage/review/page.tsx:11` | hardcodes `- 6 * 60 * 60 * 1000` instead of reading the setting |
| `src/actions/get-outstanding-counts.ts:63,138` | nav badge count |
| `src/app/actions/checklists-insights.ts:76` | default `to` date |
| `src/app/actions/checklists-spotcheck.ts:89,205` | default date for the spot-check draw |

### Database

No server-side day decision exists. The only checklist function,
`draw_daily_spot_checks(p_business_date date, p_count int)`
(`supabase/migrations/20260731000300_checklists_spot_check_draw.sql:7`), takes the
date as a parameter; `now()` is used only for `drawn_at`. No `CURRENT_DATE`, no
`date_trunc`, no triggers, no views compute a checklist day. An application-layer
fix is sufficient.

Unique constraints are unaffected: `UNIQUE(template_id, business_date, slot)`
(`20260731000000_checklists_foundation.sql:139`) keys on the string the app
supplies. Moving the boundary changes which string is written, not the key shape.

### Cron

`/api/cron/checklists-generate` at `0 4 * * *` UTC, re-gated in code to London
hours 04:00 to 06:00 (`route.ts:19-28`), then sets
`businessDate = formatInTimeZone(nowUtc, 'Europe/London', 'yyyy-MM-dd')`
(`route.ts:32`). Under a 5am boundary the gate lower bound and the comment at
`:30-31` both need revisiting. The other three checklist crons
(weekly-summary, retention, and the unrelated event-checklist-reminders) are
boundary-insensitive.

### Is 5am safe?

Yes, on current data. `expandInstants` rejects a trading window that closes after
the business-day end. Standard hours are 22:00 close every day
(`business_hours`), and no `special_hours` row in the last 60 days closes between
04:00 and 12:00. Nothing would become `invalid_hours`.

Moving to 5 also removes an existing dead zone: today, closing tasks lock at
05:00 but the day does not flip until 06:00, leaving an hour where yesterday's
work is locked and today's is not yet shown. Setting the boundary to 5 aligns it
with `CLOSING_GRACE_END_HOUR`.

### Weekday claim: refuted

`src/lib/checklists/cadence.ts:95` does use `getUTCDay()`, but `target` is
`toUtcDate(iso)`, a `YYYY-MM-DD` business-date string anchored at UTC midnight,
never a wall-clock now. Reading the weekday of a UTC-midnight-anchored calendar
date is deterministic and correct under BST. Same pattern with an explicit
comment at `src/lib/checklists/weekly-review.ts:3-4,49` and in
`src/lib/dateUtils.ts:141`. Not a bug, and it follows the boundary fix
automatically.

### Blast radius

1. Data: `UPDATE checklist_settings SET business_day_start_hour = 5`. Immediately
   moves generation, grace clamps, completion attribution and sweep locking.
2. Code: the 8 rows in the "ignores it" table above, plus the fallback constant
   `DEFAULT_BUSINESS_DAY_START_HOUR = 6` at `src/lib/checklists/window.ts:12`.
3. Cron: gate lower bound and comment in `checklists-generate/route.ts`.
4. Tests: `src/lib/checklists/__tests__/window.test.ts:39`,
   `__tests__/generation.test.ts:16`, `__tests__/weekly-review.test.ts`,
   `_components/ChecklistScreen.test.tsx`.
5. Transition day: instances already generated under 6 keep their `business_date`
   and their computed windows until the next generation run. Best applied in the
   morning, well before the evening close.
6. UI copy: the staff screen shows no date at all
   (`src/app/(authenticated)/checklists/page.tsx:23-24`). Once tasks persist past
   midnight, a "Thursday 14 August" style subtitle stops it being confusing at 01:00.
