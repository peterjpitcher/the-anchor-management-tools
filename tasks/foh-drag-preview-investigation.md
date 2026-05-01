# FOH Table Booking Drag Preview Investigation

Date: 2026-04-24

## Problem

On `/table-bookings/foh`, bookings can be dragged to change table or time:

- vertical movement changes table
- horizontal movement changes time

The drop logic works well enough to open the confirmation modal, but the user cannot see a useful booking preview while dragging. In the screen recording at:

`/Users/peterpitcher/Desktop/Screen Recording 2026-04-24 at 14.13.36.mov`

the pointer moves across the timeline, but the booking does not visibly follow the cursor. The only visible feedback is a faint original booking block and a lane outline, which makes it hard to target the intended table/time.

Extracted contact sheet:

`/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/output/playwright/foh-drag-recording/drag-contact-sheet.png`

## Relevant Files

- `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
- `src/app/(authenticated)/table-bookings/foh/components/FohTimeline.tsx`
- `src/app/(authenticated)/table-bookings/foh/useFohDrag.ts`
- `src/components/foh/DraggableBookingBlock.tsx`
- `src/components/foh/DroppableLaneTimeline.tsx`

## Current Implementation Shape

`DraggableBookingBlock` uses `@dnd-kit/core`:

- `useDraggable({ id: bookingId, data: { ... } })`
- the draggable source is a timeline-positioned `button`
- source classes include `absolute top-*`
- the source element fades during drag via `isDragging ? 'opacity-40 cursor-grabbing' : ''`

`FohTimeline` renders:

- `DndContext`
- lane drop targets via `DroppableLaneTimeline`
- a `DragOverlay`

`FohScheduleClient` owns `activeDragData`, which determines whether the overlay renders.

## Findings So Far

1. The drag/drop state is firing.

   The recording shows lane highlighting and the confirmation modal appears after drop, so `DndContext`, `useDraggable`, `useDroppable`, and `onDragEnd` are functioning.

2. The original source booking does not move.

   `DraggableBookingBlock` does not apply the `transform` returned from `useDraggable`. That is fine if `DragOverlay` works, but it means the overlay is the only possible visible moving preview.

3. The original overlay code reused the timeline booking class.

   Before the change, `DragOverlay` rendered the same class used by in-lane bookings. That class includes `absolute top-*`, which is appropriate inside a lane but risky inside `DragOverlay`. This could make the overlay paint incorrectly or appear offset.

4. `activeDragData` previously depended on `event.active.rect.current.initial`.

   If `event.active.rect.current.initial` is `null`, the overlay data was never set, so `DragOverlay` rendered nothing. This is a likely reason the user saw no moving preview.

## Changes Tried

### 1. Dedicated overlay class

`FohTimeline` now has a separate non-positioned overlay class:

```tsx
const bookingOverlayBaseClass = isManagerKioskStyle
  ? 'h-11 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[9px]'
  : 'h-12 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[10px]'
```

The overlay uses:

```tsx
className={cn(
  bookingOverlayBaseClass,
  activeDragData.statusClassName,
  'select-none opacity-95 shadow-xl ring-2 ring-white/70 cursor-grabbing'
)}
```

This avoids passing timeline positioning classes (`absolute`, `top-*`) into `DragOverlay`.

### 2. Pass only status/color class through drag data

`DraggableBookingBlock` now passes `statusClassName` in `useDraggable` data instead of the full positioned block class.

### 3. Do not require dnd-kit initial rect to render overlay

`FohScheduleClient.onDragStart` now sets `activeDragData` when drag data exists, even if `event.active.rect.current.initial` is missing:

```tsx
widthPx: rect?.width ?? 280
```

This should prevent `DragOverlay` from rendering `null` just because dnd-kit did not provide a rect at drag start.

## Verification Done

Focused drag hook tests pass:

```bash
npm test -- src/app/'(authenticated)'/table-bookings/foh/useFohDrag.test.ts
```

Targeted lint passes:

```bash
npm run lint -- \
  src/app/'(authenticated)'/table-bookings/foh/components/FohTimeline.tsx \
  src/app/'(authenticated)'/table-bookings/foh/FohScheduleClient.tsx \
  src/components/foh/DraggableBookingBlock.tsx
```

I could not fully reproduce interactively in browser from this environment because direct access to `http://localhost:3001/table-bookings/foh` redirects to `/auth/login` in my session.

## Remaining Hypotheses If Preview Is Still Invisible

1. `onDragStart` is not setting `activeDragData`.

   Add a temporary `console.log` in `FohScheduleClient.onDragStart` to confirm `data` exists and `activeDragData` is populated.

2. `DragOverlay` is rendering, but behind another stacking context.

   Inspect the DOM during drag for the dnd-kit overlay element. If present but hidden, add an explicit wrapper class or style with a high z-index.

3. The source element is being treated as the drag preview by the browser instead of dnd-kit overlay.

   Consider applying the `transform` from `useDraggable` directly to `DraggableBookingBlock` as a fallback, or creating a custom fixed-position preview from pointer coordinates.

4. The drag starts from a child/text selection interaction and the overlay only appears after a threshold.

   The sensor uses `PointerSensor` with `activationConstraint: { distance: 8 }`. This should be fine, but can be tested by lowering/removing the threshold temporarily.

## Practical Next Debug Step

Add temporary visual/debug output:

```tsx
console.log('FOH drag start', {
  data: event.active.data.current,
  rect: event.active.rect.current.initial,
})
```

and temporarily render:

```tsx
{activeDragData && (
  <div className="fixed right-4 top-4 z-[9999] bg-red-600 p-2 text-white">
    dragging {activeDragData.bookingLabel}
  </div>
)}
```

If this debug badge appears while dragging, state is fine and the issue is specifically with `DragOverlay` rendering/z-index. If it does not appear, `activeDragData` is not being set.

## Possible Robust Fix

If `DragOverlay` continues to be unreliable here, bypass it and render a custom fixed-position preview:

- track pointer position in `onDragMove`
- render a `fixed z-[9999] pointer-events-none` booking preview
- position it near the pointer
- keep `DragOverlay` removed or unused

This would be less idiomatic than dnd-kit `DragOverlay`, but very explicit and easier to debug.
