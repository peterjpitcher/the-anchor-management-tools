# Table-booking print sheets — implementation spec

**Revision: v5** (supersedes v1–v4). **This spec supersedes `tasks/todo.md`** for this feature.

Every identifier below is verified against the live database (project `tfcasgxopxegwrabvwat`) or the real source. v4 was discarded: it invented a table name, two FK constraint names, a `tables.is_outside_seating` column, a `formatDateTimeInLondon` export, and an undefined `printableBookingCount`. **Do not reintroduce anything from v4.**

## 1. Goal

A **Download PDF** button on `/table-bookings/boh` that downloads one PDF containing **one branded A4 page per table booking** for a single service day, styled like the existing events "Booking Sheets".

## 2. Decisions (all DECIDED — do not reopen)

| # | Decision | Outcome |
|---|---|---|
| D-1 | Location | **BOH toolbar** (`BohBookingsClient.tsx`). No FOH button is built. FOH is untouched. |
| D-2 | Sheet content | Customer name, booking time, party size, table(s), status, booking reference, generated-at, footer. |
| D-3 | Notes | **Not printed.** `special_requirements` is not selected, not rendered, not tested. |
| D-4 | Scope | **Table bookings only.** Private-booking blocks and event/communal occupants excluded (they are not `table_bookings` rows). |
| D-5 | Which day | **Day view only.** Button enabled only when `view === 'day'`; prints `focusDate`. Disabled in week/month with an explanatory `title`. |
| D-6 | Permission | The BOH gate: `requireBohTableBookingPermission('view')`. Gates the **route**, not just the button. |
| D-7 | Kiosk | **No code.** The helper already 403s FOH-only users; the kiosk account is `foh_staff`-only. Requirement satisfied by the existing gate. |
| D-8 | Long values | **Never silently clipped.** Wrap; no `-webkit-line-clamp`/`overflow:hidden` on any required fact. |
| D-9 | Fonts | Remote Google Fonts, matching the events template. |
| D-10 | Row cap | `MAX_PRINTABLE_ROWS = 200` → **422**. |
| D-11 | Rate limiting | **None exists** → **no 429 branch**. |

**Open questions: none.**

## 3. Verified ground truth (authoritative — do not re-derive)

**Database (live):**
- Assignment table is **`booking_table_assignments`** — columns `id, table_booking_id, table_id, start_datetime, end_datetime, created_at`.
- FK constraint names: **`booking_table_assignments_table_booking_id_fkey`** (→ `table_bookings.id`), **`booking_table_assignments_table_id_fkey`** (→ `tables.id`), **`table_bookings_customer_id_fkey`** (→ `customers.id`).
- **`is_outside_seating` is on `table_bookings`** (boolean NOT NULL) — **not** on `tables`. Outside-ness is a property of the **booking**.
- `tables` columns: `id, table_number, capacity, is_active, notes, created_at, updated_at, name, is_bookable, area, area_id`. **Every live row has a populated prose `name`** (table_number 6 = "High 4", 10 = "Dining Room 6a") — so `name || table_number` is never a digit; order by `table_number`, not by label. **`is_bookable` is NOT NULL** (so `!== false` ≡ `=== true`; the NULL-parity nuance from earlier revisions is moot — keep `!== false` as harmless defence).
- `table_bookings`: `booking_reference`, `booking_date`, `booking_time`, `party_size`, `status`, `is_outside_seating`, `deposit_waived` are **NOT NULL**. `payment_status`, `no_show_at`, `left_at`, `seated_at`, `paypal_deposit_capture_id`, `deposit_amount`, `deposit_amount_locked` are nullable.
- `deposit_amount_locked` **is a real column** but is **missing from `src/types/database.generated.ts`** — that file is **stale**. Do not infer column existence from it; TypeScript may need a cast.

**Code:**
- Auth: `import { getLondonDateIso, requireBohTableBookingPermission } from '@/lib/foh/api-auth'`. Signature `requireBohTableBookingPermission(action: 'view'|'edit'|'manage'): Promise<PermissionCheckResult>`. Success → `{ ok: true, userId: string, supabase }` where **`supabase` is the service-role admin client**. Failure → `{ ok: false, response }` — **return `auth.response`**, it does not throw. It checks module `table_bookings` + action, **and** 403s FOH-only users (`isFohOnlyUser`).
- Status: `import { getTableBookingVisualState, getTableBookingStatusLabel } from '@/lib/table-bookings/ui'` (**not** under `src/ds/`). `getTableBookingStatusLabel` takes the **visual state**, not the raw status. `confirmed` → **"Booked"**. Visual-state precedence: `private_block → no_show → cancelled → left → seated → pending_payment → status`.
- Dates: `import { formatDateDdMmmmYyyy, formatDateFull, formatTime12Hour, toLondonDateTimeLocalValue } from '@/lib/dateUtils'`. **`formatDateTimeInLondon` does not exist.**
- Audit: `import { logAuditEvent } from '@/app/actions/audit'` (**`src/lib/audit.ts` does not exist**). It **swallows all its own errors** — it can never throw or report failure, so a `try/catch` around it is pointless.
- Download helpers: `import { downloadBlob, filenameFromContentDisposition } from '@/lib/download-file'` — **client-only** (touch `window`/`document`); never call in a route.
- PDF: `import { generatePDFFromHTML } from '@/lib/pdf-generator'`.
- Nested-embed precedent **exists and works**: `src/app/(authenticated)/table-bookings/[id]/page.tsx:45-50` embeds `booking_table_assignments` → `tables` off `table_bookings` with a pinned FK.
- ESLint: `no-console` is an **error**; only `console.warn`/`console.error` are permitted. Use the project logger for non-error output.

## 4. Route — `src/app/api/boh/table-bookings/booking-sheets/route.ts`

Path follows the existing collection-level precedent `boh/table-bookings/preorder-sheet/`. Serves `GET /api/boh/table-bookings/booking-sheets?date=YYYY-MM-DD`.

```ts
export const runtime = 'nodejs'   // Puppeteer + node:fs
export const maxDuration = 300    // matches the in-prod events booking-sheets route
```

### 4.1 Auth (before any read)
```ts
const auth = await requireBohTableBookingPermission('view')
if (!auth.ok) return auth.response      // 401 / 403 (incl. FOH-only users → kiosk blocked)
const { supabase, userId } = auth        // supabase = service-role admin client
```

### 4.2 Date
- **Absent** → `getLondonDateIso()`.
- **Present but invalid** (bad shape *or* bad calendar date, e.g. `2026-13-45`, `2026-02-31`) → **400**. Never silently coerce.
```ts
function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
```

### 4.3 Query — one nested select, pinned FKs
```ts
const { data: rows, error } = await supabase
  .from('table_bookings')
  .select(`
    id, booking_reference, booking_date, booking_time, party_size,
    status, payment_status, no_show_at, left_at, seated_at,
    deposit_waived, paypal_deposit_capture_id, deposit_amount, deposit_amount_locked,
    is_outside_seating,
    customer:customers!table_bookings_customer_id_fkey(first_name, last_name),
    table_booking_tables:booking_table_assignments!booking_table_assignments_table_booking_id_fkey(
      table:tables!booking_table_assignments_table_id_fkey(id, name, table_number, is_bookable)
    )
  `)
  .eq('booking_date', date)
  .not('status', 'in', '("cancelled","no_show")')
  .order('booking_time', { ascending: true })
if (error) throw error
```

**The status filter must be copied verbatim** from the proven production line (`src/app/api/foh/schedule/route.ts:213`) — the **quoted** in-list. A malformed in-list **fails open** (PostgREST returns everything) rather than erroring, which would silently print cancelled bookings with no runtime signal.

The 14 booking columns are exactly what is needed: 10 for `getTableBookingVisualState`/`hasPendingRequiredDepositSignal` (`status, payment_status, no_show_at, left_at, seated_at, party_size, deposit_waived, paypal_deposit_capture_id, deposit_amount, deposit_amount_locked`) plus `id, booking_reference, booking_date, is_outside_seating`.

> **Do not select `special_requirements`** (D-3) or `is_private_block` (**not a column**). The `status === 'private_block'` branch in `ui.ts:88` never matches a real DB row — harmless here, since private bookings are out of scope and are not `table_bookings` rows.

### 4.4 Guards (in this order)
1. `if (!rows || rows.length === 0)` → **404**, body `No printable bookings found for the selected day` (**must not say "active"**).
2. `if (rows.length > MAX_PRINTABLE_ROWS /* 200 */)` → **422** with a clear message. No PDF generated.

### 4.5 Mapping
| Sheet field | Source |
|---|---|
| `bookingRef` | `row.booking_reference` |
| `customerName` | `[first_name, last_name].filter(Boolean).join(' ').trim()` → else `row.booking_reference` → else `'Walk-in guest'` |
| `bookingDate` | `formatDateFull(date)` |
| `startTime` | `formatTime12Hour(row.booking_time)` (column is NOT NULL; "TBC" is defensive only) |
| `partySize` | `String(row.party_size)` |
| `tableLabel` | `tableField(row)` — below |
| `status` | `getTableBookingStatusLabel(getTableBookingVisualState(row))` — **never** the raw DB status |
| `generatedAt` | see 4.6 |

**`tableField` — outside precedence FIRST** (outside-ness is a booking property; an outside booking with a stray assignment must still read "Outside"):
```ts
function tableField(row): string {
  if (row.is_outside_seating) return 'Outside'
  // De-dup by table id; keep name AND table_number — label is the name, ORDER is by number.
  const seen = new Map<string, {label: string; tableNumber: string; name: string}>()
  for (const a of row.table_booking_tables ?? []) {
    const t = a?.table
    if (!t || t.is_bookable === false) continue        // is_bookable is NOT NULL
    const label = t.name || t.table_number
    if (!label) continue
    seen.set(t.id, { label, tableNumber: t.table_number || '', name: t.name || '' })
  }
  const labels = [...seen.values()].sort((a, b) => {
    if (a.tableNumber && b.tableNumber) {
      const byNumber = tableCollator.compare(a.tableNumber, b.tableNumber)
      if (byNumber !== 0) return byNumber
    }
    return tableCollator.compare(a.name, b.name)
  }).map(t => t.label)
  return labels.length ? labels.join(', ') : 'Unassigned'
}
```
> **Sort by `table_number`, not by the label** (corrected after adversarial review). **Every row in the live `tables` table has a prose `name`** (table_number 6 is "High 4", 10 is "Dining Room 6a"), so `name || table_number` is *never* a digit and a collator applied to the label would sort alphabetically. The BOH screen orders by `table_number` numerically then name (`src/app/api/boh/table-bookings/route.ts:444-453`) — the sheet **must** match, or a booking on tables 6+10 prints "Dining Room 6a, High 4" while the screen reads "High 4, Dining Room 6a". `tableCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })` — numeric so "6" precedes "10".

**Page order:** `booking_time` asc, then `booking_reference`, then `id` (deterministic for equal times).

### 4.6 Generated-at (London)
```ts
const now = new Date()
const generatedAt =
  `${formatDateDdMmmmYyyy(now)} at ${formatTime12Hour(toLondonDateTimeLocalValue(now).slice(11))}`
// → "16 July 2026 at 7:32pm"  (DST-correct; hour times render "7pm", day is 2-digit)
```

### 4.7 PDF + response
```ts
const logoDataUrl = await imageDataUrl('booking-confirmation/anchor-logo-black.png', 'image/png')
const html = generateTableBookingSheetsHTML(sheets, { logoDataUrl })
const pdfBuffer = await generatePDFFromHTML(html, {
  format: 'A4', printBackground: true, preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
  displayHeaderFooter: false,
})
const pdfContent = pdfBuffer.buffer.slice(
  pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength
) as ArrayBuffer

return new NextResponse(pdfContent, {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="table-bookings-${date}.pdf"`,
    'Cache-Control': 'no-store, private, must-revalidate',
  },
})
```
`date` is validated ISO, so the filename is inherently filesystem-safe. **`Cache-Control: no-store` governs HTTP caching only — the downloaded attachment is still written to disk** (an operational matter, not a technical control).

### 4.8 Audit + observability
```ts
await logAuditEvent({
  user_id: userId,
  operation_type: 'export',
  resource_type: 'table_booking_sheets',
  operation_status: 'success',
  additional_info: { date, count: sheets.length },
})
```
No `try/catch` — it swallows its own errors and can never throw. It therefore **cannot report failure**, so the route's own `console.error` on the failure path is the only observability. Log `date`, `count`, duration — **never** customer names.

### 4.9 Errors
Auth + date handling sit **outside** the try block. Wrap reads + PDF generation in one `try/catch`; DB errors `throw`; the catch does `console.error('Failed to generate table booking sheets:', error)` and returns plain-text 500. Because the client uses `fetch` (§6), non-200s become toasts, not a replaced page.

## 5. Template — `src/lib/table-booking-sheet-template.ts`

Fork of `src/lib/event-booking-sheet-template.ts`, stripped to basics.

```ts
export interface TableBookingSheetData {
  bookingRef: string
  customerName: string
  bookingDate: string   // pre-formatted
  startTime: string     // pre-formatted
  partySize: string
  tableLabel: string    // "Window, 6" | "Outside" | "Unassigned" — never blank
  status: string        // "Booked" | "Seated" | "Pending payment" | ...
  generatedAt: string   // pre-formatted London
}
export function generateTableBookingSheetsHTML(
  sheets: TableBookingSheetData[],
  options: { logoDataUrl: string }
): string
```
All values arrive **pre-formatted**; the template only escapes and lays out.

- **`escapeHtml` copied verbatim** from the events template (`&` first, then `< > " '`). **Every** interpolated value passes through it — no exceptions.
- **Carry over verbatim** from the events template: `:root` tokens (`--paper`, `--ink`, `--ink-soft`, `--ink-mute`, `--rule`, `--pad:13mm`) and the three font vars; `@page { size: A4 portrait; margin: 0 }`; `.page { width:210mm; height:297mm; padding:var(--pad); display:flex; flex-direction:column; overflow:hidden; page-break-after:always; break-after:page }`; `.page:last-child { page-break-after:auto; break-after:auto }`; `.page::after` inner border at `inset:7mm`; `.page-inner`; `print-color-adjust:exact`; the Google Fonts `<link>` block (D-9).
- **Per page:** masthead (logo + "Table booking" eyebrow + `bookingDate`) with `bookingRef`; "Reserved for `customerName`" in the display serif; a 3-cell facts grid — **Time**, **Party size**, **Table**; `status` as a labelled line/pill; footer with `Generated at ${generatedAt}` + "Live system is the source of truth".
- **No** notes box, QR, promo, price, payment or attendee blocks.
- **D-8 — no silent clipping.** Required facts must never be clipped. Use `overflow-wrap: anywhere; word-break: break-word;` and rely on the generous one-booking-per-page A4 space. **Never** `-webkit-line-clamp` or `overflow: hidden` on `.customer-name`, `.table-value`, `.status` or `.booking-ref`. If a pathological value ever needs bounding it must degrade **visibly** (shrink toward the 9px floor), never clip.
- Assembly: `sheets.map(s => renderPage(s, options)).join('\n')` → N `.page` sections → N pages.

## 6. UI — `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`

BOH already imports `{ Badge, Button }` from `@/ds` (line 6) and uses the **DS Button** throughout its toolbar — mirror the existing "Message guests" button and use the DS Button's own `loading` prop (`src/ds/primitives/Button.tsx:10-22`), as Refresh does. **Do not** copy FohHeader's raw `<button>`/`cn()` style.

**Derived values** (all from existing state — no new fetching):
```ts
// `bookings` holds the WHOLE loaded range (week/month), not one day → filter to the focused day.
// CRITICAL (corrected after adversarial review): the BOH list route applies NO status filter, so
// `bookings` includes cancelled/no_show rows that the sheets route excludes. Without matching that
// exclusion the button enables on a day of only-cancelled bookings and then 404s. (Verified: 11
// days currently in prod have rows but zero printable rows.)
const printableBookingCount = bookings.filter(b =>
  b.booking_date === focusDate && b.status !== 'cancelled' && b.status !== 'no_show'
).length

// Settled-for-this-day. `loading===false` alone is NOT sufficient (focusDate drives the refetch);
// rangeStart/End are only ever set from a successful payload.
const scheduleSettled =
  !loading && !error && rangeStartDate <= focusDate && focusDate <= rangeEndDate
```

**Button** — placed in the toolbar action cluster:
```tsx
const isDayView = view === 'day'
const canDownload = isDayView && scheduleSettled && printableBookingCount > 0

<Button
  variant="secondary"
  size="sm"
  onClick={handleDownloadPdf}
  loading={downloading}
  disabled={!canDownload || downloading}
  aria-busy={downloading}
  title={!isDayView ? "Switch to Day view to print a day's sheets" : undefined}
>
  Download PDF
</Button>
```

**Handler** — `fetch` + blob (never a full-page navigation, which would replace the page with the error body):
```tsx
async function handleDownloadPdf() {
  if (downloading) return
  setDownloading(true)
  try {
    const res = await fetch(`/api/boh/table-bookings/booking-sheets?date=${focusDate}`)
    if (!res.ok) {
      toast.error(
        res.status === 404 ? 'No bookings to print for this day'
        : res.status === 422 ? 'Too many bookings to print in one PDF'
        : res.status === 401 ? 'Your session has expired — please sign in again'
        : res.status === 403 ? "You don't have permission to export booking sheets"
        : 'Could not generate the booking sheets'
      )
      return
    }
    if (!res.headers.get('content-type')?.includes('application/pdf')) {
      toast.error('Unexpected response — no PDF was downloaded')
      return
    }
    const blob = await res.blob()
    downloadBlob(blob, filenameFromContentDisposition(
      res.headers.get('content-disposition'), `table-bookings-${focusDate}.pdf`
    ))                                        // server filename is authoritative
    toast.success(`Downloaded booking sheets for ${focusDate}`)
  } catch {
    toast.error('Could not generate the booking sheets')
  } finally {
    setDownloading(false)
  }
}
```
**No 429 branch** (D-11 — no rate limiter exists).

> **No `aria-label`** (corrected after adversarial review). An `aria-label="Download booking sheets PDF"` would make the accessible name *not contain* the visible text "Download PDF", breaking voice control ("click Download PDF" would match nothing) — WCAG 2.5.3 Label in Name. The visible text is already an adequate accessible name. Tests query the button by its **visible** label.

## 7. Acceptance criteria

1. Day view, 3 bookings → `table-bookings-<date>.pdf`, exactly 3 A4 pages, ordered by time then reference.
2. `cancelled` / `no_show` absent; departed (`left_at`) and `completed` present.
3. Outside booking → Table reads **"Outside"**, even with a stray indoor assignment.
4. Indoor booking with no bookable assignment → **"Unassigned"**.
5. Two tables → **one** page, labels de-duped and ordered by `table_number` numerically ("6" before "10"), matching the BOH screen's order — not alphabetically by label.
6. Walk-in with no name → booking reference, else "Walk-in guest". Never blank.
7. `Ben & "Jo" <VIP>` / `<script>` → escaped; no raw `<script>`, no broken markup.
8. **Required facts are never clipped** — long name/table list wraps and stays fully readable.
9. Absent `?date` → today (London). Present-invalid → **400**. Valid empty day → **404**.
10. **Button disabled in week/month view** with the explanatory title; enabled only in Day view.
11. Button disabled while unsettled or when the focused day has 0 bookings.
12. Unauthenticated → 401; unpermitted (incl. FOH-only/kiosk) → 403 — both before any read.
13. Deposit-pending booking prints **"Pending payment"**; a seated booking prints **"Seated"**.
14. Every page shows "Generated at …" and the source-of-truth footer.

## 8. Testing

**Template** (`src/lib/__tests__/table-booking-sheet-template.test.ts`) — proves HTML structure/escaping only, **not** pagination:
- 3 sheets → exactly 3 `<section class="page">`; last-child break reset.
- Escaping **parameterised across every field** (`customerName`, `tableLabel`, `bookingRef`, `status`, `bookingDate`, `startTime`, `partySize`, `generatedAt`).
- Table values "Outside" / "Unassigned" / "Window, 6" render.
- Footer present on every page.
- **No clamp:** assert no `-webkit-line-clamp`/`overflow:hidden` on required-fact selectors.
- **No notes:** a long free-text string is never rendered (guards D-3).

**Route** (`src/app/api/boh/table-bookings/booking-sheets/route.test.ts`) — mirror `src/app/api/table-bookings/load/route.test.ts` (chainable builder):
- Mock `@/lib/foh/api-auth` → `{ ok:true, supabase, userId }` / `{ ok:false, response }`.
- Mock `@/lib/pdf-generator` → `Buffer.from('%PDF')` (**never** launch Chromium).
- Mock `@/app/actions/audit`.
- Cases: (a) 3 rows → 200 + headers + filename; (b) 0 rows → **404**, assert body, **no `Content-Disposition` assertion** (a 404 has no filename); (c) `auth.ok=false` → response returned unchanged, no reads; (d) **status mapping** (`confirmed`+`payment_status:'pending'`+deposit → "Pending payment"; `seated_at` → "Seated") — asserted **here**, not in template tests; (e) multi-table incl. duplicate table id → one sheet, de-duped, numeric-sorted; (f) `is_bookable:false` → "Unassigned"; (g) **outside + stray assignment → "Outside"**; (h) equal times → deterministic order; (i) dates: absent → today, `2026-13-45` → **400**, valid empty → 404; (j) 201 rows → **422**, no PDF call; (k) DB error / logo read failure → 500; (l) audit called once with `{date,count}`.

**BOH UI** (component test): button disabled in week/month + enabled in day view; disabled while unsettled and at 0 count; `printableBookingCount` filters to `focusDate`; success → `downloadBlob` with the server-derived filename; 401/403/404/422/500 → distinct toasts; non-PDF content-type → no download.

**Real-Chromium check** (targeted, not every unit run): generate a real PDF from fixtures (long name, multi-table, outside) and assert the **page count via `pdf-lib`** — HTML node counts do not prove pagination. Render a page to confirm nothing is clipped.

**Pipeline:** `npm run lint` (zero warnings) → `npx tsc --noEmit` → `npm test` → **cold** `npm run build` (use Node 20–22 with an 8 GB heap; a warm build can hide a type error).

## 9. Security & privacy

- Route gated by `requireBohTableBookingPermission('view')` **before any read**. Because the returned client is **service-role (RLS-bypassing)**, this gate is the *only* row boundary — never weaken or reorder it.
- **PII is customer names only.** No notes, no phone, no health/accessibility text (D-3). A strict subset of the BOH list on screen.
- `attachment` + `no-store, private, must-revalidate`; no PII in the URL (only `?date`); no names in logs or the audit payload.
- Kiosk exposure closed by the existing `isFohOnlyUser` 403 (D-7).

## 10. Complexity, rollout, rollback

**Score: 4 (L).** 2 new production files + 1 edited (`BohBookingsClient.tsx`) + 2 test files + a real-PDF check. No schema change, no migration, no API-contract change, no change to existing routes, **no FOH change**.

**Additive and independently deployable.** Land route + template + tests first (button unwired), run a preview-deployment Chromium smoke test (proves cold build + real page count), then wire the UI. **Rollback:** revert the commit — no data or state to unwind.

## 11. Do not

- Do **not** invent `formatDateTimeInLondon` — it does not exist.
- Do **not** select `is_private_block` (not a column) or `special_requirements` (D-3).
- Do **not** write `table_booking_assignments` — it is **`booking_table_assignments`**.
- Do **not** read `is_outside_seating` from `tables` — it is on `table_bookings`.
- Do **not** clamp/clip any required fact (D-8).
- Do **not** retype the status filter — copy the quoted form verbatim (it fails open).
- Do **not** call `downloadBlob`/`filenameFromContentDisposition` server-side (client-only).
- Do **not** add a 429 branch (no rate limiter exists).
- Do **not** import audit from `@/lib/audit` (does not exist) — use `@/app/actions/audit`.
- Do **not** trust `src/types/database.generated.ts` for `deposit_amount_locked` (stale).
- Do **not** touch FOH, or refactor `loadScheduleBookingRows`.
- Do **not** use `console.log` (ESLint `no-console` is an error; only `warn`/`error`).
