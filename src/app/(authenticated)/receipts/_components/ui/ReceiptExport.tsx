'use client'

import { FormEvent, useState } from 'react'
import { Button, Select, Card, CardBody, CardHeader, FormFooter, toast, Icon } from '@/ds'
import { getLastCompletedQuarter } from '@/lib/receipts/export/default-period'

export function ReceiptExport({ canExport = false }: { canExport?: boolean }) {
  const [isExporting, setIsExporting] = useState(false)
  if (!canExport) return null
  const defaultPeriod = getLastCompletedQuarter()
  const currentYear = new Date().getUTCFullYear()
  const exportYears = [currentYear, currentYear - 1, currentYear - 2]

  // Fetched, not navigated to: a failed export used to leave the person looking at a page of
  // raw JSON, and a pack with files missing arrived with nothing to say so.
  async function handleExportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const year = formData.get('year') as string
    const quarter = formData.get('quarter') as string
    if (!year || !quarter) {
      toast.error('Select a year and quarter to export')
      return
    }
    const url = `/api/receipts/export?year=${encodeURIComponent(year)}&quarter=${encodeURIComponent(quarter)}`

    setIsExporting(true)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        let message = 'The export could not be built. Please try again.'
        try {
          const body = await response.json()
          if (typeof body?.error === 'string' && body.error) message = body.error
        } catch {
          // Not JSON: keep the plain message.
        }
        toast.error(message)
        return
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `receipts_q${quarter}_${year}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)

      const missing = Number(response.headers.get('X-Receipts-Missing-Files') ?? 0)
      if (missing > 0) {
        toast.warning(
          `${missing} file${missing === 1 ? '' : 's'} could not be included. ${missing === 1 ? 'It is' : 'They are'} listed in MISSING_FILES.txt in the pack.`
        )
      } else {
        toast.success('Export downloaded')
      }
    } catch (error) {
      console.error('Receipts export failed', error)
      toast.error('The export could not be built. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Quarterly Export" subtitle="A ZIP of one quarter: the summary, every receipt and a list of what it holds" />
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
            <Button type="submit" icon={<Icon name="download" size={16} />} loading={isExporting}>
              Export ZIP
            </Button>
          </FormFooter>
        </form>
      </CardBody>
    </Card>
  )
}
