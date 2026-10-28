'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { Alert, Button, Card, CardBody, CardHeader, Field, Fieldset, FormFooter, Input, Select, toast } from '@/ds'
import { Icon } from '@/ds/icons'
import type { Event } from '@/types/database'
import { createEventManualBooking } from '@/app/actions/events'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { StaffMarketingConsentField } from '@/components/features/shared/StaffMarketingConsentField'
import { resolveTicketTypeSellPrice, type EventTicketTypeRow } from '@/lib/events/ticket-types'
import { requiresGuestDetails } from '@/lib/events/booking-questions'
import {
  StaffGuestDetailsFields,
  resizeStaffGuestRows,
  staffGuestRowsForSubmit,
  type StaffGuestRow,
} from '@/components/features/events/StaffGuestDetailsFields'
import {
  MAX_MANUAL_BOOKING_SEATS,
  describeManualBookingOutcome,
  summariseTicketBasket,
  validateSeatsInput,
  type BasketTypeOption,
  type ManualBookingOutcome,
} from './manual-booking-helpers'

interface AddManualBookingFormProps {
  event: Event
  /** Active + inactive ticket types for the event (basket uses active only). */
  ticketTypes: EventTicketTypeRow[]
  /** True when the event supports ticket types (flag on, not communal/mixed). */
  basketEligible: boolean
  onCreated: () => Promise<void> | void
}

interface FormErrors {
  phone?: string
  firstName?: string
  email?: string
  seats?: string
  basket?: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function formatBlockedReason(reason: string | null): string {
  if (reason === 'customer_conflict') {
    return 'This customer already has an active booking for this event.'
  }
  if (!reason) return 'Booking could not be created.'
  return reason.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

const NO_TICKETS_ERROR = 'Choose at least one ticket.'

export function AddManualBookingForm({
  event,
  ticketTypes,
  basketEligible,
  onCreated,
}: AddManualBookingFormProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [seats, setSeats] = useState('')
  const [seatingPreference, setSeatingPreference] = useState<'seated' | 'standing'>('seated')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [email, setEmail] = useState('')
  const [guestRows, setGuestRows] = useState<StaffGuestRow[]>([])
  // What the last submit did, kept on screen until the next one (BK-033): a full event keeps the
  // form filled in, and a held booking shows its payment link to read out or copy.
  const [outcome, setOutcome] = useState<ManualBookingOutcome | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  // Staff read the guest the marketing notice and they said yes (owner decision D32).
  const [marketingYes, setMarketingYes] = useState(false)
  const [isPending, startTransition] = useTransition()

  const basketTypes = useMemo<BasketTypeOption[]>(
    () =>
      ticketTypes
        .filter((type) => type.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((type) => ({
          id: type.id,
          name: type.name,
          price: resolveTicketTypeSellPrice(Number(type.base_price), event),
        })),
    [ticketTypes, event],
  )

  // FF-002: per-type basket replaces the single seats input only when the event
  // genuinely offers a choice (>1 active type).
  const useBasket = basketEligible && basketTypes.length > 1

  const basketSummary = useMemo(
    () => summariseTicketBasket(basketTypes, quantities),
    [basketTypes, quantities],
  )

  // "Choose at least one ticket" only appears after a submit attempt; range and
  // format problems show live so out-of-range input is never silently accepted.
  const liveBasketError =
    basketSummary.error && basketSummary.error !== NO_TICKETS_ERROR ? basketSummary.error : null
  const basketErrorToShow = errors.basket ?? liveBasketError
  const totalSeats = basketSummary.error === null ? basketSummary.totalSeats : 0

  const setQuantity = useCallback((typeId: string, value: string) => {
    setQuantities((prev) => ({ ...prev, [typeId]: value.replace(/\D/g, '') }))
    setErrors((prev) => ({ ...prev, basket: undefined }))
  }, [])

  const adjustQuantity = useCallback((typeId: string, delta: number) => {
    setQuantities((prev) => {
      const current = Number((prev[typeId] ?? '').trim() || 0)
      const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta)
      return { ...prev, [typeId]: next === 0 ? '' : String(next) }
    })
    setErrors((prev) => ({ ...prev, basket: undefined }))
  }, [])

  // One guest card per ticket (BK-011): the basket total, or the seats typed (blank is one).
  const questions = useMemo(() => event.booking_questions ?? [], [event.booking_questions])
  const guestDetailsRequired = requiresGuestDetails(event)
  const plainSeats = seats.trim() === '' ? 1 : validateSeatsInput(seats).seats ?? 0
  const ticketCount = useBasket ? totalSeats : plainSeats
  const visibleGuestRows = useMemo(
    () => (ticketCount > 0 && ticketCount <= MAX_MANUAL_BOOKING_SEATS ? resizeStaffGuestRows(guestRows, ticketCount) : []),
    [guestRows, ticketCount],
  )

  const resetForm = useCallback(() => {
    setSelectedCustomerId(null)
    setPhone('')
    setFirstName('')
    setLastName('')
    setSeats('')
    setSeatingPreference('seated')
    setQuantities({})
    setEmail('')
    setGuestRows([])
    setErrors({})
    setMarketingYes(false)
  }, [])

  const handleSubmit = useCallback(() => {
    const nextErrors: FormErrors = {}

    if (!selectedCustomerId) {
      if (!phone.trim()) nextErrors.phone = 'Enter a phone number.'
      if (!firstName.trim()) nextErrors.firstName = 'Enter a first name.'
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = 'Enter a valid email address.'

    let seatsToBook = 0
    let ticketSelections: Array<{ ticketTypeId: string; quantity: number }> | undefined

    if (useBasket) {
      if (basketSummary.error) {
        nextErrors.basket = basketSummary.error
      } else {
        seatsToBook = basketSummary.totalSeats
        ticketSelections = basketSummary.lines.map((line) => ({
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
        }))
      }
    } else {
      // Blank keeps the long-standing default of one seat; anything typed must
      // be a whole number in range (no silent clamping).
      const seatsCheck = seats.trim() === '' ? { seats: 1, error: null } : validateSeatsInput(seats)
      if (seatsCheck.error || seatsCheck.seats === null) {
        nextErrors.seats = seatsCheck.error ?? 'Enter the number of seats.'
      } else {
        seatsToBook = seatsCheck.seats
      }
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setOutcome(null)
    const attendees = staffGuestRowsForSubmit(resizeStaffGuestRows(guestRows, seatsToBook))

    startTransition(async () => {
      const result = await createEventManualBooking({
        eventId: event.id,
        phone: phone.trim(),
        seats: seatsToBook,
        seatingPreference: event.booking_mode === 'communal' ? seatingPreference : undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        ...(ticketSelections ? { ticketSelections } : {}),
        ...(attendees.length > 0 ? { attendees } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(marketingYes ? { marketingTextsYes: true } : {}),
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if (result.data.state === 'blocked') {
        toast.error(formatBlockedReason(result.data.reason))
        return
      }
      const described = describeManualBookingOutcome(result.data)
      setOutcome(described)
      if (described.tone === 'danger') {
        // BK-033: nothing was booked, so the form keeps everything staff typed.
        toast.error(described.message)
        return
      }
      toast.success(described.message)
      resetForm()
      await onCreated()
    })
  }, [
    selectedCustomerId,
    phone,
    firstName,
    lastName,
    seats,
    seatingPreference,
    useBasket,
    basketSummary,
    guestRows,
    email,
    marketingYes,
    event,
    resetForm,
    onCreated,
  ])

  return (
    <Card>
      <CardHeader title="Add Manual Booking" />
      <CardBody className="space-y-4">
          <Field label="Customer">
            <CustomerSearchInput
              onCustomerSelect={(customer) => {
                if (customer) {
                  setSelectedCustomerId(customer.id)
                  setPhone(customer.mobile_number || '')
                  setFirstName(customer.first_name || '')
                  setLastName(customer.last_name || '')
                } else {
                  setSelectedCustomerId(null)
                  setPhone('')
                  setFirstName('')
                  setLastName('')
                }
                setErrors((prev) => ({ ...prev, phone: undefined, firstName: undefined }))
              }}
              selectedCustomerId={selectedCustomerId}
              placeholder="Search by name or phone..."
            />
          </Field>

          {!selectedCustomerId && (
            <Fieldset legend="Or add a new customer">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Phone number"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    setErrors((prev) => ({ ...prev, phone: undefined }))
                  }}
                  placeholder="07700 900000"
                  error={errors.phone}
                />
                <Input
                  label="First name"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value)
                    setErrors((prev) => ({ ...prev, firstName: undefined }))
                  }}
                  placeholder="First name"
                  error={errors.firstName}
                />
                <Input
                  label="Last name (optional)"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
            </Fieldset>
          )}

          <Input
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErrors((prev) => ({ ...prev, email: undefined }))
            }}
            placeholder="name@example.com"
            hint="The confirmation and any payment link go here first, and by text only if no email goes."
            error={errors.email}
          />

          <StaffMarketingConsentField
            idPrefix="event-manual-booking-marketing"
            checked={marketingYes}
            onChange={setMarketingYes}
            disabled={isPending}
          />

          {useBasket ? (
            <div>
              <Fieldset legend="Tickets" error={basketErrorToShow || undefined}>
                <div className="space-y-2">
                  {basketTypes.map((type) => {
                    const quantityValue = quantities[type.id] ?? ''
                    const currentQuantity = Number(quantityValue.trim() || 0)
                    return (
                      <div
                        key={type.id}
                        className="flex items-center justify-between gap-2 rounded-default border border-border p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text">{type.name}</p>
                          <p className="text-xs text-text-muted">{formatCurrency(type.price)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-label={`Remove one ${type.name} ticket`}
                            onClick={() => adjustQuantity(type.id, -1)}
                            disabled={isPending || currentQuantity <= 0}
                          >
                            −
                          </Button>
                          <Input
                            inputMode="numeric"
                            aria-label={`${type.name} quantity`}
                            className="w-12 text-center"
                            value={quantityValue}
                            onChange={(e) => setQuantity(type.id, e.target.value)}
                            placeholder="0"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-label={`Add one ${type.name} ticket`}
                            onClick={() => adjustQuantity(type.id, 1)}
                            disabled={isPending}
                          >
                            +
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Fieldset>
              <p className="mt-2 text-sm font-medium text-text">
                {basketSummary.error === null
                  ? `${basketSummary.totalSeats} ${basketSummary.totalSeats === 1 ? 'seat' : 'seats'} · ${formatCurrency(basketSummary.totalAmount)}`
                  : 'No tickets selected'}
              </p>

            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="w-full sm:w-28">
                <Input
                  label="Seats"
                  inputMode="numeric"
                  value={seats}
                  onChange={(e) => {
                    setSeats(e.target.value.replace(/\D/g, ''))
                    setErrors((prev) => ({ ...prev, seats: undefined }))
                  }}
                  placeholder="1"
                  error={errors.seats}
                />
              </div>
              {event.booking_mode === 'communal' && (
                <div className="w-full sm:w-44">
                  <Select
                    label="Seating"
                    value={seatingPreference}
                    onChange={(e) =>
                      setSeatingPreference(e.target.value === 'standing' ? 'standing' : 'seated')
                    }
                    options={[
                      { value: 'seated', label: 'Seated' },
                      { value: 'standing', label: 'Standing' },
                    ]}
                  />
                </div>
              )}
            </div>
          )}

          <StaffGuestDetailsFields
            idPrefix="event-manual-booking-guest"
            rows={visibleGuestRows}
            questions={questions}
            required={guestDetailsRequired}
            disabled={isPending}
            onChange={setGuestRows}
          />

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

          <FormFooter>
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={isPending}
              icon={<Icon name="plus" size={14} />}
            >
              Add Booking
            </Button>
          </FormFooter>
      </CardBody>
    </Card>
  )
}
