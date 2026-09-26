'use client'

import { FormEvent } from 'react'
import { Button, Select, Card, CardBody, CardHeader, FormFooter, toast, Icon } from '@/ds'
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
      <CardHeader title="Quarterly Export" subtitle="Download PDF summary and receipts as ZIP" />
      <CardBody>
        <form onSubmit={handleExportSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Year"
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
              label="Quarter"
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
          <FormFooter>
            <Button type="submit" icon={<Icon name="download" size={16} />}>
              Download Bundle
            </Button>
          </FormFooter>
        </form>
      </CardBody>
    </Card>
  )
}
