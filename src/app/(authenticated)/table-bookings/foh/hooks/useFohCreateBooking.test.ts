import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FohScheduleResponse, TimelineRange } from '../types'
import { describeHighChairs, useFohCreateBooking } from './useFohCreateBooking'
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

describe('useFohCreateBooking high chairs, outside and step-free', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubBookingFetch(responseData: Record<string, unknown>) {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === '/api/foh/bookings') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: {
            state: 'confirmed',
            table_booking_id: 'tb-1',
            booking_reference: 'TB-TEST1',
            reason: null,
            blocked_reason: null,
            next_step_url: null,
            hold_expires_at: null,
            table_name: null,
            ...responseData,
          },
        }), { status: 201, headers: { 'content-type': 'application/json' } }))
      }
      if (url.startsWith('/api/foh/periods')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { period: null } }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
    }))
    return calls
  }

  async function submitBooking(form: Record<string, unknown>) {
    const setStatusMessage = vi.fn()
    const { result } = renderHook(() =>
      useFohCreateBooking({
        date: '2026-05-23',
        clockNow: new Date('2026-05-23T10:00:00.000Z'),
        canEdit: true,
        schedule,
        timeline,
        setErrorMessage: vi.fn(),
        setStatusMessage,
        reloadSchedule: vi.fn().mockResolvedValue(undefined),
      })
    )
    await act(async () => {
      result.current.openCreateModal({ mode: 'booking' })
    })
    await waitFor(() => expect(result.current.loadingEventOptions).toBe(false))
    await act(async () => {
      result.current.setCreateForm((current) => ({
        ...current,
        time: '13:00',
        party_size: '4',
        purpose: 'food',
        phone: '07700900123',
        first_name: 'Sam',
        ...form,
      }))
    })
    await act(async () => {
      await result.current.handleCreateBooking({ preventDefault: vi.fn() } as never)
    })
    return { result, setStatusMessage }
  }

  function bookingBody(calls: { url: string; init?: RequestInit }[]) {
    const call = calls.find((c) => c.url === '/api/foh/bookings')
    return JSON.parse(String(call?.init?.body))
  }

  it('starts every new booking with no high chairs, indoors and no step-free need', async () => {
    stubBookingFetch({})
    const { result } = renderCreateBookingHook(new Date('2026-05-23T10:00:00.000Z'))
    await act(async () => {
      result.current.openCreateModal({ mode: 'booking' })
    })
    expect(result.current.createForm).toMatchObject({
      high_chair_count: '0',
      outside_seating: false,
      requires_accessible_table: false,
    })
    await waitFor(() => expect(result.current.loadingEventOptions).toBe(false))
  })

  it('sends high chairs, outside seating and step-free to the booking API', async () => {
    const calls = stubBookingFetch({ high_chairs_granted: 2 })
    await submitBooking({ high_chair_count: '2', requires_accessible_table: true })
    expect(bookingBody(calls)).toMatchObject({ high_chair_count: 2, requires_accessible_table: true })
    expect(bookingBody(calls).outside_seating).toBeUndefined()
  })

  it('sends an outside booking without the step-free flag, which is for indoor tables', async () => {
    const calls = stubBookingFetch({ is_outside_seating: true })
    const { setStatusMessage } = await submitBooking({ outside_seating: true, requires_accessible_table: true })
    expect(bookingBody(calls)).toMatchObject({ outside_seating: true })
    expect(bookingBody(calls).requires_accessible_table).toBeUndefined()
    expect(setStatusMessage).toHaveBeenLastCalledWith(expect.stringContaining('at an outside table'))
  })

  it('sends nothing extra for a plain booking', async () => {
    const calls = stubBookingFetch({})
    await submitBooking({})
    const body = bookingBody(calls)
    expect(body.high_chair_count).toBeUndefined()
    expect(body.outside_seating).toBeUndefined()
    expect(body.requires_accessible_table).toBeUndefined()
  })

  it('tells staff when fewer high chairs were free than they asked for', async () => {
    stubBookingFetch({ high_chairs_granted: 1 })
    const { setStatusMessage } = await submitBooking({ high_chair_count: '2' })
    expect(setStatusMessage).toHaveBeenLastCalledWith(
      expect.stringContaining('Only 1 high chair free at that time, so 1 reserved instead of 2.')
    )
  })
})

describe('describeHighChairs', () => {
  it('says nothing when none were asked for', () => {
    expect(describeHighChairs(0, 0)).toBe('')
  })

  it('confirms the chairs when all were granted', () => {
    expect(describeHighChairs(2, 2)).toBe(' 2 high chairs reserved.')
    expect(describeHighChairs(1, 1)).toBe(' 1 high chair reserved.')
  })

  it('says when none were free', () => {
    expect(describeHighChairs(2, 0)).toBe(' No high chairs were free at that time, so none are reserved.')
  })
})
