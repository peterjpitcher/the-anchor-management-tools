# /events/[id] mobile UI review + fix plan — 2026-07-05

Read-only review (3 parallel reviewers) of `EventDetailClient.tsx` (+ AddManualBookingForm, EventTicketTypesCard) at ~390px. No code changed.

## Corrections to first-glance reads
- **Stat cards are NOT one-per-row** — `EventDetailClient.tsx:1025` is already `grid-cols-2 sm:grid-cols-3 xl:grid-cols-6`. The height is just inherent to 6 cards. Leave as-is.
- **Event Details grid** is already single-col → `sm:grid-cols-2` (`:786`). Fine.
- **Add Manual Booking form** (recent work) holds up on mobile — steppers meet the 34px touch standard, inputs stack full-width. Only minor polish available.

## Ranked findings

### HIGH
1. **Header crushes the event title.** `PageHeader.tsx:56-65` puts title (`min-w-0`) and the action cluster (status badge + price badge + Edit + Delete, `flex-shrink-0`) in one non-wrapping row; call site `EventDetailClient.tsx:503-529`. Long titles collapse to a stub. → Stack actions under the title below `sm`; full-width Edit/Delete (`Button` supports `fullWidth`). Safest at the call site, or make PageHeader's title row `flex-col gap-3 sm:flex-row`.
2. **Attendees table has no mobile card fallback.** `EventDetailClient.tsx:1101-1114` — an 8-column table (Name/Phone/Seats/[Type]/Paid/Status/Created/Actions) in a bare `overflow-x-auto`. At 390px it's ~2–3× viewport; Seats/Paid/Status/Actions are off-screen (matches the clipped Seats column in the screenshot). → Add the repo's `hidden md:block` table + `block md:hidden` card list (private-bookings `PrivateBookingsClient.tsx:493/717`, invoices).
3. **Per-row actions unreachable on mobile.** `EventDetailClient.tsx:1207-1304` — up to 7 ghost buttons (Cash paid, Card paid, Comp, Edit, Edit names, Transfer, Refund…, Cancel) live in the clipped right-most Actions cell. → Render the same handlers in a card footer action row (`flex flex-wrap gap-2`).

### MEDIUM
4. **Attendee sub-name list inflates row height.** `EventDetailClient.tsx:1142-1146` — numbered `<ol>` nested in the Name cell. → In the mobile card, move it to its own full-width labelled sub-section.
5. **Ticket-types editor is a raw 5-col table with no mobile fallback + squeezed inline-edit inputs.** `EventTicketTypesCard.tsx:156-277`, edit inputs `:171-212`. → `hidden sm:block` table + `sm:hidden` card list; fold edit mode into a stacked full-width form on mobile.
6. **Tab bar overflow is invisible.** `Tabs.tsx:88-90` uses `scrollbar-hide` with no affordance, so "Marketing"/part of "Short Links" are silently cut off (`EventDetailClient.tsx:540-549`). → Right-edge fade mask on the tablist, and/or shorten labels ("Ticket types"→"Tickets").
7. **Attendees toolbar (Check-In / Booking Sheets / Show Cancelled) squeezes the card title.** `EventDetailClient.tsx:1066-1094` — non-wrapping `flex` in a `flex-shrink-0` header slot. → `flex flex-wrap justify-end`, or full-width group below the title on mobile.

### LOW
8. Slug / Booking URL use `break-all` → tall mid-word wraps (`DetailRow` `:1474-1482`, slug `:807`, URL `:820`). → `truncate min-w-0` for URL-like values; CopyButton already gives the full value.
9. Hardcoded `text-gray-500` / `text-blue-600` in the attendee sub-list + breakdown (`:1142/:1179/:1134`) bypass design tokens. → `text-text-muted` + shared link token.
10. Ticket-types "Add type" button not full-width on mobile (`EventTicketTypesCard.tsx:280-324`). → `w-full sm:w-auto`.
11. `w-14` qty input slightly squeezes ticket-name block (`AddManualBookingForm.tsx:282-319`). → optional `w-12` / smaller gap.

## Proposed plan (phased, for approval)
- **Phase 1 — the real fixes (High):** header stacking (#1), attendees mobile card list with all per-row actions in a footer (#2, #3, #4). This is the bulk of the win.
- **Phase 2 — secondary (Medium):** ticket-types mobile cards + stacked edit (#5), tab-overflow fade (#6), attendees toolbar wrap (#7).
- **Phase 3 — polish (Low):** slug truncation (#8), design tokens (#9), full-width add-type button (#10), qty width (#11).

Recommendation: do Phase 1 + Phase 2 together (they're the mobile-usability substance), Phase 3 as a quick follow-up. All are presentation-only changes — no data/logic/permission changes, no migrations.
