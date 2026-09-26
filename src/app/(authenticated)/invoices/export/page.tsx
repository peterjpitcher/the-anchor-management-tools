'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PageLayout,
  Icon,
  Button,
  Input,
  Select,
  Field,
  Fieldset,
  Card,
  CardHeader,
  CardBody,
  Alert,
  FormFooter,
  toast,
} from '@/ds'
import { toLocalIsoDate } from '@/lib/dateUtils'
import { usePermissions } from '@/contexts/PermissionContext'
import { downloadBlob, filenameFromContentDisposition } from '@/lib/download-file'
import { getCurrentQuarterDateRange } from '@/lib/invoices/date-ranges'
import { financeNav } from '../_shared/nav'

export default function InvoiceExportPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canExport = hasPermission('invoices', 'export')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [exportType, setExportType] = useState<'all' | 'paid' | 'unpaid'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set default dates to current quarter
  useEffect(() => {
    const { startDate: quarterStart, endDate: quarterEnd } = getCurrentQuarterDateRange()

    setStartDate(quarterStart)
    setEndDate(quarterEnd)
  }, [])

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    if (!canExport) {
      router.replace('/unauthorized')
    }
  }, [permissionsLoading, canExport, router])

  async function handleExport() {
    if (!canExport) {
      toast.error('You do not have permission to export invoices')
      return
    }

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

      const blob = await response.blob()
      const filename = filenameFromContentDisposition(
        response.headers.get('content-disposition'),
        'invoices-export.zip'
      )
      downloadBlob(blob, filename)
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
    
    setStartDate(toLocalIsoDate(quarterStart))
    setEndDate(toLocalIsoDate(quarterEnd))
  }

  const layoutProps = {
    title: 'Invoices',
    subtitle: 'Export: a ZIP of invoice PDFs and a summary CSV for the accountant',
    navItems: financeNav({ canExport }),
    containerSize: 'md' as const,
  }

  if (permissionsLoading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Checking export permissions" />
  }

  if (!canExport) {
    return null
  }

  return (
    <PageLayout {...layoutProps}>
      {error && (
        <Alert tone="danger">{error}</Alert>
      )}

      <Card>
        <CardHeader title="Export Options" />
        <CardBody className="space-y-4">
          {/* The preset buttons answer one question, so the DS Fieldset names them as a group. */}
          <Fieldset legend="Quick Select">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQuarterDates(0)}
                leftIcon={<Icon name="calendar" size={16} />}
              >
                Current Quarter
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQuarterDates(-1)}
                leftIcon={<Icon name="calendar" size={16} />}
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
                  setStartDate(toLocalIsoDate(yearStart))
                  setEndDate(toLocalIsoDate(yearEnd))
                }}
                leftIcon={<Icon name="calendar" size={16} />}
              >
                Current Year
              </Button>
            </div>
          </Fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start Date" required>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </Field>

            <Field label="End Date" required>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </Field>
          </div>

          <Field label="Invoice Status">
            <Select
              value={exportType}
              onChange={(e) => setExportType(e.target.value as typeof exportType)}
            >
              <option value="all">All Invoices</option>
              <option value="paid">Paid Only</option>
              <option value="unpaid">Unpaid Only</option>
            </Select>
          </Field>

          <Alert tone="info" title="What's included" role="status">
            <ul className="list-disc space-y-1 pl-5">
              <li>Individual PDF for each invoice</li>
              <li>Invoice summary CSV file</li>
              <li>Organized by invoice number</li>
              <li>Ready for accountant submission</li>
            </ul>
          </Alert>
        </CardBody>
      </Card>

      {/* A tab page has no Cancel: there is nothing to go back to. */}
      <FormFooter>
        <Button variant="primary"
          onClick={handleExport}
          disabled={loading || !startDate || !endDate || !canExport}
          loading={loading}
          leftIcon={<Icon name="download" size={16} />}
        >
          Export ZIP
        </Button>
      </FormFooter>
    </PageLayout>
  )
}
