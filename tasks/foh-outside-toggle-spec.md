# Spec — FOH outside view toggle (A) + website high-chair-unavailable message (B)

**Date:** 2026-07-08
**Status:** Design agreed, ready to build.
**Scope:** Two small, INDEPENDENT changesets in two repos — ship together or separately:
- **Part A** — AMS FOH Inside/Outside view toggle (`OJ-AnchorManagementTools`, auto-deploys `main`).
- **Part B** — website booking-form "high chairs unavailable" message (`OJ-The-Anchor.pub`, **manual** deploy).
**Complexity:** A = 2 / S (5 files, no DB); B = 1 / XS (1 file, copy/UI only).

---

# Part A — FOH Inside/Outside view toggle + outside cards (AMS)

## 1. Problem

Outside bookings currently render in a single virtual "Outside" swimlane at the bottom of the `/foh` timeline (`api/foh/schedule/route.ts:838` builds a `__outside__` lane). A swimlane positions blocks by time against a *table* axis — but outside bookings have no table, so **two outside bookings that overlap in time draw on top of each other and hide one another.** This gets worse as outside volume grows. A time-grid adds no value for outside (no table to assign, no drag-to-table).

## 2. Solution

A **segmented view toggle `Inside | Outside (N)`** in the FOH header, between the Food Order and Walk-in buttons. Default **Inside** (today's swimlane view, unchanged). **Outside** view replaces the swimlanes with a simple **time-sorted list of cards** — the right shape for table-less bookings, and cards stack cleanly no matter how many overlap.

**The count `(N)` on the toggle is essential** — it means staff on the Inside view always see that outside bookings exist and never forget to check them.

### Decisions (owner can flip)
- **D1** Toggle is **always visible** (shows `Outside (0)` when none) — most discoverable. (Alt: hide when N=0.)
- **D2** Default view = **Inside**.
- **D3** View mode is **local component state**, not persisted — resets on reload, consistent with the screen's existing 5-min auto-return to today.
- **D4** Outside cards **reuse the existing booking-detail modal** for actions (tap a card → `FohBookingDetailModal` with seated/left/no-show/cancel), so no new action code. The modal already handles outside bookings (move-table hidden, badges shown — shipped in the high-chair/outside work).
- **D5** **No new FOH create UI** in this change — this is a view only. (The FOH create *API* already accepts outside seating — `src/app/api/foh/bookings/route.ts:48` — but no create-modal outside control is added here; that's a separate follow-up.)

## 3. Changes (file-by-file)

### 3a. Schedule API — return outside as a list, drop the virtual lane
`src/app/api/foh/schedule/route.ts`
- Keep the split at `:784` (`outsideBookings = untabledBookings.filter(is_outside_seating === true)`).
- **Remove** the virtual `__outside__` lane (`:838–850`, incl. `lanesWithOutside`); lanes = indoor lanes only again.
- **Add** `outside_bookings` to the response `data` (alongside `lanes`/`unassigned_bookings` at `:858`), **sorted by `start_datetime || booking_time || id`** — stable order even when `start_datetime` is null.
- Genuinely-untabled **indoor** bookings stay in `unassigned_bookings` (unchanged).

### 3b. Types
`src/app/(authenticated)/table-bookings/foh/types.ts`
- `FohScheduleResponse.data` (`:60–64`): add `outside_bookings?: FohBooking[]` — **optional**, so existing schedule fixtures (e.g. `foh/hooks/useFohCreateBooking.test.ts`) don't break. Consumers read `schedule.outside_bookings ?? []`.

### 3c. Header — the toggle
`src/app/(authenticated)/table-bookings/foh/components/FohHeader.tsx` (buttons at Food Order `:225`, Walk-in `:237`)
- Insert a segmented control between Food Order and Walk-in: two segments `Inside` and `Outside (N)`. Use `@/ds` primitives / existing button styling (no ad-hoc hex). Respect the `manager_kiosk` style variant.
- Props: `viewMode: 'inside' | 'outside'`, `outsideCount: number`, `onViewModeChange(mode)`.
- **Label:** exactly `Outside (N)` (e.g. `Outside (2)`) — one form everywhere, not `Outside · N`.
- Active segment visibly selected; `aria-pressed` on the segments.
- **Render it independent of `canEdit`** — it's a view control, so place it *outside* the existing `canEdit`-gated action group (Walk-in/Add booking); view-only users must be able to toggle.

### 3d. Client — state, counter, render switch
`src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
- Add `const [viewMode, setViewMode] = useState<'inside'|'outside'>('inside')`.
- **Totals counter** (`:110–122`): it currently sums `schedule.lanes` + `unassigned_bookings`. With outside no longer in `lanes`, add `schedule.outside_bookings` to the unique-booking map (`~:114`) so **Total bookings / Total covers still include outside** regardless of view.
- **Optimistic status update** (`:233`): also map `outside_bookings` (mirror the `unassigned_bookings` handling) so a seated/left/no-show action on an outside card updates the card immediately.
- Pass `viewMode`, `outsideCount = schedule?.outside_bookings?.length ?? 0`, and `onViewModeChange` to `FohHeader` (`:329` area).
- **Render switch**: gate BOTH `FohUnassignedBookings` (`:340`) **and** `FohTimeline` behind `viewMode==='inside'`. When `viewMode==='outside'` render **only** `FohOutsideBookings` — the indoor unassigned strip must NOT show in Outside view.
- Realtime refresh (`useFohRealtime`) already re-fetches the whole schedule; the count + cards update automatically.

### 3e. New component — outside cards
Create `src/app/(authenticated)/table-bookings/foh/components/FohOutsideBookings.tsx`
- Props: `bookings: FohBooking[]`, `canEdit`, `styleVariant`, `onBookingClick(booking)`.
- Tap → `openBookingDetails(booking, { laneTableId: null, laneTableName: null })` (mirror `FohUnassignedBookings` `:340`). **Pass `laneTableName: null`, NOT `'Outside'`** — the modal appends "· table {laneTableName}" (`FohBookingDetailModal.tsx:127`), so any value would render the wrong "· table Outside"; the modal already shows the `Outside` badge from `is_outside_seating`.
- Renders a responsive card grid/list, **sorted by `start_datetime || booking_time || id`**. Each card: guest name, time window (`formatBookingWindow`), party size, **status pill derived like the timeline** — `getTableBookingStatusBadgeClasses(getBookingVisualState(booking))` with label `getBookingVisualLabel(booking)` (both from `foh/utils.ts`), NOT the raw `status`, so seated/left/no-show read correctly. **High chair ×N** badge when `high_chair_count > 0` (full `@/ds` Badge is fine — cards have room). No "Outside" badge (every card is outside).
- The card opens the shared `FohBookingDetailModal` (all actions live there).
- Empty state: "No outside bookings for this service." Respect `manager_kiosk` styling.

### 3f. Timeline cleanup
`src/app/(authenticated)/table-bookings/foh/components/FohTimeline.tsx`
- Remove the `__outside__` virtual-lane handling (the `isOutsideLane` branch, the non-droppable/non-draggable outside-lane rendering added for the virtual lane). Indoor lanes only now. **Keep** the compact `BookingBadges` (indoor high-chair bookings still show a compact "High chair ×N" pill in their swimlane block).

## 4. Edge cases
- **Count accuracy:** derived from `outside_bookings.length` for the selected service date — always matches the cards.
- **No double-count:** the totals map keys by booking `id`; outside bookings appear only in `outside_bookings`, so no overlap with lanes/unassigned.
- **Switching views** never mutates data; it's a pure render switch. In-flight optimistic updates apply to whichever list the booking lives in.
- **Realtime / date change:** changing the service date or a realtime event re-fetches; if the current view is Outside and the new date has none, show the empty state (toggle still lets them switch back to Inside).
- **Permissions:** `canEdit` gates actions in the modal exactly as today; the toggle itself is view-only and always available to anyone who can see the FOH page.
- **Manager kiosk:** toggle + cards honour `styleVariant === 'manager_kiosk'` (compact, green skin).

## 5. Verification
- `npm run lint` (0 warnings) → `npx tsc --noEmit` → `npm test` → **cold build** `rm -rf .next && npm run build` (mandatory before deploy — a cached build masked a type error last time; see `tasks/lessons.md`).
- **Regression test** (the bug this fixes): a schedule-route test asserting, for an outside booking, that (a) no lane has `table_id === '__outside__'`, (b) `outside_bookings` contains it, and (c) two time-overlapping outside bookings both appear in `outside_bookings` (they'd have collided in the old single lane). Add `outside_bookings: []` to any existing schedule fixtures (or rely on the optional-field default) so they keep compiling.
- Manual: on `/foh`, toggle Inside↔Outside; the count matches the cards; overlapping outside bookings each show as their own card; the indoor unassigned strip is hidden in Outside view; tapping a card opens the modal with **no "table Outside" text**, the correct status, and working seated/left actions; Total bookings/covers are unchanged by the toggle.

## 6. Open questions
- **O1 (D1):** toggle always visible vs only when `N ≥ 1`? Recommend always visible.
- **O2:** should the count also flash/highlight when a *new* outside booking arrives via realtime while on the Inside view? Nice-to-have, not v1.
- **O3:** FOH-side creation of outside bookings (D5) — schedule as a follow-up if staff need to add outside walk-ins.

---

# Part B — Website "high chairs unavailable" message (the-anchor.pub)

> Independent of Part A: different repo, customer-facing, **manual deploy** (`vercel --prod`).

## B1. Problem
On `/book-table`, when the chosen slot has no high chairs left, the stepper caps at `0` with a disabled "+" and a vague note ("We may not be able to reserve one for this time — we'll do our best"). It reads as **broken** — the customer can't tell whether the control is disabled or the page is stuck, and isn't told what to do.

## B2. Current behaviour (grounded)
`components/features/TableBooking/ManagementTableBookingForm.tsx`:
- `highChairMax` (`:817–823`) = `min(2, floor(high_chairs_remaining))` when the slot reports a finite number, else `2` (fail-open when availability is unknown). So **`highChairMax === 0` ⟺ the slot reports `high_chairs_remaining === 0` (genuinely full)** — it is *never* 0 in the unknown/fail-open case.
- The note (`:2398–2402`) shows "We may not be able to reserve one for this time — we'll do our best." when `highChairMax === 0`, else "We have a limited number, reserved on a first-come basis."
- The stepper "+" is disabled at 0 (`:2410`/`:2426`), and a `useEffect` (`:826`) clamps a previously-chosen count down to `highChairMax` when the slot changes — so switching to a full slot already resets the request to 0.

## B3. Change
When `highChairMax === 0`, show a **warm, clear message** and remove the non-functional +/− stepper (so nothing looks clickable-but-dead):
- **Recommended copy** (calm inline note, keep the existing `text-xs text-ink-muted` styling — no bold alert block, per house tone [[feedback_customer_facing_tone]]):
  > "Sorry — all our high chairs are booked for this time. If you need one, please try another time slot; you're very welcome to book here without one."
- **Recommended:** hide only the high-chair stepper — the +/− buttons + count in the high-chair row (`:2404–2433`) — and show the message in its place. **Minimal alternative:** keep the disabled stepper but just swap the note.
- **Scope guard:** ONLY the high-chair stepper is affected. The **"I'd like an outside table (weather permitting)" checkbox** immediately below (`:2436`) — and everything else in the block — stays exactly as-is.
- `highChairMax >= 1` → unchanged (stepper + "reserved on a first-come basis" note).
- Fail-open (availability unknown → `highChairMax === 2`) → unchanged (stepper enabled, no message).
- No submit-logic change: the server remains the gate; the customer can still book without a chair, and the confirmation already reports what was actually granted.

## B4. Verify
Cold build (`rm -rf .next && npm run build`) → tsc → lint. Manual: a slot known full → warm message, no dead controls; a slot with chairs → stepper works; unknown availability → stepper enabled (fail-open). Then owner **manual deploy** (`vercel --prod`) + verify the-anchor.pub serves it.
