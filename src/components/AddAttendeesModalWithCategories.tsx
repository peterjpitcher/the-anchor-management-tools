'use client'

import { Customer, Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { MagnifyingGlassIcon, XMarkIcon, StarIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { CategoryCustomerSuggestions } from '@/components/CategoryCustomerSuggestions'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { formatDistanceToNow } from 'date-fns'

// Define a more specific type for currentBookings based on what EventViewPage uses
// This assumes BookingWithCustomer has at least customer_id
interface BookingLike {
  customer_id: string;
  seats?: number | null;
}

interface EventCheckInSummary {
  id: string
  check_in_time: string
  check_in_method: string | null
  customer: {
    id: string
    first_name: string
    last_name: string | null
    mobile_number: string | null
  }
}

const formatCustomerName = (customer: Customer) => {
  const first = customer.first_name?.trim() ?? ''
  const last = customer.last_name?.trim() ?? ''
  return [first, last].filter(Boolean).join(' ')
}

interface AddAttendeesModalWithCategoriesProps {
  event: Event;
  currentBookings: BookingLike[];
  checkIns: EventCheckInSummary[];
  onClose: () => void;
  onAddAttendees: (customerIds: string[]) => Promise<void>;
}

export function AddAttendeesModalWithCategories({
  event,
  currentBookings,
  checkIns,
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
  const [activeView, setActiveView] = useState<'suggested' | 'all'>('suggested')

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

      } catch (err) {
        console.error('Error fetching data for modal:', err)
        toast.error('Could not load all customer data.')
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [supabase, event.category_id])

  const bookedCustomerIds = useMemo(
    () => new Set(currentBookings.map((b: BookingLike) => b.customer_id).filter(Boolean)),
    [currentBookings]
  )

  const checkedInCustomerIds = useMemo(
    () => new Set(checkIns.map(checkIn => checkIn.customer.id)),
    [checkIns]
  )

  const availableCustomers = useMemo(() => {
    const filtered = allCustomers
      .filter(customer => !bookedCustomerIds.has(customer.id))
      .filter(customer => {
        const mobile = customer.mobile_number ? customer.mobile_number.toLowerCase() : ''
        const fullName = formatCustomerName(customer).toLowerCase()
        const term = searchTerm.toLowerCase()
        return fullName.includes(term) || mobile.includes(term)
      })

    return filtered.sort((a, b) => {
      const firstNameComparison = (a.first_name ?? '').localeCompare(b.first_name ?? '', undefined, {
        sensitivity: 'base',
      })

      if (firstNameComparison !== 0) {
        return firstNameComparison
      }

      return (a.last_name ?? '').localeCompare(b.last_name ?? '', undefined, {
        sensitivity: 'base',
      })
    })
  }, [allCustomers, bookedCustomerIds, searchTerm])

  const selectedCustomerDetails = useMemo(() => {
    if (selectedCustomerIds.length === 0 || allCustomers.length === 0) return []
    const customerMap = new Map(allCustomers.map(customer => [customer.id, customer]))
    return selectedCustomerIds
      .map(id => customerMap.get(id))
      .filter((customer): customer is Customer => Boolean(customer))
  }, [allCustomers, selectedCustomerIds])

  const totalBookedSeats = useMemo(() => {
    return currentBookings.reduce((sum, booking) => sum + (booking.seats || 0), 0)
  }, [currentBookings])

  const addButtonLabel = isSubmitting
    ? 'Adding...'
    : selectedCustomerIds.length > 0
      ? `Add ${selectedCustomerIds.length} attendee${selectedCustomerIds.length === 1 ? '' : 's'}`
      : 'Select attendees'

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

  const handleRemoveSelected = (customerId: string) => {
    setSelectedCustomerIds(prev => prev.filter(id => id !== customerId))
  }

  const selectedSet = useMemo(() => new Set(selectedCustomerIds), [selectedCustomerIds])

  const handleCategorySuggestionsSelect = (customerIds: string[], candidateIds: string[]) => {
    const candidateSet = new Set(candidateIds)

    const retainedSelections = selectedCustomerIds.filter(id => !candidateSet.has(id))
    const allowedCandidates = customerIds.filter(id => !bookedCustomerIds.has(id))

    const merged = [...retainedSelections, ...allowedCandidates]
    setSelectedCustomerIds(Array.from(new Set(merged)))
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

  const remainingCapacity = event.capacity ? Math.max(event.capacity - totalBookedSeats, 0) : null
  const contentMaxHeight = 'calc(92vh - 240px)'

  return (
    <div className="fixed inset-0 bg-gray-500/75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Add Attendees</h2>
            <p className="mt-1 text-sm text-gray-500">
              {event.name} • {currentBookings.length} booking{currentBookings.length === 1 ? '' : 's'} • {checkIns.length} checked in
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close modal"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="px-6 py-4 flex-1 overflow-hidden min-h-0">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)] h-full min-h-0">
            <div className="flex flex-col gap-4 overflow-hidden min-h-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Currently Booked</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{currentBookings.length}</p>
                  <p className="text-xs text-gray-400">{totalBookedSeats} ticket{totalBookedSeats === 1 ? '' : 's'} reserved{event.capacity ? ` of ${event.capacity}` : ''}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Checked In</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{checkIns.length}</p>
                  <p className="text-xs text-gray-400">Live data from tonight&apos;s check-in desk</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Selected to Add</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{selectedCustomerIds.length}</p>
                  <p className="text-xs text-gray-400">{remainingCapacity !== null ? `${remainingCapacity} ticket${remainingCapacity === 1 ? '' : 's'} remaining` : 'Unlimited capacity'}</p>
                </div>
              </div>

              <div className="inline-flex items-center rounded-full bg-gray-100 p-1 text-xs font-medium w-fit">
                <button
                  type="button"
                  onClick={() => setActiveView('suggested')}
                  className={`px-4 py-1.5 rounded-full transition ${
                    activeView === 'suggested'
                      ? 'bg-white shadow-sm text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Suggested
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('all')}
                  className={`px-4 py-1.5 rounded-full transition ${
                    activeView === 'all'
                      ? 'bg-white shadow-sm text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  All Customers
                </button>
              </div>

              <div className="flex-1 overflow-hidden min-h-0">
                <div className="h-full overflow-y-auto pr-1" style={{ maxHeight: contentMaxHeight }}>
                  {activeView === 'suggested' ? (
                    <div className="space-y-4">
                      <div className="border border-gray-200 rounded-lg p-4 bg-white">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-gray-900">Tonight&apos;s Check-ins ({checkIns.length})</h3>
                          <span className="text-xs text-gray-500">Reference only</span>
                        </div>
                        {checkIns.length === 0 ? (
                          <p className="mt-3 text-sm text-gray-500">No guests have checked in yet.</p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {checkIns.map((checkIn) => (
                              <div key={checkIn.id} className="flex items-start justify-between rounded-lg bg-gray-50 px-3 py-2">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">
                                    {checkIn.customer.first_name} {checkIn.customer.last_name || ''}
                                  </p>
                                  {checkIn.customer.mobile_number && (
                                    <p className="text-xs text-gray-500">{checkIn.customer.mobile_number}</p>
                                  )}
                                  <p className="mt-1 text-xs text-gray-400 flex items-center">
                                    Checked in {formatDistanceToNow(new Date(checkIn.check_in_time), { addSuffix: true })}
                                  </p>
                                </div>
                                <CheckCircleIcon className="h-5 w-5 text-green-500 mt-1" aria-hidden="true" />
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="mt-3 text-xs text-gray-500">Guests already checked in can&apos;t be re-added, but seeing them here helps avoid double invites.</p>
                      </div>

                      {event.category_id ? (
                        <CategoryCustomerSuggestions
                          categoryId={event.category_id}
                          categories={categories}
                          onSelectCustomers={handleCategorySuggestionsSelect}
                          selectedCustomerIds={selectedCustomerIds}
                          excludedCustomerIds={Array.from(new Set([...bookedCustomerIds, ...checkedInCustomerIds]))}
                        />
                      ) : (
                        <div className="border border-dashed border-gray-300 rounded-lg p-4 text-sm text-gray-500">
                          Set a category on this event to surface regulars and smart suggestions automatically.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="relative">
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
                        <div className="py-10 text-center text-gray-500">Loading customers...</div>
                      ) : availableCustomers.length === 0 ? (
                        <div className="py-10 text-center text-gray-500 border border-gray-200 rounded-lg bg-white">
                          No new customers available to add.
                        </div>
                      ) : (
                        <div className="border border-gray-200 rounded-lg bg-white">
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
                                    onClick={(event) => event.stopPropagation()}
                                    disabled={availableCustomers.length === 0}
                                    aria-label="Select all available customers"
                                  />
                                ),
                                cell: (customer: Customer) => (
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-green-600 shadow-sm focus:ring-green-500"
                                    checked={selectedSet.has(customer.id)}
                                    onChange={() => handleSelectCustomer(customer.id)}
                                    onClick={(event) => event.stopPropagation()}
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
                                    {formatCustomerName(customer)}
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <aside
              className="hidden lg:flex flex-col bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-y-auto min-h-0"
              style={{ maxHeight: contentMaxHeight }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Selected Attendees ({selectedCustomerDetails.length})</h3>
                {selectedCustomerDetails.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCustomerIds([])}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {selectedCustomerDetails.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">
                  Pick guests on the left to add them to this event. Regulars and recent check-ins are highlighted so you can move quickly.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {selectedCustomerDetails.map((customer) => (
                    <div key={customer.id} className="flex items-start justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {formatCustomerName(customer)}
                        </p>
                        {customer.mobile_number && (
                          <p className="text-xs text-gray-500">{customer.mobile_number}</p>
                        )}
                        {recentBookerIds.has(customer.id) && (
                          <p className="text-xs text-yellow-600 mt-1">Booked in the last 90 days</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveSelected(customer.id)}
                        className="text-gray-400 hover:text-gray-600"
                        aria-label={`Remove ${formatCustomerName(customer)}`}
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-auto pt-6 space-y-2 text-xs text-gray-500">
                <p>
                  Selected guests will be booked immediately and receive the scheduled SMS reminder automatically via the existing flow.
                </p>
                <p>
                  Guests already checked in for tonight appear in the list above so you can avoid sending duplicate invites.
                </p>
              </div>
            </aside>
          </div>
          {selectedCustomerDetails.length > 0 && (
            <div className="mt-4 lg:hidden border border-gray-200 rounded-lg bg-gray-50 p-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Selected Attendees ({selectedCustomerDetails.length})
              </h3>
              <div className="mt-3 space-y-2">
                {selectedCustomerDetails.map((customer) => (
                  <div key={customer.id} className="flex items-start justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {formatCustomerName(customer)}
                      </p>
                      {customer.mobile_number && (
                        <p className="text-xs text-gray-500">{customer.mobile_number}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSelected(customer.id)}
                      className="text-gray-400 hover:text-gray-600"
                      aria-label={`Remove ${formatCustomerName(customer)}`}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-gray-500">
            Ready to add {selectedCustomerIds.length} attendee{selectedCustomerIds.length === 1 ? '' : 's'}{selectedCustomerIds.length > 0 ? ' to this event.' : '.'}
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:gap-2 sm:items-center">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex justify-center items-center rounded-lg border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || selectedCustomerIds.length === 0 || isLoading}
              className="inline-flex justify-center items-center rounded-lg border border-transparent bg-green-600 px-6 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {addButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
