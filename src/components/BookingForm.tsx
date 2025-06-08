import { Booking, Event } from '@/types/database'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { formatDate } from '@/lib/dateUtils'
import { CustomerWithLoyalty, getLoyalCustomers, sortCustomersByLoyalty } from '@/lib/customerUtils'

interface BookingFormProps {
  booking?: Booking
  event: Event
  onSubmit: (data: Omit<Booking, 'id' | 'created_at'>) => Promise<void>
  onCancel: () => void
}

export function BookingForm({ booking, event, onSubmit, onCancel }: BookingFormProps) {
  const [customerId, setCustomerId] = useState(booking?.customer_id ?? '')
  const [seats, setSeats] = useState(booking?.seats?.toString() ?? '')
  const [notes, setNotes] = useState(booking?.notes ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [customers, setCustomers] = useState<CustomerWithLoyalty[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [allCustomers, setAllCustomers] = useState<CustomerWithLoyalty[]>([])

  const loadCustomers = useCallback(async () => {
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
      const existingCustomerIds = new Set(existingBookings.map(b => b.customer_id))
      const availableCustomers = (customersData || [])
        .filter(customer => !existingCustomerIds.has(customer.id) || customer.id === booking?.customer_id)
        .map(customer => ({
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
  }, [booking?.customer_id, event.id])

  useEffect(() => {
    loadCustomers()
  }, [loadCustomers])

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

  const handleSubmit = async (e: React.FormEvent, addAnother: boolean = false) => {
    e.preventDefault()

    // Check if customer already has a booking for this event
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id, seats')
      .eq('event_id', event.id)
      .eq('customer_id', customerId)
      .single()

    if (existingBooking) {
      if (existingBooking.seats > 0 && !booking) {
        const confirmBooking = window.confirm(
          'This customer already has a booking with seats for this event. Would you like to create another booking for them?'
        )
        if (!confirmBooking) {
          return
        }
      } else if (existingBooking.seats === 0 || existingBooking.seats === null) {
        // Update the existing reminder booking using the onSubmit handler
        setIsSubmitting(true)
        try {
          await onSubmit({
            customer_id: customerId,
            event_id: event.id,
            seats: seats ? parseInt(seats, 10) : null,
            notes: notes || null,
          })

          if (addAnother) {
            setCustomerId('')
            setSeats('')
            setNotes('')
            setSearchTerm('')
            await loadCustomers()
          } else {
            onCancel() // Close the form if not adding another
          }
          return
        } catch (error) {
          console.error('Error updating reminder:', error)
          toast.error('Failed to update reminder')
          return
        } finally {
          setIsSubmitting(false)
        }
      }
    }

    setIsSubmitting(true)
    try {
      await onSubmit({
        customer_id: customerId,
        event_id: event.id,
        seats: seats ? parseInt(seats, 10) : null,
        notes: notes || null,
      })

      if (addAnother) {
        // Reset form for next booking
        setCustomerId('')
        setSeats('')
        setNotes('')
        setSearchTerm('')
        // Reload available customers
        await loadCustomers()
      } else {
        onCancel() // Close the form if not adding another
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <div className="text-black">Loading available customers...</div>
  }

  return (
    <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-6 max-h-[calc(100vh-8rem)] overflow-y-auto">
      <div>
        <h2 className="text-lg font-medium text-black mb-4">
          New Booking for {event.name} on {formatDate(event.date)} at {event.time}
        </h2>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="search"
          className="block text-sm font-medium text-black mb-2"
        >
          Search Customer
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-600" aria-hidden="true" />
          </div>
          <input
            type="text"
            id="search"
            name="search"
            className="block w-full rounded-lg border-gray-300 pl-10 focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2 text-black placeholder-gray-600"
            placeholder="Search by name or mobile number"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="customer"
          className="block text-sm font-medium text-black mb-2"
        >
          Select Customer
        </label>
        <select
          id="customer"
          name="customer"
          className="block w-full rounded-lg border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2 text-black"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          required
        >
          <option value="">Select a customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.first_name} {customer.last_name} ({customer.mobile_number}) {customer.isLoyal ? '★' : ''}
            </option>
          ))}
        </select>
        {customers.length === 0 && searchTerm && (
          <p className="mt-2 text-sm text-gray-700">
            No customers found matching your search.
          </p>
        )}
        {customers.length === 0 && !searchTerm && (
          <p className="mt-2 text-sm text-red-700">
            No available customers. Either all customers are already booked for this event,
            or no customers exist in the system.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="seats"
          className="block text-sm font-medium text-black mb-2"
        >
          Number of Seats (Optional)
        </label>
        <input
          type="number"
          id="seats"
          name="seats"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          inputMode="numeric"
          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2 text-black"
        />
        <p className="mt-2 text-sm text-gray-700">
          Leave empty if this is just a reminder
        </p>
      </div>

      <div>
        <label
          htmlFor="notes"
          className="block text-sm font-medium text-black mb-2"
        >
          Notes (Optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm text-black"
          placeholder="Add any notes about this booking..."
        />
      </div>

      <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3 sm:justify-end mt-8">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex justify-center items-center rounded-lg border border-gray-300 bg-white px-6 py-3 md:py-2 text-base md:text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px]"
        >
          Cancel
        </button>
        {!booking && (
          <button
            type="button"
            onClick={(e) => handleSubmit(e, true)}
            disabled={isSubmitting}
            className="inline-flex justify-center items-center rounded-lg border border-transparent bg-indigo-600 px-6 py-3 md:py-2 text-base md:text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px] disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save and Add Another'}
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center items-center rounded-lg border border-transparent bg-indigo-600 px-6 py-3 md:py-2 text-base md:text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px] disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : booking ? 'Update Booking' : 'Save'}
        </button>
      </div>
    </form>
  )
} 