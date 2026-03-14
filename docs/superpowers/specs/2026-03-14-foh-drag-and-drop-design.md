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
- Kiosk mode (`styleVariant === 'kiosk'`): **drag disabled entirely**
- Non-editable statuses (cancelled, no-show, completed): **not draggable**
- `canEdit === false`: **not draggable**

---

## Data Flow

### Time change (horizontal drag, same table)

1. User drags booking horizontally within its table row
2. Ghost snaps to nearest 15-minute interval; tooltip shows target time
3. On drop → confirmation modal: "Move **Smith × 4** from 13:00 to 13:15?"
4. On confirm → `PATCH /api/foh/bookings/[id]/time` with `{ time: "13:15" }`
5. API updates `table_bookings.booking_time`, `table_bookings.start_datetime`, `table_bookings.end_datetime`, and `booking_table_assignments.start_datetime`, `booking_table_assignments.end_datetime`
6. Realtime subscription fires → schedule refreshes

### Table reassignment (cross-row drag)

1. User drags booking to a different table row
2. Ghost stays at original horizontal position (same time); target row highlights
3. On drop → confirmation modal: "Move **Smith × 4** to **Table 3**?"
4. On confirm → existing `POST /api/foh/bookings/[id]/move-table` with `{ table_id }`
5. Realtime subscription fires → schedule refreshes

---

## New Files

### `src/app/(authenticated)/table-bookings/foh/useFohDrag.ts`
Custom hook owning all drag state:
- `pendingMove`: `{ bookingId, bookingLabel, fromTime, toTime, fromTable, toTable, type: 'time' | 'table' } | null`
- `confirm()`: calls the appropriate API, clears `pendingMove`
- `cancel()`: clears `pendingMove`
- `onDragEnd(event)`: receives @dnd-kit drop event, calculates snap target, sets `pendingMove`
- `onDragMove(event)`: tracks current ghost position for overlay rendering

### `src/app/(authenticated)/table-bookings/foh/snapToInterval.ts`
Pure utility:
```ts
snapToInterval(offsetPx: number, containerWidthPx: number, intervalMinutes: number): Date
```
- Timeline spans 11:00–23:00 (720 minutes)
- Converts pixel offset → minutes from timeline start → snap → Date

### `src/components/foh/DragConfirmationModal.tsx`
Confirmation dialog:
- Props: `pendingMove`, `onConfirm`, `onCancel`, `isSubmitting`, `error`
- Shows human-readable summary of the move
- Displays inline error if API returns conflict
- Reuses existing modal/button styling from ui-v2

---

## Modified Files

### `src/app/api/foh/bookings/[id]/time/route.ts` _(new API route)_
`PATCH` handler:
- Auth: requires `canEdit` permission
- Body: `{ time: "HH:MM" }` (validated with Zod)
- Derives new `start_datetime` and `end_datetime` by shifting original duration to new start time
- Updates both `table_bookings` and `booking_table_assignments` atomically
- Returns `{ success: true }` or `{ error: string }`
- Logs audit event: `table_booking.time_changed`

### `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
Changes:
- Wrap schedule grid in `<DndContext>` with `onDragEnd` and `onDragMove` from `useFohDrag`
- Add `<DragOverlay>` rendering ghost block at snapped position
- Add `useDraggable` to each booking block (conditional on `canEdit` and status)
- Add `useDroppable` to each table row's timeline area (keyed by `table_id`)
- Render `<DragConfirmationModal>` driven by `pendingMove`
- Highlight active drop target row while dragging
- Pause realtime refresh while a drag is in flight

---

## Visual Feedback

| State | Behaviour |
|---|---|
| Hover over draggable booking | Cursor: `grab` |
| Dragging | Original block: opacity 0.4. Ghost block: full opacity, snapped position, shows name + target time |
| Dragging over different table row | Target row: subtle background highlight |
| Dragging outside timeline | Ghost: red tint; drop cancels move |
| Confirmation modal open | Standard modal overlay |
| API error | Inline error in modal; modal stays open |

---

## Error Handling

- **Slot conflict**: API returns error → shown inline in confirmation modal
- **Network error**: Toast notification, booking stays at original position
- **Realtime fires during drag**: Drag is cancelled, booking snaps to DB position
- **Drop outside droppable area**: No confirmation shown, booking snaps back

---

## Dependencies

- `@dnd-kit/core` — drag primitives (`DndContext`, `useDraggable`, `useDroppable`, `DragOverlay`)
- `@dnd-kit/utilities` — `CSS.Transform.toString()` for ghost positioning

No other new dependencies.

---

## Out of Scope

- Changing time and table simultaneously in one drag
- Touch-optimised drag (touch works via @dnd-kit pointer sensor, but no special touch UX)
- Undo after confirmation (drag-back is the undo mechanism)
- Drag to resize booking duration
