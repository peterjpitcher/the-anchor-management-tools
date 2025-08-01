'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
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
      toast.success('Export downloaded successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export invoices')
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
    <PageWrapper>
      <PageHeader
        title="Export Invoices"
        subtitle="Export invoices as a ZIP file containing individual PDFs"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
      />
      <PageContent>
        <div className="space-y-6">
          {error && (
            <Alert variant="error" description={error} />
          )}

          <Card>
        <h2 className="text-lg font-semibold mb-4">Export Options</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Quick Select</label>
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQuarterDates(0)}
                leftIcon={<Calendar className="h-4 w-4" />}
              >
                Current Quarter
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQuarterDates(-1)}
                leftIcon={<Calendar className="h-4 w-4" />}
              >
                Last Quarter
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const now = new Date()
                  const yearStart = new Date(now.getFullYear(), 0, 1)
                  const yearEnd = new Date(now.getFullYear(), 11, 31)
                  setStartDate(yearStart.toISOString().split('T')[0])
                  setEndDate(yearEnd.toISOString().split('T')[0])
                }}
                leftIcon={<Calendar className="h-4 w-4" />}
              >
                Current Year
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Start Date <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                End Date <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <FormGroup label="Invoice Status">
            <Select
              value={exportType}
              onChange={(e) => setExportType(e.target.value as typeof exportType)}
            >
              <option value="all">All Invoices</option>
              <option value="paid">Paid Only</option>
              <option value="unpaid">Unpaid Only</option>
            </Select>
          </FormGroup>
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
            variant="secondary"
            onClick={() => router.push('/invoices')}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleExport}
            disabled={loading || !startDate || !endDate}
            loading={loading}
            leftIcon={<Download className="h-4 w-4" />}
          >
            Export Invoices
          </Button>
        </div>
      </Card>
        </div>
      </PageContent>
    </PageWrapper>
  )
}