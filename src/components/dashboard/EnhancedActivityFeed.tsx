'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { 
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  UserPlusIcon,
  CalendarIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  UsersIcon,
  ShieldCheckIcon,
  PaperClipIcon,
  ChatBubbleBottomCenterTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'
import { formatDateTime } from '@/lib/dateUtils'
import Link from 'next/link'

interface ActivityItem {
  id: string
  type: 'booking' | 'message' | 'employee' | 'template' | 'customer' | 'event' | 'role' | 'bulk_message' | 'document' | 'note'
  title: string
  description: string
  timestamp: string
  status?: 'success' | 'warning' | 'error' | 'info'
  link?: string
  user?: string
  metadata?: Record<string, unknown>
}

interface ActivityFeedProps {
  limit?: number
  showFilters?: boolean
}

export function EnhancedActivityFeed({ limit = 10, showFilters = false }: ActivityFeedProps) {
  const supabase = useSupabase()
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  const activityTypes = [
    { id: 'booking', label: 'Bookings', icon: CalendarIcon },
    { id: 'message', label: 'Messages', icon: ChatBubbleLeftRightIcon },
    { id: 'employee', label: 'Employees', icon: UsersIcon },
    { id: 'customer', label: 'Customers', icon: UserPlusIcon },
    { id: 'template', label: 'Templates', icon: DocumentTextIcon },
    { id: 'bulk_message', label: 'Bulk SMS', icon: EnvelopeIcon }
  ]

  const loadActivity = useCallback(async () => {
    try {
      setIsLoading(true)
      const activities: ActivityItem[] = []
      
      const twentyFourHoursAgo = new Date()
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

      // Get recent bookings
      const { data: bookings } = await supabase
        .from('bookings')
        .select(`
          id,
          seats,
          created_at,
          events!inner(name, id),
          customers!inner(first_name, last_name, id)
        `)
        .gte('created_at', twentyFourHoursAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(20)

      type BookingWithRelations = {
        id: string;
        seats: number;
        created_at: string;
        customers: {
          first_name: string;
          last_name: string;
          id: string;
        };
        events: {
          name: string;
          id: string;
        };
      }

      bookings?.forEach((booking: any) => {
        activities.push({
          id: `booking-${booking.id}`,
          type: 'booking',
          title: 'New Booking',
          description: `${booking.customers.first_name} ${booking.customers.last_name} booked ${booking.seats} seat${booking.seats !== 1 ? 's' : ''} for ${booking.events.name}`,
          timestamp: booking.created_at,
          status: 'success',
          link: `/events/${booking.events.id}`
        })
      })

      // Get recent messages
      const { data: messages } = await supabase
        .from('messages')
        .select(`
          id,
          direction,
          twilio_status,
          created_at,
          customers!inner(first_name, last_name, id)
        `)
        .gte('created_at', twentyFourHoursAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(20)

      type MessageWithCustomer = {
        id: string;
        direction: string;
        twilio_status: string;
        created_at: string;
        customers: {
          first_name: string;
          last_name: string;
          id: string;
        };
      }

      messages?.forEach((message: any) => {
        const customer = message.customers
        activities.push({
          id: `message-${message.id}`,
          type: 'message',
          title: message.direction === 'inbound' ? 'SMS Received' : 'SMS Sent',
          description: `${message.direction === 'inbound' ? 'From' : 'To'} ${customer.first_name} ${customer.last_name}`,
          timestamp: message.created_at,
          status: message.twilio_status === 'delivered' ? 'success' : 
                 message.twilio_status === 'failed' ? 'error' : 'info',
          link: `/customers/${customer.id}`
        })
      })

      // Get recent employee updates from audit logs (skip if no permission)
      try {
        const { data: employeeLogs } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('resource_type', 'employee')
          .gte('created_at', twentyFourHoursAgo.toISOString())
          .order('created_at', { ascending: false })
          .limit(10)

        employeeLogs?.forEach(log => {
          const employeeName = log.new_values?.first_name && log.new_values?.last_name
            ? `${log.new_values.first_name} ${log.new_values.last_name}`
            : log.old_values?.first_name && log.old_values?.last_name
              ? `${log.old_values.first_name} ${log.old_values.last_name}`
              : 'Employee'

          activities.push({
            id: `employee-${log.id}`,
            type: 'employee',
            title: `Employee ${log.operation_type}d`,
            description: employeeName,
            timestamp: log.created_at,
            status: log.operation_status === 'success' ? 'success' : 'error',
            user: log.user_email,
            link: log.resource_id ? `/employees/${log.resource_id}` : undefined
          })
        })
      } catch (error) {
        // Skip if no permission
      }

      // Get recent customer additions
      const { data: customers } = await supabase
        .from('customers')
        .select('id, first_name, last_name, created_at')
        .gte('created_at', twentyFourHoursAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(10)

      customers?.forEach(customer => {
        activities.push({
          id: `customer-${customer.id}`,
          type: 'customer',
          title: 'New Customer',
          description: `${customer.first_name} ${customer.last_name} added`,
          timestamp: customer.created_at,
          status: 'success',
          link: `/customers/${customer.id}`
        })
      })

      // Get recent template changes (skip if no permission)
      try {
        const { data: templateLogs } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('resource_type', 'message_template')
          .gte('created_at', twentyFourHoursAgo.toISOString())
          .order('created_at', { ascending: false })
          .limit(10)

        templateLogs?.forEach(log => {
          activities.push({
            id: `template-${log.id}`,
            type: 'template',
            title: `Template ${log.operation_type}d`,
            description: log.new_values?.name || log.old_values?.name || 'Message template',
            timestamp: log.created_at,
            status: 'info',
            user: log.user_email,
            link: '/settings/message-templates'
          })
        })
      } catch (error) {
        // Skip if no permission
      }

      // Get recent bulk messages (skip if no permission)
      try {
        const { data: bulkMessages } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('resource_type', 'bulk_message')
          .eq('operation_type', 'create')
          .gte('created_at', twentyFourHoursAgo.toISOString())
          .order('created_at', { ascending: false })
          .limit(5)

        bulkMessages?.forEach(log => {
          const recipientCount = log.additional_info?.recipient_count || 0
          activities.push({
            id: `bulk-${log.id}`,
            type: 'bulk_message',
            title: 'Bulk SMS Sent',
            description: `Sent to ${recipientCount} recipient${recipientCount !== 1 ? 's' : ''}`,
            timestamp: log.created_at,
            status: 'success',
            user: log.user_email,
            link: '/messages/bulk'
          })
        })
      } catch (error) {
        // Skip if no permission
      }

      // Get recent employee notes
      const { data: notes } = await supabase
        .from('employee_notes')
        .select(`
          note_id,
          created_at,
          employee_id,
          employees!inner(first_name, last_name)
        `)
        .gte('created_at', twentyFourHoursAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(10)

      notes?.forEach(note => {
        const employee = note.employees as any
        activities.push({
          id: `note-${note.note_id}`,
          type: 'note',
          title: 'Employee Note Added',
          description: `Note added for ${employee.first_name} ${employee.last_name}`,
          timestamp: note.created_at,
          status: 'info',
          link: `/employees/${note.employee_id}`
        })
      })

      // Sort all activities by timestamp
      activities.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

      setActivities(activities)
    } catch (error) {
      console.error('Error loading activity:', error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, limit])

  useEffect(() => {
    loadActivity()
  }, [loadActivity])

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'booking':
        return CalendarIcon
      case 'message':
        return ChatBubbleLeftRightIcon
      case 'employee':
        return UsersIcon
      case 'customer':
        return UserPlusIcon
      case 'template':
        return DocumentTextIcon
      case 'bulk_message':
        return EnvelopeIcon
      case 'document':
        return PaperClipIcon
      case 'note':
        return ChatBubbleBottomCenterTextIcon
      case 'role':
        return ShieldCheckIcon
      default:
        return ClockIcon
    }
  }

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'success':
        return CheckCircleIcon
      case 'error':
        return XCircleIcon
      case 'warning':
        return ExclamationTriangleIcon
      default:
        return null
    }
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success':
        return 'text-green-500'
      case 'error':
        return 'text-red-500'
      case 'warning':
        return 'text-yellow-500'
      default:
        return 'text-gray-400'
    }
  }

  const filteredActivities = selectedTypes.length > 0
    ? activities.filter(a => selectedTypes.includes(a.type))
    : activities

  if (isLoading) {
    return (
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
          Recent Activity
        </h3>

        {showFilters && (
          <div className="mb-4 flex flex-wrap gap-2">
            {activityTypes.map(type => (
              <button
                key={type.id}
                onClick={() => {
                  setSelectedTypes(prev =>
                    prev.includes(type.id)
                      ? prev.filter(t => t !== type.id)
                      : [...prev, type.id]
                  )
                }}
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  selectedTypes.includes(type.id)
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <type.icon className="h-3 w-3 mr-1" />
                {type.label}
              </button>
            ))}
            {selectedTypes.length > 0 && (
              <button
                onClick={() => setSelectedTypes([])}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="flow-root">
          <ul className="-mb-8">
            {filteredActivities.slice(0, limit).map((activity, activityIdx) => {
              const Icon = getActivityIcon(activity.type)
              const StatusIcon = getStatusIcon(activity.status)
              
              return (
                <li key={activity.id}>
                  <div className="relative pb-8">
                    {activityIdx !== filteredActivities.slice(0, limit).length - 1 ? (
                      <span
                        className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-gray-200"
                        aria-hidden="true"
                      />
                    ) : null}
                    <div className="relative flex items-start space-x-3">
                      <div className="relative">
                        <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center">
                          <Icon className="h-5 w-5 text-gray-600" />
                        </div>
                        {StatusIcon && (
                          <span className={`absolute -bottom-0.5 -right-1 h-4 w-4 ${getStatusColor(activity.status)}`}>
                            <StatusIcon className="h-4 w-4" />
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {activity.title}
                          </p>
                          <p className="text-sm text-gray-500">
                            {activity.description}
                          </p>
                          {activity.user && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              by {activity.user}
                            </p>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          <time dateTime={activity.timestamp}>
                            {formatDateTime(activity.timestamp)}
                          </time>
                          {activity.link && (
                            <>
                              {' • '}
                              <Link
                                href={activity.link}
                                className="font-medium text-indigo-600 hover:text-indigo-500"
                              >
                                View
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        {filteredActivities.length === 0 && (
          <p className="text-center text-sm text-gray-500 py-8">
            No recent activity
          </p>
        )}
      </div>
    </div>
  )
}