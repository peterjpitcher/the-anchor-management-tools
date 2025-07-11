'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ChevronLeft, Download, Calendar, AlertCircle } from 'lucide-react'

export default function InvoiceExportPage() {
  const router = useRouter()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [exportType, setExportType] = useState<'all' | 'paid' | 'unpaid'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set default dates to current quarter
  useState(() => {
    const now = new Date()
    const currentQuarter = Math.floor(now.getMonth() / 3)
    const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1)
    const quarterEnd = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0)
    
    setStartDate(quarterStart.toISOString().split('T')[0])
    setEndDate(quarterEnd.toISOString().split('T')[0])
  })

  async function handleExport() {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates')
      return
    }

    if (startDate > endDate) {
      setError('Start date must be before end date')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Create query parameters
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        type: exportType
      })

      // Trigger download
      const response = await fetch(`/api/invoices/export?${params}`)
      
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Export failed')
      }

      // Get filename from response headers
      const contentDisposition = response.headers.get('content-disposition')
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'invoices-export.zip'

      // Download the file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export invoices')
    } finally {
      setLoading(false)
    }
  }

  // Helper to set quarter dates
  function setQuarterDates(quarterOffset: number) {
    const now = new Date()
    const currentQuarter = Math.floor(now.getMonth() / 3)
    const targetQuarter = currentQuarter + quarterOffset
    const year = now.getFullYear() + Math.floor(targetQuarter / 4)
    const quarter = ((targetQuarter % 4) + 4) % 4
    
    const quarterStart = new Date(year, quarter * 3, 1)
    const quarterEnd = new Date(year, (quarter + 1) * 3, 0)
    
    setStartDate(quarterStart.toISOString().split('T')[0])
    setEndDate(quarterEnd.toISOString().split('T')[0])
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.push('/invoices')}
          className="mb-4"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Invoices
        </Button>

        <h1 className="text-3xl font-bold mb-2">Export Invoices</h1>
        <p className="text-muted-foreground">
          Export invoices as a ZIP file containing individual PDFs
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-lg font-semibold mb-4">Export Options</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Quick Select</label>
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQuarterDates(0)}
              >
                <Calendar className="h-4 w-4 mr-1" />
                Current Quarter
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQuarterDates(-1)}
              >
                <Calendar className="h-4 w-4 mr-1" />
                Last Quarter
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const now = new Date()
                  const yearStart = new Date(now.getFullYear(), 0, 1)
                  const yearEnd = new Date(now.getFullYear(), 11, 31)
                  setStartDate(yearStart.toISOString().split('T')[0])
                  setEndDate(yearEnd.toISOString().split('T')[0])
                }}
              >
                <Calendar className="h-4 w-4 mr-1" />
                Current Year
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                End Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Invoice Status
            </label>
            <select
              value={exportType}
              onChange={(e) => setExportType(e.target.value as typeof exportType)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Invoices</option>
              <option value="paid">Paid Only</option>
              <option value="unpaid">Unpaid Only</option>
            </select>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="font-medium text-blue-900 mb-2">What&apos;s included:</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Individual PDF for each invoice</li>
            <li>• Invoice summary CSV file</li>
            <li>• Organized by invoice number</li>
            <li>• Ready for accountant submission</li>
          </ul>
        </div>

        <div className="flex justify-end gap-4 mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/invoices')}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={loading || !startDate || !endDate}
          >
            <Download className="h-4 w-4 mr-2" />
            {loading ? 'Preparing Export...' : 'Export Invoices'}
          </Button>
        </div>
      </div>
    </div>
  )
}