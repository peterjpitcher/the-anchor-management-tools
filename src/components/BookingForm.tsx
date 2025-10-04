import type { Booking, Event, Customer } from '@/types/database'
import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import toast from 'react-hot-toast'
import { MagnifyingGlassIcon, UserPlusIcon } from '@heroicons/react/24/outline'
import { formatDate } from '@/lib/dateUtils'
import { CustomerWithLoyalty, getLoyalCustomers, sortCustomersByLoyalty } from '@/lib/customerUtils'
import { Button } from '@/components/ui-v2/forms/Button'
import { createBooking } from '@/app/actions/bookings'

interface BookingFormProps {
  booking?: Booking
  event: Event
  customer?: Customer
  onSubmit: (data: Omit<Booking, 'id' | 'created_at'>) => Promise<void>
  onCancel: () => void
}

export function BookingForm({ booking, event, customer: preselectedCustomer, onSubmit, onCancel }: BookingFormProps) {
  const supabase = useSupabase()
  const [customerId, setCustomerId] = useState(booking?.customer_id ?? preselectedCustomer?.id ?? '')
  const [seats, setSeats] = useState(booking?.seats?.toString() ?? '')
  const [notes, setNotes] = useState(booking?.notes ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [customers, setCustomers] = useState<CustomerWithLoyalty[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [allCustomers, setAllCustomers] = useState<CustomerWithLoyalty[]>([])
  const [availableCapacity, setAvailableCapacity] = useState<number | null>(null)
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)
  const [existingBookingInfo, setExistingBookingInfo] = useState<{ id: string; seats: number } | null>(null)
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false)
  const [newCustomer, setNewCustomer] = useState({
    firstName: '',
    lastName: '',
    mobileNumber: ''
  })

  // Calculate available capacity
  const calculateAvailableCapacity = useCallback(async () => {
    if (!event.capacity) {
      setAvailableCapacity(null)
      return
    }

    try {
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select('seats')
        .eq('event_id', event.id)
        .not('id', 'eq', booking?.id || '00000000-0000-0000-0000-000000000000')

      if (error) throw error

      const totalBooked = bookings?.reduce((sum: number, b: any) => sum + (b.seats || 0), 0) || 0
      setAvailableCapacity(event.capacity - totalBooked)
    } catch (error) {
      console.error('Error calculating capacity:', error)
      toast.error('Failed to calculate available capacity')
    }
  }, [event.id, event.capacity, booking?.id, supabase])

  const loadCustomers = useCallback(async () => {
    if (preselectedCustomer) {
      setCustomers([{ ...preselectedCustomer, isLoyal: false }])
      setAllCustomers([{ ...preselectedCustomer, isLoyal: false }])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      // Get all customers
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .order('first_name')

      if (customersError) throw customersError

      // Then get existing bookings for this event with seats > 0
      const { data: existingBookings } = await supabase
        .from('bookings')
        .select('customer_id, seats')
        .eq('event_id', event.id)
        .gt('seats', 0)

      if (!existingBookings) {
        toast.error('Failed to load existing bookings')
        return
      }

      // Get loyal customer IDs
      const loyalCustomerIds = await getLoyalCustomers(supabase)

      // Filter out customers who already have a booking with seats for this event
      // unless it's the current booking's customer
      const existingCustomerIds = new Set(existingBookings.map((b: any) => b.customer_id))
      const availableCustomers = (customersData || [])
        .filter((customer: any) => !existingCustomerIds.has(customer.id) || customer.id === booking?.customer_id)
        .map((customer: any) => ({
          ...customer,
          isLoyal: loyalCustomerIds.includes(customer.id)
        }))

      // Sort customers with loyal ones at the top
      const sortedCustomers = sortCustomersByLoyalty(availableCustomers)
      setAllCustomers(sortedCustomers)
      setCustomers(sortedCustomers)
    } catch (error) {
      console.error('Error loading customers:', error)
      toast.error('Failed to load customers')
    } finally {
      setIsLoading(false)
    }
  }, [booking?.customer_id, event.id, preselectedCustomer, supabase])

  useEffect(() => {
    loadCustomers()
    calculateAvailableCapacity()
  }, [loadCustomers, calculateAvailableCapacity])

  useEffect(() => {
    if (booking) {
      setCustomerId(booking.customer_id ?? '')
      setSeats(booking.seats?.toString() ?? '')
      setNotes(booking.notes ?? '')
    }
  }, [booking])

  useEffect(() => {
    if (searchTerm.trim() === '') {
      setCustomers(allCustomers)
      return
    }

    const searchTermLower = searchTerm.toLowerCase()
    const searchTermDigits = searchTerm.replace(/\D/g, '') // Remove non-digits for phone number search
    const filtered = allCustomers.filter(customer => 
      customer.first_name.toLowerCase().includes(searchTermLower) ||
      customer.last_name.toLowerCase().includes(searchTermLower) ||
      customer.mobile_number.replace(/\D/g, '').includes(searchTermDigits)
    )
    setCustomers(filtered)
  }, [searchTerm, allCustomers])

  const handleSubmit = async (e: React.FormEvent, addAnother: boolean = false, overwrite: boolean = false) => {
    e.preventDefault()

    // Validate seats is not negative
    const seatCount = seats ? parseInt(seats, 10) : null
    if (seatCount !== null && seatCount < 0) {
      toast.error('Number of tickets cannot be negative')
      return
    }

    // Check capacity if event has capacity limit
    if (event.capacity && availableCapacity !== null && seatCount) {
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
        if (!newCustomer.firstName || !newCustomer.lastName || !newCustomer.mobileNumber) {
          toast.error('Please fill in all customer details')
          setIsSubmitting(false)
          return
        }

        // Use server action to create the customer
        const formData = new FormData()
        formData.append('event_id', event.id)
        formData.append('create_customer', 'true')
        formData.append('customer_first_name', newCustomer.firstName)
        formData.append('customer_last_name', newCustomer.lastName)
        formData.append('customer_mobile_number', newCustomer.mobileNumber)
        formData.append('seats', seatCount?.toString() || '0')
        formData.append('notes', notes || '')
        if (overwrite) {
          formData.append('overwrite', 'true')
        }

        const result = await createBooking(formData)

        if ('error' in result) {
          if (result.error === 'duplicate_booking' && 'existingBooking' in result && !overwrite) {
            // Show overwrite confirmation
            setExistingBookingInfo(result.existingBooking)
            setShowOverwriteConfirm(true)
            setIsSubmitting(false)
            return
          } else {
            toast.error(typeof result.error === 'string' ? result.error : 'An error occurred')
            setIsSubmitting(false)
            return
          }
        }

        // Success!
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
          setNewCustomer({ firstName: '', lastName: '', mobileNumber: '' })
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
      if (overwrite) {
        formData.append('overwrite', 'true')
      }

      const result = await createBooking(formData)

      if ('error' in result) {
        if (result.error === 'duplicate_booking' && 'existingBooking' in result && !overwrite) {
          // Show overwrite confirmation
          setExistingBookingInfo(result.existingBooking)
          setShowOverwriteConfirm(true)
          setIsSubmitting(false)
          return
        } else {
          toast.error(typeof result.error === 'string' ? result.error : 'An error occurred')
          setIsSubmitting(false)
          return
        }
      }

      // Success!
      toast.success(overwrite ? 'Booking updated successfully' : 'Booking created successfully')
      
      // If updating an existing booking (from the event page), use the onSubmit callback
      if (booking) {
        await onSubmit({
          customer_id: customerId,
          event_id: event.id,
          seats: seatCount,
          notes: notes || null,
        })
      }

      if (addAnother) {
        // Reset form for next booking
        setCustomerId('')
        setSeats('')
        setNotes('')
        setSearchTerm('')
        setShowOverwriteConfirm(false)
        setExistingBookingInfo(null)
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
              This customer already has a booking for this event with {existingBookingInfo.seats || 0} ticket{existingBookingInfo.seats !== 1 ? 's' : ''}.
              Would you like to overwrite the existing booking?
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

      {!preselectedCustomer && (
        <>
          <div className="space-y-2">
            <label
              htmlFor="search"
              className="block text-sm font-medium text-gray-900 mb-2"
            >
              Search Customer
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
              </div>
              <input
                type="text"
                id="search"
                name="search"
                className="block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 pl-10 text-base sm:text-sm text-gray-900 placeholder-gray-500 focus:border-green-500 focus:ring-green-500 min-h-[48px] sm:min-h-[44px]"
                placeholder="Search by name or mobile number"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {!showNewCustomerForm && (
            <div>
              <label
                htmlFor="customer"
                className="block text-sm font-medium text-gray-900 mb-2"
              >
                Select Customer
              </label>
              <select
                id="customer"
                name="customer"
                className="block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 focus:border-green-500 focus:ring-green-500 min-h-[48px] sm:min-h-[44px] bg-white"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required={!showNewCustomerForm}
              >
                <option value="">Select a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name} ({c.mobile_number}) {c.isLoyal ? '★' : ''}
                  </option>
                ))}
              </select>
              {customers.length === 0 && searchTerm && (
                <p className="mt-2 text-sm text-gray-500">
                  No customers found matching your search.
                </p>
              )}
              {customers.length === 0 && !searchTerm && (
                <p className="mt-2 text-sm text-red-600">
                  No available customers. Either all customers are already booked for this event,
                  or no customers exist in the system.
                </p>
              )}
            </div>
          )}
          
          {!showNewCustomerForm && (
            <button
              type="button"
              onClick={() => setShowNewCustomerForm(true)}
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
                    required={showNewCustomerForm}
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
                    setNewCustomer({ firstName: '', lastName: '', mobileNumber: '' })
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
          Number of Tickets (Optional)
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
        />
        <p className="mt-2 text-sm text-gray-500">
          Leave empty if this is just a reminder
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
