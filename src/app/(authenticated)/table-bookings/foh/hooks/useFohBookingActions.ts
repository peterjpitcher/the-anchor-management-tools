'use client'

import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import { toast } from '@/ds'
import type { UndoOffer } from '@/components/features/table-bookings/UndoBar'
import {
  describeGuestNotificationChannel,
  describeGuestNotificationProblem,
  readGuestNotificationOutcome,
} from '@/lib/table-bookings/guest-notification-outcome'
import { describeDepositRefundForStaff, readDepositRefundOutcome } from '@/lib/table-bookings/deposit-refund-outcome'
import { describePartySizeStaffNotice } from '@/lib/table-bookings/party-size-staff-notice'
import type { FohBooking, FohScheduleResponse, SelectedBookingContext } from '../types'
import { BookingActionError, postBookingAction } from '../utils'

/** A message shown inside the open booking panel, where staff are looking. */
export type FohPanelNotice = { tone: 'success' | 'warning' | 'danger'; text: string }

export type FohRunAction = (
  action: () => Promise<unknown>,
  successMessage: string,
  inFlightLabel?: string,
  options?: { undoLabel?: string }
) => Promise<boolean>

type BookingPatch = Partial<FohBooking> & { id: string; cancelled_at?: string | null; updated_at?: string | null }

/** A toast that says something staff must act on stays up long enough to be read mid-service. */
const LONG_TOAST_MS = 12_000

/** The warning for a guest who was not told about a change, or null. */
function describeGuestNotReached(result: unknown): string | null {
  const payload = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  if (!payload) return null

  const cancellation = describeGuestNotificationProblem(
    readGuestNotificationOutcome(payload.guest_notification),
    'about the cancellation'
  )
  if (cancellation) return cancellation

  const transition = payload.depositTransition && typeof payload.depositTransition === 'object'
    ? (payload.depositTransition as Record<string, unknown>)
    : null
  const deposit = describeGuestNotificationProblem(readGuestNotificationOutcome(transition?.notification), 'about the deposit')
  if (deposit) return `${deposit} Copy the deposit link from the booking to send it.`

  // The new party size, when staff changed it and the guest could not be told (BK-091).
  return describeGuestNotificationProblem(readGuestNotificationOutcome(payload.partySizeNotification), 'about the new party size')
}

function buildActionSuccessMessage(successMessage: string, result: unknown): string {
  const payload = result as Record<string, unknown> | null
  const data = payload && typeof payload.data === 'object' && payload.data !== null
    ? payload.data as Record<string, unknown>
    : null

  if (data?.state === 'unchanged') {
    return 'No change was made.'
  }

  const transition = payload && typeof payload.depositTransition === 'object' && payload.depositTransition !== null
    ? payload.depositTransition as Record<string, unknown>
    : null

  if (transition?.state === 'deposit_required') {
    const depositUrl = typeof transition.depositUrl === 'string' ? transition.depositUrl : null
    // The request goes email first and says which channel reached the guest; with no outcome
    // (staff chose not to notify), the plain wording.
    const notification = readGuestNotificationOutcome(transition.notification)
    const sentBy = notification
      ? describeGuestNotificationChannel(notification)
      : transition.smsSent === true
        ? 'by SMS'
        : null
    // A confirmed booking stays confirmed with the deposit owed (D20).
    const staysConfirmed = transition.stillConfirmed === true ? ' The booking stays confirmed.' : ''
    return `${successMessage}. Deposit is now required${sentBy ? ` and the payment link was sent ${sentBy}` : ''}${depositUrl ? `: ${depositUrl}` : '.'}${staysConfirmed}`
  }

  if (transition?.state === 'deposit_cleared') {
    return `${successMessage}. Pending deposit cleared.`
  }

  // An unpaid deposit that followed the new party size (D20), or one not asked for because the
  // party is already at its table.
  if (
    (transition?.state === 'deposit_repriced' || transition?.state === 'deposit_not_required_seated')
    && typeof payload?.depositNote === 'string'
  ) {
    return `${successMessage}. ${payload.depositNote}`
  }

  // The guest was told about the new party size (BK-091).
  const toldBy = describeGuestNotificationChannel(readGuestNotificationOutcome(payload?.partySizeNotification))
  if (toldBy) {
    return `${successMessage}. The guest was told ${toldBy}.`
  }

  return successMessage
}

function readSnapshot(source: Record<string, unknown> | null | undefined): BookingPatch | null {
  const booking = source?.booking
  if (booking && typeof booking === 'object' && typeof (booking as { id?: unknown }).id === 'string') {
    return booking as BookingPatch
  }
  return null
}

/**
 * Every action taken from the booking panel, and its Undo (owner decisions, 22 November 2026).
 *
 *  - What happened is said where staff are looking: inside the open panel, and as a toast on top
 *    of it. The page banner underneath still carries it for when the panel has closed.
 *  - A save that worked never reads as failed. The refresh afterwards is best effort: if it fails
 *    the success still shows, the panel closes as it would have, and the "last updated" warning
 *    is what says the screen is behind.
 *  - Seated, Left and No-show answer with an undo ticket, offered for 10 seconds.
 */
export function useFohBookingActions(input: {
  setSchedule: React.Dispatch<React.SetStateAction<FohScheduleResponse['data'] | null>>
  setSelectedBookingContext: React.Dispatch<React.SetStateAction<SelectedBookingContext | null>>
  reloadSchedule: (opts?: { requestedDate?: string; surfaceError?: boolean }) => Promise<void>
  setErrorMessage: (message: string | null) => void
  setStatusMessage: (message: string | null) => void
  /** Called before each action, to close any open confirm step. */
  onActionStart?: () => void
  /** Called after each action that saved, so the lists beside the timeline look again. */
  onActionSaved?: () => void
}) {
  const {
    setSchedule, setSelectedBookingContext, reloadSchedule, setErrorMessage, setStatusMessage,
    onActionStart, onActionSaved,
  } = input

  const [bookingActionInFlight, setBookingActionInFlight] = useState<string | null>(null)
  const [panelNotice, setPanelNotice] = useState<FohPanelNotice | null>(null)
  // What staff must read after a party-size change (a deposit left for a manager, food choices
  // dropped). Kept on screen until dismissed, never cleared by the next action (BK-043).
  const [staffNotice, setStaffNotice] = useState<string[] | null>(null)
  const [undoOffer, setUndoOffer] = useState<UndoOffer | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const undoCounterRef = useRef(0)

  const applyBookingPatch = useCallback((patch: BookingPatch) => {
    setSchedule((cur) => {
      if (!cur) return cur
      const p = (bs: FohBooking[]) => bs.map((b) => b.id === patch.id ? { ...b, ...patch } : b)
      return {
        ...cur,
        lanes: cur.lanes.map((l) => ({ ...l, bookings: p(l.bookings) })),
        unassigned_bookings: p(cur.unassigned_bookings),
        outside_bookings: cur.outside_bookings ? p(cur.outside_bookings) : cur.outside_bookings,
        no_show_bookings: cur.no_show_bookings ? p(cur.no_show_bookings) : cur.no_show_bookings,
      }
    })
    setSelectedBookingContext((cur) => {
      if (!cur || cur.booking.id !== patch.id) return cur
      return { ...cur, booking: { ...cur.booking, ...patch } }
    })
  }, [setSchedule, setSelectedBookingContext])

  /** Best effort: a failed refresh never turns a saved action into an error. */
  const refreshQuietly = useCallback(async () => {
    try {
      await reloadSchedule({ surfaceError: false })
    } catch {
      // The "last updated" warning tells staff when the screen is behind.
    }
  }, [reloadSchedule])

  const runAction = useCallback<FohRunAction>(async (action, successMessage, inFlightLabel, options) => {
    onActionStart?.()
    setErrorMessage(null); setStatusMessage(null); setPanelNotice(null)
    setBookingActionInFlight(inFlightLabel || successMessage)
    try {
      const result = await action()
      const rp = result as Record<string, unknown> | null
      const snap = readSnapshot(rp)
      if (snap) applyBookingPatch(snap)

      // What happened to the deposit on a cancellation, said to the person who cancelled (BK-114).
      const depositRefund = describeDepositRefundForStaff(readDepositRefundOutcome(rp?.deposit_refund))
      const successText = buildActionSuccessMessage(successMessage, result)
      const fullSuccess = depositRefund?.tone === 'success' ? `${successText} ${depositRefund.message}` : successText
      const notice = describePartySizeStaffNotice(result)
      if (notice.length > 0) setStaffNotice(notice)
      setStatusMessage(fullSuccess)
      setPanelNotice({ tone: 'success', text: fullSuccess })
      toast.success(fullSuccess)

      // The change stands, but staff must know when the guest was not told about it, or a refund
      // did not go. Only the email-first paths report this, so without their flags nothing shows.
      const problems = [
        depositRefund?.tone === 'error' ? depositRefund.message : null,
        describeGuestNotReached(result),
      ].filter((line): line is string => Boolean(line)).join(' ')
      if (problems) {
        setErrorMessage(problems)
        setPanelNotice({ tone: 'warning', text: `${fullSuccess} ${problems}` })
        toast.warning(problems, { duration: LONG_TOAST_MS })
      }

      if (options?.undoLabel && snap && rp?.undo && typeof rp.undo === 'object') {
        undoCounterRef.current += 1
        setUndoOffer({
          id: undoCounterRef.current,
          bookingId: snap.id,
          label: options.undoLabel,
          ticket: rp.undo as Record<string, unknown>,
        })
      }

      onActionSaved?.()
      await refreshQuietly()
      return true
    } catch (error) {
      if (error instanceof BookingActionError) {
        const snap = readSnapshot(error.payload)
        if (snap) applyBookingPatch(snap)
      }
      const message = error instanceof Error ? error.message : 'Action failed'
      setErrorMessage(message)
      setPanelNotice({ tone: 'danger', text: message })
      toast.error(message, { duration: LONG_TOAST_MS })
      return false
    } finally { setBookingActionInFlight(null) }
  }, [applyBookingPatch, onActionSaved, onActionStart, refreshQuietly, setErrorMessage, setStatusMessage])

  const dismissUndo = useCallback(() => setUndoOffer(null), [])

  const runUndo = useCallback(async () => {
    const offer = undoOffer
    if (!offer || undoBusy) return
    setUndoBusy(true)
    setErrorMessage(null); setStatusMessage(null)
    try {
      const result = await postBookingAction(`/api/foh/bookings/${offer.bookingId}/undo`, offer.ticket)
      const snap = readSnapshot(result)
      if (snap) applyBookingPatch(snap)
      const text = `Undone: ${offer.label}.`
      setStatusMessage(text)
      toast.success(text)
      onActionSaved?.()
    } catch (error) {
      // The action stands. Say why, and keep it on screen: a table given to someone else
      // meanwhile is the case that matters.
      const message = error instanceof Error ? error.message : 'Could not undo.'
      setErrorMessage(message)
      setPanelNotice({ tone: 'danger', text: message })
      toast.error(message, { duration: LONG_TOAST_MS })
    } finally {
      setUndoBusy(false)
      setUndoOffer(null)
      await refreshQuietly()
    }
  }, [applyBookingPatch, onActionSaved, refreshQuietly, setErrorMessage, setStatusMessage, undoBusy, undoOffer])

  return {
    bookingActionInFlight, setBookingActionInFlight,
    panelNotice, setPanelNotice,
    staffNotice, setStaffNotice,
    undoOffer, undoBusy, runUndo, dismissUndo,
    runAction, refreshQuietly,
  }
}
