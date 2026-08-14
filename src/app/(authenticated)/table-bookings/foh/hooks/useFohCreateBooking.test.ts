import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FohScheduleResponse, TimelineRange } from '../types'
import { useFohCreateBooking } from './useFohCreateBooking'
import {
  FOH_BOOKING_CLIENT_CONTRACT,
  FOH_BOOKING_CLIENT_HEADER,
} from '@/lib/foh/booking-client-contract'

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

describe('useFohCreateBooking customer identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the selected customer and current client contract for an event walk-in', async () => {
    let eventBookingRequest: RequestInit | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/foh/event-bookings')) {
        eventBookingRequest = init
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            state: 'confirmed',
            booking_id: 'booking-1',
            reason: null,
            seats_remaining: 20,
            next_step_url: null,
            manage_booking_url: null,
            event_name: 'Test event',
            payment_mode: 'free',
            booking_mode: 'table',
            event_seating_type: 'seated',
            seated_remaining: null,
            standing_remaining: null,
            total_remaining: 20,
            table_booking_id: 'table-booking-1',
            table_name: 'Low 4a',
          },
        }), { status: 201, headers: { 'content-type': 'application/json' } }))
      }
      if (url.startsWith('/api/foh/periods')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { period: null } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: [{
          id: 'event-1',
          name: 'Test event',
          date: '2026-05-23',
          time: '19:30',
          start_datetime: '2026-05-23T18:30:00.000Z',
          end_datetime: '2026-05-23T21:30:00.000Z',
          payment_mode: 'free',
          price_per_seat: null,
          capacity: 100,
          seats_remaining: 100,
          is_full: false,
          booking_mode: 'table',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }))

    const { result } = renderCreateBookingHook(new Date('2026-05-23T18:00:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({ mode: 'walk_in' })
    })
    await waitFor(() => expect(result.current.loadingEventOptions).toBe(false))

    await act(async () => {
      result.current.setWalkInPurposeAutoSelectionEnabled(false)
    })

    await act(async () => {
      result.current.setSelectedCustomer({
        id: 'customer-1',
        first_name: 'Jane',
        last_name: 'Smith',
        full_name: 'Jane Smith',
        mobile_number: null,
        mobile_e164: null,
        display_phone: null,
      })
      result.current.setCreateForm((current) => ({
        ...current,
        purpose: 'event',
        event_id: 'event-1',
        party_size: '3',
      }))
    })

    expect(result.current.createMode).toBe('walk_in')
    expect(result.current.createForm).toMatchObject({
      purpose: 'event',
      event_id: 'event-1',
      party_size: '3',
    })
    expect(result.current.selectedCustomer?.id).toBe('customer-1')

    await act(async () => {
      await result.current.handleCreateBooking({ preventDefault: vi.fn() } as never)
    })

    expect(eventBookingRequest).toBeDefined()
    expect(new Headers(eventBookingRequest?.headers).get(FOH_BOOKING_CLIENT_HEADER))
      .toBe(FOH_BOOKING_CLIENT_CONTRACT)
    expect(JSON.parse(String(eventBookingRequest?.body))).toMatchObject({
      customer_mode: 'selected',
      customer_id: 'customer-1',
      walk_in: true,
      event_id: 'event-1',
      seats: 3,
    })
  })
})

/**
 * The seasonal question on the staff side.
 *
 * Staff could only ever create a seasonal booking through the `christmas`
 * purpose, so Mother's Day, Easter and Father's Day were unusable by staff even
 * once configured: the API accepted the period fields but no screen sent them.
 */
describe('useFohCreateBooking seasonal periods', () => {
  function stubFetchWithPeriod(period: Record<string, unknown> | null) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/foh/periods')) {
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data: { date: '2026-05-23', period } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        )
      })
    )
  }

  const mothersDay = {
    id: '11111111-2222-3333-4444-555555555555',
    code: 'mothers_day',
    period_kind: 'mothers_day',
    name: "Mother's Day",
    guest_question: "Is this a Mother's Day booking?",
    guest_blurb: null,
    requires_preorder: false,
    min_party_size: null,
    max_party_size: null,
    bookable: true,
    not_bookable_reason: null,
    not_bookable_message: null,
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces a non-Christmas period and keeps the answer unset until staff choose', async () => {
    stubFetchWithPeriod(mothersDay)
    const { result } = renderCreateBookingHook(new Date('2026-05-23T10:00:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({ mode: 'booking' })
    })

    await waitFor(() => expect(result.current.seasonalPeriod?.code).toBe('mothers_day'))
    expect(result.current.seasonalAnswer).toBeNull()

    await act(async () => {
      result.current.setSeasonalAnswer(true)
    })
    expect(result.current.seasonalAnswer).toBe(true)
  })

  it('keeps a NO answer rather than treating it as unanswered', async () => {
    stubFetchWithPeriod(mothersDay)
    const { result } = renderCreateBookingHook(new Date('2026-05-23T10:00:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({ mode: 'booking' })
    })
    await waitFor(() => expect(result.current.seasonalPeriod).not.toBeNull())

    await act(async () => {
      result.current.setSeasonalAnswer(false)
    })
    // `false` is a real answer: the normal menu at normal terms. Treating it as
    // "not answered yet" would block the booking staff are trying to take.
    expect(result.current.seasonalAnswer).toBe(false)
  })

  it('never asks about a Christmas period, which travels as a purpose', async () => {
    stubFetchWithPeriod({ ...mothersDay, code: 'christmas', period_kind: 'christmas', name: 'Christmas' })
    const { result } = renderCreateBookingHook(new Date('2026-05-23T10:00:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({ mode: 'booking' })
    })

    // Two controls for one decision is two ways to disagree. The existing
    // christmas purpose already posts a Christmas booking.
    await waitFor(() => expect(result.current.isCreateModalOpen).toBe(true))
    expect(result.current.seasonalPeriod).toBeNull()
  })

  it('treats a failed period lookup as no period rather than blocking the booking', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { result } = renderCreateBookingHook(new Date('2026-05-23T10:00:00.000Z'))

    await act(async () => {
      result.current.openCreateModal({ mode: 'booking' })
    })

    await waitFor(() => expect(result.current.isCreateModalOpen).toBe(true))
    expect(result.current.seasonalPeriod).toBeNull()
  })
})
