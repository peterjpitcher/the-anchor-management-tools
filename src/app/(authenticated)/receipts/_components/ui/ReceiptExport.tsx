'use client'

import { FormEvent } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Select } from '@/components/ui-v2/forms/Select'
import { Card } from '@/components/ui-v2/layout/Card'
import { DocumentArrowDownIcon } from '@heroicons/react/24/outline'

export function ReceiptExport() {
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
    <Card className="lg:col-span-2" header={<div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Quarterly export</h2>
        <p className="text-sm text-gray-500">Download a PDF summary and all receipts as a ZIP.</p>
      </div>
    </div>}>
      <form onSubmit={handleExportSubmit} className="grid gap-3 sm:grid-cols-2">
        <Select name="year" defaultValue={String(currentYear)}>
          <option value="" disabled>Year</option>
          {exportYears.map((yearOption) => (
            <option key={yearOption} value={yearOption}>{yearOption}</option>
          ))}
        </Select>
        <Select name="quarter" defaultValue={String(Math.ceil((new Date().getUTCMonth() + 1) / 3))}>
          <option value="" disabled>Quarter</option>
          <option value="1">Q1 (January to March)</option>
          <option value="2">Q2 (April to June)</option>
          <option value="3">Q3 (July to September)</option>
          <option value="4">Q4 (October to December)</option>
        </Select>
        <Button type="submit" className="sm:col-span-2">
          <DocumentArrowDownIcon className="mr-2 h-5 w-5" />
          Download receipts bundle
        </Button>
      </form>
    </Card>
  )
}
