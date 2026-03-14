# FOH Drag-and-Drop Design

**Date:** 2026-03-14
**Feature:** Drag-to-reschedule and drag-to-reassign table on /foh timeline
**Status:** Approved

---

## Overview

Add drag-and-drop to the FOH schedule page so staff can:
1. Drag a booking horizontally to change its time (snaps to 15-minute intervals)
2. Drag a booking vertically to a different table row (preserves the original time)

Both operations show a confirmation dialog before committing. Neither supports changing time and table simultaneously in one drag — cross-row drags always keep the original time.

---

## Constraints

- Snap interval: **15 minutes**
- Confirm before save: **yes** — confirmation modal on every drop
- Cross-table drags: **table change only**, time is preserved
- Kiosk mode (`styleVariant === 'manager_kiosk'`): **drag disabled entirely**
- Non-draggable bookings — drag must be disabled on any booking where:
  - `canEdit === false`
  - status is `cancelled`, `no_show`, or `completed`
  - `is_private_block === true`
  - `assignment_count > 1` (multi-table bookings — too complex to move atomically; safe default is no drag)
- Unassigned bookings (those in the `unassigned_bookings` list, not yet in a lane): **not draggable** — out of scope
- Drag activation requires **8px movement threshold** via `PointerSensor` `activationConstraint` to prevent accidental drags interfering with tap-to-open-detail

---

## Data Flow

### Time change (horizontal drag, same table)

1. User drags booking horizontally within its table row (must move ≥8px to activate)
2. Ghost snaps to nearest 15-minute interval; tooltip shows target time
3. On drop → confirmation modal: "Move **Smith × 4** from 13:00 to 13:15?"
4. On confirm → `PATCH /api/foh/bookings/[id]/time` with `{ time: "13:15" }` (always `"HH:MM"` format with leading zeros, e.g. `"09:00"`, `"13:05"`)
5. API updates `table_bookings.booking_time`, `table_bookings.start_datetime`, `table_bookings.end_datetime`, and `booking_table_assignments.start_datetime`, `booking_table_assignments.end_datetime` — both tables must be updated
6. Realtime subscription fires → schedule refreshes

### Table reassignment (cross-row drag)

1. User drags booking to a different table row (must move ≥8px to activate)
2. Ghost stays at original horizontal position (same time); target row highlights
3. On drop → confirmation modal: "Move **Smith × 4** to **Table 3**? (availability is checked when you confirm)"
4. On confirm → existing `POST /api/foh/bookings/[id]/move-table` with `{ table_id: string }`
5. If API returns a conflict (slot taken by the time user confirmed), show error inline in the modal — do not close it
6. Realtime subscription fires → schedule refreshes

---

## New Files

### `src/app/(authenticated)/table-bookings/foh/useFohDrag.ts`
Custom hook owning all drag state:

```ts
type PendingMove =
  | { type: 'time'; bookingId: string; bookingLabel: string; fromTime: string; toTime: string; tableId: string; tableName: string }
  | { type: 'table'; bookingId: string; bookingLabel: string; time: string; fromTableId: string; fromTableName: string; toTableId: string; toTableName: string }

// All time strings are "HH:MM" format (24h, leading zeros)
// tableId values are UUIDs matching booking_table_assignments.table_id
```

Exports:
- `pendingMove: PendingMove | null`
- `isDragging: boolean` — used to suppress realtime refresh while a drag is active
- `liveSnapTime: string | null` — the current snapped target time ("HH:MM") updated on every `onDragMove` event; used to display the live time label inside the `DragOverlay` ghost. Set to `null` when not dragging
- `isSubmitting: boolean` — true while the confirm API call is in flight
- `confirmError: string | null` — set if the confirm API call fails; cleared on next drag or cancel
- `confirm(): Promise<void>` — calls the appropriate API, clears `pendingMove`
- `cancel(): void` — clears `pendingMove` and `confirmError`
- `onDragEnd(event: DragEndEvent): void` — receives @dnd-kit drop event, sets `pendingMove`
- `onDragMove(event: DragMoveEvent): void` — recalculates snap position from current pointer offset and updates `liveSnapTime`; also detects out-of-bounds to trigger red ghost state
- `sensors` — pre-configured `PointerSensor` with 8px activation constraint, to be spread onto `<DndContext>`

### `src/app/(authenticated)/table-bookings/foh/snapToInterval.ts`
Pure utility — receives timeline config from live component state, not hard-coded:

```ts
function snapToInterval(
  offsetPx: number,          // cursor X position relative to timeline container left edge
  containerWidthPx: number,  // current pixel width of the timeline container
  timelineStartMin: number,  // minutes since midnight (e.g. 540 for 09:00) — from live schedule state
  timelineEndMin: number,    // minutes since midnight (e.g. 1380 for 23:00) — from live schedule state
  durationMinutes: number,   // booking duration (end - start); needed to clamp the end within the timeline
  intervalMinutes: number    // 15
): { snappedMinutes: number; timeString: string } // snappedMinutes = minutes since midnight for the snapped start, timeString = "HH:MM"
```

Boundary handling:
- If snapped start would be before `timelineStartMin` → clamp start to `timelineStartMin`
- If snapped start + `durationMinutes` would exceed `timelineEndMin` → clamp start to `timelineEndMin - durationMinutes`
- The ghost turns red and the drop is rejected (no confirmation) if the cursor leaves the timeline container element entirely

### `src/components/foh/DragConfirmationModal.tsx`
Confirmation dialog:
- Props: `pendingMove: PendingMove | null`, `onConfirm: () => Promise<void>`, `onCancel: () => void`, `isSubmitting: boolean`, `error: string | null` — `isSubmitting` and `error` are sourced from `useFohDrag` exports `isSubmitting` and `confirmError`
- For `type: 'time'`: "Move **{bookingLabel}** from {fromTime} to {toTime}?"
- For `type: 'table'`: "Move **{bookingLabel}** to **{toTableName}**? (Availability is checked when you confirm.)"
- Shows inline error below the buttons if `error` is set; modal stays open on error
- Reuses existing modal/button styling from ui-v2

---

## Modified Files

### `src/app/api/foh/bookings/[id]/time/route.ts` _(new API route)_
`PATCH` handler:
- Auth: requires `table_bookings:edit` permission
- Body: `{ time: string }` validated with Zod pattern `/^([01]\d|2[0-3]):[0-5]\d$/`
- Fetches duration from `booking_table_assignments` (not `table_bookings`) — the assignment's `start_datetime`/`end_datetime` are authoritative for FOH rendering and may differ from the booking row if a previous time-shift was applied at assignment level. If no assignment exists, fall back to `table_bookings.start_datetime`/`end_datetime`
- Derives new `start_datetime` and `end_datetime` by applying same duration starting at new time
- Updates `table_bookings` and `booking_table_assignments` — both in the same transaction (use `supabase.rpc` or sequential updates; if assignment update fails, return 500 and log)
- Returns `{ success: true }` or `{ error: string }`
- Logs audit event: `table_booking.time_changed` with `{ bookingId, fromTime, toTime }`

### `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
Changes only:
- Install `@dnd-kit/core` and `@dnd-kit/utilities`
- Wrap schedule grid in `<DndContext sensors={sensors} onDragEnd={onDragEnd}>` using sensors and handler from `useFohDrag`
- Add `<DragOverlay>` — renders a copy of the booking block at its natural pixel width (captured at drag start via `getBoundingClientRect`) and at full opacity. The `DragOverlay` position is managed automatically by @dnd-kit. The ghost label displays `liveSnapTime` from `useFohDrag` (updated via `onDragMove`) so the target time updates live as the user moves the cursor
- Add `useDraggable` to each booking block, conditional on `canEdit` and the non-draggable status checks above
- Add `useDroppable` to each table row's timeline area, keyed by `table_id`
- Suppress `queueRefresh` calls from the realtime subscription while `isDragging === true` — resume and trigger one refresh on `isDragging` returning to false
- Highlight active `useDroppable` row with a subtle background when `isOver === true`
- Render `<DragConfirmationModal>` driven by `pendingMove`, `confirm`, `cancel`

---

## Visual Feedback

| State | Behaviour |
|---|---|
| Hover over draggable booking | Cursor: `grab` |
| Hover over non-draggable booking | Cursor: default (no change) |
| Drag activated (≥8px moved) | Original block: opacity 0.4. Ghost block: full opacity, same pixel width as original, snapped position, shows booking name + target time |
| Dragging over different table row | Target row: subtle background highlight (`bg-white/10`) |
| Ghost would overflow timeline boundaries | Ghost: red tint; drop cancels (no confirmation shown) |
| Cursor leaves timeline container entirely | Ghost: red tint; drop cancels |
| Confirmation modal open | Standard modal overlay |
| API error | Inline error inside modal; modal stays open |

---

## Error Handling

- **Slot conflict on table reassignment**: API returns 409 → shown inline in confirmation modal ("That slot is no longer available")
- **Any other API error**: Toast notification, modal closes, booking stays at original position
- **Realtime fires during drag**: Refresh suppressed via `isDragging` flag; resumes when drag ends
- **Drop outside droppable area**: No confirmation shown, booking snaps back
- **Ghost hits timeline boundary**: Clamped as described in `snapToInterval` spec above

---

## Dependencies

Add to `package.json`:
- `@dnd-kit/core`
- `@dnd-kit/utilities`

No other new dependencies.

---

## Out of Scope

- Changing time and table simultaneously in one drag
- Dragging unassigned bookings onto a table lane
- Dragging multi-table bookings (`assignment_count > 1`)
- Drag-to-resize booking duration
- Touch-specific UX beyond what @dnd-kit pointer sensor provides by default
- Undo after confirmation (drag-back is the undo mechanism)
