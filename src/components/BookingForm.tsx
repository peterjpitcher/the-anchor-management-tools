import type { Booking, Event, Customer } from '@/types/database'
import { Fragment, useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import toast from 'react-hot-toast'
import { MagnifyingGlassIcon, UserPlusIcon } from '@heroicons/react/24/outline'
import { Combobox, Transition } from '@headlessui/react'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { formatDate } from '@/lib/dateUtils'
import { cn } from '@/lib/utils'
import { CustomerWithLoyalty, getLoyalCustomers, sortCustomersByLoyalty } from '@/lib/customerUtils'
import { Button } from '@/components/ui-v2/forms/Button'
import { createBooking } from '@/app/actions/bookings'

interface BookingFormProps {
  booking?: Booking
  event: Event
  customer?: Customer
  onSubmit: (data: Omit<Booking, 'id' | 'created_at'>, context?: { keepOpen?: boolean }) => Promise<void>
  onCancel: () => void
}

export function BookingForm({ booking, event, customer: preselectedCustomer, onSubmit, onCancel }: BookingFormProps) {
  const supabase = useSupabase()
  const [customerId, setCustomerId] = useState(booking?.customer_id ?? preselectedCustomer?.id ?? '')
  const [seats, setSeats] = useState(booking?.seats?.toString() ?? '')
  const [notes, setNotes] = useState(booking?.notes ?? '')
  const [isReminderOnly, setIsReminderOnly] = useState<boolean>(booking?.is_reminder_only ?? ((booking?.seats ?? 0) === 0))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [customers, setCustomers] = useState<CustomerWithLoyalty[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [blockedCustomerIds, setBlockedCustomerIds] = useState<Set<string>>(new Set())
  const [loyalCustomerIds, setLoyalCustomerIds] = useState<Set<string>>(new Set())
  const [availableCapacity, setAvailableCapacity] = useState<number | null>(null)
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)
  type ExistingBookingInfo = { id: string; seats: number; isReminderOnly: boolean }

  const [existingBookingInfo, setExistingBookingInfo] = useState<ExistingBookingInfo | null>(null)
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false)
  const [newCustomer, setNewCustomer] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobileNumber: ''
  })
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithLoyalty | null>(
    booking?.customer_id && preselectedCustomer
      ? { ...preselectedCustomer, isLoyal: false }
      : null
  )

  // Calculate available capacity
  const calculateAvailableCapacity = useCallback(async () => {
    try {
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, customer_id, seats')
        .eq('event_id', event.id)
        .not('id', 'eq', booking?.id || '00000000-0000-0000-0000-000000000000')

      if (error) throw error

      const relevantBookings = bookings || []
      if (event.capacity) {
        const totalBooked = relevantBookings.reduce((sum: number, b: any) => sum + (b.seats || 0), 0)
        setAvailableCapacity(event.capacity - totalBooked)
      } else {
        setAvailableCapacity(null)
      }

      const blockedIds = new Set<string>()
      relevantBookings
        .filter((b: any) => (b.seats || 0) > 0 && b.customer_id)
        .forEach((b: any) => {
          blockedIds.add(b.customer_id)
        })

      if (booking?.customer_id) {
        blockedIds.delete(booking.customer_id)
      }
      setBlockedCustomerIds(blockedIds)
    } catch (error) {
      console.error('Error calculating capacity:', error)
      toast.error('Failed to calculate available capacity')
    }
  }, [event.id, event.capacity, booking?.customer_id, booking?.id, supabase])

  const loadCustomers = useCallback(async (query?: string) => {
    try {
      setIsLoading(true)

      let request = supabase
        .from('customers')
        .select('*')
        .order('first_name')
        .limit(60)

      const trimmedQuery = query?.trim() ?? ''
      if (trimmedQuery) {
        const digits = trimmedQuery.replace(/\D/g, '')
        const orConditions = [
          `first_name.ilike.%${trimmedQuery}%`,
          `last_name.ilike.%${trimmedQuery}%`,
          `email.ilike.%${trimmedQuery}%`,
          digits ? `mobile_number.ilike.%${digits}%` : ''
        ]
          .filter(Boolean)
          .join(',')

        if (orConditions) {
          request = request.or(orConditions)
        }
      }

      const { data: customersData, error: customersError } = await request
      if (customersError) throw customersError

      const customerRows = (customersData ?? []) as Customer[]

      let candidateCustomers: CustomerWithLoyalty[] = customerRows.map((customer) => ({
        ...customer,
        isLoyal: loyalCustomerIds.has(customer.id)
      }))

      if (blockedCustomerIds.size > 0) {
        candidateCustomers = candidateCustomers.filter((customer) => !blockedCustomerIds.has(customer.id))
      }

      if (preselectedCustomer && !candidateCustomers.some((customer) => customer.id === preselectedCustomer.id)) {
        candidateCustomers.unshift({
          ...preselectedCustomer,
          isLoyal: loyalCustomerIds.has(preselectedCustomer.id ?? '')
        } as CustomerWithLoyalty)
      }

      if (booking?.customer_id && !candidateCustomers.some((customer) => customer.id === booking.customer_id)) {
        const existingCustomer = customerRows.find((customer) => customer.id === booking.customer_id)
        if (existingCustomer) {
          candidateCustomers.unshift({
            ...existingCustomer,
            isLoyal: loyalCustomerIds.has(existingCustomer.id)
          })
        }
      }

      setCustomers(sortCustomersByLoyalty(candidateCustomers))
    } catch (error) {
      console.error('Error loading customers:', error)
      toast.error('Failed to load customers')
    } finally {
      setIsLoading(false)
    }
  }, [blockedCustomerIds, booking?.customer_id, loyalCustomerIds, preselectedCustomer, supabase])

  useEffect(() => {
    calculateAvailableCapacity()
  }, [calculateAvailableCapacity])

  useEffect(() => {
    const handler = setTimeout(() => {
      loadCustomers(searchTerm)
    }, 250)

    return () => clearTimeout(handler)
  }, [loadCustomers, searchTerm])

  useEffect(() => {
    let active = true

    async function hydrateLoyalCustomers() {
      try {
        const loyalIds = await getLoyalCustomers(supabase)
        if (active) {
          setLoyalCustomerIds(new Set(loyalIds))
        }
      } catch (error) {
        console.error('Error loading loyal customers:', error)
      }
    }

    hydrateLoyalCustomers()

    return () => {
      active = false
    }
  }, [supabase])

  useEffect(() => {
    if (booking) {
      setCustomerId(booking.customer_id ?? '')
      setNotes(booking.notes ?? '')
      const reminderFlag = booking.is_reminder_only ?? ((booking.seats ?? 0) === 0)
      setIsReminderOnly(reminderFlag)
      setSeats(reminderFlag ? '' : booking.seats?.toString() ?? '')
    } else {
      setIsReminderOnly(false)
    }
  }, [booking])

  useEffect(() => {
    if (!customerId) {
      setSelectedCustomer(null)
      return
    }
    const current = customers.find((customer) => customer.id === customerId)
    if (current) {
      setSelectedCustomer(current)
    }
  }, [customers, customerId])

  const handleSubmit = async (e: React.FormEvent, addAnother: boolean = false, overwrite: boolean = false) => {
    e.preventDefault()

    // Validate seats is not negative
    const seatCount = isReminderOnly ? 0 : seats ? parseInt(seats, 10) : null
    if (!isReminderOnly) {
      if (seatCount === null || Number.isNaN(seatCount) || seatCount <= 0) {
        toast.error('Please enter at least 1 ticket')
        return
      }
    }

    if (seatCount !== null && seatCount < 0) {
      toast.error('Number of tickets cannot be negative')
      return
    }

    // Check capacity if event has capacity limit
    if (!isReminderOnly && event.capacity && availableCapacity !== null && seatCount) {
      // If editing, add back the original seats to available capacity
      const originalSeats = booking?.seats || 0
      const actualAvailable = availableCapacity + originalSeats
      
      if (seatCount > actualAvailable) {
        toast.error(`Only ${actualAvailable} tickets available for this event`)
        return
      }
    }

    setIsSubmitting(true)
    try {
      const finalCustomerId = customerId

      // Create new customer if needed
      if (showNewCustomerForm && !customerId) {
        const trimmedFirstName = newCustomer.firstName.trim()
        const trimmedLastName = newCustomer.lastName.trim()
        const trimmedEmail = newCustomer.email.trim()
        const trimmedMobile = newCustomer.mobileNumber.trim()

        if (!trimmedFirstName || !trimmedMobile) {
          toast.error('Please provide at least a first name and mobile number')
          setIsSubmitting(false)
          return
        }

        // Use server action to create the customer
        const formData = new FormData()
        formData.append('event_id', event.id)
        formData.append('create_customer', 'true')
        formData.append('customer_first_name', trimmedFirstName)
        formData.append('customer_last_name', trimmedLastName)
        formData.append('customer_mobile_number', trimmedMobile)
        if (trimmedEmail) {
          formData.append('customer_email', trimmedEmail)
        }
        formData.append('seats', seatCount?.toString() || '0')
        formData.append('notes', notes || '')
        formData.append('is_reminder_only', isReminderOnly ? 'true' : 'false')
        if (overwrite) {
          formData.append('overwrite', 'true')
        }

        const result = await createBooking(formData)

        if ('error' in result) {
          if (result.error === 'duplicate_booking' && 'existingBooking' in result && !overwrite) {
            // Show overwrite confirmation
            const existingBooking = result.existingBooking
            setExistingBookingInfo({
              id: existingBooking.id,
              seats: existingBooking.seats,
              isReminderOnly: existingBooking.is_reminder_only
            })
            setShowOverwriteConfirm(true)
            setIsSubmitting(false)
            return
          } else {
            toast.error(typeof result.error === 'string' ? result.error : 'An error occurred')
            setIsSubmitting(false)
            return
          }
        }

        if (!('success' in result) || !result.success || !('data' in result) || !result.data) {
          toast.error('Failed to create booking')
          setIsSubmitting(false)
          return
        }

        await onSubmit(
          {
            customer_id: result.data.customer_id,
            event_id: result.data.event_id,
            seats: result.data.seats,
            notes: result.data.notes,
            is_reminder_only: isReminderOnly,
          },
          { keepOpen: addAnother }
        )

        toast.success(overwrite ? 'Booking updated successfully' : 'Booking created successfully with new customer')
        
        if (addAnother) {
          // Reset form for next booking
          setCustomerId('')
          setSeats('')
          setNotes('')
          setSearchTerm('')
          setShowOverwriteConfirm(false)
          setExistingBookingInfo(null)
          setShowNewCustomerForm(false)
          setNewCustomer({ firstName: '', lastName: '', email: '', mobileNumber: '' })
          // Reload available customers
          await loadCustomers()
        } else {
          onCancel() // Close the form if not adding another
        }
        return
      }

      // Use server action for existing customer
      const formData = new FormData()
      formData.append('event_id', event.id)
      formData.append('customer_id', finalCustomerId)
      formData.append('seats', seatCount?.toString() || '0')
      formData.append('notes', notes || '')
      formData.append('is_reminder_only', isReminderOnly ? 'true' : 'false')
      if (overwrite) {
        formData.append('overwrite', 'true')
      }

      const result = await createBooking(formData)

      if ('error' in result) {
        if (result.error === 'duplicate_booking' && 'existingBooking' in result && !overwrite) {
          // Show overwrite confirmation
          const existingBooking = result.existingBooking
          setExistingBookingInfo({
            id: existingBooking.id,
            seats: existingBooking.seats,
            isReminderOnly: existingBooking.is_reminder_only
          })
          setShowOverwriteConfirm(true)
          setIsSubmitting(false)
          return
        } else {
          toast.error(typeof result.error === 'string' ? result.error : 'An error occurred')
          setIsSubmitting(false)
          return
        }
      }

      if (!('success' in result) || !result.success || !('data' in result) || !result.data) {
        toast.error('Failed to create booking')
        setIsSubmitting(false)
        return
      }

      await onSubmit(
        {
          customer_id: result.data.customer_id,
          event_id: result.data.event_id,
          seats: result.data.seats,
          notes: result.data.notes,
          is_reminder_only: isReminderOnly,
        },
        { keepOpen: addAnother }
      )

      toast.success(overwrite ? 'Booking updated successfully' : 'Booking created successfully')

      if (addAnother) {
        // Reset form for next booking
        setCustomerId('')
        setSeats('')
        setNotes('')
        setSearchTerm('')
        setShowOverwriteConfirm(false)
        setExistingBookingInfo(null)
        setIsReminderOnly(false)
        // Reload available customers
        await loadCustomers()
      } else {
        onCancel() // Close the form if not adding another
      }
    } catch (error) {
      console.error('Error creating booking:', error)
      toast.error('Failed to create booking')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <div className="text-black">Loading available customers...</div>
  }

  return (
    <>
      {/* Overwrite Confirmation Dialog */}
      {showOverwriteConfirm && existingBookingInfo && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-lg p-6 max-w-md w-full max-h-[90vh] sm:max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Existing Booking Found
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {existingBookingInfo.isReminderOnly ? (
                <>This customer currently has a reminder for this event. Converting it will create a full booking.</>
              ) : (
                <>This customer already has a booking for this event with {existingBookingInfo.seats || 0} ticket{existingBookingInfo.seats !== 1 ? 's' : ''}. Overwrite the existing booking?</>
              )}
            </p>
            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowOverwriteConfirm(false)
                  setExistingBookingInfo(null)
                  setIsSubmitting(false)
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  setShowOverwriteConfirm(false)
                  const syntheticEvent = { preventDefault: () => {} } as React.FormEvent
                  handleSubmit(syntheticEvent, false, true)
                }}
              >
                Overwrite
              </Button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-6">
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            New Booking for {event.name} on {formatDate(event.date)} at {event.time}
          </h2>
        </div>

        <div className="flex items-start gap-2">
          <input
            id="reminder-only"
            type="checkbox"
            checked={isReminderOnly}
            onChange={(e) => {
              const value = e.target.checked
              setIsReminderOnly(value)
              if (value) {
                setSeats('')
              }
            }}
            className="mt-1 h-4 w-4 text-green-600 border-gray-300 rounded"
          />
          <label htmlFor="reminder-only" className="text-sm text-gray-700">
            Treat this as a reminder (no tickets reserved). Uncheck to allocate seats.
          </label>
        </div>

      {!preselectedCustomer && (
        <>
          {!showNewCustomerForm && (
            <div className="space-y-2">
              <label
                htmlFor="customer-search"
                className="block text-sm font-medium text-gray-900 mb-2"
              >
                Search Customer
              </label>
              <Combobox
                value={selectedCustomer}
                onChange={(customer) => {
                  setSelectedCustomer(customer)
                  setCustomerId(customer?.id ?? '')
                  setShowNewCustomerForm(false)
                  setSearchTerm('')
                }}
              >
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  </div>
                  <Combobox.Input
                    id="customer-search"
                    className="w-full rounded-lg border border-gray-300 bg-white py-3 sm:py-2 pl-10 pr-12 text-base sm:text-sm text-gray-900 placeholder-gray-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 min-h-[48px] sm:min-h-[44px]"
                    displayValue={(customer: CustomerWithLoyalty | null) => (customer ? `${customer.first_name} ${customer.last_name ?? ''} (${customer.mobile_number})` : '')}
                    onChange={(event) => {
                      const value = event.target.value
                      setSearchTerm(value)
                      setSelectedCustomer(null)
                      setCustomerId('')
                    }}
                    placeholder="Search by name or mobile number"
                  />
                  <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
                    <ChevronUpDownIcon className="h-5 w-5" aria-hidden="true" />
                  </Combobox.Button>
                </div>
                <Transition
                  as={Fragment}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <Combobox.Options className="absolute left-0 z-50 mt-2 max-h-60 w-full overflow-auto rounded-lg bg-white py-2 shadow-lg ring-1 ring-black/10 focus:outline-none">
                    {customers.length === 0 ? (
                      <div className="px-4 py-2 text-sm text-gray-500">
                        {searchTerm
                          ? 'No customers found. Try a different search or create a new customer.'
                          : 'No available customers. Either all customers are already booked or none exist yet.'}
                      </div>
                    ) : (
                      customers.map((customer) => (
                        <Combobox.Option
                          key={customer.id}
                          value={customer}
                          className={({ active }) =>
                            cn(
                              'flex cursor-pointer items-center justify-between px-4 py-2 text-sm',
                              active ? 'bg-green-500 text-white' : 'text-gray-900'
                            )
                          }
                        >
                          {({ active, selected }) => (
                            <>
                              <div className="flex flex-col">
                                <span className={cn('font-medium', selected && !active && 'text-green-600')}>
                                  {customer.first_name} {customer.last_name ?? ''}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {customer.mobile_number} {customer.isLoyal ? '• Loyal customer' : ''}
                                </span>
                              </div>
                              {selected && (
                                <CheckIcon className={cn('h-4 w-4', active ? 'text-white' : 'text-green-600')} aria-hidden="true" />
                              )}
                            </>
                          )}
                        </Combobox.Option>
                      ))
                    )}
                  </Combobox.Options>
                </Transition>
              </Combobox>
            </div>
          )}
          
          {!showNewCustomerForm && (
            <button
              type="button"
              onClick={() => {
                setShowNewCustomerForm(true)
                setSelectedCustomer(null)
                setCustomerId('')
                setSearchTerm('')
              }}
              className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
            >
              <UserPlusIcon className="h-4 w-4 mr-1" />
              Create new customer
            </button>
          )}

          {showNewCustomerForm && (
            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-900">New Customer Details</h3>
              <div className="grid grid-cols-1 gap-6 sm:gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                    First Name
                  </label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={newCustomer.firstName}
                    onChange={(e) => setNewCustomer(prev => ({ ...prev, firstName: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[48px] sm:min-h-[44px]"
                    required={showNewCustomerForm}
                  />
                </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                  Last Name
                </label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  value={newCustomer.lastName}
                  onChange={(e) => setNewCustomer(prev => ({ ...prev, lastName: e.target.value }))}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[48px] sm:min-h-[44px]"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="emailAddress" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  type="email"
                  id="emailAddress"
                  name="emailAddress"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="name@example.com"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[48px] sm:min-h-[44px]"
                />
              </div>
            </div>
              <div>
                <label htmlFor="mobileNumber" className="block text-sm font-medium text-gray-700">
                  Mobile Number
                </label>
                <input
                  type="tel"
                  id="mobileNumber"
                  name="mobileNumber"
                  value={newCustomer.mobileNumber}
                  onChange={(e) => setNewCustomer(prev => ({ ...prev, mobileNumber: e.target.value }))}
                  placeholder="07XXX XXXXXX"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[48px] sm:min-h-[44px]"
                  required={showNewCustomerForm}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewCustomerForm(false)
                    setNewCustomer({ firstName: '', lastName: '', email: '', mobileNumber: '' })
                  }}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <label
          htmlFor="seats"
          className="block text-sm font-medium text-gray-900 mb-2"
        >
          Number of Tickets {isReminderOnly ? '(disabled for reminders)' : ''}
        </label>
        <input
          type="number"
          id="seats"
          name="seats"
          min="0"
          max={event.capacity ? (availableCapacity !== null ? availableCapacity + (booking?.seats || 0) : event.capacity) : undefined}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-green-500 focus:ring-green-500 sm:text-sm"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          inputMode="numeric"
          disabled={isReminderOnly}
          required={!isReminderOnly}
        />
        <p className="mt-2 text-sm text-gray-500">
          {isReminderOnly ? 'Reminders do not reserve tickets.' : 'Enter the number of tickets to reserve.'}
        </p>
        {event.capacity && availableCapacity !== null && (
          <p className="mt-1 text-sm text-gray-600">
            Available: {availableCapacity + (booking?.seats || 0)} of {event.capacity} tickets
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="notes"
          className="block text-sm font-medium text-gray-900 mb-2"
        >
          Notes (Optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        ></textarea>
        <p className="mt-2 text-sm text-gray-500">Add any notes about this booking...</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:gap-3 sm:justify-start pt-6 sm:pt-4">
        <Button
          type="submit"
          disabled={isSubmitting}
          onClick={(e) => handleSubmit(e, false)}
          fullWidth
          className="sm:w-auto"
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </Button>
        <Button
          type="button"
          disabled={isSubmitting}
          onClick={(e) => handleSubmit(e, true)}
          fullWidth
          className="sm:w-auto"
        >
          Save and Add Another
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting}
          fullWidth
          className="sm:w-auto"
        >
          Cancel
        </Button>
      </div>
    </form>
    </>
  )
} 
