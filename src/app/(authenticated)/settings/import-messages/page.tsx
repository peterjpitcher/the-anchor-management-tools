'use client'

import { useState } from 'react'
import { importMissedMessages } from '@/app/actions/import-messages'

export default function ImportMessagesPage() {
  const [startDate, setStartDate] = useState('2025-06-18')
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ error?: string; success?: boolean; summary?: { totalFound: number; inboundMessages: number; outboundMessages: number; alreadyInDatabase: number; imported: number; failed: number }; errors?: string[] } | null>(null)

  async function handleImport() {
    setLoading(true)
    setResult(null)
    
    try {
      const response = await importMissedMessages(startDate, endDate)
      setResult(response)
    } catch (error) {
      setResult({ error: 'Import failed: ' + error })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6">Import Missed Messages from Twilio</h1>
      
      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
        <p className="text-sm text-yellow-800">
          <strong>Note:</strong> This will import all SMS messages (both inbound and outbound) from Twilio that are not already in the database.
          Messages will be matched to existing customers or new customers will be created for unknown numbers.
        </p>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
            Start Date
          </label>
          <input
            type="date"
            id="startDate"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
            End Date
          </label>
          <input
            type="date"
            id="endDate"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
            disabled={loading}
          />
        </div>
      </div>

      <button
        onClick={handleImport}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Importing...' : 'Import Messages'}
      </button>

      {result && (
        <div className="mt-6">
          {result.error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <h3 className="text-red-800 font-semibold mb-2">Import Failed</h3>
              <p className="text-red-700">{result.error}</p>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-md p-4">
              <h3 className="text-green-800 font-semibold mb-2">Import Complete</h3>
              <div className="text-green-700 space-y-1">
                <p>Total messages found: {result.summary?.totalFound}</p>
                <p>Inbound messages: {result.summary?.inboundMessages}</p>
                <p>Outbound messages: {result.summary?.outboundMessages}</p>
                <p>Already in database: {result.summary?.alreadyInDatabase}</p>
                <p>Successfully imported: {result.summary?.imported}</p>
                {result.summary && result.summary.failed > 0 && (
                  <p className="text-red-600">Failed to import: {result.summary.failed}</p>
                )}
              </div>
              
              {result.errors && result.errors.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-red-800 font-semibold">Errors:</h4>
                  <ul className="text-red-700 text-sm mt-2 space-y-1">
                    {result.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-8 text-sm text-gray-600">
        <h3 className="font-semibold mb-2">How this works:</h3>
        <ul className="list-disc list-inside space-y-1">
          <li>Fetches all messages (inbound and outbound) from your Twilio account within the date range</li>
          <li>Imports both messages you sent and messages you received</li>
          <li>Skips messages that already exist in the database</li>
          <li>Creates new customers for unknown phone numbers</li>
          <li>Preserves the original timestamp from when the message was sent</li>
          <li>Calculates cost estimates for outbound messages</li>
        </ul>
      </div>
    </div>
  )
}