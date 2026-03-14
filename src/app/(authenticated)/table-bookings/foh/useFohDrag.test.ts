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
})
