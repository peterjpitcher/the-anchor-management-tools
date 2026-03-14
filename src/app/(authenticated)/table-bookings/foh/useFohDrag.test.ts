import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFohDrag } from './useFohDrag'

// PointerEvent is not available in jsdom — provide a minimal stub
const makePointerEvent = (type = 'pointerdown', clientX = 0) =>
  ({ type, clientX, pointerId: 1 } as unknown as PointerEvent)

// Mock @dnd-kit/core sensors
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...args: unknown[]) => args),
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

// ── Shared test-data factories ─────────────────────────────────────────────
const makeBookingData = (overrides: Record<string, unknown> = {}) => ({
  bookingId: 'booking-1',
  bookingLabel: 'Smith × 4',
  fromTime: '12:00',
  tableId: 'table-a',
  tableName: 'Table 1',
  durationMinutes: 90,
  startMinutes: 720,
  timelineStartMin: 660,
  timelineEndMin: 1380,
  ...overrides,
})

const makeDragStartEvent = (data: ReturnType<typeof makeBookingData>) => ({
  active: {
    id: data.bookingId,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  },
  activatorEvent: makePointerEvent(),
} as any)

const makeDragMoveEvent = (
  data: ReturnType<typeof makeBookingData>,
  clientX = 100,
  deltaX = 50,
) => ({
  active: {
    id: data.bookingId,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  },
  activatorEvent: makePointerEvent('pointermove', clientX),
  delta: { x: deltaX, y: 0 },
  over: null,
  collisions: null,
} as any)

const makeDragEndEvent = (
  data: ReturnType<typeof makeBookingData>,
  overId = 'table-a',
  overData: Record<string, unknown> = {},
  deltaX = 50,
) => ({
  active: {
    id: data.bookingId,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  },
  over: { id: overId, data: { current: overData }, rect: { width: 0, height: 0 }, disabled: false },
  delta: { x: deltaX, y: 0 },
  activatorEvent: makePointerEvent(),
  collisions: null,
} as any)

describe('useFohDrag', () => {
  beforeEach(() => vi.clearAllMocks())

  it('initialises with no pending move and isDragging false', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))
    expect(result.current.pendingMove).toBeNull()
    expect(result.current.isDragging).toBe(false)
    expect(result.current.liveSnapTime).toBeNull()
  })

  it('sets pendingMove with type "time" when dropped on same table', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

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
              timelineStartMin: 660,
              timelineEndMin: 1380,
            },
          },
          rect: { current: { initial: null, translated: null } },
        },
        over: { id: 'table-a', data: { current: {} }, rect: { width: 0, height: 0 }, disabled: false },
        delta: { x: 50, y: 0 },
        activatorEvent: makePointerEvent(),
        collisions: null,
      } as any)
    })

    expect(result.current.pendingMove?.type).toBe('time')
    if (result.current.pendingMove?.type === 'time') {
      expect(result.current.pendingMove.bookingLabel).toBe('Smith × 4')
    }
  })

  it('sets pendingMove with type "table" when dropped on different table', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

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
              timelineStartMin: 660,
              timelineEndMin: 1380,
            },
          },
          rect: { current: { initial: null, translated: null } },
        },
        over: { id: 'table-b', data: { current: { tableName: 'Table 2' } }, rect: { width: 0, height: 0 }, disabled: false },
        delta: { x: 0, y: 50 },
        activatorEvent: makePointerEvent(),
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
    const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

    act(() => {
      result.current.onDragEnd({
        active: { id: 'b1', data: { current: { bookingId: 'b1', bookingLabel: 'X', fromTime: '12:00', tableId: 'ta', tableName: 'T1', durationMinutes: 60, startMinutes: 720, timelineStartMin: 660, timelineEndMin: 1380 } }, rect: { current: { initial: null, translated: null } } },
        over: { id: 'ta', data: { current: {} }, rect: { width: 0, height: 0 }, disabled: false },
        delta: { x: 10, y: 0 },
        activatorEvent: makePointerEvent(),
        collisions: null,
      } as any)
    })

    act(() => result.current.cancel())

    expect(result.current.pendingMove).toBeNull()
    expect(result.current.confirmError).toBeNull()
  })

  it('does not set pendingMove if dropped with no over target', () => {
    const ref = createTimelineRef()
    const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

    act(() => {
      result.current.onDragEnd({
        active: { id: 'b1', data: { current: { bookingId: 'b1', bookingLabel: 'X', fromTime: '12:00', tableId: 'ta', tableName: 'T1', durationMinutes: 60, startMinutes: 720, timelineStartMin: 660, timelineEndMin: 1380 } }, rect: { current: { initial: null, translated: null } } },
        over: null,
        delta: { x: 10, y: 0 },
        activatorEvent: makePointerEvent(),
        collisions: null,
      } as any)
    })

    expect(result.current.pendingMove).toBeNull()
  })

  // ── New tests for previously missing coverage ──────────────────────────────

  describe('isDragging state transitions', () => {
    it('onDragStart sets isDragging to true', () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      act(() => { result.current.onDragStart(makeDragStartEvent(makeBookingData())) })

      expect(result.current.isDragging).toBe(true)
    })

    it('onDragEnd sets isDragging to false', () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      act(() => { result.current.onDragStart(makeDragStartEvent(makeBookingData())) })
      expect(result.current.isDragging).toBe(true)

      act(() => { result.current.onDragEnd(makeDragEndEvent(makeBookingData())) })
      expect(result.current.isDragging).toBe(false)
    })
  })

  describe('liveSnapTime updates', () => {
    it('onDragStart initialises liveSnapTime to fromTime', () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      act(() => { result.current.onDragStart(makeDragStartEvent(makeBookingData({ fromTime: '18:30' }))) })

      expect(result.current.liveSnapTime).toBe('18:30')
    })

    it('onDragMove updates liveSnapTime via snapToInterval result', () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      act(() => { result.current.onDragStart(makeDragStartEvent(makeBookingData())) })
      act(() => { result.current.onDragMove(makeDragMoveEvent(makeBookingData(), 100, 50)) })

      // snapToInterval mock always returns '13:00'
      expect(result.current.liveSnapTime).toBe('13:00')
    })

    it('onDragEnd sets liveSnapTime to null', () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      act(() => { result.current.onDragStart(makeDragStartEvent(makeBookingData())) })
      act(() => { result.current.onDragEnd(makeDragEndEvent(makeBookingData())) })

      expect(result.current.liveSnapTime).toBeNull()
    })
  })

  describe('out-of-bounds drop rejection', () => {
    it('produces no pendingMove when pointer was outside timeline bounds at drag end', () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      // Populate dragDataRef via onDragStart so onDragMove can read it
      act(() => { result.current.onDragStart(makeDragStartEvent(makeBookingData())) })

      // Move pointer out of bounds: clientX=0, deltaX=-10 → pointerX=-10 < left=0
      act(() => { result.current.onDragMove(makeDragMoveEvent(makeBookingData(), 0, -10)) })

      // End the drag over a valid target — should still be rejected due to out-of-bounds
      act(() => {
        result.current.onDragEnd({
          active: {
            id: 'booking-1',
            data: { current: makeBookingData() },
            rect: { current: { initial: null, translated: null } },
          },
          over: { id: 'table-a', data: { current: {} }, rect: { width: 0, height: 0 }, disabled: false },
          delta: { x: -10, y: 0 },
          activatorEvent: makePointerEvent('pointerup', 0),
          collisions: null,
        } as any)
      })

      expect(result.current.pendingMove).toBeNull()
    })
  })

  describe('confirm() API integration', () => {
    it('calls PATCH /api/foh/bookings/[id]/time for a time move and clears pendingMove', async () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      // Set up time pendingMove: same table, fromTime '12:00', snapToInterval mock → '13:00'
      act(() => { result.current.onDragEnd(makeDragEndEvent(makeBookingData({ fromTime: '12:00' }), 'table-a', {}, 50)) })
      expect(result.current.pendingMove?.type).toBe('time')

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      )

      await act(async () => { await result.current.confirm() })

      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/foh/bookings/booking-1/time')
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body as string)).toEqual({ time: '13:00' })
      expect(result.current.pendingMove).toBeNull()
    })

    it('calls POST /api/foh/bookings/[id]/move-table for a table move and clears pendingMove', async () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      // Set up table pendingMove: different table
      act(() => {
        result.current.onDragEnd(makeDragEndEvent(
          makeBookingData({ bookingId: 'booking-99' }),
          'table-z',
          { tableName: 'Table Z' },
          0,
        ))
      })
      expect(result.current.pendingMove?.type).toBe('table')

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      )

      await act(async () => { await result.current.confirm() })

      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/foh/bookings/booking-99/move-table')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ table_id: 'table-z' })
      expect(result.current.pendingMove).toBeNull()
    })
  })

  describe('409 conflict handling on table move', () => {
    it('keeps pendingMove open and sets confirmError on 409', async () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      act(() => {
        result.current.onDragEnd(makeDragEndEvent(makeBookingData(), 'table-b', { tableName: 'Table 2' }, 0))
      })
      expect(result.current.pendingMove?.type).toBe('table')

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'That slot is already taken' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await act(async () => { await result.current.confirm() })

      // Modal stays open
      expect(result.current.pendingMove).not.toBeNull()
      // Error surfaced from response body
      expect(result.current.confirmError).toBe('That slot is already taken')
    })

    it('uses fallback message when 409 body contains no error field', async () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      act(() => {
        result.current.onDragEnd(makeDragEndEvent(makeBookingData(), 'table-b', { tableName: 'Table 2' }, 0))
      })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response('{}', {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await act(async () => { await result.current.confirm() })

      expect(result.current.confirmError).toBe('That slot is no longer available')
    })
  })

  describe('confirmError cleared on next drag start', () => {
    it('onDragStart resets confirmError left from a previous conflict', async () => {
      const ref = createTimelineRef()
      const { result } = renderHook(() => useFohDrag(ref as React.RefObject<HTMLElement | null>))

      // Produce confirmError via 409
      act(() => {
        result.current.onDragEnd(makeDragEndEvent(makeBookingData(), 'table-b', { tableName: 'Table 2' }, 0))
      })

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Conflict' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await act(async () => { await result.current.confirm() })
      expect(result.current.confirmError).toBe('Conflict')

      // Start a new drag — confirmError must be cleared
      act(() => { result.current.onDragStart(makeDragStartEvent(makeBookingData())) })

      expect(result.current.confirmError).toBeNull()
    })
  })
})
