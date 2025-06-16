'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDate } from '@/lib/dateUtils'
import toast from 'react-hot-toast'

interface AuditLog {
  id: string
  created_at: string
  user_email: string | null
  operation_type: string
  resource_type: string
  resource_id: string | null
  operation_status: 'success' | 'failure'
  ip_address: string | null
  error_message: string | null
  old_values: any
  new_values: any
  additional_info: any
}

export default function AuditLogsPage() {
  const supabase = useSupabase()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    operationType: '',
    resourceType: '',
    status: '',
    dateFrom: '',
    dateTo: ''
  })
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  useEffect(() => {
    loadAuditLogs()
  }, [filters])

  async function loadAuditLogs() {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      // Apply filters
      if (filters.operationType) {
        query = query.eq('operation_type', filters.operationType)
      }
      if (filters.resourceType) {
        query = query.eq('resource_type', filters.resourceType)
      }
      if (filters.status) {
        query = query.eq('operation_status', filters.status)
      }
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom)
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59')
      }

      const { data, error } = await query

      if (error) {
        console.error('Error loading audit logs:', error)
        toast.error('Failed to load audit logs')
      } else {
        setLogs(data || [])
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }

  const getOperationIcon = (type: string) => {
    switch (type) {
      case 'create': return '➕'
      case 'update': return '✏️'
      case 'delete': return '🗑️'
      case 'view': return '👁️'
      case 'login': return '🔐'
      case 'logout': return '🚪'
      case 'export': return '📤'
      case 'upload': return '📎'
      case 'download': return '📥'
      default: return '📝'
    }
  }

  const getStatusColor = (status: string) => {
    return status === 'success' ? 'text-green-600' : 'text-red-600'
  }

  if (loading) {
    return <div className="p-4">Loading audit logs...</div>
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Audit Logs</h1>
      
      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <select
            value={filters.operationType}
            onChange={(e) => setFilters({ ...filters, operationType: e.target.value })}
            className="rounded-md border-gray-300"
          >
            <option value="">All Operations</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="view">View</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
            <option value="export">Export</option>
            <option value="upload">Upload</option>
            <option value="download">Download</option>
          </select>

          <select
            value={filters.resourceType}
            onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
            className="rounded-md border-gray-300"
          >
            <option value="">All Resources</option>
            <option value="employee">Employee</option>
            <option value="customer">Customer</option>
            <option value="booking">Booking</option>
            <option value="event">Event</option>
            <option value="financial_details">Financial Details</option>
            <option value="attachment">Attachment</option>
            <option value="message">Message</option>
            <option value="auth">Authentication</option>
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="rounded-md border-gray-300"
          >
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>

          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            className="rounded-md border-gray-300"
            placeholder="From date"
          />

          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            className="rounded-md border-gray-300"
            placeholder="To date"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Operation
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Resource
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                IP Address
              </th>
              <th className="relative px-6 py-3">
                <span className="sr-only">View</span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDate(log.created_at)}<br />
                  <span className="text-xs text-gray-500">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {log.user_email || 'System'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <span className="mr-2">{getOperationIcon(log.operation_type)}</span>
                  {log.operation_type}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {log.resource_type}
                  {log.resource_id && (
                    <span className="text-xs text-gray-500 block">
                      ID: {log.resource_id.slice(0, 8)}...
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={getStatusColor(log.operation_status)}>
                    {log.operation_status}
                  </span>
                  {log.error_message && (
                    <span className="text-xs text-red-600 block">
                      {log.error_message}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {log.ip_address || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    {expandedLog === log.id ? 'Hide' : 'Details'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {logs.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No audit logs found matching your filters
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {expandedLog && (
        <div className="mt-4 bg-white shadow rounded-lg p-6">
          {(() => {
            const log = logs.find(l => l.id === expandedLog)
            if (!log) return null
            
            return (
              <div>
                <h3 className="text-lg font-semibold mb-4">Log Details</h3>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Log ID</dt>
                    <dd className="mt-1 text-sm text-gray-900">{log.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Timestamp</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(log.created_at).toLocaleString()}
                    </dd>
                  </div>
                  {log.old_values && (
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Old Values</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
                          {JSON.stringify(log.old_values, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  )}
                  {log.new_values && (
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">New Values</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
                          {JSON.stringify(log.new_values, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  )}
                  {log.additional_info && (
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Additional Info</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
                          {JSON.stringify(log.additional_info, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}