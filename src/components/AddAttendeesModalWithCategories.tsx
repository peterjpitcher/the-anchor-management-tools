'use client'

import { Customer, Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { useEffect, useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { MagnifyingGlassIcon, XMarkIcon, StarIcon } from '@heroicons/react/24/solid'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { CategoryCustomerSuggestions } from '@/components/CategoryCustomerSuggestions'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { DataTable } from '@/components/ui-v2/display/DataTable'

// Define a more specific type for currentBookings based on what EventViewPage uses
// This assumes BookingWithCustomer has at least customer_id
interface BookingLike {
  customer_id: string;
  // other fields that might exist on BookingWithCustomer, not strictly needed by this modal
}

interface AddAttendeesModalWithCategoriesProps {
  event: Event;
  currentBookings: BookingLike[];
  onClose: () => void;
  onAddAttendees: (customerIds: string[]) => Promise<void>;
}

export function AddAttendeesModalWithCategories({
  event,
  currentBookings,
  onClose,
  onAddAttendees,
}: AddAttendeesModalWithCategoriesProps) {
  const supabase = useSupabase()
  const [allCustomers, setAllCustomers] = useState<Customer[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [recentBookerIds, setRecentBookerIds] = useState<Set<string>>(new Set())
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false)

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

        // Fetch categories
        const categoriesResult = await getActiveEventCategories()
        if (categoriesResult.data) {
          setCategories(categoriesResult.data)
        }

        // Fetch IDs of customers who booked in the last 3 months
        const threeMonthsAgo = new Date()
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
        
        const { data: recentBookings, error: recentBookingsError } = await supabase
          .from('bookings')
          .select('customer_id')
          .gte('created_at', threeMonthsAgo.toISOString())
        
        if (recentBookingsError) throw recentBookingsError
        
        setRecentBookerIds(new Set(recentBookings?.map((b: { customer_id: string }) => b.customer_id) || []))

        // Show category suggestions by default if event has a category
        if (event.category_id) {
          setShowCategorySuggestions(true)
        }

      } catch (err) {
        console.error('Error fetching data for modal:', err)
        toast.error('Could not load all customer data.')
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [supabase, event.category_id])

  const availableCustomers = useMemo(() => {
    const bookedCustomerIds = new Set(currentBookings.map((b: BookingLike) => b.customer_id))
    const filtered = allCustomers
      .filter(customer => !bookedCustomerIds.has(customer.id))
      .filter(customer => {
        // Ensure mobile_number is not null before calling toLowerCase()
        const mobile = customer.mobile_number ? customer.mobile_number.toLowerCase() : ''
        const fullName = `${customer.first_name} ${customer.last_name}`.toLowerCase()
        const term = searchTerm.toLowerCase()
        return fullName.includes(term) || mobile.includes(term)
      })

    // Sort: recent bookers first, then by name
    return filtered.sort((a, b) => {
      const aIsRecent = recentBookerIds.has(a.id);
      const bIsRecent = recentBookerIds.has(b.id);

      if (aIsRecent && !bIsRecent) return -1; // a comes first
      if (!aIsRecent && bIsRecent) return 1;  // b comes first

      // If both are recent or neither are, sort by name (last_name, then first_name)
      const nameA = `${a.last_name} ${a.first_name}`.toLowerCase();
      const nameB = `${b.last_name} ${b.first_name}`.toLowerCase();

      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      
      return 0;
    });
  }, [allCustomers, currentBookings, searchTerm, recentBookerIds])

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

  const handleCategorySuggestionsSelect = (customerIds: string[]) => {
    // Add new selections to existing ones (avoid duplicates)
    const newSet = new Set([...selectedCustomerIds, ...customerIds])
    setSelectedCustomerIds(Array.from(newSet))
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
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Add Attendees to: {event.name}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close modal"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Category Suggestions */}
        {event.category_id && showCategorySuggestions && (
          <div className="mb-4">
            <CategoryCustomerSuggestions
              categoryId={event.category_id}
              categories={categories}
              onSelectCustomers={handleCategorySuggestionsSelect}
              selectedCustomerIds={selectedCustomerIds}
            />
          </div>
        )}

        {/* Toggle between suggestions and all customers */}
        {event.category_id && (
          <div className="mb-4">
            <button
              onClick={() => setShowCategorySuggestions(!showCategorySuggestions)}
              className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
            >
              {showCategorySuggestions ? 'Show All Customers' : 'Show Category Suggestions'}
            </button>
          </div>
        )}

        {/* All Customers List */}
        {(!event.category_id || !showCategorySuggestions) && (
          <>
            <div className="mb-4 relative">
              <input
                type="text"
                placeholder="Search by name or mobile..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 pl-10 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                  <DataTable<Customer>
                    data={availableCustomers}
                    getRowKey={(c) => c.id}
                    columns={[
                      {
                        key: 'select',
                        header: (
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-green-600 shadow-sm focus:ring-green-500"
                            checked={availableCustomers.length > 0 && selectedCustomerIds.length === availableCustomers.length}
                            onChange={handleSelectAll}
                            disabled={availableCustomers.length === 0}
                            aria-label="Select all available customers"
                          />
                        ),
                        cell: (customer: Customer) => (
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-green-600 shadow-sm focus:ring-green-500"
                            checked={selectedCustomerIds.includes(customer.id)}
                            onChange={() => handleSelectCustomer(customer.id)}
                            aria-labelledby={`customer-name-${customer.id}`}
                          />
                        ),
                        width: '1%'
                      },
                      {
                        key: 'name',
                        header: 'Name',
                        cell: (customer: Customer) => (
                          <div id={`customer-name-${customer.id}`} className="flex items-center text-sm text-gray-900">
                            {recentBookerIds.has(customer.id) && (
                              <StarIcon className="h-5 w-5 text-yellow-400 mr-1.5 flex-shrink-0" aria-label="Recent Booker" />
                            )}
                            {customer.first_name} {customer.last_name}
                          </div>
                        )
                      },
                      {
                        key: 'mobile',
                        header: 'Mobile Number',
                        cell: (customer: Customer) => (
                          <span className="text-sm text-gray-500">{customer.mobile_number}</span>
                        )
                      }
                    ]}
                    emptyMessage="No new customers available to add."
                  />
                )}
              </div>
            )}
          </>
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
            className="inline-flex justify-center items-center rounded-lg border border-transparent bg-green-600 px-6 py-3 md:py-2 text-base md:text-sm font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px] disabled:opacity-50"
          >
            {isSubmitting ? 'Adding...' : `Add ${selectedCustomerIds.length} Attendee(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
