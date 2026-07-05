# Event guest-list PDF + ticket-sales cutoff — design spec

- **Date:** 2026-07-05
- **Author:** Claude (brainstormed with Peter Pitcher)
- **Repos:** `OJ-AnchorManagementTools` (AMS, auto-deploys `main`) and `OJ-The-Anchor.pub` (website, **manual** production deploy)
- **Supabase project:** `the-anchor-management-tools` (`tfcasgxopxegwrabvwat`)
- **Status:** Approved design — ready for implementation planning

---

## 1. Goals

Two independent features for events that sell tickets:

1. **Guest-list PDF** — a printable roster of confirmed guests with a wide blank space on every
   line for staff to hand-write notes. Grouped by booking: the person who made the booking first,
   then a line for each further named guest.
2. **Ticket-sales cutoff** — an optional per-event date/time after which **online** ticket sales
   close. Must be enforced on the-anchor.pub, which sells tickets online through the AMS API.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Cutoff definition | **Absolute date & time** per event. Blank ⇒ no explicit cutoff (today's behaviour: sales stay open until the event starts). |
| D2 | Cutoff scope | **Online sales only.** Staff can still create bookings manually in AMS after the cutoff. |
| D3 | PDF layout | **Grouped by booking** — booker on line 1, then one line per further guest. |
| D4 | Guest-list inclusion | **Confirmed bookings only** (that hold ≥1 seat; reminder-only sign-ups excluded). |

**Assumptions** (my recommendations, taken as agreed because the user said "get the work done"):

- **A1** Each PDF line carries a small open tick box (□) as a subtle "arrived" marker, plus the
  name and a blank ruled area. (Trivial to drop if unwanted.)
- **A2** The late-booking rejection uses a **new, distinct** API error code `SALES_CLOSED` (HTTP
  409) rather than reusing `BOOKINGS_DISABLED`, whose message ("no booking needed, just turn up")
  is wrong for a paid event past its cutoff.
- **A3** All three changesets (two AMS, one website) are delivered in this run.

## 3. Architecture constraint (the load-bearing fact)

The-anchor.pub **never queries Supabase directly**. It reads events and creates/pays for bookings
entirely through the AMS API (`https://management.orangejelly.co.uk/api`, API-key gated via
`withApiAuth`). Consequences for the cutoff:

- The cutoff is **enforced server-side inside AMS** (the booking-creation route), which is API-key
  only — so staff server-action bookings are unaffected for free. This *is* the D2 "online only"
  boundary.
- The cutoff value is **exposed as a field in the AMS events API** so the website can read it and
  gate its own UI.
- PayPal capture is **not** separately gated: the booking already exists by payment time, so a
  booking created before the cutoff may complete payment a few minutes after. Deliberate + simpler.

---

## Feature 1 — Guest-list PDF (AMS only, self-contained)

### 1.1 Route & auth

- **New route:** `GET src/app/api/events/[id]/guest-list/route.ts`
- Runtime `nodejs`; cookie-based auth via `createClient()`; permission `checkUserPermission('events','view')`.
- Returns `application/pdf` with `Content-Disposition: attachment; filename="guest-list-<slug|id>.pdf"`
  and `Cache-Control: no-cache, no-store, must-revalidate`. Model the response wiring on
  `src/app/api/invoices/[id]/pdf/route.ts`.

### 1.2 Generator

- **New module:** `src/lib/events/guest-list-pdf.ts`, exporting
  `generateEventGuestListPdf(event, bookings): Promise<Buffer>`.
- Use **PDFKit** (not Puppeteer). Model the table/pagination helpers on
  `src/lib/receipts/export/claim-summary-pdf.ts` (`drawTable`, auto page-break, Helvetica).

### 1.3 Data

Query confirmed bookings for the event (admin client is fine; permission already checked):

```
from('bookings')
  .select('id, seats, attendee_names, event_seating_type, is_reminder_only,
           customer:customers(first_name, last_name)')
  .eq('event_id', eventId)
  .eq('status', 'confirmed')
  .order(...)  // sort applied in code by customer surname, then first name, then created_at
```

Exclude rows where `is_reminder_only` is true or `seats < 1` (not attendees).
Reuse the existing booking-sheets query shape at
`src/app/api/events/[id]/booking-sheets/route.ts` as the reference.

### 1.4 Per-booking line algorithm

For each booking (sorted by booker surname, then first name):

```
bookerName = trim(`${first_name} ${last_name}`)
names      = (attendee_names ?? []).map(trim).filter(Boolean)   // names[0] is the booker by convention
seats      = max(booking.seats ?? 1, 1)
lineCount  = max(seats, names.length, 1)

line[0]              = booker   → label = bookerName || names[0] || '(booker)'
line[1..lineCount-1] = guests   → label = names[i] ?? '' (blank when unknown)
```

Rationale: the website sets the booker as ticket 1, so `attendee_names[0]` is the booker and
`names[1..]` are the further guests — they align with the seat lines. When names weren't captured
(free events, single seat, older bookings), the extra lines render **blank** for hand-writing —
which is the whole point.

### 1.5 Layout

- **Page header:** event name (bold), date + time (via `dateUtils` / `formatDateInLondon`), and
  "Confirmed guests: N" (sum of rendered lines).
- **Booking group:** line 1 is the booker (optionally a faint "booked by" tag); lines below are the
  guests. Each line = `□` tick box + printed name (or blank) + a long light ruled area to the far
  right for handwritten notes. A thin rule separates one booking group from the next.
- Keep a group's header line with at least its first guest line across a page break (simple
  look-ahead, as in `claim-summary-pdf.ts`). Footer: "Page X of Y".
- Empty state: if there are no confirmed guests, render a single page with the header and
  "No confirmed guests yet."

Sample (illustrative):

```
The Anchor — Music Bingo                              Confirmed guests: 5
Fri 11 Jul 2026 · 7:00pm
──────────────────────────────────────────────────────────────────────
□  Jane Smith            (booked by)      ______________________________
□  Tom Smith                              ______________________________
□  Priya Patel                            ______________________________
──────────────────────────────────────────────────────────────────────
□  Alan Jones            (booked by)      ______________________________
□                                         ______________________________
──────────────────────────────────────────────────────────────────────
                                                           Page 1 of 1
```

### 1.6 Button

In `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` (the **live** component — confirmed
via `page.tsx` import), add a **"Download Guest List"** button beside the existing "Download
Booking Sheets" (~line 1239), triggering `window.location.href = \`/api/events/${event.id}/guest-list\``.

### 1.7 Tests

- Unit-test the line algorithm (a pure helper extracted from the generator) — booker + guests,
  blank fills, empty attendee_names, seats/name-count mismatch, reminder-only excluded.
- Do **not** snapshot binary PDF output; assert on the derived line model instead.

---

## Feature 2 — Ticket-sales cutoff

### 2.1 Database

New migration (repo file `supabase/migrations/20260725000000_event_booking_cutoff_at.sql`; apply to
prod via **Supabase MCP `apply_migration`**, per the prod-migrate workflow — repo timestamp ≠ prod
version):

```sql
ALTER TABLE public.events
  ADD COLUMN booking_cutoff_at timestamptz NULL;

COMMENT ON COLUMN public.events.booking_cutoff_at IS
  'Optional absolute instant after which ONLINE ticket sales close. NULL = no explicit cutoff.';
```

Additive column: no view breaks, no function/trigger references it (verified live). No cascade audit
needed. Semantics: **sales open while `booking_cutoff_at IS NULL OR now() < booking_cutoff_at`.**

Stored as `timestamptz` (an absolute instant). The form collects a **London wall-clock** date/time
and converts to UTC using `date-fns-tz` `fromZonedTime(value, 'Europe/London')`; display converts
back with `formatInTimeZone(..., 'Europe/London', ...)`. This mirrors how the events API already
assembles `startDate` into an ISO instant from the naive `date`+`time`.

### 2.2 AMS types & service

- `src/types/database.ts` — add `booking_cutoff_at?: string | null` to the `Event` interface.
- `src/services/events.ts` — add `booking_cutoff_at?: string | null` to `CreateEventInput`
  (`UpdateEventInput` is `Partial<CreateEventInput>`, so it inherits). Persist the column in
  `EventService.createEvent`/`updateEvent`'s insert/update payloads.
- `eventSchema` (Zod) — add an optional, nullable ISO-datetime field. Empty string ⇒ `null`.

### 2.3 AMS admin form

`src/app/(authenticated)/events/_components/EventDrawer.tsx`:

- Add a **"Ticket sales close"** control (a single `<input type="datetime-local">`, or the drawer's
  existing date + time input pair — follow local convention). Placed near the booking/pricing block.
- Seed state from `event.booking_cutoff_at` (UTC → London local for the input).
- In `handleSave`, append the value to `FormData` (London local → stored via the action/service).
- `src/app/actions/events.ts` `prepareEventDataFromFormData` — read the field, convert to a UTC ISO
  string or `null`, pass through to the service. Preserve the existing audit-log call.
- Helper text: "Online ticket sales stop at this time. Staff can still add bookings after it. Leave
  blank to keep sales open until the event starts."

### 2.4 AMS events API — expose the field

Add `booking_cutoff_at` (snake_case, sitting next to the existing `bookings_enabled`) to the
serialised response object in **both**:

- `src/app/api/events/route.ts` (list) — the mapping block (~lines 159–195).
- `src/app/api/events/[id]/route.ts` (detail) — the mapping block (~lines 217–310).

Value = the row's `booking_cutoff_at` (ISO string) or `null`. **Do not** filter cutoff-passed events
out of the list — the event is still upcoming; the website renders a "sales closed" state.

### 2.5 AMS booking-creation enforcement (online only)

In `src/app/api/event-bookings/route.ts`:

- Include `booking_cutoff_at` in the event `SELECT` (~line 220).
- Immediately after the existing `bookings_enabled === false` check (~line 232–238), add:

```ts
if (eventRow.booking_cutoff_at && new Date(eventRow.booking_cutoff_at).getTime() < Date.now()) {
  return createErrorResponse(
    'Online ticket sales for this event have closed.',
    'SALES_CLOSED',
    409,
  )
}
```

(Use the existing `createErrorResponse` helper from `src/lib/api/auth.ts`.) This route is API-key
gated (`read:events`), so only the website hits it — staff bookings via server actions bypass it.

PayPal `create-order` / `capture-order` external routes: **no change** (booking already exists).

### 2.6 AMS event-detail display (staff visibility)

In `EventDetailClient.tsx`, show the cutoff read-only where event timing is displayed: e.g.
"Online sales close: Fri 11 Jul 2026, 6:00pm" — and once passed, an "Online sales closed" chip.
Staff booking-creation UI stays fully enabled (D2). No new permission.

### 2.7 Website (`OJ-The-Anchor.pub`)

- **Type:** add `booking_cutoff_at?: string | null` to the `Event` interface in `lib/api/events.ts`.
- **Helper:** add `isEventBookingClosed(event): boolean` to `lib/event-lifecycle.ts` —
  `true` when `booking_cutoff_at` is set and in the past. (Keep the existing past-event logic intact;
  this is an additional gate.)
- **Event page** `app/events/[id]/page.tsx`: when `isEventBookingClosed`, render a friendly
  "Online sales have closed for this event" panel instead of the booking form. Event stays visible.
- **Booking form** `components/features/EventBooking/ManagementEventBookingForm.tsx`: guard render/
  submit — if closed, show the closed message and don't POST.
- **Proxy** `app/api/event-bookings/route.ts`: map an AMS `409 SALES_CLOSED` to a
  `{ success:false, error:{ code:'SALES_CLOSED', message:'Online ticket sales for this event have
  closed.' } }` response (mirror the existing `BOOKINGS_DISABLED` handling), so a race between page
  load and submit still fails gracefully with the right message.

### 2.8 Tests

- **AMS:** unit-test the cutoff predicate (open when null / future; closed when past). Add/extend a
  test around `event-bookings` route enforcement returning `SALES_CLOSED` when past cutoff, and
  succeeding when null/future (mock Supabase per project convention).
- **Website:** unit-test `isEventBookingClosed` (null, future, past). Extend the proxy route test for
  the `SALES_CLOSED` mapping.

---

## 4. Phasing / changesets

Scores L/XL overall, so it ships as three independently-deployable changesets:

1. **PR A — AMS: Guest-list PDF.** Self-contained; no dependency on the cutoff. Ship first.
2. **PR B — AMS: Sales cutoff.** Migration + form + types/service + API exposure + booking
   enforcement + staff display. Deploy `main` (auto), apply migration to prod via Supabase MCP.
3. **PR C — Website: Sales cutoff.** Read field + `isEventBookingClosed` + UI gates + proxy mapping.
   Sequenced **after B is live** (needs the API field). Website is a **manual** deploy.

Each is a separate branch/commit with conventional-commit messages.

## 5. Deploy & verification

- AMS auto-deploys `main`; after each AMS push, verify the Vercel deployment reaches **Ready** and
  the production alias moved to the new commit (a push ≠ a deploy).
- Website is a **manual** production deploy — PR C is not live until the user deploys it. Flag this
  explicitly at hand-off.
- After PR B: apply the migration to prod via `apply_migration`, then smoke-test the events API
  returns `booking_cutoff_at` and a late booking is rejected with `SALES_CLOSED`.

## 6. Rollback

- Guest-list PDF: remove the route + button (no data changes).
- Cutoff: the column is additive and nullable; leaving it `NULL` everywhere fully restores prior
  behaviour. Reverting code + leaving the column in place is a safe no-op.

## 7. Out of scope

- Relative ("X hours before start") cutoffs (D1 chose absolute).
- Blocking staff/manual AMS bookings after cutoff (D2 chose online-only).
- Waitlist behaviour changes at cutoff; automatic "sold out"/status flips.
- Any change to the existing one-page-per-booking "Booking Sheets" PDF (the new guest list is
  additive and separate).
- Per-attendee structured note capture (staff hand-write; no structured storage).

## 8. Key file targets (implementation reference)

**AMS — PR A**
- `src/app/api/events/[id]/guest-list/route.ts` (new)
- `src/lib/events/guest-list-pdf.ts` (new; extract a pure line-model helper for tests)
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` (add button)
- reference: `src/lib/receipts/export/claim-summary-pdf.ts`, `src/app/api/events/[id]/booking-sheets/route.ts`, `src/app/api/invoices/[id]/pdf/route.ts`

**AMS — PR B**
- `supabase/migrations/20260725000000_event_booking_cutoff_at.sql` (new)
- `src/types/database.ts`, `src/services/events.ts`, event Zod schema
- `src/app/(authenticated)/events/_components/EventDrawer.tsx`, `src/app/actions/events.ts`
- `src/app/api/events/route.ts`, `src/app/api/events/[id]/route.ts`
- `src/app/api/event-bookings/route.ts`, `src/lib/api/auth.ts` (reuse `createErrorResponse`)
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` (read-only display)

**Website — PR C**
- `lib/api/events.ts`, `lib/event-lifecycle.ts`
- `app/events/[id]/page.tsx`, `components/features/EventBooking/ManagementEventBookingForm.tsx`
- `app/api/event-bookings/route.ts`
