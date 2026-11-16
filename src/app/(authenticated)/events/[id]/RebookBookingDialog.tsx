'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Fieldset, Input, Modal, PageLoading, Radio, toast } from '@/ds'
import { getEventRebookPreview, rebookLapsedEventBooking, type EventRebookPreview } from '@/app/actions/event-rebook'
import { REBOOK_MAX_TICKETS, type RebookPaymentChoice } from '@/lib/events/rebook'
import { describeManualBookingOutcome, type ManualBookingOutcome } from './manual-booking-helpers'

interface RebookBookingDialogProps {
  /** The lapsed booking to start again; null when closed. */
  bookingId: string | null
  onClose: () => void
  onDone: () => Promise<void> | void
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/**
 * Rebook a booking whose payment hold ran out (owner request, 9 November 2026): choose the number
 * of tickets (and which guests, when there are more guests than tickets), then send a payment link
 * or take cash or card at the bar now. The guests' names, mobiles and answers carry across.
 */
export function RebookBookingDialog({ bookingId, onClose, onDone }: RebookBookingDialogProps): React.ReactElement {
  const [preview, setPreview] = useState<EventRebookPreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ticketsText, setTicketsText] = useState('')
  const [keep, setKeep] = useState<string[]>([])
  const [payment, setPayment] = useState<RebookPaymentChoice>('link')
  // A rebook at the bar takes the online price unless staff untick it (owner, 14 November 2026):
  // the guest was booked online, so the door price is the exception here.
  const [giveOnlinePrice, setGiveOnlinePrice] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // A sent link stays on screen to read out or copy, as Add Booking does (BK-033).
  const [outcome, setOutcome] = useState<ManualBookingOutcome | null>(null)

  useEffect(() => {
    setPreview(null)
    setLoadError(null)
    setSubmitError(null)
    setOutcome(null)
    setPayment('link')
    setGiveOnlinePrice(true)
    if (!bookingId) return
    let cancelled = false
    getEventRebookPreview(bookingId)
      .then((result) => {
        if (cancelled) return
        if ('error' in result) {
          setLoadError(result.error)
          return
        }
        setPreview(result.data)
        setTicketsText(String(result.data.seats))
        setKeep(result.data.guests.slice(0, result.data.seats).map((guest) => guest.id))
        if (!result.data.linkGoesBy) setPayment('cash')
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the booking. Try again.')
      })
    return () => {
      cancelled = true
    }
  }, [bookingId])

  const tickets = useMemo(() => {
    const value = Number(ticketsText)
    return Number.isInteger(value) && value >= 1 && value <= REBOOK_MAX_TICKETS ? value : null
  }, [ticketsText])
  const guests = preview?.guests ?? []
  const choosingGuests = tickets !== null && guests.length > tickets
  const onlineOffered = payment !== 'link' && preview?.onlineUnitPrice != null
  const useOnlinePrice = onlineOffered && giveOnlinePrice
  const unitPrice = preview ? (useOnlinePrice ? preview.onlineUnitPrice ?? preview.doorUnitPrice : preview.doorUnitPrice) : null
  const amount = unitPrice !== null && tickets !== null ? Number((unitPrice * tickets).toFixed(2)) : null

  const ticketsError = ticketsText.trim() === '' || tickets !== null ? undefined : `Enter a number from 1 to ${REBOOK_MAX_TICKETS}.`
  const guestsError = choosingGuests && keep.length > (tickets ?? 0)
    ? `Untick ${keep.length - (tickets ?? 0)} ${keep.length - (tickets ?? 0) === 1 ? 'guest' : 'guests'}: there ${tickets === 1 ? 'is 1 ticket' : `are ${tickets} tickets`}.`
    : undefined
  const canSubmit = Boolean(preview && !preview.refusal && tickets !== null && !guestsError && !submitting && !outcome)

  const toggleGuest = (guestId: string, checked: boolean): void => {
    setKeep((current) => (checked ? [...current, guestId] : current.filter((id) => id !== guestId)))
  }

  const handleSubmit = async (): Promise<void> => {
    if (!preview || tickets === null) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await rebookLapsedEventBooking({
        bookingId: preview.bookingId,
        seats: tickets,
        keepGuestIds: choosingGuests ? keep : undefined,
        payment,
        confirmedAmount: payment === 'link' ? undefined : amount ?? undefined,
        ...(payment === 'link' ? {} : { price: useOnlinePrice ? 'online' as const : 'door' as const }),
      })
      if ('error' in result) {
        setSubmitError(result.error)
        return
      }
      await onDone()
      if (result.data.payment_error) {
        // The booking stands, so the list refreshes; the dialog says what still needs doing.
        setSubmitError(result.data.payment_error)
        setOutcome({ tone: 'warning', message: 'Rebooked. The payment still needs recording.', links: [] })
        return
      }
      if (result.data.needs_review) {
        // The money is recorded but the booking is not confirmed: say so rather than close on success.
        setOutcome({ tone: 'warning', message: result.data.needs_review, links: [] })
        return
      }
      if (payment === 'link') {
        setOutcome(describeManualBookingOutcome({
          state: result.data.state,
          next_step_url: result.data.next_step_url,
          manage_booking_url: result.data.manage_booking_url,
          details_to_follow: result.data.details_to_follow,
        }))
        toast.success(`Rebooked. Payment link sent by ${preview.linkGoesBy ?? 'text'}.`)
        return
      }
      toast.success(`Rebooked and ${formatMoney(amount ?? 0)} ${payment === 'cash' ? 'cash' : 'card'} recorded.`)
      onClose()
    } catch {
      setSubmitError('The booking could not be made. Check the list before trying again.')
    } finally {
      setSubmitting(false)
    }
  }

  const linkLabel = preview?.linkGoesBy === 'email'
    ? 'By email, as for any phone booking. Their places are held while they pay.'
    : preview?.linkGoesBy === 'text'
      ? 'By text, as there is no email for this guest. Their places are held while they pay.'
      : 'This guest has no mobile number or email, so a link cannot be sent.'

  const submitLabel = payment === 'link'
    ? 'Rebook and Send Link'
    : amount !== null
      ? `Rebook and Record ${formatMoney(amount)}`
      : 'Rebook'

  return (
    <Modal
      open={bookingId !== null}
      onClose={onClose}
      title={preview ? `Rebook ${preview.customerName}` : 'Rebook'}
      description="Their payment hold ran out. This makes a new booking with the same guest details."
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {outcome ? 'Close' : 'Cancel'}
          </Button>
          {!outcome && (
            <Button variant="primary" onClick={() => void handleSubmit()} disabled={!canSubmit} loading={submitting}>
              {submitLabel}
            </Button>
          )}
        </div>
      }
    >
      {loadError ? (
        <Alert tone="danger" size="sm">{loadError}</Alert>
      ) : !preview ? (
        <PageLoading inline label="Loading the booking" className="py-4" />
      ) : preview.refusal ? (
        <Alert tone="warning" size="sm">{preview.refusal}</Alert>
      ) : (
        <div className="space-y-4">
          <Input
            label="Tickets"
            inputMode="numeric"
            value={ticketsText}
            onChange={(event) => setTicketsText(event.target.value.replace(/\D/g, ''))}
            hint={`The lapsed booking was for ${preview.seats === 1 ? '1 ticket' : `${preview.seats} tickets`}.`}
            error={ticketsError}
            disabled={submitting || Boolean(outcome)}
          />

          {choosingGuests ? (
            <Fieldset legend="Who is coming?" hint="Their names and answers carry across." error={guestsError}>
              <div className="space-y-2">
                {guests.map((guest) => (
                  <Checkbox
                    key={guest.id}
                    label={guest.name}
                    checked={keep.includes(guest.id)}
                    onChange={(checked) => toggleGuest(guest.id, checked)}
                    disabled={submitting || Boolean(outcome)}
                  />
                ))}
              </div>
            </Fieldset>
          ) : guests.length > 0 ? (
            <p className="text-sm text-text-muted">
              Guest details carry across: {guests.map((guest) => guest.name).join(', ')}.
              {tickets !== null && tickets > guests.length ? ' Details for the extra tickets can follow.' : ''}
            </p>
          ) : null}

          <Fieldset legend="Payment">
            <div className="space-y-3">
              <Radio
                name="rebook-payment"
                value="link"
                label="Send a payment link"
                description={linkLabel}
                checked={payment === 'link'}
                onChange={() => setPayment('link')}
                disabled={!preview.linkGoesBy || submitting || Boolean(outcome)}
              />
              <Radio
                name="rebook-payment"
                value="cash"
                label="Cash at the bar now"
                description="No link is sent. The guest gets their confirmation."
                checked={payment === 'cash'}
                onChange={() => setPayment('cash')}
                disabled={submitting || Boolean(outcome)}
              />
              <Radio
                name="rebook-payment"
                value="card_terminal"
                label="Card at the bar now"
                description="No link is sent. The guest gets their confirmation."
                checked={payment === 'card_terminal'}
                onChange={() => setPayment('card_terminal')}
                disabled={submitting || Boolean(outcome)}
              />
            </div>
          </Fieldset>

          {onlineOffered && preview.onlineUnitPrice != null && (
            <Checkbox
              label={`Give the online price: ${formatMoney(preview.onlineUnitPrice)} a ticket instead of ${formatMoney(preview.doorUnitPrice)}`}
              description="Ticked by default for a rebook. Untick to take the door price. This is noted on the payment."
              checked={giveOnlinePrice}
              onChange={setGiveOnlinePrice}
              disabled={submitting || Boolean(outcome)}
            />
          )}

          {payment !== 'link' && amount !== null && unitPrice !== null && (
            <Alert tone="info" size="sm">
              Take {formatMoney(amount)}: {tickets === 1 ? '1 ticket' : `${tickets} tickets`} at {formatMoney(unitPrice)}, the {useOnlinePrice ? 'online' : 'door'} price.
            </Alert>
          )}

          {submitError && <Alert tone="danger" size="sm">{submitError}</Alert>}

          {outcome && (
            <Alert tone={outcome.tone} size="sm">
              <p>{outcome.message}</p>
              {outcome.links.map((link) => (
                <p key={link.label} className="mt-1 break-all">
                  {link.label}: <a className="underline" href={link.url} target="_blank" rel="noreferrer">{link.url}</a>{' '}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(link.url).then(
                        () => toast.success(`${link.label} copied`),
                        () => toast.error('Could not copy the link'),
                      )
                    }}
                  >
                    Copy
                  </Button>
                </p>
              ))}
            </Alert>
          )}
        </div>
      )}
    </Modal>
  )
}
