'use client'

/**
 * "Download report" (spec 6.4 and 7.3): a quarter, financial year, tax year or custom dates, and all
 * drivers or one. The PDF covers every trip in the dates, OJ Projects trips included. Choices survive
 * an error, the button is disabled while the report builds, and a failure downloads nothing.
 */

import { useMemo, useState } from 'react'
import { Alert, Button, Input, Modal, Select } from '@/ds'
import type { MileageDriver } from '@/app/actions/mileage-drivers'
import { downloadBlob, filenameFromContentDisposition } from '@/lib/download-file'
import { financialYearOptions, quarterOptions, taxYearOptions } from '@/lib/mileage/period-options'
import {
  customPeriod,
  daysBetween,
  describePeriod,
  lastCompletedQuarter,
  MAX_REPORT_DAYS,
  type ReportPeriod,
} from '@/lib/mileage/periods'
import { LOG_START_DATE } from '@/lib/mileage/report/model'

type ListPeriodType = 'quarter' | 'financial_year' | 'tax_year'
type PeriodType = ListPeriodType | 'custom'
type PeriodOption = ReturnType<typeof quarterOptions>[number]

const PERIOD_TYPE_OPTIONS: Array<{ value: PeriodType; label: string }> = [
  { value: 'quarter', label: 'Quarter' },
  { value: 'financial_year', label: 'Financial year (January to December)' },
  { value: 'tax_year', label: 'Tax year (6 April to 5 April)' },
  { value: 'custom', label: 'Custom dates' },
]

const RENDER_FAILED = "Couldn't build the PDF. Nothing was downloaded. Try again."

interface MileageReportDialogProps {
  open: boolean
  onClose: () => void
  drivers: MileageDriver[]
  /** Today's London date as YYYY-MM-DD. */
  today: string
  /** The trips table's dates. A listed quarter, financial year or tax year opens on that period; other dates open as custom. */
  initialRange?: { from: string | null; to: string | null }
  /** The trips table's driver filter. A driver not in the list opens on all drivers. */
  initialDriverId?: string | null
  /** Table filters the PDF does not apply, named in the dialog (spec 6.4). */
  ignoredFilters?: string[]
}

interface InitialChoice {
  periodType: PeriodType
  listValue: string | null
  customFrom: string
  customTo: string
}

function initialChoice(
  today: string,
  lists: Record<ListPeriodType, PeriodOption[]>,
  range?: { from: string | null; to: string | null }
): InitialChoice {
  if (range?.from && range.to) {
    const period = describePeriod(range.from, range.to)
    if (period.kind !== 'custom' && lists[period.kind].some((option) => option.value === period.fileLabel)) {
      return { periodType: period.kind, listValue: period.fileLabel, customFrom: '', customTo: '' }
    }
  }
  // Dates that match no listed period, or only one of the two dates, open as custom dates to finish or check.
  if (range?.from || range?.to) {
    return { periodType: 'custom', listValue: null, customFrom: range.from ?? '', customTo: range.to ?? '' }
  }
  return { periodType: 'quarter', listValue: lastCompletedQuarter(today).fileLabel, customFrom: '', customTo: '' }
}

function joinWords(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export function MileageReportDialog({
  open,
  onClose,
  drivers,
  today,
  initialRange,
  initialDriverId,
  ignoredFilters = [],
}: MileageReportDialogProps): React.JSX.Element {
  const lists = useMemo(
    () => ({
      quarter: quarterOptions(LOG_START_DATE, today),
      financial_year: financialYearOptions(LOG_START_DATE, today),
      tax_year: taxYearOptions(LOG_START_DATE, today),
    }),
    [today]
  )
  // The trips page mounts the dialog only while it is open, so each opening starts from the table.
  const [initial] = useState(() => initialChoice(today, lists, initialRange))
  const [periodType, setPeriodType] = useState<PeriodType>(initial.periodType)
  const [selected, setSelected] = useState<Record<ListPeriodType, string>>(() => ({
    quarter: initial.periodType === 'quarter' && initial.listValue ? initial.listValue : lastCompletedQuarter(today).fileLabel,
    financial_year:
      initial.periodType === 'financial_year' && initial.listValue ? initial.listValue : (lists.financial_year[0]?.value ?? ''),
    tax_year: initial.periodType === 'tax_year' && initial.listValue ? initial.listValue : (lists.tax_year[0]?.value ?? ''),
  }))
  const [customFrom, setCustomFrom] = useState(initial.customFrom)
  const [customTo, setCustomTo] = useState(initial.customTo)
  const [driver, setDriver] = useState(() =>
    initialDriverId && drivers.some((entry) => entry.id === initialDriverId) ? initialDriverId : 'all'
  )
  const [dateError, setDateError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  function resolvePeriod(): ReportPeriod | null {
    if (periodType !== 'custom') {
      setDateError(null)
      return lists[periodType].find((option) => option.value === selected[periodType])?.period ?? null
    }
    let problem: string | null = null
    if (!customFrom || !customTo) problem = 'Choose a start and end date.'
    else if (customFrom > customTo) problem = 'The start date must be on or before the end date.'
    else if (daysBetween(customFrom, customTo) > MAX_REPORT_DAYS) problem = 'Choose dates no more than five years apart.'
    setDateError(problem)
    return problem ? null : customPeriod(customFrom, customTo)
  }

  // While a report builds the dialog stays open, so a failure is always seen rather than landing on a
  // closed dialog. Closing clears old messages so the next visit starts clean. Choices survive an error
  // within one opening; the trips page remounts the dialog, so the next opening starts from the table.
  function handleClose(): void {
    if (isDownloading) return
    setDateError(null)
    setDownloadError(null)
    onClose()
  }

  async function handleDownload(): Promise<void> {
    const period = resolvePeriod()
    if (!period) return

    setDownloadError(null)
    setIsDownloading(true)
    try {
      const params = new URLSearchParams({ from: period.from, to: period.to, driver })
      const response = await fetch(`/api/mileage/report?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setDownloadError(body?.error ?? RENDER_FAILED)
        return
      }

      const fileName = filenameFromContentDisposition(response.headers.get('Content-Disposition'), 'Mileage_Report.pdf')
      downloadBlob(await response.blob(), fileName)
      onClose()
    } catch {
      setDownloadError(RENDER_FAILED)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Download mileage report"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isDownloading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleDownload} loading={isDownloading} disabled={isDownloading}>
            {isDownloading ? 'Building report' : 'Download PDF'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Period type"
          value={periodType}
          onChange={(event) => setPeriodType(event.target.value as PeriodType)}
          options={PERIOD_TYPE_OPTIONS}
        />
        {periodType === 'custom' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="From" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            <Input
              label="To"
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              error={dateError ?? undefined}
            />
          </div>
        ) : (
          <Select
            label="Period"
            value={selected[periodType]}
            onChange={(event) => {
              const value = event.target.value
              setSelected((current) => ({ ...current, [periodType]: value }))
            }}
            options={lists[periodType].map(({ value, label }) => ({ value, label }))}
          />
        )}
        <Select
          label="Driver"
          value={driver}
          onChange={(event) => setDriver(event.target.value)}
          options={[{ value: 'all', label: 'All drivers' }, ...drivers.map((entry) => ({ value: entry.id, label: `${entry.displayName} only` }))]}
        />
        <p className="text-sm text-text-muted">
          The report lists every trip in these dates, OJ Projects trips included. Downloading it does not record a payment.
        </p>
        {ignoredFilters.length > 0 && (
          <p className="rounded-md bg-surface-2 p-3 text-sm text-text">
            {`The PDF uses the dates and driver only. It ignores the ${joinWords(ignoredFilters)} ${
              ignoredFilters.length === 1 ? 'filter' : 'filters'
            } on the trips table, so it lists every trip in these dates.`}
          </p>
        )}
        {downloadError && (
          <Alert tone="danger" title="Nothing was downloaded">
            {downloadError}
          </Alert>
        )}
      </div>
    </Modal>
  )
}
