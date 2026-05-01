'use client'

import { FormEvent } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Select } from '@/components/ui-v2/forms/Select'
import { Card } from '@/components/ui-v2/layout/Card'
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
    <Card padding="sm">
      <h2 className="text-sm font-semibold text-gray-900">Quarterly export</h2>
      <p className="text-xs text-gray-500 mb-3">Download PDF summary and receipts as ZIP.</p>
      <form onSubmit={handleExportSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Select name="year" defaultValue={String(defaultPeriod.year)}>
            <option value="" disabled>Year</option>
            {exportYears.map((yearOption) => (
              <option key={yearOption} value={yearOption}>{yearOption}</option>
            ))}
          </Select>
          <Select name="quarter" defaultValue={String(defaultPeriod.quarter)}>
            <option value="" disabled>Quarter</option>
            <option value="1">Q1 (Jan–Mar)</option>
            <option value="2">Q2 (Apr–Jun)</option>
            <option value="3">Q3 (Jul–Sep)</option>
            <option value="4">Q4 (Oct–Dec)</option>
          </Select>
        </div>
        <Button type="submit" size="sm" className="w-full">
          <DocumentArrowDownIcon className="mr-2 h-4 w-4" />
          Download bundle
        </Button>
      </form>
    </Card>
  )
}
