'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { 
  ShieldCheckIcon,
  UserIcon,
  KeyIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { formatDateTime } from '@/lib/dateUtils'
import { usePermissions } from '@/contexts/PermissionContext'

interface AuditStats {
  totalEventsToday: number
  totalEventsThisWeek: number
  securityEvents: {
    type: string
    message: string
    timestamp: string
    user: string
    severity: 'info' | 'warning' | 'critical'
  }[]
  userActivity: {
    userId: string
    userEmail: string
    actionCount: number
    lastAction: string
    lastActionTime: string
  }[]
  criticalActions: {
    action: string
    resource: string
    user: string
    timestamp: string
  }[]
}

export function AuditTrailWidget() {
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()
  const [stats, setStats] = useState<AuditStats>({
    totalEventsToday: 0,
    totalEventsThisWeek: 0,
    securityEvents: [],
    userActivity: [],
    criticalActions: []
  })
  const [isLoading, setIsLoading] = useState(true)

  const canViewAudit = hasPermission('settings', 'view')

  useEffect(() => {
    if (canViewAudit) {
      loadAuditStats()
    }
  }, [canViewAudit])

  async function loadAuditStats() {
    try {
      setIsLoading(true)

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      weekAgo.setHours(0, 0, 0, 0)

      // Get audit logs for the past week
      const { data: auditLogs, error: auditError } = await supabase
        .from('audit_logs')
        .select('*')
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false })

      if (auditError) {
        // If it's a permission error, silently return empty stats
        if (auditError.message?.includes('permission') || auditError.code === '42501') {
          setStats({
            totalEventsToday: 0,
            totalEventsThisWeek: 0,
            securityEvents: [],
            userActivity: [],
            criticalActions: []
          })
          return
        }
        throw auditError
      }

      // Count events
      const todayEvents = auditLogs?.filter(log => 
        new Date(log.created_at) >= today
      ).length || 0

      const weekEvents = auditLogs?.length || 0

      // Identify security events (login, logout, permission changes, failed operations)
      const securityEvents = auditLogs?.filter(log => 
        log.operation_type === 'login' ||
        log.operation_type === 'logout' ||
        log.resource_type === 'role' ||
        log.resource_type === 'permission' ||
        log.operation_status === 'failure'
      ).map(log => {
        let severity: 'info' | 'warning' | 'critical' = 'info'
        let description = ''

        if (log.operation_status === 'failure') {
          severity = 'warning'
          description = `Failed ${log.operation_type} on ${log.resource_type}`
        } else if (log.operation_type === 'login') {
          description = 'User logged in'
        } else if (log.operation_type === 'logout') {
          description = 'User logged out'
        } else if (log.resource_type === 'role') {
          severity = 'warning'
          description = `Role ${log.operation_type}d`
        } else if (log.resource_type === 'permission') {
          severity = 'critical'
          description = `Permission ${log.operation_type}d`
        }

        return {
          type: log.operation_type,
          message: description,
          timestamp: log.created_at,
          user: log.user_email,
          severity
        }
      }).slice(0, 5) || []

      // User activity summary
      const userActivityMap = new Map<string, {
        userId: string
        userEmail: string
        actionCount: number
        lastAction: string
        lastActionTime: string
      }>()

      auditLogs?.forEach(log => {
        if (!userActivityMap.has(log.user_id)) {
          userActivityMap.set(log.user_id, {
            userId: log.user_id,
            userEmail: log.user_email,
            actionCount: 0,
            lastAction: '',
            lastActionTime: ''
          })
        }

        const user = userActivityMap.get(log.user_id)!
        user.actionCount++
        if (!user.lastAction) {
          user.lastAction = `${log.operation_type} ${log.resource_type}`
          user.lastActionTime = log.created_at
        }
      })

      const userActivity = Array.from(userActivityMap.values())
        .sort((a, b) => b.actionCount - a.actionCount)
        .slice(0, 3)

      // Critical actions (delete operations, role changes, bulk operations)
      const criticalActions = auditLogs?.filter(log =>
        log.operation_type === 'delete' ||
        log.resource_type === 'role' ||
        log.resource_type === 'permission' ||
        (log.operation_type === 'export' && log.resource_type === 'customers') ||
        (log.operation_type === 'create' && log.resource_type === 'bulk_message')
      ).map(log => ({
        action: log.operation_type,
        resource: log.resource_type,
        user: log.user_email,
        timestamp: log.created_at
      })).slice(0, 5) || []

      setStats({
        totalEventsToday: todayEvents,
        totalEventsThisWeek: weekEvents,
        securityEvents,
        userActivity,
        criticalActions
      })
    } catch (error) {
      console.error('Error loading audit stats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!canViewAudit) {
    return null // Don't show widget if user doesn't have permission
  }

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

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-100'
      case 'warning':
        return 'text-yellow-600 bg-yellow-100'
      default:
        return 'text-blue-600 bg-blue-100'
    }
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg leading-6 font-medium text-gray-900 flex items-center">
            <ShieldCheckIcon className="h-5 w-5 text-green-600 mr-2" />
            Audit & Security
          </h3>
          <Link
            href="/settings/audit-logs"
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            View Logs
          </Link>
        </div>

        {/* Activity Summary */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-semibold text-gray-900">{stats.totalEventsToday}</p>
            <p className="text-xs text-gray-600">Events Today</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-semibold text-gray-900">{stats.totalEventsThisWeek}</p>
            <p className="text-xs text-gray-600">This Week</p>
          </div>
        </div>

        {/* Security Events */}
        {stats.securityEvents.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
              <KeyIcon className="h-4 w-4 text-gray-400 mr-1" />
              Security Events
            </h4>
            <div className="space-y-2">
              {stats.securityEvents.slice(0, 3).map((event, index) => (
                <div key={index} className="flex items-start space-x-2 text-sm">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getSeverityColor(event.severity)}`}>
                    {event.severity}
                  </span>
                  <div className="flex-1">
                    <p className="text-gray-900">{event.message}</p>
                    <p className="text-xs text-gray-500">
                      {event.user} • {formatDateTime(event.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Users */}
        {stats.userActivity.length > 0 && (
          <div className="mb-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
              <UserIcon className="h-4 w-4 text-gray-400 mr-1" />
              Most Active Users
            </h4>
            <div className="space-y-2">
              {stats.userActivity.map((user, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-gray-900">{user.userEmail}</p>
                    <p className="text-xs text-gray-500">{user.lastAction}</p>
                  </div>
                  <span className="text-xs font-medium text-gray-700">
                    {user.actionCount} actions
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Critical Actions */}
        {stats.criticalActions.length > 0 && (
          <div className="pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
              <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500 mr-1" />
              Critical Actions
            </h4>
            <div className="space-y-1">
              {stats.criticalActions.slice(0, 3).map((action, index) => (
                <div key={index} className="text-xs">
                  <span className="font-medium text-gray-900">
                    {action.action} {action.resource}
                  </span>
                  <span className="text-gray-500 ml-1">
                    by {action.user}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.totalEventsThisWeek === 0 && (
          <div className="text-center py-4">
            <ShieldCheckIcon className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">No audit events this week</p>
          </div>
        )}
      </div>
    </div>
  )
}