// The create form on the floor iPad (owner decisions, 22 November 2026): the party size never
// carries over from the booking before, "Add booking" keeps the date being looked at, and a
// booking that was made never reads as failed because the refresh after it failed.

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import type { FohScheduleResponse, TimelineRange } from '../types'
import { useFohCreateBooking } from './useFohCreateBooking'

const NOW = new Date('2026-11-21T18:00:00.000Z')

const timeline: TimelineRange = { startMin: 11 * 60 + 30, endMin: 23 * 60 + 30, ticks: [] }

function scheduleFor(date: string): NonNullable<FohScheduleResponse['data']> {
  return {
    date,
    service_window: { start_time: '12:00', end_time: '23:00', end_next_day: false, source: 'test' },
    lanes: [],
    unassigned_bookings: [],
  }
}

type Reload = (opts?: { requestedDate?: string; surfaceError?: boolean }) => Promise<void>

function renderCreateHook(options: { date: string; reloadSchedule?: Reload }) {
  const setErrorMessage = vi.fn()
  const setStatusMessage = vi.fn()
  const reloadSchedule: Reload = options.reloadSchedule ?? vi.fn<Reload>().mockResolvedValue(undefined)
  const hook = renderHook(() =>
    useFohCreateBooking({
      date: options.date,
      clockNow: NOW,
      serviceDateNow: '2026-11-21',
      canEdit: true,
      schedule: scheduleFor(options.date),
      timeline,
      setErrorMessage,
      setStatusMessage,
      reloadSchedule,
    })
  )
  return { ...hook, setErrorMessage, setStatusMessage, reloadSchedule }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/foh/bookings') && init?.method === 'POST') {
      return json({
        success: true,
        data: { state: 'confirmed', table_booking_id: 'booking-9', booking_reference: 'TB-0009', table_name: 'Table 4', next_step_url: null },
      })
    }
    return json({ success: true, data: [] })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('the create form does not carry things over', () => {
  it('opens at a party of two whatever the booking before was', async () => {
    const { result } = renderCreateHook({ date: '2026-11-21' })

    await act(async () => { result.current.openCreateModal({ mode: 'booking' }) })
    act(() => { result.current.setCreateForm((current) => ({ ...current, party_size: '14' })) })
    expect(result.current.createForm.party_size).toBe('14')

    act(() => { result.current.closeCreateModal() })
    expect(result.current.createForm.party_size).toBe('2')

    act(() => { result.current.setCreateForm((current) => ({ ...current, party_size: '9' })) })
    await act(async () => { result.current.openCreateModal({ mode: 'walk_in' }) })

    expect(result.current.createForm.party_size).toBe('2')
    await waitFor(() => expect(result.current.loadingEventOptions).toBe(false))
  })
})

describe('the date a new booking opens on', () => {
  it('keeps a later date that is being looked at', async () => {
    const { result } = renderCreateHook({ date: '2026-11-28' })

    await act(async () => { result.current.openCreateModal({ mode: 'booking' }) })

    expect(result.current.createForm.booking_date).toBe('2026-11-28')
    await waitFor(() => expect(result.current.loadingEventOptions).toBe(false))
  })

  it('opens a walk-in on the day being worked, whatever date is on screen', async () => {
    const { result } = renderCreateHook({ date: '2026-11-28' })

    await act(async () => { result.current.openCreateModal({ mode: 'walk_in' }) })

    expect(result.current.createForm.booking_date).toBe('2026-11-21')
    await waitFor(() => expect(result.current.loadingEventOptions).toBe(false))
  })

  it('falls back to today when the date on screen has gone', async () => {
    const { result } = renderCreateHook({ date: '2026-11-19' })

    await act(async () => { result.current.openCreateModal({ mode: 'booking' }) })

    expect(result.current.createForm.booking_date).toBe('2026-11-21')
    await waitFor(() => expect(result.current.loadingEventOptions).toBe(false))
  })
})

describe('a booking that was made never reads as failed', () => {
  it('reports the booking and closes the form when the refresh afterwards fails', async () => {
    const reloadSchedule = vi.fn<Reload>().mockRejectedValue(new Error('Failed to load Front of House schedule'))
    const { result, setErrorMessage, setStatusMessage } = renderCreateHook({ date: '2026-11-28', reloadSchedule })

    await act(async () => { result.current.openCreateModal({ mode: 'booking' }) })
    act(() => {
      result.current.setCreateForm((current) => ({
        ...current, time: '19:00', party_size: '4', first_name: 'Jo', last_name: 'Bloggs', phone: '07700900123', email: 'jo@example.com',
      }))
    })
    setErrorMessage.mockClear()

    await act(async () => {
      await result.current.handleCreateBooking({ preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>)
    })

    expect(reloadSchedule).toHaveBeenCalledWith({ surfaceError: false })
    expect(setStatusMessage).toHaveBeenLastCalledWith(expect.stringContaining('TB-0009 on Table 4 was created and confirmed.'))
    expect(setErrorMessage.mock.calls.every(([message]) => message === null)).toBe(true)
    expect(result.current.isCreateModalOpen).toBe(false)
  })
})
