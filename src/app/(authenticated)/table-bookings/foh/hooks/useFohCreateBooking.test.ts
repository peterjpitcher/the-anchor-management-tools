import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FohScheduleResponse, TimelineRange } from '../types'
import { useFohCreateBooking } from './useFohCreateBooking'

const schedule: NonNullable<FohScheduleResponse['data']> = {
  date: '2026-05-23',
  service_window: {
    start_time: '09:00',
    end_time: '23:00',
    end_next_day: false,
    kitchen_start_time: '12:00',
    kitchen_end_time: '21:00',
    kitchen_end_next_day: false,
    kitchen_closed: false,
    source: 'test',
  },
  lanes: [],
  unassigned_bookings: [],
}

const timeline: TimelineRange = {
  startMin: 8 * 60 + 30,
  endMin: 23 * 60 + 30,
  ticks: [],
}

function renderCreateBookingHook(clockNow: Date) {
  return renderHook(() =>
    useFohCreateBooking({
      date: '2026-05-23',
      clockNow,
      canEdit: true,
      schedule,
      timeline,
      setErrorMessage: vi.fn(),
      setStatusMessage: vi.fn(),
      reloadSchedule: vi.fn().mockResolvedValue(undefined),
    })
  )
}

describe('useFohCreateBooking defaults', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          data: [
            {
              id: 'event-1',
              name: 'Test event',
              date: '2026-06-01',
              time: '19:30',
              start_datetime: '2026-06-01T18:30:00.000Z',
              end_datetime: '2026-06-01T21:30:00.000Z',
              payment_mode: 'free',
              price_per_seat: null,
              capacity: 100,
              seats_remaining: 100,
              is_full: false,
              booking_mode: 'table',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults a new walk-in to the current London date and next valid minute', async () => {
    const { result } = renderCreateBookingHook(new Date('2026-05-24T13:34:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({ mode: 'walk_in' })
    })

    expect(result.current.createMode).toBe('walk_in')
    expect(result.current.createForm.booking_date).toBe('2026-05-24')
    expect(result.current.createForm.time).toBe('14:35')
    expect(result.current.createForm.party_size).toBe('2')

    await waitFor(() => {
      expect(result.current.loadingEventOptions).toBe(false)
    })
  })

  it('defaults a fresh table booking to the current London date and next valid minute', async () => {
    const { result } = renderCreateBookingHook(new Date('2026-05-24T13:34:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({ mode: 'booking' })
    })

    expect(result.current.createMode).toBe('booking')
    expect(result.current.createForm.booking_date).toBe('2026-05-24')
    expect(result.current.createForm.time).toBe('14:35')
    expect(result.current.createForm.purpose).toBe('food')

    await waitFor(() => {
      expect(result.current.loadingEventOptions).toBe(false)
    })
  })

  it('keeps explicit event prefills instead of replacing them with now', async () => {
    const { result } = renderCreateBookingHook(new Date('2026-05-24T13:34:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({
        mode: 'booking',
        prefill: {
          booking_date: '2026-06-01',
          purpose: 'event',
          event_id: 'event-1',
        },
      })
    })

    expect(result.current.createForm.booking_date).toBe('2026-06-01')
    expect(result.current.createForm.time).toBe('19:00')
    expect(result.current.createForm.purpose).toBe('event')
    expect(result.current.createForm.event_id).toBe('event-1')

    await waitFor(() => {
      expect(result.current.loadingEventOptions).toBe(false)
    })
  })
})
