# FOH Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-to-reschedule and drag-to-reassign to the FOH `/table-bookings/foh` timeline so staff can drag booking blocks horizontally to change time (snapping to 15-minute intervals) or vertically to reassign tables, with confirmation before committing.

**Architecture:** New hook `useFohDrag` owns all drag state and API calls; pure utility `snapToInterval` handles time maths; extracted components `DraggableBookingBlock` and `DroppableLaneTimeline` wrap @dnd-kit primitives; `DragConfirmationModal` handles confirm/cancel; `PATCH /api/foh/bookings/[id]/time` handles time changes. The existing `POST /api/foh/bookings/[id]/move-table` handles table reassignment.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, @dnd-kit/core ^6.3.1, @dnd-kit/utilities ^3.2.2 (already installed), Supabase, Tailwind CSS v4, Vitest

---

## Spec Reference

Full approved spec: `docs/superpowers/specs/2026-03-14-foh-drag-and-drop-design.md`

Key constraints from spec:
- Snap interval: 15 minutes
- Confirm before save: yes — confirmation modal on every drop
- Cross-table drags: table change only, time is preserved
- Kiosk mode (`styleVariant === 'manager_kiosk'`): drag disabled entirely
- Non-draggable when: `canEdit === false`, status `cancelled`/`no_show`/`completed`, `is_private_block === true`, `assignment_count > 1`
- Unassigned bookings (in `unassigned_bookings` list): not draggable
- Drag activation: PointerSensor with 8px movement threshold
- Ghost: original block opacity 0.4; ghost full opacity at same pixel width (captured via getBoundingClientRect)
- Ghost label shows `liveSnapTime` updated on every onDragMove
- Ghost turns red and drop is rejected (no confirmation) when cursor leaves timeline container
- Time strings: always "HH:MM" 24h format with leading zeros (e.g. "09:00", "13:15")

---

## File Map

**New files:**
- `src/app/(authenticated)/table-bookings/foh/snapToInterval.ts` — pure time-snap utility
- `src/app/(authenticated)/table-bookings/foh/snapToInterval.test.ts` — unit tests
- `src/app/(authenticated)/table-bookings/foh/useFohDrag.ts` — hook owning all drag state
- `src/app/(authenticated)/table-bookings/foh/useFohDrag.test.ts` — unit tests
- `src/app/(authenticated)/table-bookings/foh/DraggableBookingBlock.tsx` — useDraggable wrapper
- `src/app/(authenticated)/table-bookings/foh/DroppableLaneTimeline.tsx` — useDroppable wrapper
- `src/components/foh/DragConfirmationModal.tsx` — confirmation dialog
- `src/app/api/foh/bookings/[id]/time/route.ts` — new PATCH endpoint
- `src/app/api/foh/bookings/[id]/time/route.test.ts` — unit tests

**Modified files:**
- `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` — wire up DndContext, use new components

---

## Chunk 1: Foundation — snapToInterval + API route

### Task 1: Create snapToInterval.ts with tests

**Files:**
- Create: `src/app/(authenticated)/table-bookings/foh/snapToInterval.ts`
- Create: `src/app/(authenticated)/table-bookings/foh/snapToInterval.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/app/(authenticated)/table-bookings/foh/snapToInterval.test.ts
import { describe, it, expect } from 'vitest'
import { snapToInterval } from './snapToInterval'

describe('snapToInterval', () => {
  // Timeline: 09:00 (540 min) to 23:00 (1380 min), container 1200px wide
  const BASE = { containerWidthPx: 1200, timelineStartMin: 540, timelineEndMin: 1380, durationMinutes: 120, intervalMinutes: 15 }

  it('snaps to nearest 15-minute interval', () => {
    // offsetPx=150 → 150/1200*(840 min span)=105 min after 540 → 645 min (10:45)
    const result = snapToInterval(150, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes)
    expect(result.snappedMinutes).toBe(645)
    expect(result.timeString).toBe('10:45')
  })

  it('produces leading-zero time strings', () => {
    // snap to 09:00
    const result = snapToInterval(0, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes)
    expect(result.timeString).toBe('09:00')
  })

  it('clamps start to timelineStartMin when offset is negative', () => {
    const result = snapToInterval(-50, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes)
    expect(result.snappedMinutes).toBe(540)
    expect(result.timeString).toBe('09:00')
  })

  it('clamps end so booking does not overflow timelineEndMin', () => {
    // Far-right offset: snapped start + 120 min must not exceed 1380
    const result = snapToInterval(1200, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes)
    expect(result.snappedMinutes).toBe(1260) // 1380 - 120
    expect(result.timeString).toBe('21:00')
  })

  it('rounds up to next interval when past mid-point', () => {
    // 540 + 8 min = 548; nearest 15-min intervals are 540 and 555; 548 > 547.5 so rounds up to 555
    const pxFor8min = 8 / 840 * 1200
    const result = snapToInterval(pxFor8min, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes)
    expect(result.snappedMinutes).toBe(555)
    expect(result.timeString).toBe('09:15')
  })

  it('handles single-digit hours with leading zero', () => {
    // Snap to 09:05 — but intervals are 15 min so 09:15 is nearest
    const result = snapToInterval(0, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes)
    expect(result.timeString.length).toBe(5)
    expect(result.timeString[2]).toBe(':')
  })
})
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx vitest run src/app/\\(authenticated\\)/table-bookings/foh/snapToInterval.test.ts 2>&1 | tail -20
```

Expected: error "Cannot find module './snapToInterval'"

- [ ] **Step 3: Implement snapToInterval.ts**

```typescript
// src/app/(authenticated)/table-bookings/foh/snapToInterval.ts

/**
 * Snaps a pixel offset to the nearest N-minute interval on the FOH timeline.
 *
 * @param offsetPx          Cursor X position relative to timeline container left edge
 * @param containerWidthPx  Current pixel width of the timeline container
 * @param timelineStartMin  Minutes since midnight for timeline start (e.g. 540 = 09:00)
 * @param timelineEndMin    Minutes since midnight for timeline end (e.g. 1380 = 23:00)
 * @param durationMinutes   Booking duration in minutes (used to clamp end within timeline)
 * @param intervalMinutes   Snap interval (e.g. 15)
 * @returns { snappedMinutes, timeString } where timeString is "HH:MM" (24h, leading zeros)
 */
export function snapToInterval(
  offsetPx: number,
  containerWidthPx: number,
  timelineStartMin: number,
  timelineEndMin: number,
  durationMinutes: number,
  intervalMinutes: number,
): { snappedMinutes: number; timeString: string } {
  const timelineSpanMin = timelineEndMin - timelineStartMin

  // Convert pixel offset to minutes since timeline start
  const rawMinutesFromStart = (offsetPx / containerWidthPx) * timelineSpanMin

  // Snap to nearest interval
  const snappedFromStart = Math.round(rawMinutesFromStart / intervalMinutes) * intervalMinutes

  // Absolute minutes since midnight (before clamping)
  let snappedMinutes = timelineStartMin + snappedFromStart

  // Clamp: start must not be before timeline start
  snappedMinutes = Math.max(snappedMinutes, timelineStartMin)

  // Clamp: booking end must not exceed timeline end
  snappedMinutes = Math.min(snappedMinutes, timelineEndMin - durationMinutes)

  // Format as "HH:MM" with leading zeros
  const hours = Math.floor(snappedMinutes / 60)
  const minutes = snappedMinutes % 60
  const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

  return { snappedMinutes, timeString }
}
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx vitest run src/app/\\(authenticated\\)/table-bookings/foh/snapToInterval.test.ts 2>&1 | tail -20
```

Expected: all 6 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git add src/app/\\(authenticated\\)/table-bookings/foh/snapToInterval.ts src/app/\\(authenticated\\)/table-bookings/foh/snapToInterval.test.ts && git commit -m "feat: add snapToInterval utility for FOH drag-and-drop"
```

---

### Task 2: Create PATCH /api/foh/bookings/[id]/time route with tests

**Files:**
- Create: `src/app/api/foh/bookings/[id]/time/route.ts`
- Create: `src/app/api/foh/bookings/[id]/time/route.test.ts`

**Context:** This endpoint updates a booking's time. It must update BOTH `table_bookings` (booking_time, start_datetime, end_datetime) AND `booking_table_assignments` (start_datetime, end_datetime) atomically. Duration is fetched from `booking_table_assignments` (authoritative). Fall back to `table_bookings` if no assignment. Requires `table_bookings:edit` permission.

Auth pattern from `src/lib/supabase/server.ts`: `const supabase = await getSupabaseServerClient()` then `const { data: { user } } = await supabase.auth.getUser()`.
Permission check: `await checkUserPermission('table-bookings', 'edit', user.id)`.
Audit log: `await logAuditEvent({ user_id: user.id, operation_type: 'table_booking.time_changed', resource_type: 'table_booking', metadata: { bookingId, fromTime, toTime } })`.
Admin client for transactional updates: `import { createAdminClient } from '@/lib/supabase/admin'`.

- [ ] **Step 1: Write failing tests**

```typescript
// src/app/api/foh/bookings/[id]/time/route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PATCH } from './route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/permissions', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(),
}))

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/foh/bookings/test-id/time', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('PATCH /api/foh/bookings/[id]/time', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 if user not authenticated', async () => {
    const { getSupabaseServerClient } = await import('@/lib/supabase/server')
    vi.mocked(getSupabaseServerClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: null } }) },
    } as any)

    const res = await PATCH(makeRequest({ time: '13:00' }), { params: Promise.resolve({ id: 'test-id' }) })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid time format', async () => {
    const { getSupabaseServerClient } = await import('@/lib/supabase/server')
    vi.mocked(getSupabaseServerClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: 'user-1' } } }) },
    } as any)
    const { checkUserPermission } = await import('@/lib/auth/permissions')
    vi.mocked(checkUserPermission).mockResolvedValueOnce(true)

    const res = await PATCH(makeRequest({ time: '25:00' }), { params: Promise.resolve({ id: 'test-id' }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing time field', async () => {
    const { getSupabaseServerClient } = await import('@/lib/supabase/server')
    vi.mocked(getSupabaseServerClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: 'user-1' } } }) },
    } as any)
    const { checkUserPermission } = await import('@/lib/auth/permissions')
    vi.mocked(checkUserPermission).mockResolvedValueOnce(true)

    const res = await PATCH(makeRequest({}), { params: Promise.resolve({ id: 'test-id' }) })
    expect(res.status).toBe(400)
  })

  it('returns 200 and updates both tables on valid request', async () => {
    const { getSupabaseServerClient } = await import('@/lib/supabase/server')
    vi.mocked(getSupabaseServerClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: 'user-1' } } }) },
    } as any)
    const { checkUserPermission } = await import('@/lib/auth/permissions')
    vi.mocked(checkUserPermission).mockResolvedValueOnce(true)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const mockSelect = vi.fn().mockResolvedValueOnce({
      data: {
        start_datetime: '2026-03-15T13:00:00+00:00',
        end_datetime: '2026-03-15T15:00:00+00:00',
        booking_date: '2026-03-15',
      },
      error: null,
    })
    const mockUpdate = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: mockSelect }) }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(mockUpdate) }),
      }),
    } as any)

    const res = await PATCH(makeRequest({ time: '14:00' }), { params: Promise.resolve({ id: 'test-id' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx vitest run src/app/api/foh/bookings/\\[id\\]/time/route.test.ts 2>&1 | tail -20
```

Expected: error "Cannot find module './route'"

- [ ] **Step 3: Implement route.ts**

First, check the exact import paths used in adjacent route files:
```bash
head -20 /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/foh/bookings/*/route.ts 2>/dev/null | head -60
```

Then implement:

```typescript
// src/app/api/foh/bookings/[id]/time/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/lib/auth/permissions'
import { logAuditEvent } from '@/lib/audit'

const TimeSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM format'),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: bookingId } = await params

  // Auth check
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // Permission check
  const hasPermission = await checkUserPermission('table-bookings', 'edit', user.id)
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = TimeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 })
  }

  const { time: newTime } = parsed.data
  const [newHours, newMinutes] = newTime.split(':').map(Number)

  const db = createAdminClient()

  // Fetch current assignment (authoritative for duration)
  const { data: assignment, error: fetchError } = await db
    .from('booking_table_assignments')
    .select('start_datetime, end_datetime')
    .eq('table_booking_id', bookingId)
    .maybeSingle()

  if (fetchError) {
    console.error('Error fetching assignment:', fetchError)
    return NextResponse.json({ error: 'Failed to fetch booking data' }, { status: 500 })
  }

  // Fall back to table_bookings if no assignment
  let startDt: string
  let endDt: string
  let bookingDate: string

  if (assignment?.start_datetime && assignment?.end_datetime) {
    startDt = assignment.start_datetime
    endDt = assignment.end_datetime
  } else {
    const { data: booking, error: bookingError } = await db
      .from('table_bookings')
      .select('start_datetime, end_datetime, booking_date')
      .eq('id', bookingId)
      .maybeSingle()

    if (bookingError || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }
    startDt = booking.start_datetime
    endDt = booking.end_datetime
    bookingDate = booking.booking_date
  }

  // Calculate duration in milliseconds
  const startDate = new Date(startDt)
  const endDate = new Date(endDt)
  const durationMs = endDate.getTime() - startDate.getTime()

  // Build new start datetime preserving the date, updating time
  const newStart = new Date(startDate)
  newStart.setUTCHours(newHours, newMinutes, 0, 0)
  const newEnd = new Date(newStart.getTime() + durationMs)

  const newStartIso = newStart.toISOString()
  const newEndIso = newEnd.toISOString()
  const fromTime = `${String(startDate.getUTCHours()).padStart(2, '0')}:${String(startDate.getUTCMinutes()).padStart(2, '0')}`

  // Update table_bookings
  const { error: bookingUpdateError } = await db
    .from('table_bookings')
    .update({
      booking_time: `${newTime}:00`,
      start_datetime: newStartIso,
      end_datetime: newEndIso,
    })
    .eq('id', bookingId)

  if (bookingUpdateError) {
    console.error('Error updating table_bookings:', bookingUpdateError)
    return NextResponse.json({ error: 'Failed to update booking time' }, { status: 500 })
  }

  // Update booking_table_assignments (if exists)
  if (assignment) {
    const { error: assignmentUpdateError } = await db
      .from('booking_table_assignments')
      .update({
        start_datetime: newStartIso,
        end_datetime: newEndIso,
      })
      .eq('table_booking_id', bookingId)

    if (assignmentUpdateError) {
      console.error('Error updating booking_table_assignments:', assignmentUpdateError)
      return NextResponse.json({ error: 'Failed to update assignment time' }, { status: 500 })
    }
  }

  // Audit log
  await logAuditEvent({
    user_id: user.id,
    operation_type: 'table_booking.time_changed',
    resource_type: 'table_booking',
    metadata: { bookingId, fromTime, toTime: newTime },
  })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx vitest run src/app/api/foh/bookings/\\[id\\]/time/route.test.ts 2>&1 | tail -20
```

Expected: 4 tests pass

- [ ] **Step 5: Check existing `move-table` route to confirm permission/auth pattern is consistent**

```bash
cat /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/foh/bookings/*/route.ts 2>/dev/null | head -40
```

- [ ] **Step 6: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git add src/app/api/foh/bookings/ && git commit -m "feat: add PATCH /api/foh/bookings/[id]/time endpoint for drag-and-drop time changes"
```

---

## Chunk 2: UI Components — Modal + useFohDrag hook

### Task 3: Create DragConfirmationModal

**Files:**
- Create: `src/components/foh/DragConfirmationModal.tsx`

**Context:** This is a confirmation dialog shown before committing a drag. It uses the `PendingMove` type which is a discriminated union. It uses existing ui-v2 modal/button styling. The project uses Tailwind v4 with design tokens. No tests needed — pure UI component.

Check the existing `move-table` modal or other modal files for the ui-v2 pattern:
```bash
find /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components -name "*Modal*" | head -5
```

```typescript
// src/components/foh/DragConfirmationModal.tsx
'use client'

import type { PendingMove } from '@/app/(authenticated)/table-bookings/foh/useFohDrag'

interface DragConfirmationModalProps {
  pendingMove: PendingMove | null
  onConfirm: () => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
  error: string | null
}

export function DragConfirmationModal({
  pendingMove,
  onConfirm,
  onCancel,
  isSubmitting,
  error,
}: DragConfirmationModalProps) {
  if (!pendingMove) return null

  const title = pendingMove.type === 'time' ? 'Change Booking Time' : 'Move to Different Table'

  const message =
    pendingMove.type === 'time'
      ? (
          <>
            Move <strong>{pendingMove.bookingLabel}</strong> from {pendingMove.fromTime} to {pendingMove.toTime}?
          </>
        )
      : (
          <>
            Move <strong>{pendingMove.bookingLabel}</strong> to <strong>{pendingMove.toTableName}</strong>? (Availability is checked when you confirm.)
          </>
        )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drag-confirm-title"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-[var(--color-surface)] p-6 shadow-xl">
        <h2 id="drag-confirm-title" className="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>

        <p className="mb-5 text-sm text-[var(--color-text-secondary)]">{message}</p>

        {error && (
          <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? 'Moving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 1: Check ui-v2 colour tokens available**

```bash
grep -E "color-(surface|primary|text)" /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/globals.css 2>/dev/null | head -20
```

- [ ] **Step 2: Write DragConfirmationModal (adjusting token names to match what exists)**

- [ ] **Step 3: Lint check**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx eslint src/components/foh/DragConfirmationModal.tsx 2>&1
```

- [ ] **Step 4: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git add src/components/foh/DragConfirmationModal.tsx && git commit -m "feat: add DragConfirmationModal for FOH drag-and-drop"
```

---

### Task 4: Create useFohDrag hook with tests

**Files:**
- Create: `src/app/(authenticated)/table-bookings/foh/useFohDrag.ts`
- Create: `src/app/(authenticated)/table-bookings/foh/useFohDrag.test.ts`

**Context:** This hook owns all drag-and-drop state for the FOH page. It imports `snapToInterval` from the same directory. It must be a `'use client'` file.

Key exports:
- `PendingMove` type (discriminated union — also exported for use in modal)
- `isDragging: boolean` — used to suppress realtime refresh while dragging
- `liveSnapTime: string | null` — current snapped target time, updated on every `onDragMove`, null when not dragging
- `isOutOfBounds: boolean` — true when cursor is outside timeline container (ghost turns red)
- `isSubmitting: boolean` — true while confirm API call is in flight
- `confirmError: string | null` — set if confirm API call fails; cleared on next drag or cancel
- `sensors` — pre-configured PointerSensor with 8px activation constraint
- `onDragStart(event: DragStartEvent): void` — captures initial drag state
- `onDragMove(event: DragMoveEvent): void` — updates liveSnapTime; detects out-of-bounds
- `onDragEnd(event: DragEndEvent): void` — sets pendingMove (or no-op if out of bounds)
- `confirm(): Promise<void>` — calls the appropriate API, clears pendingMove
- `cancel(): void` — clears pendingMove and confirmError

The hook receives a `timelineRef: React.RefObject<HTMLElement | null>` to detect out-of-bounds via `getBoundingClientRect`.

Hook signature:
```typescript
export function useFohDrag(timelineRef: React.RefObject<HTMLElement | null>)
```

The hook uses `PointerSensor` from `@dnd-kit/core` with `{ activationConstraint: { distance: 8 } }`.

`onDragEnd` receives `DragEndEvent` from @dnd-kit. The `active.data.current` contains:
```typescript
{
  bookingId: string
  bookingLabel: string        // e.g. "Smith × 4"
  fromTime: string            // "HH:MM"
  tableId: string             // current table UUID
  tableName: string           // current table display name
  durationMinutes: number     // booking duration
  startMinutes: number        // booking start as minutes since midnight
}
```
The `over?.id` contains the target table's UUID (from DroppableLaneTimeline).

For horizontal (same-table) drag: `active.id` and `over?.id` reference the same table → time drag. For cross-table drag: `over?.id` is a different table → table drag.

Time drag: call `snapToInterval` using the `delta.x` added to the booking's original pixel position to get new snap position, then set `pendingMove` with `type: 'time'`.

Table drag: set `pendingMove` with `type: 'table'`.

- [ ] **Step 1: Write failing tests**

```typescript
// src/app/(authenticated)/table-bookings/foh/useFohDrag.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFohDrag } from './useFohDrag'

// Mock @dnd-kit/core sensors
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...args) => args),
    PointerSensor: vi.fn(),
  }
})

vi.mock('./snapToInterval', () => ({
  snapToInterval: vi.fn(() => ({ snappedMinutes: 780, timeString: '13:00' })),
}))

const createTimelineRef = (rect: Partial<DOMRect> = {}) => ({
  current: {
    getBoundingClientRect: () => ({
      left: 0, right: 1200, top: 0, bottom: 60, width: 1200, height: 60,
      x: 0, y: 0, toJSON: () => {},
      ...rect,
    }),
  } as HTMLElement,
})

describe('useFohDrag', () => {
  beforeEach(() => vi.clearAllMocks())

  it('initialises with no pending move and isDragging false', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as any))
    expect(result.current.pendingMove).toBeNull()
    expect(result.current.isDragging).toBe(false)
    expect(result.current.liveSnapTime).toBeNull()
  })

  it('sets pendingMove with type "time" when dropped on same table', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as any))

    act(() => {
      result.current.onDragEnd({
        active: {
          id: 'booking-1',
          data: {
            current: {
              bookingId: 'booking-1',
              bookingLabel: 'Smith × 4',
              fromTime: '12:00',
              tableId: 'table-a',
              tableName: 'Table 1',
              durationMinutes: 90,
              startMinutes: 720,
            },
          },
          rect: { current: { initial: null, translated: null } },
        },
        over: { id: 'table-a', data: { current: {} }, rect: { width: 0, height: 0 }, disabled: false },
        delta: { x: 50, y: 0 },
        activatorEvent: new PointerEvent('pointerdown'),
        collisions: null,
      } as any)
    })

    expect(result.current.pendingMove?.type).toBe('time')
    expect(result.current.pendingMove?.bookingLabel).toBe('Smith × 4')
  })

  it('sets pendingMove with type "table" when dropped on different table', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as any))

    act(() => {
      result.current.onDragEnd({
        active: {
          id: 'booking-1',
          data: {
            current: {
              bookingId: 'booking-1',
              bookingLabel: 'Jones × 2',
              fromTime: '19:00',
              tableId: 'table-a',
              tableName: 'Table 1',
              durationMinutes: 60,
              startMinutes: 1140,
            },
          },
          rect: { current: { initial: null, translated: null } },
        },
        over: { id: 'table-b', data: { current: { tableName: 'Table 2' } }, rect: { width: 0, height: 0 }, disabled: false },
        delta: { x: 0, y: 50 },
        activatorEvent: new PointerEvent('pointerdown'),
        collisions: null,
      } as any)
    })

    expect(result.current.pendingMove?.type).toBe('table')
    if (result.current.pendingMove?.type === 'table') {
      expect(result.current.pendingMove.toTableId).toBe('table-b')
    }
  })

  it('cancel() clears pendingMove and confirmError', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as any))

    act(() => {
      result.current.onDragEnd({
        active: { id: 'b1', data: { current: { bookingId: 'b1', bookingLabel: 'X', fromTime: '12:00', tableId: 'ta', tableName: 'T1', durationMinutes: 60, startMinutes: 720 } }, rect: { current: { initial: null, translated: null } } },
        over: { id: 'ta', data: { current: {} }, rect: { width: 0, height: 0 }, disabled: false },
        delta: { x: 10, y: 0 },
        activatorEvent: new PointerEvent('pointerdown'),
        collisions: null,
      } as any)
    })

    act(() => result.current.cancel())

    expect(result.current.pendingMove).toBeNull()
    expect(result.current.confirmError).toBeNull()
  })

  it('does not set pendingMove if dropped with no over target', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as any))

    act(() => {
      result.current.onDragEnd({
        active: { id: 'b1', data: { current: { bookingId: 'b1', bookingLabel: 'X', fromTime: '12:00', tableId: 'ta', tableName: 'T1', durationMinutes: 60, startMinutes: 720 } }, rect: { current: { initial: null, translated: null } } },
        over: null,
        delta: { x: 10, y: 0 },
        activatorEvent: new PointerEvent('pointerdown'),
        collisions: null,
      } as any)
    })

    expect(result.current.pendingMove).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx vitest run src/app/\\(authenticated\\)/table-bookings/foh/useFohDrag.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Implement useFohDrag.ts**

```typescript
// src/app/(authenticated)/table-bookings/foh/useFohDrag.ts
'use client'

import { useState, useRef, useCallback } from 'react'
import {
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { snapToInterval } from './snapToInterval'

export type PendingMove =
  | {
      type: 'time'
      bookingId: string
      bookingLabel: string
      fromTime: string
      toTime: string
      tableId: string
      tableName: string
    }
  | {
      type: 'table'
      bookingId: string
      bookingLabel: string
      time: string
      fromTableId: string
      fromTableName: string
      toTableId: string
      toTableName: string
    }

interface DragBookingData {
  bookingId: string
  bookingLabel: string
  fromTime: string
  tableId: string
  tableName: string
  durationMinutes: number
  startMinutes: number
  /** Pixel offset of the booking block left edge within the timeline container at drag start */
  initialOffsetPx?: number
  /** Width of the booking block in pixels (captured at drag start via getBoundingClientRect) */
  blockWidthPx?: number
  timelineStartMin: number
  timelineEndMin: number
}

/**
 * Owns all drag-and-drop state for the FOH schedule.
 * Pass a ref to the timeline container div so we can detect out-of-bounds drags.
 */
export function useFohDrag(timelineRef: React.RefObject<HTMLElement | null>) {
  const [isDragging, setIsDragging] = useState(false)
  const [liveSnapTime, setLiveSnapTime] = useState<string | null>(null)
  const [isOutOfBounds, setIsOutOfBounds] = useState(false)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Track drag data in a ref so callbacks always have fresh data without re-renders
  const dragDataRef = useRef<DragBookingData | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragBookingData | undefined
    if (!data) return
    dragDataRef.current = data
    setIsDragging(true)
    setLiveSnapTime(data.fromTime)
    setConfirmError(null)
  }, [])

  const onDragMove = useCallback((event: DragMoveEvent) => {
    const data = dragDataRef.current
    if (!data || !timelineRef.current) return

    const containerRect = timelineRef.current.getBoundingClientRect()
    const pointerX = (event.activatorEvent as PointerEvent).clientX + event.delta.x

    // Out-of-bounds detection
    if (pointerX < containerRect.left || pointerX > containerRect.right) {
      setIsOutOfBounds(true)
      return
    }
    setIsOutOfBounds(false)

    // Calculate snap position from pointer position
    const offsetPx = pointerX - containerRect.left
    const { timeString } = snapToInterval(
      offsetPx,
      containerRect.width,
      data.timelineStartMin,
      data.timelineEndMin,
      data.durationMinutes,
      15,
    )
    setLiveSnapTime(timeString)
  }, [timelineRef])

  const onDragEnd = useCallback((event: DragEndEvent) => {
    setIsDragging(false)
    setLiveSnapTime(null)

    const data = dragDataRef.current
    dragDataRef.current = null

    if (!data || !event.over) {
      setIsOutOfBounds(false)
      return
    }

    // If dragged out of bounds entirely, reject the drop
    if (isOutOfBounds) {
      setIsOutOfBounds(false)
      return
    }

    const toTableId = String(event.over.id)
    const sameTable = toTableId === data.tableId

    if (sameTable) {
      // Time change drag
      if (!timelineRef.current) return
      const containerRect = timelineRef.current.getBoundingClientRect()
      const pointerX = (event.activatorEvent as PointerEvent).clientX + event.delta.x
      const offsetPx = pointerX - containerRect.left

      const { timeString: toTime } = snapToInterval(
        offsetPx,
        containerRect.width,
        data.timelineStartMin,
        data.timelineEndMin,
        data.durationMinutes,
        15,
      )

      // Only set pending if the time actually changed
      if (toTime === data.fromTime) return

      setPendingMove({
        type: 'time',
        bookingId: data.bookingId,
        bookingLabel: data.bookingLabel,
        fromTime: data.fromTime,
        toTime,
        tableId: data.tableId,
        tableName: data.tableName,
      })
    } else {
      // Table change drag — preserve original time
      const overData = event.over.data.current as { tableName?: string } | undefined
      const toTableName = overData?.tableName ?? toTableId

      setPendingMove({
        type: 'table',
        bookingId: data.bookingId,
        bookingLabel: data.bookingLabel,
        time: data.fromTime,
        fromTableId: data.tableId,
        fromTableName: data.tableName,
        toTableId,
        toTableName,
      })
    }
  }, [isOutOfBounds, timelineRef])

  const confirm = useCallback(async () => {
    if (!pendingMove) return
    setIsSubmitting(true)
    setConfirmError(null)

    try {
      if (pendingMove.type === 'time') {
        const res = await fetch(`/api/foh/bookings/${pendingMove.bookingId}/time`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ time: pendingMove.toTime }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to update booking time')
        }
      } else {
        const res = await fetch(`/api/foh/bookings/${pendingMove.bookingId}/move-table`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_id: pendingMove.toTableId }),
        })
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}))
          setConfirmError(body.error ?? 'That slot is no longer available')
          return // Keep modal open on conflict
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to move booking')
        }
      }
      setPendingMove(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setConfirmError(message)
    } finally {
      setIsSubmitting(false)
    }
  }, [pendingMove])

  const cancel = useCallback(() => {
    setPendingMove(null)
    setConfirmError(null)
  }, [])

  return {
    pendingMove,
    isDragging,
    liveSnapTime,
    isOutOfBounds,
    isSubmitting,
    confirmError,
    sensors,
    onDragStart,
    onDragMove,
    onDragEnd,
    confirm,
    cancel,
  }
}
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx vitest run src/app/\\(authenticated\\)/table-bookings/foh/useFohDrag.test.ts 2>&1 | tail -20
```

Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git add src/app/\\(authenticated\\)/table-bookings/foh/useFohDrag.ts src/app/\\(authenticated\\)/table-bookings/foh/useFohDrag.test.ts && git commit -m "feat: add useFohDrag hook for FOH drag-and-drop"
```

---

## Chunk 3: Integration — DraggableBookingBlock + DroppableLaneTimeline + FohScheduleClient wiring

### Task 5: Create DraggableBookingBlock and DroppableLaneTimeline

**Files:**
- Create: `src/app/(authenticated)/table-bookings/foh/DraggableBookingBlock.tsx`
- Create: `src/app/(authenticated)/table-bookings/foh/DroppableLaneTimeline.tsx`

**Context for DraggableBookingBlock:**

Read the existing booking block JSX in `FohScheduleClient.tsx` around line 2676-2708 to understand the exact className and style structure. The component wraps a `<button>` with `useDraggable`. When dragging is active (`transform` is non-null), the original block should have `opacity-40`. The `useDraggable` hook's `setNodeRef` must be set on the outermost element.

The data passed to `useDraggable` must match `DragBookingData` from `useFohDrag.ts`:
```typescript
{
  bookingId: string
  bookingLabel: string
  fromTime: string
  tableId: string
  tableName: string
  durationMinutes: number
  startMinutes: number
  timelineStartMin: number
  timelineEndMin: number
}
```

`isDraggable` prop gates whether drag is applied (false for kiosk, cancelled, no_show, completed, is_private_block, assignment_count > 1, canEdit === false). When not draggable, render just the original button without drag wrappers — cursor should be default.

When draggable and drag is active (`transform !== null`): original block opacity 0.4, cursor `grabbing`. When draggable and drag is not active: cursor `grab`.

**Context for DroppableLaneTimeline:**

Wraps the lane timeline `<div>` with `useDroppable`. When `isOver` is true, the timeline background gets a subtle highlight: `bg-white/10`. The `setNodeRef` goes on the outer div. Accepts `tableId` and `tableName` as props.

- [ ] **Step 1: Read current booking block and lane timeline JSX in FohScheduleClient.tsx**

```bash
sed -n '2670,2720p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx
```

Also check what fields are available on the booking objects in scope:
```bash
sed -n '2600,2680p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx
```

- [ ] **Step 2: Implement DraggableBookingBlock.tsx**

The component must pass all the existing button props through faithfully so visual appearance is identical when not dragging. Check the exact className string used for booking blocks (around line 2387-2389: `bookingBlockBaseClass`).

```typescript
// src/app/(authenticated)/table-bookings/foh/DraggableBookingBlock.tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type React from 'react'

interface DraggableBookingBlockProps {
  // Identity & drag data
  bookingId: string
  bookingLabel: string
  fromTime: string
  tableId: string
  tableName: string
  durationMinutes: number
  startMinutes: number
  timelineStartMin: number
  timelineEndMin: number
  // Drag gate
  isDraggable: boolean
  // Position (passed through to button style)
  leftPct: number
  widthPct: number
  // Button props
  className: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}

export function DraggableBookingBlock({
  bookingId,
  bookingLabel,
  fromTime,
  tableId,
  tableName,
  durationMinutes,
  startMinutes,
  timelineStartMin,
  timelineEndMin,
  isDraggable,
  leftPct,
  widthPct,
  className,
  onClick,
  children,
}: DraggableBookingBlockProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: bookingId,
    disabled: !isDraggable,
    data: {
      bookingId,
      bookingLabel,
      fromTime,
      tableId,
      tableName,
      durationMinutes,
      startMinutes,
      timelineStartMin,
      timelineEndMin,
    },
  })

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${leftPct}%`,
    width: `${widthPct}%`,
    // When dragging, the DragOverlay shows the ghost; original fades
    opacity: isDragging ? 0.4 : 1,
    cursor: !isDraggable ? 'default' : isDragging ? 'grabbing' : 'grab',
    // Apply dnd-kit transform so the block moves with the pointer before drop
    transform: CSS.Transform.toString(transform),
    touchAction: 'none',
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={className}
      style={style}
      onClick={onClick}
      {...(isDraggable ? { ...listeners, ...attributes } : {})}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 3: Implement DroppableLaneTimeline.tsx**

```typescript
// src/app/(authenticated)/table-bookings/foh/DroppableLaneTimeline.tsx
'use client'

import { useDroppable } from '@dnd-kit/core'
import type React from 'react'

interface DroppableLaneTimelineProps {
  tableId: string
  tableName: string
  className: string
  onClick?: () => void
  role?: string
  children: React.ReactNode
}

export function DroppableLaneTimeline({
  tableId,
  tableName,
  className,
  onClick,
  role,
  children,
}: DroppableLaneTimelineProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: tableId,
    data: { tableName },
  })

  return (
    <div
      ref={setNodeRef}
      className={`${className}${isOver ? ' bg-white/10' : ''}`}
      onClick={onClick}
      role={role}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Lint check both files**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx eslint src/app/\\(authenticated\\)/table-bookings/foh/DraggableBookingBlock.tsx src/app/\\(authenticated\\)/table-bookings/foh/DroppableLaneTimeline.tsx 2>&1
```

- [ ] **Step 5: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git add src/app/\\(authenticated\\)/table-bookings/foh/DraggableBookingBlock.tsx src/app/\\(authenticated\\)/table-bookings/foh/DroppableLaneTimeline.tsx && git commit -m "feat: add DraggableBookingBlock and DroppableLaneTimeline components"
```

---

### Task 6: Wire up FohScheduleClient.tsx

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`

**Context:** This is a ~3685-line client component. Make these specific, surgical changes:

1. **Add imports** (near top, after existing imports):
```typescript
import { DndContext, DragOverlay, type DragStartEvent, type DragMoveEvent, type DragEndEvent } from '@dnd-kit/core'
import { useFohDrag } from './useFohDrag'
import { DraggableBookingBlock } from './DraggableBookingBlock'
import { DroppableLaneTimeline } from './DroppableLaneTimeline'
import { DragConfirmationModal } from '@/components/foh/DragConfirmationModal'
```

2. **Add `isDraggingRef` and `timelineContainerRef`** (inside FohScheduleClient, near other useRef declarations):
```typescript
const isDraggingRef = useRef(false)
const timelineContainerRef = useRef<HTMLDivElement | null>(null)
```

3. **Call useFohDrag** (after the refs, near other hooks):
```typescript
const {
  pendingMove, isDragging, liveSnapTime, isOutOfBounds,
  isSubmitting, confirmError, sensors,
  onDragStart, onDragMove, onDragEnd,
  confirm, cancel,
} = useFohDrag(timelineContainerRef)
```

4. **Sync `isDraggingRef` to `isDragging` state** (add a useEffect near other effects):
```typescript
useEffect(() => {
  isDraggingRef.current = isDragging
}, [isDragging])
```

5. **Suppress realtime refresh while dragging** — find the `queueRefresh` function (around line 1126) which is inside a useEffect. Add the check as the very first line inside `queueRefresh`:
```typescript
if (isDraggingRef.current) return
```

6. **Attach `timelineContainerRef` to the outermost timeline container** — find the grid container that wraps all lanes (search for `overflow-x-auto` or the div that holds all the lane rows). Add `ref={timelineContainerRef}` to it. If there are multiple candidate elements, pick the one that represents the scrollable timeline area.

7. **Wrap the schedule grid in `DndContext`**:
```tsx
<DndContext
  sensors={sensors}
  onDragStart={onDragStart}
  onDragMove={onDragMove}
  onDragEnd={onDragEnd}
>
  {/* existing schedule grid JSX */}
  <DragOverlay>
    {isDragging && liveSnapTime ? (
      <div className="rounded bg-blue-500/80 px-2 py-1 text-xs font-semibold text-white shadow-lg">
        {liveSnapTime}
      </div>
    ) : null}
  </DragOverlay>
</DndContext>
```

Note: The DragOverlay ghost is a simple time label for MVP. The booking block itself turns 0.4 opacity (handled in DraggableBookingBlock).

8. **Replace lane timeline `<div>` with `<DroppableLaneTimeline>`** — currently around lines 2618-2723 there is `<div className={laneTimelineClass} role={...} onClick={...}>`. Replace with:
```tsx
<DroppableLaneTimeline
  tableId={lane.table_id}
  tableName={lane.table_name}
  className={laneTimelineClass}
  role={canEdit ? 'button' : undefined}
  onClick={() => openWalkInModalFromLane(...)}
>
  {/* existing content */}
</DroppableLaneTimeline>
```

9. **Replace booking block `<button>` with `<DraggableBookingBlock>`** — find the booking block button (around lines 2676-2708). The isDraggable condition is:
```typescript
const isDraggable =
  canEdit &&
  styleVariant !== 'manager_kiosk' &&
  booking.canEdit !== false &&
  !['cancelled', 'no_show', 'completed'].includes(booking.status) &&
  !booking.is_private_block &&
  (booking.assignment_count ?? 1) <= 1

const bookingLabel = `${booking.customer_name ?? 'Booking'} × ${booking.covers ?? ''}`
```

Replace `<button>` with:
```tsx
<DraggableBookingBlock
  key={booking.id}
  bookingId={booking.id}
  bookingLabel={bookingLabel}
  fromTime={/* booking's start time as "HH:MM" — derive from booking.booking_time or start_datetime */}
  tableId={lane.table_id}
  tableName={lane.table_name}
  durationMinutes={/* derive from start_datetime + end_datetime diff */}
  startMinutes={/* booking start as minutes since midnight */}
  timelineStartMin={timeline.startMin}
  timelineEndMin={timeline.endMin}
  isDraggable={isDraggable}
  leftPct={leftPct}
  widthPct={widthPct}
  className={bookingBlockClass}
  onClick={(e) => { e.stopPropagation(); openBookingDetails(booking) }}
>
  {/* existing booking block children */}
</DraggableBookingBlock>
```

Note: `timeline.startMin` and `timeline.endMin` come from the existing `timeline` memo (line 1531).

10. **Render DragConfirmationModal** at the end of the return statement (before the last closing tag):
```tsx
<DragConfirmationModal
  pendingMove={pendingMove}
  onConfirm={confirm}
  onCancel={cancel}
  isSubmitting={isSubmitting}
  error={confirmError}
/>
```

**Critical:** Read the actual file carefully to find the exact variable names and JSX structure before making changes. The file is long — use sed to read targeted line ranges.

- [ ] **Step 1: Read targeted sections of FohScheduleClient.tsx**

```bash
# Read imports section
sed -n '1,50p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx

# Read refs section
sed -n '980,1050p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx

# Read queueRefresh area
sed -n '1120,1140p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx

# Read timeline memo
sed -n '1525,1540p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx

# Read lane JSX area (laneTimelineClass, booking block button)
sed -n '2380,2420p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx
sed -n '2610,2730p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx

# Read return statement / outermost wrappers
sed -n '2390,2430p' /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx
```

- [ ] **Step 2: Apply all changes using Edit tool (not sed/awk)**

Make all 10 changes described above, reading each section precisely before editing.

- [ ] **Step 3: Type check**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx tsc --noEmit 2>&1 | head -50
```

Fix any type errors before continuing.

- [ ] **Step 4: Lint**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx eslint src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx 2>&1 | head -30
```

- [ ] **Step 5: Build**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm run build 2>&1 | tail -30
```

- [ ] **Step 6: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git add src/app/\\(authenticated\\)/table-bookings/foh/FohScheduleClient.tsx && git commit -m "feat: wire up drag-and-drop in FohScheduleClient"
```

---

## Final: Run full verification pipeline

- [ ] **Run all tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm test 2>&1 | tail -20
```

- [ ] **Lint**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm run lint 2>&1 | tail -20
```

- [ ] **Type check**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx tsc --noEmit 2>&1 | tail -20
```

- [ ] **Build**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm run build 2>&1 | tail -30
```
