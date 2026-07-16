# Implementation plan — BOH table-booking print sheets

**Spec (authoritative):** [`tasks/table-booking-print-sheets-spec.md`](table-booking-print-sheets-spec.md) — v5. Read §3 (verified ground truth) and §11 (Do not) before writing any code. Every identifier in the spec is verified against the live DB or real source; **do not substitute plausible-looking alternatives**.

**Nature of change:** additive. No migration, no schema change, no change to any existing route, **no FOH change**. Files: 2 new production, 1 edited, 3 test files.

**Branch:** `feat/boh-table-booking-print-sheets` (branch off `main`).

---

## Stream A — Template (no dependencies)

**File (new):** `src/lib/table-booking-sheet-template.ts`

1. Fork `src/lib/event-booking-sheet-template.ts`. Copy **verbatim**: `escapeHtml`, the `:root` tokens, `@page { size:A4 portrait; margin:0 }`, `.page` / `.page:last-child` / `.page::after` / `.page-inner` rules, `print-color-adjust:exact`, and the Google Fonts `<link>` block.
2. Export `TableBookingSheetData` and `generateTableBookingSheetsHTML(sheets, { logoDataUrl })` exactly as typed in spec §5.
3. Per-page layout per spec §5: masthead (logo + "Table booking" eyebrow + `bookingDate` + `bookingRef`), "Reserved for `customerName`", 3-cell facts grid (Time / Party size / Table), status line, footer (`Generated at …` + "Live system is the source of truth").
4. **Every** interpolated value goes through `escapeHtml` — no exceptions.
5. **No** notes box, QR, promo, price, payment or attendee blocks.
6. **No `-webkit-line-clamp` / `overflow:hidden` on any required fact.** Use `overflow-wrap:anywhere; word-break:break-word`.

**Acceptance:** `generateTableBookingSheetsHTML([a,b,c], {logoDataUrl})` returns HTML with exactly 3 `<section class="page">`; every dynamic value escaped; no notes; no clamp on required facts.

## Stream B — Route (depends on A for the type import)

**File (new):** `src/app/api/boh/table-bookings/booking-sheets/route.ts`

Implement exactly spec §4:
1. `export const runtime = 'nodejs'`; `export const maxDuration = 300`.
2. Auth **before any read**: `requireBohTableBookingPermission('view')` from `@/lib/foh/api-auth`; `if (!auth.ok) return auth.response`; destructure `{ supabase, userId }`.
3. Date: absent → `getLondonDateIso()`; present-invalid (shape **or** calendar) → **400**. Use the `isIsoDate` in §4.2.
4. Query: the single nested select in §4.3 **copied exactly** — real table `booking_table_assignments`, pinned FKs `booking_table_assignments_table_booking_id_fkey` / `booking_table_assignments_table_id_fkey` / `table_bookings_customer_id_fkey`. Status filter **copied verbatim** from `src/app/api/foh/schedule/route.ts:213` — the quoted in-list (it fails open if malformed).
5. Guards in order: 0 rows → **404** (body must not say "active"); `> 200` rows → **422**, no PDF.
6. Map per §4.5. `tableField` checks `row.is_outside_seating` **FIRST** (it is a `table_bookings` column), then de-dups by table id and sorts with `Intl.Collator('en',{numeric:true,sensitivity:'base'})`. Status via `getTableBookingStatusLabel(getTableBookingVisualState(row))` from `@/lib/table-bookings/ui`.
7. Sort: `booking_time` → `booking_reference` → `id`.
8. `generatedAt` per §4.6 (compose `formatDateDdMmmmYyyy` + `formatTime12Hour(toLondonDateTimeLocalValue(now).slice(11))` — **`formatDateTimeInLondon` does not exist**).
9. PDF + headers per §4.7. Audit per §4.8 (`@/app/actions/audit`; no try/catch — it swallows its own errors).
10. Errors per §4.9: auth/date outside the try; `console.error` + plain-text 500 inside.

**Gotcha:** `deposit_amount_locked` is a real column but missing from the stale `src/types/database.generated.ts` — a cast may be needed. Do not drop the column.

**Acceptance:** route compiles; typecheck clean; returns 200 + `application/pdf` for a day with bookings.

## Stream C — BOH UI (depends on B's route path)

**File (edited):** `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`

Implement exactly spec §6:
1. Derive `printableBookingCount = bookings.filter(b => b.booking_date === focusDate).length` (`bookings` holds the whole range, not one day).
2. Derive `scheduleSettled = !loading && !error && rangeStartDate <= focusDate && focusDate <= rangeEndDate`.
3. Add `downloading` state + `handleDownloadPdf` (fetch + blob) per §6, using `downloadBlob` + `filenameFromContentDisposition` from `@/lib/download-file` (server filename authoritative). Distinct toasts for 401/403/404/422/500 + non-PDF content-type. **No 429 branch.**
4. Add the **DS `Button`** (already imported from `@/ds`) to the toolbar, mirroring "Message guests"; use its `loading` prop. `disabled={!canDownload || downloading}` where `canDownload = view === 'day' && scheduleSettled && printableBookingCount > 0`; `title="Switch to Day view to print a day's sheets"` when not in day view; `aria-busy`; `aria-label`.

**Do not** touch FOH or copy FohHeader's raw `<button>` style.

**Acceptance:** button disabled in week/month; enabled in day view with ≥1 booking; downloads via blob.

## Stream D — Template tests (depends on A)

**File (new):** `src/lib/__tests__/table-booking-sheet-template.test.ts` — all cases in spec §8 "Template", including the **no-clamp** and **no-notes** guards and escaping parameterised across every field.

## Stream E — Route tests (depends on B)

**File (new):** `src/app/api/boh/table-bookings/booking-sheets/route.test.ts` — all cases (a)–(l) in spec §8 "Route". Mirror the chainable-builder mock pattern in `src/app/api/table-bookings/load/route.test.ts`. Mock `@/lib/foh/api-auth`, `@/lib/pdf-generator` (never launch Chromium), `@/app/actions/audit`. `beforeEach(() => vi.clearAllMocks())`.

Note (b): a 404 has **no** `Content-Disposition` — assert the body, not a filename.

## Stream F — BOH UI tests (depends on C)

Component test per spec §8 "BOH UI" — especially the **day-view gate** and the `focusDate` filtering of `printableBookingCount`.

## Stream G — Verification (depends on all)

1. `npm run lint` — zero warnings.
2. `npx tsc --noEmit` — clean.
3. `npm test` — all pass, no regressions.
4. **Cold** `npm run build` — Node 20–22, 8 GB heap (`NODE_OPTIONS=--max-old-space-size=8192`). A warm build can hide a type error.
5. Real-Chromium check: generate a PDF from fixtures (long name, multi-table, outside) and assert page count via `pdf-lib`.

---

## Do not (traps already identified — each cost a spec revision)

- Do **not** invent `formatDateTimeInLondon` (does not exist).
- Do **not** write `table_booking_assignments` — it is **`booking_table_assignments`** (FK column `table_booking_id`).
- Do **not** read `is_outside_seating` from `tables` — it is on **`table_bookings`**.
- Do **not** select `is_private_block` (not a column) or `special_requirements` (notes are not printed).
- Do **not** clamp/clip any required fact.
- Do **not** retype the status filter — copy the quoted form verbatim.
- Do **not** call `downloadBlob` server-side (client-only).
- Do **not** add a 429 branch (no rate limiter).
- Do **not** import audit from `@/lib/audit` (does not exist) — `@/app/actions/audit`.
- Do **not** use `console.log` (ESLint `no-console` is an error; `warn`/`error` only).
- Do **not** touch FOH or refactor `loadScheduleBookingRows`.

## Final checklist (maps to spec §7 acceptance criteria)

- [ ] 3 bookings → 3 pages, ordered by time then reference (AC 1)
- [ ] cancelled/no_show absent; departed/completed present (AC 2)
- [ ] Outside + stray assignment → "Outside" (AC 3)
- [ ] No bookable assignment → "Unassigned" (AC 4)
- [ ] Two tables → one page, de-duped, numeric-sorted (AC 5)
- [ ] Walk-in → reference fallback, never blank (AC 6)
- [ ] Special characters escaped (AC 7)
- [ ] Required facts never clipped (AC 8)
- [ ] Absent date → today; invalid → 400; empty day → 404 (AC 9)
- [ ] Button day-view gated (AC 10) and disabled when unsettled/0 (AC 11)
- [ ] 401/403 before any read (AC 12)
- [ ] Deposit-pending → "Pending payment"; seated → "Seated" (AC 13)
- [ ] Generated-at + footer on every page (AC 14)
- [ ] lint / tsc / test / cold build all green
