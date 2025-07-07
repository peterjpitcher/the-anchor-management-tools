'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchTwilioMessages, MessageComparison } from './actions'
import { ArrowLeftIcon, CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import toast from 'react-hot-toast'

export default function TwilioMessagesPage() {
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<MessageComparison[]>([])
  const [unloggedCount, setUnloggedCount] = useState<number | null>(null)
  const [showUnloggedOnly, setShowUnloggedOnly] = useState(false)
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 24 hours ago
    endDate: new Date().toISOString().split('T')[0] // Today
  })

  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchTwilioMessages(dateRange.startDate, dateRange.endDate, 200)
      
      if (result.error) {
        toast.error(result.error)
        return
      }

      if (result.messages) {
        const filteredMessages = showUnloggedOnly 
          ? result.messages.filter(m => !m.isLogged)
          : result.messages
        
        setMessages(filteredMessages)
        
        // Count unlogged messages
        const unlogged = result.messages.filter(m => !m.isLogged).length
        setUnloggedCount(unlogged)
      }
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [dateRange, showUnloggedOnly])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  function formatPhoneNumber(phone: string) {
    // Remove country code for display
    if (phone.startsWith('+44')) {
      return '0' + phone.substring(3)
    }
    return phone
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'delivered':
      case 'sent':
        return 'text-green-600'
      case 'failed':
      case 'undelivered':
        return 'text-red-600'
      case 'queued':
      case 'sending':
        return 'text-yellow-600'
      default:
        return 'text-gray-600'
    }
  }

  function getDirectionIcon(direction: string) {
    if (direction.startsWith('outbound')) {
      return '↗️ '
    } else if (direction === 'inbound') {
      return '↙️ '
    }
    return ''
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              href="/settings"
              className="text-gray-600 hover:text-gray-900"
            >
              <ArrowLeftIcon className="h-6 w-6" />
            </Link>
            <h1 className="text-3xl font-bold">Twilio Messages Monitor</h1>
          </div>
          {unloggedCount !== null && unloggedCount > 0 && (
            <div className="flex items-center space-x-2 text-amber-600">
              <ExclamationTriangleIcon className="h-5 w-5" />
              <span className="font-medium">{unloggedCount} unlogged messages</span>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
              className="block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
              className="block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={showUnloggedOnly}
                onChange={(e) => setShowUnloggedOnly(e.target.checked)}
                className="rounded border-gray-300 text-green-600 focus:ring-green-500 h-4 w-4 mr-2"
              />
              <span className="text-sm font-medium text-gray-700">Show unlogged only</span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={loadMessages}
              disabled={loading}
              className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Message Comparison Stats */}
      {!showUnloggedOnly && messages.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Messages</p>
                <p className="text-2xl font-bold">{messages.length}</p>
              </div>
              <div className="text-blue-500">
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Logged in Database</p>
                <p className="text-2xl font-bold text-green-600">{messages.filter(m => m.isLogged).length}</p>
              </div>
              <CheckCircleIcon className="h-8 w-8 text-green-500" />
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Not Logged</p>
                <p className="text-2xl font-bold text-amber-600">{unloggedCount || 0}</p>
              </div>
              <ExclamationTriangleIcon className="h-8 w-8 text-amber-500" />
            </div>
          </div>
        </div>
      )}

      {/* Messages Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium">
            {showUnloggedOnly ? 'Unlogged Messages' : 'All Messages'} 
            {loading && <span className="text-sm text-gray-500 ml-2">(Loading...)</span>}
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
            <p className="mt-4 text-gray-500">Loading messages from Twilio...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No messages found for the selected date range
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Direction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    From/To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Message
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date Sent
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Segments
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Logged
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {messages.map((comparison) => {
                  const msg = comparison.twilioMessage
                  const dateSent = msg.dateSent || msg.dateCreated
                  const isOutbound = msg.direction.startsWith('outbound')
                  
                  return (
                    <tr key={msg.sid} className={comparison.isLogged ? '' : 'bg-amber-50'}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm font-medium ${getStatusColor(msg.status)}`}>
                          {msg.status}
                        </span>
                        {msg.errorCode && (
                          <div className="text-xs text-red-600 mt-1">
                            Error {msg.errorCode}: {msg.errorMessage}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getDirectionIcon(msg.direction)}
                        {msg.direction}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">
                            {isOutbound ? 'To:' : 'From:'} {formatPhoneNumber(isOutbound ? msg.to : msg.from)}
                          </div>
                          <div className="text-gray-500">
                            {isOutbound ? 'From:' : 'To:'} {formatPhoneNumber(isOutbound ? msg.from : msg.to)}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-md truncate" title={msg.body}>
                          {msg.body}
                        </div>
                        {comparison.dbMessage && comparison.dbMessage.body !== msg.body && (
                          <div className="text-xs text-amber-600 mt-1">
                            ⚠️ Body mismatch in database
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {dateSent.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {msg.numSegments}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {comparison.isLogged ? (
                          <CheckCircleIcon className="h-5 w-5 text-green-500" title="Logged in database" />
                        ) : (
                          <XCircleIcon className="h-5 w-5 text-red-500" title="Not found in database" />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Legend:</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="h-4 w-4 text-green-500" />
            <span>Message logged in database</span>
          </div>
          <div className="flex items-center space-x-2">
            <XCircleIcon className="h-4 w-4 text-red-500" />
            <span>Message not found in database</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="h-4 w-8 bg-amber-50 border border-amber-200 rounded"></div>
            <span>Unlogged message row</span>
          </div>
        </div>
      </div>
    </div>
  )
}