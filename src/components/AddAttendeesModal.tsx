'use client'

import { Customer } from '@/types/database'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useEffect, useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { MagnifyingGlassIcon, XMarkIcon, StarIcon } from '@heroicons/react/24/solid'

// Define a more specific type for currentBookings based on what EventViewPage uses
// This assumes BookingWithCustomer has at least customer_id
interface BookingLike {
  customer_id: string;
  // other fields that might exist on BookingWithCustomer, not strictly needed by this modal
}

interface AddAttendeesModalProps {
  eventName: string;
  currentBookings: BookingLike[];
  onClose: () => void;
  onAddAttendees: (customerIds: string[]) => Promise<void>;
}

export function AddAttendeesModal({
  eventName,
  currentBookings,
  onClose,
  onAddAttendees,
}: AddAttendeesModalProps) {
  const supabase = createClientComponentClient()
  const [allCustomers, setAllCustomers] = useState<Customer[]>([])
  const [recentBookerIds, setRecentBookerIds] = useState<Set<string>>(new Set())
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true)
      try {
        // Fetch all customers
        const { data: customersData, error: customersError } = await supabase
          .from('customers')
          .select('*')
          .order('last_name', { ascending: true })
          .order('first_name', { ascending: true })

        if (customersError) throw customersError
        setAllCustomers(customersData || [])

        // Fetch IDs of customers who booked in the last 3 months
        const threeMonthsAgo = new Date()
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
        
        const { data: recentBookings, error: recentBookingsError } = await supabase
          .from('bookings')
          .select('customer_id')
          .gte('created_at', threeMonthsAgo.toISOString())
        
        if (recentBookingsError) throw recentBookingsError
        
        setRecentBookerIds(new Set(recentBookings?.map(b => b.customer_id) || []))

      } catch (err) {
        console.error('Error fetching data for modal:', err)
        toast.error('Could not load all customer data.')
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [supabase])

  const availableCustomers = useMemo(() => {
    const bookedCustomerIds = new Set(currentBookings.map(b => b.customer_id))
    return allCustomers
      .filter(customer => !bookedCustomerIds.has(customer.id))
      .filter(customer => {
        const fullName = `${customer.first_name} ${customer.last_name}`.toLowerCase()
        const mobile = customer.mobile_number.toLowerCase()
        const term = searchTerm.toLowerCase()
        return fullName.includes(term) || mobile.includes(term)
      })
  }, [allCustomers, currentBookings, searchTerm])

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerIds(prevSelected =>
      prevSelected.includes(customerId)
        ? prevSelected.filter(id => id !== customerId)
        : [...prevSelected, customerId],
    )
  }

  const handleSelectAll = () => {
    if (selectedCustomerIds.length === availableCustomers.length) {
      setSelectedCustomerIds([])
    } else {
      setSelectedCustomerIds(availableCustomers.map(c => c.id))
    }
  }

  const handleSubmit = async () => {
    if (selectedCustomerIds.length === 0) {
      toast.error('Please select at least one customer.')
      return
    }
    setIsSubmitting(true)
    try {
      await onAddAttendees(selectedCustomerIds)
      // Parent (EventViewPage) will handle success toast and closing modal AFTER data refresh
      // onClose(); // This will be called by parent
    } catch (error) {
      // Parent (EventViewPage) will handle error toast
      console.error('Error in handleSubmit of AddAttendeesModal:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Add Attendees to: {eventName}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close modal"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="mb-4 relative">
          <input
            type="text"
            placeholder="Search by name or mobile..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2 pl-10"
          />
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        </div>

        {isLoading ? (
          <div className="text-center py-8">Loading customers...</div>
        ) : (
          <div className="overflow-y-auto flex-grow mb-4 border rounded-md">
            {availableCustomers.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No new customers available to add.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-indigo-600 shadow-sm focus:ring-indigo-500"
                        checked={
                          availableCustomers.length > 0 &&
                          selectedCustomerIds.length === availableCustomers.length
                        }
                        onChange={handleSelectAll}
                        disabled={availableCustomers.length === 0}
                        aria-label="Select all available customers"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Mobile Number
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {availableCustomers.map(customer => (
                    <tr key={customer.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-indigo-600 shadow-sm focus:ring-indigo-500"
                          checked={selectedCustomerIds.includes(customer.id)}
                          onChange={() => handleSelectCustomer(customer.id)}
                          aria-labelledby={`customer-name-${customer.id}`}
                        />
                      </td>
                      <td id={`customer-name-${customer.id}`} className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 flex items-center">
                        {recentBookerIds.has(customer.id) && (
                          <StarIcon className="h-5 w-5 text-yellow-400 mr-1.5 flex-shrink-0" aria-label="Recent Booker" />
                        )}
                        {customer.first_name} {customer.last_name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {customer.mobile_number}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3 sm:justify-end pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex justify-center items-center rounded-lg border border-gray-300 bg-white px-6 py-3 md:py-2 text-base md:text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || selectedCustomerIds.length === 0 || isLoading}
            className="inline-flex justify-center items-center rounded-lg border border-transparent bg-indigo-600 px-6 py-3 md:py-2 text-base md:text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px] disabled:opacity-50"
          >
            {isSubmitting ? 'Adding...' : `Add ${selectedCustomerIds.length} Attendee(s)`}
          </button>
        </div>
      </div>
    </div>
  )
} 