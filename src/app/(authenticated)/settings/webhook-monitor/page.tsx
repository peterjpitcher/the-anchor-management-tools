'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { WebhookLog } from '@/types/database'

export default function WebhookMonitorPage() {
  const supabase = useSupabase()
  
  const [logs, setLogs] = useState<WebhookLog[]>([])
  const [loading, setLoading] = useState(true)
  
  const loadLogs = useCallback(async () => {
    setLoading(true)
    
    const { data, error } = await supabase
      .from('webhook_logs')
      .select('*')
      .order('processed_at', { ascending: false })
      .limit(100)
    
    if (error) {
      console.error('Error fetching webhook logs:', error)
      setLogs([])
    } else {
      setLogs(data || [])
    }
    
    setLoading(false)
  }, [supabase])
  
  useEffect(() => {
    loadLogs()
  }, [loadLogs])
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex justify-between items-center">
        <h1 className="text-3xl font-bold">Webhook Monitor</h1>
        <div className="flex gap-4">
          <Link
            href="/settings/webhook-test"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Test Webhook
          </Link>
          <button
            onClick={() => loadLogs()}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Refresh
          </button>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  From/To
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Message
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Error
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    Loading webhook logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No webhook logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDistanceToNow(new Date(log.processed_at), { addSuffix: true })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        log.status === 'success' ? 'bg-green-100 text-green-800' :
                        log.status === 'error' || log.status === 'exception' ? 'bg-red-100 text-red-800' :
                        log.status === 'signature_failed' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {log.message_body ? 'Inbound' : 'Status Update'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="text-xs">
                        {log.from_number && <div>From: {log.from_number}</div>}
                        {log.to_number && <div>To: {log.to_number}</div>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {log.message_body && (
                        <div className="max-w-xs truncate" title={log.message_body}>
                          {log.message_body}
                        </div>
                      )}
                      {log.message_sid && (
                        <div className="text-xs text-gray-500">
                          SID: {log.message_sid}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-red-600">
                      {log.error_message && (
                        <div className="max-w-xs truncate" title={log.error_message}>
                          {log.error_message}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-sm">
                      <button
                        onClick={() => {
                          const details = {
                            ...log,
                            headers: JSON.stringify(log.headers, null, 2),
                            params: JSON.stringify(log.params, null, 2),
                            error_details: JSON.stringify(log.error_details, null, 2)
                          }
                          alert(JSON.stringify(details, null, 2))
                        }}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Webhook Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">
              {logs.filter(l => l.status === 'success').length}
            </div>
            <div className="text-sm text-gray-500">Successful</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {logs.filter(l => l.status === 'error' || l.status === 'exception').length}
            </div>
            <div className="text-sm text-gray-500">Errors</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {logs.filter(l => l.status === 'signature_failed').length}
            </div>
            <div className="text-sm text-gray-500">Auth Failed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">
              {logs.length}
            </div>
            <div className="text-sm text-gray-500">Total</div>
          </div>
        </div>
      </div>
    </div>
  )
}