// What a booking action tells staff, and its Undo (owner decisions, 22 November 2026): errors and
// successes go to the open panel and a toast on top of it, a save that worked never reads as
// failed because the refresh after it failed, and Seated, Left and No-show offer an Undo.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/ds', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../utils', async (importActual) => ({
  ...(await importActual<typeof import('../utils')>()),
  postBookingAction: vi.fn(),
}))

import { toast } from '@/ds'
import { BookingActionError, postBookingAction } from '../utils'
import { useFohBookingActions } from './useFohBookingActions'

const LEFT_TICKET = {
  action: 'left',
  stamp: '2026-11-21T19:30:00.000Z',
  restore: { end_datetime: '2026-11-21T21:00:00.000Z', assignments: [] },
}

function setup(reloadSchedule = vi.fn().mockResolvedValue(undefined)) {
  const setErrorMessage = vi.fn()
  const setStatusMessage = vi.fn()
  const onActionSaved = vi.fn()
  const hook = renderHook(() =>
    useFohBookingActions({
      setSchedule: vi.fn(),
      setSelectedBookingContext: vi.fn(),
      reloadSchedule,
      setErrorMessage,
      setStatusMessage,
      onActionSaved,
    })
  )
  return { ...hook, setErrorMessage, setStatusMessage, onActionSaved, reloadSchedule }
}

beforeEach(() => vi.clearAllMocks())

describe('what an action says', () => {
  it('puts an error in the panel and in a toast on top of it', async () => {
    const { result, setErrorMessage } = setup()

    let ok = true
    await act(async () => {
      ok = await result.current.runAction(
        async () => { throw new BookingActionError('Booking cannot be seated until the required deposit is paid.', null) },
        'Marked as seated',
        'seated'
      )
    })

    expect(ok).toBe(false)
    expect(result.current.panelNotice).toEqual({ tone: 'danger', text: 'Booking cannot be seated until the required deposit is paid.' })
    expect(toast.error).toHaveBeenCalledWith('Booking cannot be seated until the required deposit is paid.', expect.anything())
    expect(setErrorMessage).toHaveBeenLastCalledWith('Booking cannot be seated until the required deposit is paid.')
    expect(result.current.bookingActionInFlight).toBeNull()
  })

  it('still reports success when the refresh afterwards fails', async () => {
    const reloadSchedule = vi.fn().mockRejectedValue(new Error('Failed to load Front of House schedule'))
    const { result, setErrorMessage, setStatusMessage } = setup(reloadSchedule)

    let ok = false
    await act(async () => {
      ok = await result.current.runAction(async () => ({ success: true, booking: { id: 'booking-1', status: 'confirmed' } }), 'Marked as seated', 'seated')
    })

    expect(ok).toBe(true)
    expect(reloadSchedule).toHaveBeenCalledWith({ surfaceError: false })
    expect(setStatusMessage).toHaveBeenLastCalledWith('Marked as seated')
    expect(toast.success).toHaveBeenCalledWith('Marked as seated')
    expect(toast.error).not.toHaveBeenCalled()
    // Only the reset at the start: nothing reported the action as failed.
    expect(setErrorMessage.mock.calls.every(([message]) => message === null)).toBe(true)
  })

  it('keeps the refund note when a cancellation worked and the refresh failed', async () => {
    const reloadSchedule = vi.fn().mockRejectedValue(new Error('offline'))
    const { result, setStatusMessage } = setup(reloadSchedule)

    await act(async () => {
      await result.current.runAction(
        async () => ({
          success: true,
          booking: { id: 'booking-1', status: 'cancelled' },
          guest_notification: { status: 'no_channel', channel: null, fallbackUsed: false, error: 'no_channel_available' },
        }),
        'Booking cancelled',
        'cancel'
      )
    })

    expect(setStatusMessage).toHaveBeenLastCalledWith('Booking cancelled')
    // The guest was not told: that warning survives too.
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(result.current.panelNotice?.tone).toBe('warning')
  })
})

describe('Undo', () => {
  it('offers the undo the action answered with', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.runAction(
        async () => ({ success: true, booking: { id: 'booking-1', status: 'confirmed' }, undo: LEFT_TICKET }),
        'Marked as left',
        'left',
        { undoLabel: 'Jo Bloggs marked as left' }
      )
    })

    expect(result.current.undoOffer).toMatchObject({ bookingId: 'booking-1', label: 'Jo Bloggs marked as left', ticket: LEFT_TICKET })
  })

  it('offers nothing when the action carries no undo', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.runAction(
        async () => ({ success: true, booking: { id: 'booking-1', status: 'confirmed' }, undo: null }),
        'Back at the table',
        'seated',
        { undoLabel: 'Jo Bloggs marked as seated' }
      )
    })

    expect(result.current.undoOffer).toBeNull()
  })

  it('sends the ticket back as it is and then withdraws the offer', async () => {
    vi.mocked(postBookingAction).mockResolvedValue({ success: true, booking: { id: 'booking-1', status: 'confirmed', left_at: null } })
    const { result, setStatusMessage } = setup()
    await act(async () => {
      await result.current.runAction(
        async () => ({ success: true, booking: { id: 'booking-1' }, undo: LEFT_TICKET }),
        'Marked as left', 'left', { undoLabel: 'Jo Bloggs marked as left' }
      )
    })

    await act(async () => { await result.current.runUndo() })

    expect(postBookingAction).toHaveBeenCalledWith('/api/foh/bookings/booking-1/undo', LEFT_TICKET)
    expect(setStatusMessage).toHaveBeenLastCalledWith('Undone: Jo Bloggs marked as left.')
    expect(result.current.undoOffer).toBeNull()
  })

  it('says so, and keeps it on screen, when the table has been taken meanwhile', async () => {
    const taken = 'Could not undo: the table has been given to TB-NEXT since this party was marked as left. The booking is still marked as left. Move one of them first, then seat this party again.'
    vi.mocked(postBookingAction).mockRejectedValue(new BookingActionError(taken, null))
    const { result, setErrorMessage } = setup()
    await act(async () => {
      await result.current.runAction(
        async () => ({ success: true, booking: { id: 'booking-1' }, undo: LEFT_TICKET }),
        'Marked as left', 'left', { undoLabel: 'Jo Bloggs marked as left' }
      )
    })

    await act(async () => { await result.current.runUndo() })

    expect(setErrorMessage).toHaveBeenLastCalledWith(taken)
    expect(result.current.panelNotice).toEqual({ tone: 'danger', text: taken })
    expect(toast.error).toHaveBeenCalledWith(taken, expect.objectContaining({ duration: 12000 }))
    expect(result.current.undoOffer).toBeNull()
  })
})
