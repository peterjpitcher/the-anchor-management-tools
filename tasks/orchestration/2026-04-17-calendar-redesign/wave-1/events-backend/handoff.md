# Wave 1 · Events Backend — Handoff

## Files modified
- `src/app/(authenticated)/events/get-events-command-center.ts` — Added `bookedSeatsCount: number` to the `EventOverview` type. Added a single grouped `.from('bookings').select('event_id, seats').in('event_id', eventIds).eq('status', 'confirmed')` query after the checklist-status fetch, building a `Map<string, number>` of confirmed-seat totals per event. Populated `bookedSeatsCount` on every mapped `EventOverview` via `bookedSeatsByEvent.get(event.id) ?? 0`.
- `src/components/events/command-center/CommandCenterShell.tsx` — Imported `PrivateBookingCalendarOverview` from the command-centre data module. Added a `filteredPrivateBookings` `useMemo` that case-insensitively filters `initialData.privateBookingsForCalendar` by `customer_name` and `event_type` when `searchQuery` is non-empty, and returns the raw list otherwise. Passed `filteredPrivateBookings` (not the raw list) into `<EventCalendarView />`.
- `src/app/actions/events.ts` — Added the missing `revalidateTag('dashboard')` call to the three booking mutation paths (`createEventManualBooking`, `updateEventManualBookingSeats`, `cancelEventManualBooking`), keeping the existing `revalidatePath` calls and appending the tag call at the end of each block to match the file's existing ordering convention.
- `src/app/actions/privateBookingActions.ts` — Added `revalidatePath('/events')` to every create/update/status/delete/cancel path, and added `revalidateTag('dashboard')` where it was missing. Touched: `createPrivateBooking`, `updatePrivateBooking`, `updateBookingStatus`, `deletePrivateBooking`, `cancelPrivateBooking`, `extendBookingHold`, `captureDepositPayment`.

## Typecheck
`npx tsc --noEmit` — exit 0, zero output (clean).

## Specific revalidate calls added
- `events.ts`:
  - line 799 — inside `createEventManualBooking` success path (added `revalidateTag('dashboard')`).
  - line 1116 — inside `updateEventManualBookingSeats` success path (added `revalidateTag('dashboard')`).
  - line 1446 — inside `cancelEventManualBooking` success path (added `revalidateTag('dashboard')`).
- `privateBookingActions.ts`:
  - line 267 — `createPrivateBooking` (added `revalidatePath('/events')`).
  - line 369 — `updatePrivateBooking` (added `revalidatePath('/events')`).
  - line 399 — `updateBookingStatus` (added `revalidatePath('/events')`).
  - line 466 — `deletePrivateBooking` (added `revalidatePath('/events')`).
  - line 756 — `cancelPrivateBooking` (added `revalidatePath('/events')`).
  - line 801 — `extendBookingHold` (added `revalidatePath('/events')` and `revalidateTag('dashboard')` — was missing both).
  - line 1569 — `captureDepositPayment` (added `revalidatePath('/events')`).

## Assumptions made
- "Create/update/delete/confirm/cancel" was interpreted to include `updateBookingStatus` (the explicit status-change function — this is the "confirm" path since transitioning to `confirmed` flows through here), plus `extendBookingHold` (changes hold-expiry state which affects whether the booking is still visible on the events calendar as pending) and `captureDepositPayment` (the PayPal-driven confirmation path). Payment-edit helpers (`recordDepositPayment`, `recordFinalPayment`, `applyBookingDiscount`, `editPrivateBookingPayment`, `deletePrivateBookingPayment`) were intentionally left untouched — they alter payment ledger state but do not change the private-booking calendar-entry identity (date/time/status/customer/event_type), so they should not need to invalidate the `/events` calendar.
- For the bookings aggregation query, row typing was cast to `Array<{ event_id: string; seats: number | null }>` because Supabase's returned type for `.select('event_id, seats')` is inferred loosely; this keeps TypeScript strict without `any`.
- In the private-bookings search filter, both fields (`customer_name` and `event_type`) are typed nullable in `PrivateBookingCalendarOverview` (`event_type: string | null`), so I used the `?? false` fallback to keep the predicate strictly typed.

## Notes for downstream
- `EventOverview` now exposes `bookedSeatsCount: number`. The `eventToEntry` adapter in the upcoming `schedule-calendar` library should read this field directly (do not re-query bookings from the adapter — the loader already aggregates once per page load).
- The search filter for private bookings runs client-side inside `CommandCenterShell`. `EventCalendarView` now always receives an already-filtered `privateBookings` prop — no further search-query filtering is needed inside the calendar view.
- All booking/private-booking mutation paths now invalidate `/events` and tag `dashboard`, so downstream UI does not need any extra client-side refetch logic beyond what Next's cache revalidation provides.
- Aggregation filter uses `status = 'confirmed'` only, matching the plan's D-requirement (excludes `cancelled`, `expired`, `pending_payment`).
