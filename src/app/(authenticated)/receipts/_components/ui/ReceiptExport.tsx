'use client'

import { FormEvent } from 'react'
import { toast } from 'react-hot-toast'
import { Button, Select, Card, CardBody, CardHeader } from '@/ds'
import { DocumentArrowDownIcon } from '@heroicons/react/24/outline'
import { getLastCompletedQuarter } from '@/lib/receipts/export/default-period'

export function ReceiptExport({ canExport = false }: { canExport?: boolean }) {
  if (!canExport) return null
  const defaultPeriod = getLastCompletedQuarter()
  const currentYear = new Date().getUTCFullYear()
  const exportYears = [currentYear, currentYear - 1, currentYear - 2]

  function handleExportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const year = formData.get('year') as string
    const quarter = formData.get('quarter') as string
    if (!year || !quarter) {
      toast.error('Select a year and quarter to export')
      return
    }
    const url = `/api/receipts/export?year=${encodeURIComponent(year)}&quarter=${encodeURIComponent(quarter)}`
    window.location.href = url
  }

  return (
    <Card>
      <CardHeader title="Quarterly export" subtitle="Download PDF summary and receipts as ZIP." />
      <CardBody>
        <form onSubmit={handleExportSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Select
              name="year"
              defaultValue={String(defaultPeriod.year)}
              options={[
                { value: '', label: 'Year' },
                ...exportYears.map((yearOption) => ({
                  value: String(yearOption),
                  label: String(yearOption),
                })),
              ]}
            />
            <Select
              name="quarter"
              defaultValue={String(defaultPeriod.quarter)}
              options={[
                { value: '', label: 'Quarter' },
                { value: '1', label: 'Q1 (Jan-Mar)' },
                { value: '2', label: 'Q2 (Apr-Jun)' },
                { value: '3', label: 'Q3 (Jul-Sep)' },
                { value: '4', label: 'Q4 (Oct-Dec)' },
              ]}
            />
          </div>
          <Button type="submit" size="sm" className="w-full">
            <DocumentArrowDownIcon className="mr-2 h-4 w-4" />
            Download bundle
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
