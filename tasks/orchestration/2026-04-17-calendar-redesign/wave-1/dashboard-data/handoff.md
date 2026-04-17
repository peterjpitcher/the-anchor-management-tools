# Wave 1 · Dashboard Data — Handoff

## Files modified
- `src/app/(authenticated)/dashboard/dashboard-data.ts` — added `bookedSeatsCount` to `EventSummary`; extended `PrivateBookingSummary` with `end_time`, `end_time_next_day`, `guest_count`; added `past` arrays to the dashboard `privateBookings` and `parking` snapshot sections; renamed internal `ParkingBookingSummary` type to `DashboardParkingBookingSummary` to match the Definition of Done vocabulary.

## Type changes
- `EventSummary`:
  - Added `bookedSeatsCount: number` (required, always populated — defaults to `0` when no confirmed bookings).
- `PrivateBookingSummary`:
  - Added `end_time: string | null`
  - Added `end_time_next_day: boolean | null`
  - Added `guest_count: number | null`
- `PrivateBookingsSnapshot`:
  - Added `past: PrivateBookingSummary[]` alongside `upcoming`.
- `ParkingSnapshot`:
  - Added `past: DashboardParkingBookingSummary[]` alongside `upcoming`.
  - Renamed local `ParkingBookingSummary` → `DashboardParkingBookingSummary` so the downstream calendar wave has an unambiguous type to import. No public API surface change; this type was not exported.

## Loader changes
- **Events**: after the existing upcoming + past `events` queries resolve, a single grouped `bookings` query runs with `.in('event_id', [...upcoming, ...past])` and `.eq('status', 'confirmed')`. Seats are summed per event into a `Map<string, number>` and `toSummary` populates `bookedSeatsCount: bookedSeatsByEvent.get(id) ?? 0` for both lists. Zero extra round-trips to compute the past window — the aggregation is shared.
- **Private bookings**: upcoming (`fromDate: today`, `limit: 20`) and past (`fromDate: today - 90d`, `toDate: today`, `limit: 50`) now run in parallel via `Promise.all` using `PrivateBookingService.getBookings` (which already selects `end_time`, `end_time_next_day`, `guest_count` from `private_bookings_with_details`). A shared `toPbSummary` mapper normalises both. Past rows arrive ascending by `event_date` (service default ordering), are filtered to strictly `< today` (since `getBookings` uses an inclusive `toDate`), then `.slice(-50)` keeps the newest 50 in chronological ascending order — matching the `events.past` shape after `.reverse()`.
- **Parking**: upcoming and past now run in parallel. Past query uses `.lt('end_at', nowIso).gte('start_at', past90Iso)` with `.order('end_at', { ascending: false })` and `.range(0, 49)`, then `[...].reverse()` to produce chronological ascending. Matches the plan's explicit `end_at < now() AND start_at >= now() - 90d` window.

## Typecheck
- `npx tsc --noEmit` → zero errors, zero output. Clean across the full project.

## Assumptions made
- `PrivateBookingService.getBookings` already selects the new columns via the `private_bookings_with_details` view. I did not touch that view / service — extending `PrivateBookingSummary` + mapping the existing row properties was sufficient.
- For past private bookings the service's `toDate` is inclusive (`.lte('event_date', ...)`), so a JS-side `< today` filter is applied before the 50-row cap. This guarantees no overlap with `upcoming` even when bookings exist today.
- For parking's past 90-day window I used `Date.now() - 90 * 24 * 60 * 60 * 1000` as the ISO cut-off (wall-clock 90 days). This matches how `oneDayAgo` / `sevenDaysAgo` are computed elsewhere in this file for timestamp-typed columns (`start_at`/`end_at` are `timestamptz`). Date-typed private-booking window still uses `getLocalIsoDateDaysAgo(90)` for Europe/London consistency.
- The past cap is enforced client-side (`.slice(-50)`) for private bookings because `PrivateBookingService.getBookings` defaults to ASC ordering and `limit: 50` would keep the *oldest* 50 rows. For parking the DB-side order + `range(0, 49)` keeps the newest 50 directly.

## Notes for downstream
- The dashboard migration (Wave 4) can now consume `snapshot.privateBookings.past` and `snapshot.parking.past` to feed the List view's scroll-up history. Both arrays are chronological ascending (oldest first), consistent with `events.past` — the calendar/List view can concatenate `[...past, ...upcoming]` or render sections separately without additional sorting.
- `EventSummary.bookedSeatsCount` is always present (not optional) — downstream code can treat `capacity - bookedSeatsCount` as remaining capacity without a null check. Events with no confirmed bookings yield `0`, not `null`.
- `PrivateBookingSummary.end_time_next_day` uses `boolean | null`: `null` means the column was missing/undefined from the row. When rendering "spills past midnight", treat `null` as `false`.
- Internal type rename (`ParkingBookingSummary` → `DashboardParkingBookingSummary`) is file-local; no other file referenced this type name.
- **No git commits made.** All changes are staged in the working tree only.
