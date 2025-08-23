'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import Link from 'next/link'
import { formatDate } from '@/lib/dateUtils'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { 
  UserGroupIcon, 
  FunnelIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  CalendarIcon,
  TagIcon
} from '@heroicons/react/24/outline'
import { EventCategory } from '@/types/event-categories'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

interface Customer {
  id: string
  first_name: string
  last_name: string
  mobile_number: string
  sms_opt_in: boolean | null
  created_at: string
  total_bookings?: number
  event_bookings?: {
    event_id: string
    seats: number | null
  }[]
  category_preferences?: {
    category_id: string
    times_attended: number
  }[]
}

interface Event {
  id: string
  name: string
  date: string
  time: string
  category_id?: string | null
}

interface FilterOptions {
  smsOptIn: 'all' | 'opted_in' | 'not_opted_out'
  hasBookings: 'all' | 'with_bookings' | 'without_bookings'
  createdAfter: string
  createdBefore: string
  searchTerm: string
  eventId: string
  eventAttendance: 'all' | 'attending' | 'not_attending'
  bookingType: 'all' | 'bookings_only' | 'reminders_only'
  categoryId: string
  categoryAttendance: 'all' | 'regulars' | 'never_attended'
}

export default function BulkMessagePage() {
  const supabase = useSupabase()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([])
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set())
  const [customMessage, setCustomMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [events, setEvents] = useState<Event[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [filters, setFilters] = useState<FilterOptions>({
    smsOptIn: 'opted_in',
    hasBookings: 'all',
    createdAfter: '',
    createdBefore: '',
    searchTerm: '',
    eventId: '',
    eventAttendance: 'all',
    bookingType: 'all',
    categoryId: '',
    categoryAttendance: 'all'
  })

  const loadData = useCallback(async () => {
    try {
      // Load customers with booking count, event bookings, and category preferences
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select(`
          *,
          bookings(count),
          event_bookings:bookings(event_id, seats),
          category_preferences:customer_category_stats(category_id, times_attended)
        `)
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true })

      if (customersError) throw customersError

      // Load events
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*, category:event_categories(*)')
        .order('date', { ascending: false })
        .order('time', { ascending: false })

      if (eventsError) throw eventsError

      // Load categories
      const categoriesResult = await getActiveEventCategories()
      if (!categoriesResult.data) throw new Error('Failed to load categories')

      // Process customer data to include booking count, event bookings, and category preferences
      const processedCustomers = customersData?.map((customer: any) => ({
        ...customer,
        total_bookings: customer.bookings?.[0]?.count || 0,
        event_bookings: customer.event_bookings || [],
        category_preferences: customer.category_preferences || []
      })) || []

      setCustomers(processedCustomers)
      setEvents(eventsData || [])
      setCategories(categoriesResult.data)
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const applyFilters = useCallback(() => {
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

    // Event attendance filter
    if (filters.eventId && filters.eventAttendance !== 'all') {
      if (filters.eventAttendance === 'attending') {
        filtered = filtered.filter(c => 
          c.event_bookings?.some(b => b.event_id === filters.eventId)
        )
        
        // Further filter by booking type if attending an event
        if (filters.bookingType !== 'all') {
          filtered = filtered.filter(c => {
            const eventBooking = c.event_bookings?.find(b => b.event_id === filters.eventId)
            if (!eventBooking) return false
            
            if (filters.bookingType === 'bookings_only') {
              return eventBooking.seats !== null && eventBooking.seats > 0
            } else if (filters.bookingType === 'reminders_only') {
              return eventBooking.seats === null || eventBooking.seats === 0
            }
            return true
          })
        }
      } else if (filters.eventAttendance === 'not_attending') {
        filtered = filtered.filter(c => 
          !c.event_bookings?.some(b => b.event_id === filters.eventId)
        )
      }
    }

    // Category filter
    if (filters.categoryId && filters.categoryAttendance !== 'all') {
      if (filters.categoryAttendance === 'regulars') {
        filtered = filtered.filter(c => 
          c.category_preferences?.some(p => 
            p.category_id === filters.categoryId && p.times_attended > 0
          )
        )
      } else if (filters.categoryAttendance === 'never_attended') {
        filtered = filtered.filter(c => 
          !c.category_preferences?.some(p => 
            p.category_id === filters.categoryId && p.times_attended > 0
          )
        )
      }
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
  }, [customers, filters, events, categories])

  useEffect(() => {
    applyFilters()
  }, [applyFilters])

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
    const selectedEvent = events.find(e => e.id === filters.eventId)
    const selectedCategory = categories.find(c => c.id === filters.categoryId)
    
    // Replace variables with sample data for preview
    content = content.replace(/{{customer_name}}/g, 'John Smith')
    content = content.replace(/{{first_name}}/g, 'John')
    content = content.replace(/{{venue_name}}/g, 'The Anchor')
    content = content.replace(/{{contact_phone}}/g, process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '+44 1234 567890')
    content = content.replace(/{{event_name}}/g, selectedEvent?.name || 'Sample Event')
    content = content.replace(/{{event_date}}/g, selectedEvent ? formatDate(selectedEvent.date) : '25th December')
    content = content.replace(/{{event_time}}/g, selectedEvent?.time || '7:00 PM')
    content = content.replace(/{{category_name}}/g, selectedCategory?.name || 'Sample Category')
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

    // Confirmation is now handled in the button onClick

    setSending(true)

    try {
      const selectedCustomersList = customers.filter(c => selectedCustomers.has(c.id))
      const selectedCustomerIds = selectedCustomersList.map(c => c.id)
      
      // Updated threshold from 50 to 100 for better performance
      if (selectedCustomerIds.length > 100) {
        const result = await enqueueBulkSMSJob(
          selectedCustomerIds, 
          messageContent,
          filters.eventId,
          filters.categoryId
        )
        
        if (result.success && result.jobId) {
          toast.success(`Bulk SMS job queued successfully. Your ${selectedCustomerIds.length} messages will be sent within the next few minutes.`)
          setSelectedCustomers(new Set())
          setCustomMessage('') // Clear the message after sending
        } else {
          toast.error(result.error || 'Failed to queue bulk SMS job')
        }
      } else {
        // For smaller batches, use the optimized bulk send
        // The backend now handles all personalization
        const result = await sendBulkSMSDirect(
          selectedCustomerIds,
          messageContent,
          filters.eventId,
          filters.categoryId
        )
        
        if (result && 'error' in result) {
          toast.error(result.error || 'Failed to send messages')
        } else if (result && 'success' in result && result.success) {
          // Handle the response based on what's returned
          if ('sent' in result && result.sent !== undefined) {
            const sent = result.sent || 0
            const failed = 'failed' in result ? (result.failed || 0) : 0
            
            if (sent > 0 && failed === 0) {
              toast.success(`Successfully sent ${sent} messages`)
            } else if (failed > 0 && sent === 0) {
              toast.error(`Failed to send ${failed} messages`)
            } else if (sent > 0 && failed > 0) {
              toast.warning(`Sent ${sent} messages, failed ${failed}`)
            }
          } else if ('message' in result) {
            toast.success(result.message || `Messages sent successfully`)
          } else {
            toast.success(`Messages sent successfully`)
          }
          
          // Clear selection and message after sending
          setSelectedCustomers(new Set())
          setCustomMessage('')
        }
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
      <PageWrapper>
        <PageHeader
          title="Bulk Message"
          backButton={{ label: "Back to Messages", href: "/messages" }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Bulk Message"
        subtitle={`Send a message to multiple customers at once`}
        backButton={{ label: "Back to Messages", href: "/messages" }}
        breadcrumbs={[
          { label: 'Messages', href: '/messages' },
          { label: 'Bulk Message', href: '/messages/bulk' }
        ]}
        actions={
          <div className="text-sm text-gray-600">
            {selectedCustomers.size} of {filteredCustomers.length} customers selected
          </div>
        }
      />
      <PageContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters and Customer List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Filters */}
          <Section 
            title="Filters"
            icon={<FunnelIcon className="h-5 w-5" />}
          >
            <Card>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormGroup label="SMS Status">
                  <Select
                    value={filters.smsOptIn}
                    onChange={(e) => setFilters({ ...filters, smsOptIn: e.target.value as 'all' | 'opted_in' | 'not_opted_out' })}
                  >
                    <option value="all">All Customers</option>
                    <option value="opted_in">Opted In Only</option>
                    <option value="not_opted_out">Not Opted Out</option>
                  </Select>
                </FormGroup>

                <FormGroup label="Booking Status">
                  <Select
                    value={filters.hasBookings}
                    onChange={(e) => setFilters({ ...filters, hasBookings: e.target.value as 'all' | 'with_bookings' | 'without_bookings' })}
                  >
                    <option value="all">All Customers</option>
                    <option value="with_bookings">With Bookings</option>
                    <option value="without_bookings">Without Bookings</option>
                  </Select>
                </FormGroup>

                <FormGroup label="Created After">
                  <Input
                    type="date"
                    value={filters.createdAfter}
                    onChange={(e) => setFilters({ ...filters, createdAfter: e.target.value })}
                  />
                </FormGroup>

                <FormGroup label="Created Before">
                  <Input
                    type="date"
                    value={filters.createdBefore}
                    onChange={(e) => setFilters({ ...filters, createdBefore: e.target.value })}
                  />
                </FormGroup>

                <div className="md:col-span-2">
                  <FormGroup label="Category Filter">
                    <Select
                      value={filters.categoryId}
                      onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
                    >
                      <option value="">All Categories</option>
                      {categories.map(category => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  </FormGroup>
                </div>

                {filters.categoryId && (
                  <FormGroup label="Category Attendance">
                    <Select
                      value={filters.categoryAttendance}
                      onChange={(e) => setFilters({ ...filters, categoryAttendance: e.target.value as 'all' | 'regulars' | 'never_attended' })}
                    >
                      <option value="all">All Customers</option>
                      <option value="regulars">Category Regulars</option>
                      <option value="never_attended">Never Attended Category</option>
                    </Select>
                  </FormGroup>
                )}

                <div className="md:col-span-2">
                  <FormGroup label="Event Filter">
                    <Select
                      value={filters.eventId}
                      onChange={(e) => setFilters({ ...filters, eventId: e.target.value })}
                    >
                      <option value="">All Events</option>
                      {events.map(event => (
                        <option key={event.id} value={event.id}>
                          {event.name} - {new Date(event.date).toLocaleDateString()} {event.time}
                        </option>
                      ))}
                    </Select>
                  </FormGroup>
                </div>

                {filters.eventId && (
                  <>
                    <FormGroup label="Event Attendance">
                      <Select
                        value={filters.eventAttendance}
                        onChange={(e) => setFilters({ ...filters, eventAttendance: e.target.value as 'all' | 'attending' | 'not_attending' })}
                      >
                        <option value="all">All Customers</option>
                        <option value="attending">Attending Event</option>
                        <option value="not_attending">Not Attending Event</option>
                      </Select>
                    </FormGroup>

                    {filters.eventAttendance === 'attending' && (
                      <FormGroup label="Booking Type">
                        <Select
                          value={filters.bookingType}
                          onChange={(e) => setFilters({ ...filters, bookingType: e.target.value as 'all' | 'bookings_only' | 'reminders_only' })}
                        >
                          <option value="all">All Types</option>
                          <option value="bookings_only">Bookings Only (With Seats)</option>
                          <option value="reminders_only">Reminders Only (No Seats)</option>
                        </Select>
                      </FormGroup>
                    )}
                  </>
                )}

                <div className="md:col-span-2">
                  <FormGroup label="Search">
                    <div className="relative">
                      <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <Input
                        type="text"
                        value={filters.searchTerm}
                        onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                        placeholder="Search by name or phone..."
                        className="pl-10"
                      />
                    </div>
                  </FormGroup>
                </div>
              </div>
            </Card>
          </Section>

          {/* Customer List */}
          <Section 
            title={`Select Recipients (${filteredCustomers.length} customers)`}
            icon={<UserGroupIcon className="h-5 w-5" />}
            actions={
              <Button
                onClick={selectAll}
                variant="secondary"
                size="sm"
              >
                {selectedCustomers.size === filteredCustomers.length ? 'Deselect All' : 'Select All'}
              </Button>
            }
          >
            <Card>
              
              {/* Active filters summary */}
              {(filters.eventId || filters.categoryId || filters.smsOptIn !== 'all' || filters.hasBookings !== 'all') && (
                <div className="p-4 border-b flex flex-wrap gap-2">
                  {filters.categoryId && (
                    <Badge variant="info" size="sm">
                      <TagIcon className="h-3 w-3 mr-1" />
                      {categories.find(c => c.id === filters.categoryId)?.name}
                      {filters.categoryAttendance === 'regulars' && ' - Regulars'}
                      {filters.categoryAttendance === 'never_attended' && ' - Never Attended'}
                    </Badge>
                  )}
                  {filters.eventId && (
                    <Badge variant="info" size="sm">
                      <CalendarIcon className="h-3 w-3 mr-1" />
                      {events.find(e => e.id === filters.eventId)?.name}
                      {filters.eventAttendance === 'attending' && ' - Attending'}
                      {filters.eventAttendance === 'not_attending' && ' - Not Attending'}
                      {filters.bookingType === 'bookings_only' && ' (Bookings)'}
                      {filters.bookingType === 'reminders_only' && ' (Reminders)'}
                    </Badge>
                  )}
                  {filters.smsOptIn === 'opted_in' && (
                    <Badge variant="success" size="sm">
                      SMS Opted In
                    </Badge>
                  )}
                  {filters.hasBookings === 'with_bookings' && (
                    <Badge variant="info" size="sm">
                      Has Bookings
                    </Badge>
                  )}
                </div>
              )}
            
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
                        <Checkbox
                          checked={selectedCustomers.has(customer.id)}
                          onChange={(e) => toggleCustomer(customer.id)}
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
                          {filters.categoryId && customer.category_preferences?.some(p => p.category_id === filters.categoryId) && (
                            <Badge variant="info" size="sm">
                              <TagIcon className="h-3 w-3 mr-1" />
                              {(() => {
                                const pref = customer.category_preferences?.find(p => p.category_id === filters.categoryId)
                                return pref ? `${pref.times_attended}x` : ''
                              })()}
                            </Badge>
                          )}
                          {filters.eventId && customer.event_bookings?.some(b => b.event_id === filters.eventId) && (
                            <Badge variant="info" size="sm">
                              <CalendarIcon className="h-3 w-3 mr-1" />
                              {(() => {
                                const booking = customer.event_bookings?.find(b => b.event_id === filters.eventId)
                                return booking?.seats ? `${booking.seats} seats` : 'Reminder'
                              })()}
                            </Badge>
                          )}
                          {customer.total_bookings && customer.total_bookings > 0 && (
                            <Badge variant="info" size="sm">
                              {customer.total_bookings} bookings
                            </Badge>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </Section>
        </div>

        {/* Message Composition */}
        <div className="space-y-6">
          <Section title="Compose Message">
            <Card>
              <div className="space-y-4">
                <FormGroup 
                  label="Message Content"
                  help={`${customMessage.length} chars, ~${Math.ceil(customMessage.length / 160)} segments`}
                >
                  <Textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={6}
                    placeholder="Type your message here..."
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Available variables: {"{{customer_name}}"}, {"{{first_name}}"}, {"{{venue_name}}"}, {"{{contact_phone}}"}
                    {filters.eventId && (
                      <>, {"{{event_name}}"}, {"{{event_date}}"}, {"{{event_time}}"}</>
                    )}
                    {filters.categoryId && (
                      <>, {"{{category_name}}"}</>
                    )}
                  </p>
                </FormGroup>

                {/* Preview */}
                {getMessageContent() && (
                  <FormGroup label="Preview">
                    <Card className="bg-gray-50">
                      <div className="text-sm whitespace-pre-wrap">
                        {getPreviewMessage()}
                      </div>
                    </Card>
                  </FormGroup>
                )}

                {/* Warning */}
                <Alert variant="warning"
                  title="Important"
                  description="Messages will only be sent to customers who have not opted out of SMS. Standard messaging rates apply."
                  icon={<ExclamationTriangleIcon className="h-5 w-5" />}
                />

                {/* Send Button */}
                <Button
                  onClick={() => {
                    if (!confirm(`Are you sure you want to send this message to ${selectedCustomers.size} customers?`)) {
                      return
                    }
                    handleSendMessages()
                  }}
                  disabled={sending || selectedCustomers.size === 0 || !getMessageContent()}
                  loading={sending}
                  variant="primary"
                  className="w-full"
                >
                  <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                  Send to {selectedCustomers.size} Customers
                </Button>
              </div>
            </Card>
          </Section>
        </div>
      </div>
      </PageContent>
    </PageWrapper>
  )
}