'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Fieldset, Input, Modal, PageLoading, Radio, Select, toast } from '@/ds'
import type { EventBookingRow } from '@/app/actions/events'
import {
  addEventBookingGuests,
  changeEventBookingTicketType,
  getEventBookingTicketChangeOptions,
  removeEventBookingGuests,
} from '@/app/actions/events'

type Options = Extract<Awaited<ReturnType<typeof getEventBookingTicketChangeOptions>>, { success: true }>['data']
type Mode = 'remove' | 'add' | 'change'
type Settlement = 'cash' | 'card_terminal' | 'comp' | 'none'

interface ChangeTicketsDialogProps {
  booking: EventBookingRow | null
  onClose: () => void
  onDone: () => Promise<void> | void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function newGuestId(): string {
  return crypto.randomUUID()
}

/**
 * Change tickets on a booking (BK-023, customer bookings review of 24 October 2026): take guests
 * off, add guests, or move tickets to another type. Any member of staff who manages events may do
 * it (owner decision D7). Nothing is refunded here: when money may be owed back, a manager decides
 * the refund from the booking, starting from the price paid. Added or dearer tickets on a
 * paid-in-advance event are paid now at the venue at the full price (D10) or given free with a
 * reason. The guest is emailed an updated confirmation.
 */
export function ChangeTicketsDialog({ booking, onClose, onDone }: ChangeTicketsDialogProps) {
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('remove')
  const [chosenGuests, setChosenGuests] = useState<string[]>([])
  const [typeId, setTypeId] = useState('')
  const [toTypeId, setToTypeId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [newGuests, setNewGuests] = useState<Array<{ id: string; name: string; phone: string }>>([])
  const [settlement, setSettlement] = useState<Settlement>('cash')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setOptions(null)
    setLoadError(null)
    setProblem(null)
    setMode('remove')
    setChosenGuests([])
    setQuantity('1')
    setNewGuests([])
    setNote('')
    if (!booking) return
    let cancelled = false
    setLoading(true)
    getEventBookingTicketChangeOptions(booking.id)
      .then((result) => {
        if (cancelled) return
        if ('error' in result) {
          setLoadError(result.error)
          return
        }
        setOptions(result.data)
        const onBooking = result.data.ticketTypes.find((type) => type.onBooking > 0)
        setTypeId(onBooking?.id ?? result.data.ticketTypes[0]?.id ?? '')
        setToTypeId(result.data.ticketTypes.find((type) => type.id !== onBooking?.id)?.id ?? '')
        setSettlement(result.data.paymentMode === 'prepaid' ? 'cash' : 'none')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [booking])

  const named = (options?.guests.length ?? 0) > 0
  const prepaid = options?.paymentMode === 'prepaid'
  const count = named && mode !== 'add' ? chosenGuests.length : Math.max(0, Number.parseInt(quantity, 10) || 0)
  const typeById = useMemo(() => new Map((options?.ticketTypes ?? []).map((type) => [type.id, type])), [options])

  useEffect(() => {
    if (mode !== 'add' || !named) return
    setNewGuests((current) => {
      const wanted = Math.max(0, Math.min(20, Number.parseInt(quantity, 10) || 0))
      if (current.length === wanted) return current
      if (current.length > wanted) return current.slice(0, wanted)
      return [...current, ...Array.from({ length: wanted - current.length }, () => ({ id: newGuestId(), name: '', phone: '' }))]
    })
  }, [mode, named, quantity])

  // What the change means for money, as the server will work it out.
  const pricePaidForChosen = useMemo(() => {
    if (!options) return 0
    if (named) {
      return chosenGuests.reduce((sum, guestId) => {
        const guest = options.guests.find((g) => g.id === guestId)
        const type = typeById.get(guest?.ticketTypeId ?? '') ?? options.ticketTypes.find((t) => t.onBooking > 0)
        return sum + (type?.pricePaid ?? type?.bookedPrice ?? 0)
      }, 0)
    }
    const type = typeById.get(typeId)
    return count * (type?.pricePaid ?? type?.bookedPrice ?? 0)
  }, [options, named, chosenGuests, typeById, typeId, count])
  const addAmount = (typeById.get(typeId)?.fullPrice ?? 0) * count
  const changeDifference = (typeById.get(toTypeId)?.bookedPrice ?? 0) * count - pricePaidForChosen
  const takesMoney = prepaid && ((mode === 'add') || (mode === 'change' && changeDifference > 0.004))
  const moneyToTake = settlement === 'comp' ? 0 : mode === 'add' ? addAmount : Math.max(0, changeDifference)

  const toggleGuest = (guestId: string, checked: boolean): void => {
    setChosenGuests((current) => (checked ? [...current, guestId] : current.filter((id) => id !== guestId)))
  }

  const handleSave = async (): Promise<void> => {
    if (!booking || !options) return
    setProblem(null)
    if (count < 1) {
      setProblem(named && mode !== 'add' ? 'Choose at least one guest.' : 'Choose how many tickets.')
      return
    }
    if (takesMoney && settlement === 'comp' && !note.trim()) {
      setProblem('Say why the tickets are free.')
      return
    }
    const effectiveSettlement: Settlement = takesMoney ? settlement : 'none'
    const expectedAmount = takesMoney && (settlement === 'cash' || settlement === 'card_terminal')
      ? Math.round(moneyToTake * 100) / 100
      : undefined
    setSaving(true)
    try {
      const result = mode === 'remove'
        ? await removeEventBookingGuests({
            bookingId: booking.id,
            ...(named ? { attendeeIds: chosenGuests } : { ticketTypeId: typeId, quantity: count }),
          })
        : mode === 'add'
          ? await addEventBookingGuests({
              bookingId: booking.id,
              ticketTypeId: typeId,
              quantity: count,
              attendees: named
                ? newGuests.map((guest) => ({ id: guest.id, name: guest.name.trim(), ...(guest.phone.trim() ? { phone: guest.phone.trim() } : {}), ticket_type_id: typeId, answers: {} }))
                : [],
              settlement: effectiveSettlement,
              ...(note.trim() ? { note: note.trim() } : {}),
              ...(expectedAmount !== undefined ? { expectedAmount } : {}),
            })
          : await changeEventBookingTicketType({
              bookingId: booking.id,
              ...(named ? { attendeeIds: chosenGuests } : { fromTicketTypeId: typeId, quantity: count }),
              toTicketTypeId: toTypeId,
              settlement: effectiveSettlement,
              ...(note.trim() ? { note: note.trim() } : {}),
              ...(expectedAmount !== undefined ? { expectedAmount } : {}),
            })
      if ('error' in result) {
        setProblem(result.error)
        return
      }
      const parts = ['Booking updated and the guest emailed.']
      if (result.data.amount_taken > 0) parts.push(`${formatCurrency(result.data.amount_taken)} recorded as taken.`)
      if (result.data.refund_owed > 0) parts.push(`Up to ${formatCurrency(result.data.refund_owed)} is waiting for a manager to decide the refund.`)
      toast.success(parts.join(' '), { duration: result.data.refund_owed > 0 ? 10000 : 5000 })
      await onDone()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const typeOptions = (options?.ticketTypes ?? []).map((type) => ({
    value: type.id,
    label: `${type.name} (${formatCurrency(mode === 'add' && prepaid ? type.fullPrice : type.bookedPrice)})`,
  }))
  const typesOnBooking = (options?.ticketTypes ?? [])
    .filter((type) => type.onBooking > 0)
    .map((type) => ({ value: type.id, label: `${type.name} (${type.onBooking} on this booking)` }))

  return (
    <Modal
      open={booking !== null}
      onClose={onClose}
      title="Change tickets"
      description="Take guests off, add guests, or change a ticket type."
      width="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={!options || saving}>
            {mode === 'remove' ? 'Take off' : mode === 'add' ? 'Add' : 'Change'}
          </Button>
        </div>
      }
    >
      {loading ? (
        <PageLoading inline label="Loading the tickets" className="py-4" />
      ) : loadError ? (
        <Alert tone="danger" size="sm">{loadError}</Alert>
      ) : options ? (
        <div className="space-y-4">
          <Fieldset legend="What to change">
            <Radio name="ticket-change-mode" value="remove" label="Take guests off" checked={mode === 'remove'} onChange={() => { setMode('remove'); setProblem(null) }} />
            <Radio name="ticket-change-mode" value="add" label="Add guests" checked={mode === 'add'} onChange={() => { setMode('add'); setProblem(null) }} />
            {options.ticketTypes.length > 1 && (
              <Radio name="ticket-change-mode" value="change" label="Change ticket type" checked={mode === 'change'} onChange={() => { setMode('change'); setProblem(null) }} />
            )}
          </Fieldset>

          {mode !== 'add' && named && (
            <Fieldset legend={mode === 'remove' ? 'Guests to take off' : 'Guests to change'}>
              {options.guests.map((guest, index) => (
                <Checkbox
                  key={guest.id}
                  label={`${guest.name || `Guest ${index + 1}`} (${typeById.get(guest.ticketTypeId ?? '')?.name ?? 'ticket'})`}
                  checked={chosenGuests.includes(guest.id)}
                  onChange={(checked) => toggleGuest(guest.id, checked)}
                />
              ))}
            </Fieldset>
          )}

          {(mode === 'add' || !named) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label={mode === 'add' ? 'Ticket type' : 'Tickets of type'}
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
                options={mode === 'add' ? typeOptions : typesOnBooking}
              />
              <Input label="How many" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/\D/g, '').slice(0, 2))} />
            </div>
          )}

          {mode === 'change' && (
            <Select
              label="Change to"
              value={toTypeId}
              onChange={(event) => setToTypeId(event.target.value)}
              options={typeOptions}
            />
          )}

          {mode === 'add' && named && newGuests.length > 0 && (
            <Fieldset legend="New guests" hint="A name, a phone and their answers can follow later.">
              {newGuests.map((guest, index) => (
                <div key={guest.id} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    label={`Guest ${options.guests.length + index + 1} name`}
                    value={guest.name}
                    maxLength={120}
                    onChange={(event) => setNewGuests((current) => current.map((g) => (g.id === guest.id ? { ...g, name: event.target.value } : g)))}
                  />
                  <Input
                    label="Mobile (optional)"
                    type="tel"
                    value={guest.phone}
                    onChange={(event) => setNewGuests((current) => current.map((g) => (g.id === guest.id ? { ...g, phone: event.target.value } : g)))}
                  />
                </div>
              ))}
            </Fieldset>
          )}

          {mode === 'remove' && count > 0 && (
            <p className="text-sm text-text">
              {pricePaidForChosen > 0
                ? `These tickets were sold at ${formatCurrency(pricePaidForChosen)}. Nothing is refunded now: a manager decides the refund from the booking.`
                : 'Nothing was paid for these tickets, so there is no refund to decide.'}
            </p>
          )}
          {mode === 'change' && count > 0 && Math.abs(changeDifference) > 0.004 && (
            <p className="text-sm text-text">
              {changeDifference < 0
                ? `The new type costs ${formatCurrency(-changeDifference)} less. A manager decides the refund from the booking.`
                : `The new type costs ${formatCurrency(changeDifference)} more.`}
            </p>
          )}

          {takesMoney && count > 0 && (
            <Fieldset legend={`Take ${formatCurrency(mode === 'add' ? addAmount : Math.max(0, changeDifference))} now`} hint={mode === 'add' ? 'Tickets paid at the venue are the full price; the online discount is for paying online in advance.' : undefined}>
              <Radio name="ticket-change-settlement" value="cash" label="Cash" checked={settlement === 'cash'} onChange={() => setSettlement('cash')} />
              <Radio name="ticket-change-settlement" value="card_terminal" label="Card terminal" checked={settlement === 'card_terminal'} onChange={() => setSettlement('card_terminal')} />
              <Radio name="ticket-change-settlement" value="comp" label="Free (say why)" checked={settlement === 'comp'} onChange={() => setSettlement('comp')} />
            </Fieldset>
          )}
          {takesMoney && settlement === 'comp' && (
            <Input label="Why are they free?" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          )}

          {problem && <Alert tone="danger" size="sm">{problem}</Alert>}
        </div>
      ) : null}
    </Modal>
  )
}
