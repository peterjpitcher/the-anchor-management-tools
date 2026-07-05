# Event guest-list PDF + ticket-sales cutoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a printable confirmed-guest-list PDF (grouped by booking, blank note line per guest) and an optional per-event online ticket-sales cutoff enforced across AMS and the-anchor.pub.

**Architecture:** Guest-list PDF is AMS-only (PDFKit route + pure line-model helper). The cutoff is a nullable `events.booking_cutoff_at timestamptz`, enforced server-side in the AMS API booking-creation route (which is API-key-only, so staff bookings are unaffected — this is the "online only" boundary), exposed in the AMS events API, and read by the website to gate its booking UI. The website never touches Supabase directly — everything is via the AMS API.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (Postgres), PDFKit, Vitest (AMS) / Jest (website), date-fns-tz, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-05-event-guest-list-pdf-and-sales-cutoff-design.md`

**Repos:** AMS = `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools` (auto-deploys `main`). Website = `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub` (**manual** production deploy).

**Branching:** three changesets, each its own branch off `main`:
- `feat/event-guest-list-pdf` (PR A — AMS)
- `feat/event-sales-cutoff` (PR B — AMS)
- `feat/event-sales-cutoff-web` (PR C — website)

**Global rule for every "Modify" step:** open the target file first and integrate following the file's existing conventions (imports, component library `@/ds`, snake_case↔camelCase mapping, audit-log calls). The exact addition is specified per task; the surrounding wiring must match local patterns. Run the AMS pipeline (`npm run lint` → `npx tsc --noEmit` → `npm test` → `npm run build`) before each commit that touches shipped code.

---

## PR A — Guest-list PDF (AMS)

### Task A1: Pure guest-list line-model helper (TDD)

**Files:**
- Create: `src/lib/events/guest-list-model.ts`
- Test: `tests/lib/events/guest-list-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/events/guest-list-model.test.ts
import { describe, it, expect } from 'vitest'
import { buildGuestListModel, type GuestListBookingInput } from '@/lib/events/guest-list-model'

const booking = (o: Partial<GuestListBookingInput>): GuestListBookingInput => ({
  seats: 1, attendeeNames: null, customerFirstName: null, customerLastName: null,
  isReminderOnly: false, ...o,
})

describe('buildGuestListModel', () => {
  it('lists the booker first, then each further named guest', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 3, customerFirstName: 'Jane', customerLastName: 'Smith',
        attendeeNames: ['Jane Smith', 'Tom Smith', 'Priya Patel'] }),
    ])
    expect(group.bookerName).toBe('Jane Smith')
    expect(group.lines.map(l => l.name)).toEqual(['Jane Smith', 'Tom Smith', 'Priya Patel'])
    expect(group.lines[0].isBooker).toBe(true)
    expect(group.lines[1].isBooker).toBe(false)
  })

  it('fills blank lines up to the seat count when names are missing', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 3, customerFirstName: 'Alan', customerLastName: 'Jones', attendeeNames: null }),
    ])
    expect(group.lines).toHaveLength(3)
    expect(group.lines[0].name).toBe('Alan Jones')
    expect(group.lines[1].name).toBe('')
    expect(group.lines[2].name).toBe('')
  })

  it('always renders at least one line for a single-seat booking', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 1, customerFirstName: 'Sol', customerLastName: 'Reed' }),
    ])
    expect(group.lines).toHaveLength(1)
    expect(group.lines[0].name).toBe('Sol Reed')
  })

  it('excludes reminder-only and zero-seat bookings', () => {
    const groups = buildGuestListModel([
      booking({ seats: 0, customerFirstName: 'No', customerLastName: 'Seat' }),
      booking({ seats: 2, isReminderOnly: true, customerFirstName: 'Rem', customerLastName: 'Only' }),
      booking({ seats: 1, customerFirstName: 'Real', customerLastName: 'Guest' }),
    ])
    expect(groups.map(g => g.bookerName)).toEqual(['Real Guest'])
  })

  it('sorts groups by booker surname then first name', () => {
    const groups = buildGuestListModel([
      booking({ customerFirstName: 'Zoe', customerLastName: 'Adams' }),
      booking({ customerFirstName: 'Amy', customerLastName: 'Adams' }),
      booking({ customerFirstName: 'Bob', customerLastName: 'Zephyr' }),
    ])
    expect(groups.map(g => g.bookerName)).toEqual(['Amy Adams', 'Zoe Adams', 'Bob Zephyr'])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/lib/events/guest-list-model.test.ts`
Expected: FAIL — module `@/lib/events/guest-list-model` not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/events/guest-list-model.ts
export interface GuestListBookingInput {
  seats: number | null
  attendeeNames: string[] | null
  customerFirstName: string | null
  customerLastName: string | null
  isReminderOnly?: boolean | null
}

export interface GuestLine {
  /** Empty string means "no known name" → a blank line for staff to hand-write. */
  name: string
  isBooker: boolean
}

export interface GuestGroup {
  bookerName: string
  lines: GuestLine[]
}

function toGroup(b: GuestListBookingInput): GuestGroup {
  const bookerName = `${(b.customerFirstName ?? '').trim()} ${(b.customerLastName ?? '').trim()}`.trim()
  const names = (b.attendeeNames ?? []).map(n => (n ?? '').trim()).filter(n => n.length > 0)
  const seats = Math.max(b.seats ?? 1, 1)
  const lineCount = Math.max(seats, names.length, 1)
  const display = bookerName || names[0] || ''
  const lines: GuestLine[] = [{ name: display, isBooker: true }]
  for (let i = 1; i < lineCount; i++) {
    lines.push({ name: names[i] ?? '', isBooker: false })
  }
  return { bookerName: display, lines }
}

/** Confirmed bookings only should be passed in; reminder-only / zero-seat rows are dropped here defensively. */
export function buildGuestListModel(bookings: GuestListBookingInput[]): GuestGroup[] {
  return bookings
    .filter(b => !b.isReminderOnly && (b.seats ?? 0) >= 1)
    .map(b => ({
      group: toGroup(b),
      sortKey: `${(b.customerLastName ?? '').trim()} ${(b.customerFirstName ?? '').trim()}`.toLowerCase(),
    }))
    .sort((a, z) => a.sortKey.localeCompare(z.sortKey, 'en-GB', { sensitivity: 'base' }))
    .map(x => x.group)
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/lib/events/guest-list-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/events/guest-list-model.ts tests/lib/events/guest-list-model.test.ts
git commit -m "feat(events): guest-list line model (booker + per-guest lines)"
```

---

### Task A2: PDF generator (PDFKit)

**Files:**
- Create: `src/lib/events/guest-list-pdf.ts`
- Reference (read first for house style + Buffer handling): `src/lib/receipts/export/claim-summary-pdf.ts`

- [ ] **Step 1: Implement the generator**

Read the reference file first to match font/branding conventions, then create:

```ts
// src/lib/events/guest-list-pdf.ts
import PDFDocument from 'pdfkit'
import type { GuestGroup } from '@/lib/events/guest-list-model'

export interface GuestListEventHeader {
  name: string
  /** Pre-formatted London date/time strings from the caller (use dateUtils there). */
  dateLabel: string
  timeLabel: string
}

const PAGE_MARGIN = 40
const TICK_BOX = 10
const ROW_HEIGHT = 26
const NOTE_LINE_INSET = 220 // x where the blank ruled note area starts, from left margin

export async function generateEventGuestListPdf(
  header: GuestListEventHeader,
  groups: GuestGroup[],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const left = PAGE_MARGIN
  const right = doc.page.width - PAGE_MARGIN
  const bottom = doc.page.height - PAGE_MARGIN
  const totalGuests = groups.reduce((n, g) => n + g.lines.length, 0)

  const drawPageHeader = () => {
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827')
      .text(header.name, left, PAGE_MARGIN, { width: right - left })
    doc.font('Helvetica').fontSize(11).fillColor('#374151')
      .text(`${header.dateLabel} · ${header.timeLabel}`, left, doc.y + 2)
      .text(`Confirmed guests: ${totalGuests}`, left, doc.y + 2)
    doc.moveTo(left, doc.y + 6).lineTo(right, doc.y + 6).strokeColor('#9ca3af').stroke()
    doc.y += 14
  }

  drawPageHeader()

  if (groups.length === 0) {
    doc.font('Helvetica').fontSize(12).fillColor('#6b7280')
      .text('No confirmed guests yet.', left, doc.y + 8)
    doc.end()
    return done
  }

  const drawRow = (name: string, isBooker: boolean) => {
    if (doc.y + ROW_HEIGHT > bottom) { doc.addPage(); drawPageHeader() }
    const y = doc.y
    // tick box
    doc.rect(left, y + 4, TICK_BOX, TICK_BOX).lineWidth(0.75).strokeColor('#6b7280').stroke()
    // name (or blank)
    doc.font(isBooker ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor('#111827')
      .text(name || '', left + TICK_BOX + 8, y + 2, { width: NOTE_LINE_INSET - TICK_BOX - 16 })
    if (isBooker) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9ca3af')
        .text('(booked by)', left + TICK_BOX + 8, y + 15)
    }
    // blank ruled note area
    doc.moveTo(left + NOTE_LINE_INSET, y + ROW_HEIGHT - 6).lineTo(right, y + ROW_HEIGHT - 6)
      .lineWidth(0.5).strokeColor('#d1d5db').stroke()
    doc.y = y + ROW_HEIGHT
  }

  groups.forEach((group, idx) => {
    // keep the booker line with at least one following line
    const needed = Math.min(group.lines.length, 2) * ROW_HEIGHT
    if (doc.y + needed > bottom) { doc.addPage(); drawPageHeader() }
    group.lines.forEach(line => drawRow(line.name, line.isBooker))
    if (idx < groups.length - 1) {
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
      doc.y += 8
    }
  })

  // page numbers
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, bottom + 8, { width: right - left, align: 'right' })
  }

  doc.end()
  return done
}
```

Note: construct the doc with `bufferPages: true` if `bufferedPageRange`/`switchToPage` require it — set `new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })`. Apply that when implementing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/events/guest-list-pdf.ts
git commit -m "feat(events): PDFKit guest-list generator with blank note lines"
```

---

### Task A3: Guest-list API route

**Files:**
- Create: `src/app/api/events/[id]/guest-list/route.ts`
- Reference (mirror auth/permission + admin query EXACTLY): `src/app/api/events/[id]/booking-sheets/route.ts`

- [ ] **Step 1: Read the reference route** to copy its auth pattern (`createClient`, `checkUserPermission('events', ...)` — use the exact signature that file uses), the admin client import, and the bookings query shape.

- [ ] **Step 2: Implement the route**

```ts
// src/app/api/events/[id]/guest-list/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'          // match booking-sheets route's imports
import { createAdminClient } from '@/lib/supabase/admin'       // match booking-sheets route's imports
import { checkUserPermission } from '@/app/actions/rbac'       // match booking-sheets route's import
import { buildGuestListModel } from '@/lib/events/guest-list-model'
import { generateEventGuestListPdf } from '@/lib/events/guest-list-pdf'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const allowed = await checkUserPermission('events', 'view') // adjust arg shape to match booking-sheets
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: event } = await admin
    .from('events').select('id, name, date, time, slug').eq('id', id).single()
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const { data: bookings } = await admin
    .from('bookings')
    .select('id, seats, attendee_names, is_reminder_only, created_at, customer:customers(first_name, last_name)')
    .eq('event_id', id)
    .eq('status', 'confirmed')

  const groups = buildGuestListModel((bookings ?? []).map((b: any) => ({
    seats: b.seats,
    attendeeNames: b.attendee_names,
    customerFirstName: b.customer?.first_name ?? null,
    customerLastName: b.customer?.last_name ?? null,
    isReminderOnly: b.is_reminder_only,
  })))

  const pdf = await generateEventGuestListPdf(
    { name: event.name, dateLabel: formatDateInLondon(event.date), timeLabel: formatTime12Hour(event.time) },
    groups,
  )

  const filename = `guest-list-${event.slug || event.id}.pdf`
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
```

Confirm the exact names of `createClient`, admin client factory, `checkUserPermission`, `formatDateInLondon`, `formatTime12Hour` against the reference route and `src/lib/dateUtils.ts`; fix imports to match. If `formatTime12Hour` expects `HH:MM`, the `events.time` column is `text` — pass it straight through.

- [ ] **Step 3: Verify pipeline**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/events/[id]/guest-list/route.ts
git commit -m "feat(events): guest-list PDF download route"
```

---

### Task A4: "Download Guest List" button

**Files:**
- Modify: `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` (near the existing "Download Booking Sheets" button, ~line 1239)

- [ ] **Step 1: Add the button** beside the existing booking-sheets download, using the same `Button` component/variant from `@/ds`:

```tsx
<Button
  variant="secondary"
  onClick={() => { window.location.href = `/api/events/${event.id}/guest-list` }}
>
  Download Guest List
</Button>
```

Match the exact icon/variant/props of the sibling button so the two read as a pair.

- [ ] **Step 2: Verify with the preview server** — open an event with confirmed bookings, click the button, confirm a PDF downloads with the booker on line 1, guest lines below, blank note area on each. Also verify an event with zero confirmed bookings renders the "No confirmed guests yet." page.

- [ ] **Step 3: Pipeline + commit**

```bash
npm run lint && npx tsc --noEmit && npm run build
git add "src/app/(authenticated)/events/[id]/EventDetailClient.tsx"
git commit -m "feat(events): add Download Guest List button to event detail"
```

- [ ] **Step 4: Deploy verification** — push branch, open PR / merge per user preference. After AMS deploys `main`, confirm the Vercel deployment is Ready and the prod alias moved.

---

## PR B — Ticket-sales cutoff (AMS)

### Task B1: Migration — add `events.booking_cutoff_at`

**Files:**
- Create: `supabase/migrations/20260725000000_event_booking_cutoff_at.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Optional absolute instant after which ONLINE ticket sales close for an event.
ALTER TABLE public.events
  ADD COLUMN booking_cutoff_at timestamptz NULL;

COMMENT ON COLUMN public.events.booking_cutoff_at IS
  'Optional absolute instant after which ONLINE ticket sales close. NULL = no explicit cutoff (sales open until event start).';
```

- [ ] **Step 2: Apply to prod** via Supabase MCP `apply_migration` (project `tfcasgxopxegwrabvwat`), per the prod-migrate workflow — repo filename ≠ prod version. Additive nullable column; no view/function references it (verified). Then smoke-test:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'events' AND column_name = 'booking_cutoff_at';
```
Expected: one row, `timestamp with time zone`, `YES`.

- [ ] **Step 3: Regenerate types** (if the project regenerates `database.generated.ts`) or hand-add the column there to keep `tsc` honest. Commit:

```bash
git add supabase/migrations/20260725000000_event_booking_cutoff_at.sql
git commit -m "feat(events): add booking_cutoff_at column for online sales cutoff"
```

---

### Task B2: Type + service + Zod plumbing

**Files:**
- Modify: `src/types/database.ts` (Event interface — add `booking_cutoff_at?: string | null`)
- Modify: `src/types/database.generated.ts` (events Row/Insert/Update — add `booking_cutoff_at: string | null`) if not regenerated in B1
- Modify: `src/services/events.ts` (`CreateEventInput` + insert/update payloads in `createEvent`/`updateEvent`)
- Modify: the event Zod schema (search for `eventSchema` — likely in `src/services/events.ts` or `src/lib/validation`)

- [ ] **Step 1: Add the field to `CreateEventInput`**

```ts
// in CreateEventInput
booking_cutoff_at?: string | null
```

- [ ] **Step 2: Add to the Zod schema** — optional nullable ISO datetime; coerce empty string to null:

```ts
booking_cutoff_at: z.string().datetime({ offset: true }).nullish()
  .or(z.literal('').transform(() => null)),
```

Match the schema's existing style (it may use `.optional()`/`.nullable()` rather than `.nullish()`).

- [ ] **Step 3: Persist in `EventService.createEvent` and `updateEvent`** — include `booking_cutoff_at` in the insert/update object mapped to the DB row (it is already snake_case, so it maps 1:1).

- [ ] **Step 4: Pipeline + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/types/database.ts src/types/database.generated.ts src/services/events.ts
git commit -m "feat(events): thread booking_cutoff_at through types, schema and service"
```

---

### Task B3: Admin form field in EventDrawer

**Files:**
- Modify: `src/app/(authenticated)/events/_components/EventDrawer.tsx`
- Modify: `src/app/actions/events.ts` (`prepareEventDataFromFormData`)

- [ ] **Step 1: Add form state + control.** Seed from `event?.booking_cutoff_at` converted UTC→London for a `datetime-local` input:

```tsx
// state
const [bookingCutoffAt, setBookingCutoffAt] = useState<string>(
  event?.booking_cutoff_at ? utcIsoToLondonLocalInput(event.booking_cutoff_at) : ''
)
```

Add a helper (in `src/lib/dateUtils.ts` or a small local util) using `date-fns-tz`:

```ts
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
const LONDON = 'Europe/London'
// UTC ISO → value for <input type="datetime-local"> (London wall time, no seconds)
export function utcIsoToLondonLocalInput(iso: string): string {
  return formatInTimeZone(new Date(iso), LONDON, "yyyy-MM-dd'T'HH:mm")
}
// datetime-local (London wall time) → UTC ISO instant, or null when blank
export function londonLocalInputToUtcIso(local: string): string | null {
  if (!local) return null
  return fromZonedTime(local, LONDON).toISOString()
}
```

Control (place near the booking/pricing block, using `@/ds` inputs and the drawer's field wrapper):

```tsx
<label className="block text-sm font-medium text-gray-700">Ticket sales close</label>
<input
  type="datetime-local"
  value={bookingCutoffAt}
  onChange={e => setBookingCutoffAt(e.target.value)}
  className="…match sibling inputs…"
/>
<p className="text-xs text-gray-500">
  Online ticket sales stop at this time. Staff can still add bookings after it. Leave blank to keep sales open until the event starts.
</p>
```

- [ ] **Step 2: Append to FormData in `handleSave`**

```ts
formData.set('booking_cutoff_at', bookingCutoffAt) // London wall-time or ''
```

- [ ] **Step 3: Convert in `prepareEventDataFromFormData`** (server action) — read the raw value and store the UTC ISO / null:

```ts
booking_cutoff_at: londonLocalInputToUtcIso(String(formData.get('booking_cutoff_at') ?? '')),
```

Import `londonLocalInputToUtcIso` from wherever the helper was placed. Preserve the existing audit-log + revalidate calls unchanged.

- [ ] **Step 4: Verify in preview** — create an event with a cutoff, reopen the drawer, confirm the same London time round-trips; clear it, confirm it saves null.

- [ ] **Step 5: Pipeline + commit**

```bash
npm run lint && npx tsc --noEmit
git add "src/app/(authenticated)/events/_components/EventDrawer.tsx" src/app/actions/events.ts src/lib/dateUtils.ts
git commit -m "feat(events): add 'ticket sales close' field to the event drawer"
```

---

### Task B4: Expose `booking_cutoff_at` in the events API

**Files:**
- Modify: `src/app/api/events/route.ts` (list serialisation block)
- Modify: `src/app/api/events/[id]/route.ts` (detail serialisation block)

- [ ] **Step 1:** In each route, add `booking_cutoff_at` to the DB `select` if the query uses an explicit column list, and add to the response object next to `bookings_enabled`:

```ts
booking_cutoff_at: event.booking_cutoff_at ?? null,
```

Do **not** add any filtering that hides cutoff-passed events from the list.

- [ ] **Step 2: Pipeline + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/api/events/route.ts "src/app/api/events/[id]/route.ts"
git commit -m "feat(events): expose booking_cutoff_at in the events API"
```

---

### Task B5: Enforce cutoff on booking creation (TDD)

**Files:**
- Modify: `src/app/api/event-bookings/route.ts` (after the `bookings_enabled` check)
- Test: extend/create `tests/api/event-bookings-cutoff.test.ts` (match the repo's API-route test style; mock Supabase per convention)

- [ ] **Step 1: Write the failing test** asserting a past `booking_cutoff_at` yields a 409 `SALES_CLOSED`, and a null/future one does not. Model the mock setup on the nearest existing `event-bookings` route test. Core assertions:

```ts
// past cutoff → blocked
expect(res.status).toBe(409)
expect(body.error.code).toBe('SALES_CLOSED')
// future cutoff → not blocked by this rule (proceeds past the check)
```

- [ ] **Step 2: Run it — expect FAIL** (currently no such rejection).

Run: `npx vitest run tests/api/event-bookings-cutoff.test.ts`

- [ ] **Step 3: Add `booking_cutoff_at` to the event SELECT** in the route, then add the check immediately after the existing `bookings_enabled === false` guard:

```ts
if (eventRow.booking_cutoff_at && new Date(eventRow.booking_cutoff_at).getTime() < Date.now()) {
  return createErrorResponse('Online ticket sales for this event have closed.', 'SALES_CLOSED', 409)
}
```

Use the exact `createErrorResponse` signature from `src/lib/api/auth.ts` (confirm arg order: message, code, status).

- [ ] **Step 4: Run tests — expect PASS.** Then full suite: `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/event-bookings/route.ts tests/api/event-bookings-cutoff.test.ts
git commit -m "feat(events): reject online bookings after sales cutoff (SALES_CLOSED)"
```

---

### Task B6: Staff-facing cutoff display

**Files:**
- Modify: `src/app/(authenticated)/events/[id]/EventDetailClient.tsx`

- [ ] **Step 1:** Where event timing is shown, render (only when `event.booking_cutoff_at` is set) a line "Online sales close: {London date/time}", and once past, a subtle "Online sales closed" chip (use a `@/ds` Badge if available). Do **not** disable any staff booking controls.

- [ ] **Step 2: Pipeline + commit**

```bash
npm run lint && npx tsc --noEmit && npm run build
git add "src/app/(authenticated)/events/[id]/EventDetailClient.tsx"
git commit -m "feat(events): show online sales-close time on event detail"
```

- [ ] **Step 3: Deploy + prod verify** — merge PR B, confirm AMS deploy Ready + alias moved, confirm the migration is applied to prod (B1 Step 2), and smoke-test: events API returns `booking_cutoff_at`; a booking POST for a past-cutoff event returns `SALES_CLOSED`.

---

## PR C — Website cutoff (OJ-The-Anchor.pub)

> Repo: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`. Test runner: Jest. **Manual** production deploy. Sequence after PR B is live (needs the API field). Run the website's own lint/typecheck/test/build before each commit.

### Task C1: Event type + `isEventBookingClosed` helper (TDD)

**Files:**
- Modify: `lib/api/events.ts` (add `booking_cutoff_at?: string | null` to the `Event` interface)
- Modify: `lib/event-lifecycle.ts` (add helper)
- Test: `__tests__`/`tests/` location matching the repo convention, e.g. `tests/lib/event-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { isEventBookingClosed } from '@/lib/event-lifecycle' // match the repo's import alias

const ev = (cutoff: string | null) => ({ booking_cutoff_at: cutoff } as any)

describe('isEventBookingClosed', () => {
  it('is false when no cutoff is set', () => {
    expect(isEventBookingClosed(ev(null))).toBe(false)
  })
  it('is false when the cutoff is in the future', () => {
    expect(isEventBookingClosed(ev(new Date(Date.now() + 3600_000).toISOString()))).toBe(false)
  })
  it('is true when the cutoff is in the past', () => {
    expect(isEventBookingClosed(ev(new Date(Date.now() - 3600_000).toISOString()))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (helper undefined).

- [ ] **Step 3: Implement**

```ts
// lib/event-lifecycle.ts
import type { Event } from '@/lib/api/events'

export function isEventBookingClosed(event: Pick<Event, 'booking_cutoff_at'>): boolean {
  if (!event.booking_cutoff_at) return false
  return new Date(event.booking_cutoff_at).getTime() < Date.now()
}
```

And add to the `Event` interface in `lib/api/events.ts`:

```ts
booking_cutoff_at?: string | null
```

- [ ] **Step 4: Run tests — expect PASS.** Commit:

```bash
git add lib/api/events.ts lib/event-lifecycle.ts tests/lib/event-lifecycle.test.ts
git commit -m "feat(events): read booking_cutoff_at and add isEventBookingClosed"
```

---

### Task C2: Gate the event page + booking form

**Files:**
- Modify: `app/events/[id]/page.tsx`
- Modify: `components/features/EventBooking/ManagementEventBookingForm.tsx`

- [ ] **Step 1: Event page** — when `isEventBookingClosed(event)`, render a friendly panel instead of the booking form:

> "Online ticket sales for this event have closed. Please contact us or turn up on the night."

Keep the event otherwise visible (details, date, etc.).

- [ ] **Step 2: Booking form** — guard the render/submit: if closed, show the same closed message and do not POST. Follow the component's existing "blocked" rendering pattern (it already handles `BOOKINGS_DISABLED`/policy states).

- [ ] **Step 3: Verify** with the website dev server against a staging/prod event that has a past cutoff (or temporarily set one) — the form is replaced by the closed message.

- [ ] **Step 4: Commit**

```bash
git add "app/events/[id]/page.tsx" components/features/EventBooking/ManagementEventBookingForm.tsx
git commit -m "feat(events): hide booking form when online sales have closed"
```

---

### Task C3: Map `SALES_CLOSED` in the booking proxy (TDD)

**Files:**
- Modify: `app/api/event-bookings/route.ts`
- Test: extend the existing proxy route test (the repo already tests `BOOKINGS_DISABLED` mapping)

- [ ] **Step 1: Write the failing test** — when the upstream AMS returns 409 `SALES_CLOSED`, the proxy returns a 409 with `error.code === 'SALES_CLOSED'` and the closed message.

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — mirror the existing `BOOKINGS_DISABLED` branch:

```ts
const salesClosed = upstream.status === 409 && hasErrorCode(parsed, 'SALES_CLOSED')
if (salesClosed) {
  return NextResponse.json(
    { success: false, error: { code: 'SALES_CLOSED', message: 'Online ticket sales for this event have closed.' } },
    { status: 409, headers: { 'X-Idempotency-Key': idempotencyKey } },
  )
}
```

- [ ] **Step 4: Run tests — expect PASS.** Full pipeline (`npm run lint && npx tsc --noEmit && npm test && npm run build`).

- [ ] **Step 5: Commit**

```bash
git add app/api/event-bookings/route.ts tests/…/recruitment-or-event-booking-proxy.test.ts
git commit -m "feat(events): surface SALES_CLOSED from the booking proxy"
```

- [ ] **Step 6: Manual deploy** — website is a manual production deploy. Hand off to the user to deploy, or deploy per the project's documented process, then verify the closed state live.

---

## Final verification checklist

- [ ] AMS: `npm run lint` (0 warnings), `npx tsc --noEmit` (0), `npm test` (all pass), `npm run build` (exit 0).
- [ ] Website: its own lint/typecheck/test/build all green.
- [ ] Prod migration applied + smoke-tested (B1).
- [ ] Guest-list PDF: booker first, guest/blank lines, note area, empty-state page — confirmed in preview.
- [ ] Cutoff: past-cutoff booking rejected with `SALES_CLOSED` via the API; website hides the form; staff can still add a booking in AMS after cutoff.
- [ ] Deploys verified: AMS Ready + alias moved; website manual deploy flagged to user.
```
