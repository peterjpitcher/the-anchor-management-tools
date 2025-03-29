import { Booking, Customer, Event } from '@/types/database'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

interface BookingFormProps {
  booking?: Booking
  event: Event
  onSubmit: (data: Omit<Booking, 'id' | 'created_at'>) => Promise<void>
  onCancel: () => void
}

export function BookingForm({ booking, event, onSubmit, onCancel }: BookingFormProps) {
  const [customerId, setCustomerId] = useState(booking?.customer_id ?? '')
  const [seats, setSeats] = useState(booking?.seats?.toString() ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [availableCustomers, setAvailableCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadAvailableCustomers()
  }, [event.id])

  async function loadAvailableCustomers() {
    try {
      // First get all customers
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .order('last_name', { ascending: true })

      if (customersError) throw customersError

      // Then get customers who already have bookings for this event
      const { data: existingBookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('customer_id')
        .eq('event_id', event.id)

      if (bookingsError) throw bookingsError

      // Filter out customers who already have bookings, unless it's the current booking being edited
      const bookedCustomerIds = existingBookings.map(b => b.customer_id)
      const availableCustomers = customers.filter(customer => 
        !bookedCustomerIds.includes(customer.id) || customer.id === booking?.customer_id
      )

      setAvailableCustomers(availableCustomers)
    } catch (error) {
      console.error('Error loading available customers:', error)
      toast.error('Failed to load available customers')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await onSubmit({
        customer_id: customerId,
        event_id: event.id,
        seats: seats ? parseInt(seats, 10) : null,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <div>Loading available customers...</div>
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="customer"
          className="block text-sm font-medium text-gray-700"
        >
          Customer
        </label>
        <select
          id="customer"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        >
          <option value="">Select a customer</option>
          {availableCustomers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.first_name} {customer.last_name}
            </option>
          ))}
        </select>
        {availableCustomers.length === 0 && (
          <p className="mt-1 text-sm text-red-600">
            No available customers. Either all customers are already booked for this event,
            or no customers exist in the system.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="seats"
          className="block text-sm font-medium text-gray-700"
        >
          Number of Seats (Optional)
        </label>
        <input
          type="number"
          id="seats"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          min="1"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
        <p className="mt-1 text-sm text-gray-500">
          Leave empty if this is just a reminder
        </p>
      </div>

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          {isSubmitting ? 'Saving...' : booking ? 'Update Booking' : 'Create Booking'}
        </button>
      </div>
    </form>
  )
} 