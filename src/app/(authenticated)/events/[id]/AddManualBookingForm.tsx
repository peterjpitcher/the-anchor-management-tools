'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { Button, Card, CardBody, CardHeader, Input, Select, Spinner, toast } from '@/ds'
import { Icon } from '@/ds/icons'
import type { Event } from '@/types/database'
import { createEventManualBooking } from '@/app/actions/events'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { resolveTicketTypeSellPrice, type EventTicketTypeRow } from '@/lib/events/ticket-types'
import {
  MAX_MANUAL_BOOKING_SEATS,
  summariseTicketBasket,
  validateAttendeeNameList,
  validateSeatsInput,
  type BasketTypeOption,
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
  seats?: string
  basket?: string
  names?: string
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
  const [attendeeNames, setAttendeeNames] = useState<string[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
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
    setErrors((prev) => ({ ...prev, basket: undefined, names: undefined }))
  }, [])

  const adjustQuantity = useCallback((typeId: string, delta: number) => {
    setQuantities((prev) => {
      const current = Number((prev[typeId] ?? '').trim() || 0)
      const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta)
      return { ...prev, [typeId]: next === 0 ? '' : String(next) }
    })
    setErrors((prev) => ({ ...prev, basket: undefined, names: undefined }))
  }, [])

  const setAttendeeName = useCallback((index: number, value: string) => {
    setAttendeeNames((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
    setErrors((prev) => ({ ...prev, names: undefined }))
  }, [])

  const resetForm = useCallback(() => {
    setSelectedCustomerId(null)
    setPhone('')
    setFirstName('')
    setLastName('')
    setSeats('')
    setSeatingPreference('seated')
    setQuantities({})
    setAttendeeNames([])
    setErrors({})
  }, [])

  const handleSubmit = useCallback(() => {
    const nextErrors: FormErrors = {}

    if (!selectedCustomerId) {
      if (!phone.trim()) nextErrors.phone = 'Enter a phone number.'
      if (!firstName.trim()) nextErrors.firstName = 'Enter a first name.'
    }

    let seatsToBook = 0
    let ticketSelections: Array<{ ticketTypeId: string; quantity: number }> | undefined
    let namesToSubmit: string[] | undefined

    if (useBasket) {
      if (basketSummary.error) {
        nextErrors.basket = basketSummary.error
      } else {
        seatsToBook = basketSummary.totalSeats
        ticketSelections = basketSummary.lines.map((line) => ({
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
        }))
        const nameCheck = validateAttendeeNameList(attendeeNames, basketSummary.totalSeats)
        if (nameCheck.error) {
          nextErrors.names = nameCheck.error
        } else if (nameCheck.names.length > 0) {
          namesToSubmit = nameCheck.names
        }
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

    startTransition(async () => {
      const result = await createEventManualBooking({
        eventId: event.id,
        phone: phone.trim(),
        seats: seatsToBook,
        seatingPreference: event.booking_mode === 'communal' ? seatingPreference : undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        ...(ticketSelections ? { ticketSelections } : {}),
        ...(namesToSubmit ? { attendeeNames: namesToSubmit } : {}),
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if (result.data.state === 'blocked') {
        toast.error(formatBlockedReason(result.data.reason))
        return
      }
      toast.success('Booking created successfully')
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
    attendeeNames,
    event,
    resetForm,
    onCreated,
  ])

  return (
    <Card>
      <CardHeader title="Add Manual Booking" />
      <CardBody>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Customer</label>
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
          </div>

          {!selectedCustomerId && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-2">Or add a new customer</p>
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
            </div>
          )}

          {useBasket ? (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Tickets</p>
              <div className="space-y-2">
                {basketTypes.map((type) => {
                  const quantityValue = quantities[type.id] ?? ''
                  const currentQuantity = Number(quantityValue.trim() || 0)
                  return (
                    <div
                      key={type.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5"
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
              {basketErrorToShow && (
                <p className="mt-1.5 text-xs text-danger" role="alert">{basketErrorToShow}</p>
              )}
              <p className="mt-2 text-sm font-medium text-text">
                {basketSummary.error === null
                  ? `${basketSummary.totalSeats} ${basketSummary.totalSeats === 1 ? 'seat' : 'seats'} · ${formatCurrency(basketSummary.totalAmount)}`
                  : 'No tickets selected'}
              </p>

              {totalSeats > 0 && totalSeats <= MAX_MANUAL_BOOKING_SEATS && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-text-muted mb-1">
                    Ticket names (optional — name every ticket or leave blank)
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Array.from({ length: totalSeats }).map((_, index) => (
                      <Input
                        key={index}
                        value={attendeeNames[index] ?? ''}
                        onChange={(e) => setAttendeeName(index, e.target.value)}
                        placeholder={index === 0 ? 'Ticket 1 (lead booker)' : `Ticket ${index + 1}`}
                        aria-label={`Ticket ${index + 1} name`}
                      />
                    ))}
                  </div>
                  {errors.names && (
                    <p className="mt-1.5 text-xs text-danger" role="alert">{errors.names}</p>
                  )}
                </div>
              )}
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

          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isPending}
            icon={isPending ? <Spinner className="h-4 w-4" /> : <Icon name="plus" size={14} />}
            className="w-full sm:w-auto"
          >
            Add Booking
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
