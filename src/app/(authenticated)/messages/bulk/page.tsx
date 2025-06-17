'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { sendBulkSMS } from '@/app/actions/sms'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { 
  UserGroupIcon, 
  FunnelIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline'

interface Customer {
  id: string
  first_name: string
  last_name: string
  mobile_number: string
  sms_opt_in: boolean | null
  created_at: string
  total_bookings?: number
}


interface FilterOptions {
  smsOptIn: 'all' | 'opted_in' | 'not_opted_out'
  hasBookings: 'all' | 'with_bookings' | 'without_bookings'
  createdAfter: string
  createdBefore: string
  searchTerm: string
}

export default function BulkMessagePage() {
  const supabase = useSupabase()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([])
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set())
  const [customMessage, setCustomMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [filters, setFilters] = useState<FilterOptions>({
    smsOptIn: 'opted_in',
    hasBookings: 'all',
    createdAfter: '',
    createdBefore: '',
    searchTerm: ''
  })
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [customers, filters])

  async function loadData() {
    try {
      // Load customers with booking count
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select(`
          *,
          bookings(count)
        `)
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true })

      if (customersError) throw customersError

      // Process customer data to include booking count
      const processedCustomers = customersData?.map(customer => ({
        ...customer,
        total_bookings: customer.bookings?.[0]?.count || 0
      })) || []

      setCustomers(processedCustomers)
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function applyFilters() {
    let filtered = [...customers]

    // SMS opt-in filter
    if (filters.smsOptIn === 'opted_in') {
      filtered = filtered.filter(c => c.sms_opt_in === true)
    } else if (filters.smsOptIn === 'not_opted_out') {
      filtered = filtered.filter(c => c.sms_opt_in !== false)
    }

    // Bookings filter
    if (filters.hasBookings === 'with_bookings') {
      filtered = filtered.filter(c => (c.total_bookings || 0) > 0)
    } else if (filters.hasBookings === 'without_bookings') {
      filtered = filtered.filter(c => (c.total_bookings || 0) === 0)
    }

    // Date filters
    if (filters.createdAfter) {
      filtered = filtered.filter(c => new Date(c.created_at) >= new Date(filters.createdAfter))
    }
    if (filters.createdBefore) {
      filtered = filtered.filter(c => new Date(c.created_at) <= new Date(filters.createdBefore))
    }

    // Search filter
    if (filters.searchTerm) {
      const search = filters.searchTerm.toLowerCase()
      filtered = filtered.filter(c => {
        const fullName = `${c.first_name} ${c.last_name}`.toLowerCase()
        return fullName.includes(search) || c.mobile_number.includes(search)
      })
    }

    setFilteredCustomers(filtered)
  }

  function toggleCustomer(customerId: string) {
    const newSelected = new Set(selectedCustomers)
    if (newSelected.has(customerId)) {
      newSelected.delete(customerId)
    } else {
      newSelected.add(customerId)
    }
    setSelectedCustomers(newSelected)
  }

  function selectAll() {
    if (selectedCustomers.size === filteredCustomers.length) {
      setSelectedCustomers(new Set())
    } else {
      setSelectedCustomers(new Set(filteredCustomers.map(c => c.id)))
    }
  }

  function getMessageContent() {
    return customMessage
  }

  function getPreviewMessage() {
    let content = getMessageContent()
    // Replace variables with sample data for preview
    content = content.replace(/{{customer_name}}/g, 'John Smith')
    content = content.replace(/{{first_name}}/g, 'John')
    content = content.replace(/{{venue_name}}/g, 'The Anchor')
    content = content.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '+44 1234 567890')
    return content
  }

  async function handleSendMessages() {
    if (selectedCustomers.size === 0) {
      toast.error('Please select at least one customer')
      return
    }

    const messageContent = getMessageContent()
    if (!messageContent.trim()) {
      toast.error('Please enter a message or select a template')
      return
    }

    if (!confirm(`Are you sure you want to send this message to ${selectedCustomers.size} customers?`)) {
      return
    }

    setSending(true)
    const results = { success: 0, failed: 0 }

    try {
      // Send messages to selected customers
      const selectedCustomersList = customers.filter(c => selectedCustomers.has(c.id))
      
      for (const customer of selectedCustomersList) {
        try {
          // Personalize the message
          let personalizedContent = messageContent
          personalizedContent = personalizedContent.replace(/{{customer_name}}/g, `${customer.first_name} ${customer.last_name}`)
          personalizedContent = personalizedContent.replace(/{{first_name}}/g, customer.first_name)
          personalizedContent = personalizedContent.replace(/{{venue_name}}/g, 'The Anchor')
          personalizedContent = personalizedContent.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '')

          const result = await sendBulkSMS(customer.id, personalizedContent)
          
          if ('error' in result) {
            console.error(`Failed to send to ${customer.first_name} ${customer.last_name}:`, result.error)
            results.failed++
          } else {
            results.success++
          }
        } catch (error) {
          console.error(`Error sending to ${customer.first_name} ${customer.last_name}:`, error)
          results.failed++
        }
      }

      // Show results
      if (results.success > 0 && results.failed === 0) {
        toast.success(`Successfully sent ${results.success} messages`)
        // Clear selection
        setSelectedCustomers(new Set())
      } else if (results.failed > 0 && results.success === 0) {
        toast.error(`Failed to send all ${results.failed} messages`)
      } else {
        toast.error(`Sent ${results.success} messages, ${results.failed} failed`)
      }
    } catch (error) {
      console.error('Error sending bulk messages:', error)
      toast.error('Failed to send messages')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading customers...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              href="/messages"
              className="text-gray-600 hover:text-gray-900"
            >
              <ArrowLeftIcon className="h-6 w-6" />
            </Link>
            <h1 className="text-3xl font-bold">Bulk Message</h1>
          </div>
          <div className="text-sm text-gray-600">
            {selectedCustomers.size} of {filteredCustomers.length} customers selected
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters and Customer List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Filters */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium mb-4 flex items-center">
              <FunnelIcon className="h-5 w-5 mr-2" />
              Filters
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SMS Status</label>
                <select
                  value={filters.smsOptIn}
                  onChange={(e) => setFilters({ ...filters, smsOptIn: e.target.value as any })}
                  className="block w-full rounded-md border-gray-300 shadow-sm"
                >
                  <option value="all">All Customers</option>
                  <option value="opted_in">Opted In Only</option>
                  <option value="not_opted_out">Not Opted Out</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Booking Status</label>
                <select
                  value={filters.hasBookings}
                  onChange={(e) => setFilters({ ...filters, hasBookings: e.target.value as any })}
                  className="block w-full rounded-md border-gray-300 shadow-sm"
                >
                  <option value="all">All Customers</option>
                  <option value="with_bookings">With Bookings</option>
                  <option value="without_bookings">Without Bookings</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Created After</label>
                <input
                  type="date"
                  value={filters.createdAfter}
                  onChange={(e) => setFilters({ ...filters, createdAfter: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Created Before</label>
                <input
                  type="date"
                  value={filters.createdBefore}
                  onChange={(e) => setFilters({ ...filters, createdBefore: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    value={filters.searchTerm}
                    onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                    placeholder="Search by name or phone..."
                    className="block w-full pl-10 rounded-md border-gray-300 shadow-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Customer List */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium flex items-center">
                  <UserGroupIcon className="h-5 w-5 mr-2" />
                  Select Recipients ({filteredCustomers.length} customers)
                </h2>
                <button
                  onClick={selectAll}
                  className="text-sm text-indigo-600 hover:text-indigo-900"
                >
                  {selectedCustomers.size === filteredCustomers.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            </div>
            
            <div className="max-h-96 overflow-y-auto">
              {filteredCustomers.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  No customers match your filters
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredCustomers.map((customer) => (
                    <label
                      key={customer.id}
                      className="flex items-center p-4 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCustomers.has(customer.id)}
                        onChange={() => toggleCustomer(customer.id)}
                        className="h-4 w-4 text-indigo-600 rounded border-gray-300"
                      />
                      <div className="ml-3 flex-1">
                        <div className="text-sm font-medium text-gray-900">{customer.first_name} {customer.last_name}</div>
                        <div className="text-sm text-gray-500">{customer.mobile_number}</div>
                      </div>
                      <div className="ml-3 flex items-center space-x-2">
                        {customer.sms_opt_in === true && (
                          <CheckCircleIcon className="h-5 w-5 text-green-500" title="SMS Opted In" />
                        )}
                        {customer.sms_opt_in === false && (
                          <XCircleIcon className="h-5 w-5 text-red-500" title="SMS Opted Out" />
                        )}
                        {customer.total_bookings && customer.total_bookings > 0 && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                            {customer.total_bookings} bookings
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Message Composition */}
        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium mb-4">Compose Message</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message Content
                  <span className="text-xs text-gray-500 ml-2">
                    ({customMessage.length} chars, ~{Math.ceil(customMessage.length / 160)} segments)
                  </span>
                </label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={6}
                  className="block w-full rounded-md border-gray-300 shadow-sm"
                  placeholder="Type your message here..."
                />
                <p className="mt-2 text-xs text-gray-500">
                  Available variables: {"{{customer_name}}"}, {"{{first_name}}"}, {"{{venue_name}}"}, {"{{contact_phone}}"}
                </p>
              </div>

              {/* Preview */}
              {getMessageContent() && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Preview</label>
                  <div className="p-3 bg-gray-100 rounded-md text-sm whitespace-pre-wrap">
                    {getPreviewMessage()}
                  </div>
                </div>
              )}

              {/* Warning */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                <div className="flex">
                  <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">Important</h3>
                    <p className="mt-1 text-sm text-yellow-700">
                      Messages will only be sent to customers who have not opted out of SMS.
                      Standard messaging rates apply.
                    </p>
                  </div>
                </div>
              </div>

              {/* Send Button */}
              <button
                onClick={handleSendMessages}
                disabled={sending || selectedCustomers.size === 0 || !getMessageContent()}
                className={`w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                  sending || selectedCustomers.size === 0 || !getMessageContent()
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {sending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                    Send to {selectedCustomers.size} Customers
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}