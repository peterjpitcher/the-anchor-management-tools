'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button, Card, CardBody, CardHeader, Select } from '@/ds'
import type { PrivateBookingGrowthSnapshot } from '@/lib/analytics/private-booking-growth'
import {
  buildAnnualPrivateBookingSeries,
  buildMonthlyPrivateBookingSeries,
  buildPrivateBookingSeasonality,
  categorisePrivateBookingOccasion,
  countPrivateBookingsYearToDate,
  resolvePrivateBookingRangeStartYear,
  type PrivateBookingGrowthRange,
} from '@/lib/analytics/private-booking-growth-model'
import { formatDateTimeInLondon } from '@/lib/dateUtils'

type Granularity = 'year' | 'month'

const RANGE_OPTIONS: Array<{ value: PrivateBookingGrowthRange; label: string }> = [
  { value: 'all', label: 'All history' },
  { value: 'five_years', label: 'Last 5 years' },
  { value: 'three_years', label: 'Last 3 years' },
]

const numberFormatter = new Intl.NumberFormat('en-GB')
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function utcDate(value: string): Date {
  return new Date(`${value}T12:00:00Z`)
}

function formatSignedChange(value: number): string {
  if (value === 0) return 'No change'
  return `${value > 0 ? '+' : ''}${numberFormatter.format(value)}`
}

function TrendTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-[150px] rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-text-strong">{label}</p>
      {payload.map((item) => (
        <p key={item.dataKey} className="flex items-center justify-between gap-4 text-text-muted">
          <span>{item.dataKey === 'bookings' ? 'Bookings' : 'Running total'}</span>
          <span className="font-semibold text-text-strong">{numberFormatter.format(item.value)}</span>
        </p>
      ))}
    </div>
  )
}

function MetricCard({ label, value, detail, accent = false }: {
  label: string
  value: string
  detail: string
  accent?: boolean
}) {
  return (
    <Card className={accent ? 'border-primary/30 bg-primary-soft' : undefined}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-text-strong">{value}</p>
      <p className="mt-1 text-xs leading-5 text-text-muted">{detail}</p>
    </Card>
  )
}

export default function PrivateBookingGrowthReportClient({ snapshot }: {
  snapshot: PrivateBookingGrowthSnapshot
}) {
  const currentYear = Number(snapshot.asOfDate.slice(0, 4))
  const firstYear = snapshot.firstRecordDate ? Number(snapshot.firstRecordDate.slice(0, 4)) : currentYear
  const [range, setRange] = useState<PrivateBookingGrowthRange>('all')
  const [occasion, setOccasion] = useState('all')
  const [granularity, setGranularity] = useState<Granularity>('year')

  const occasionOptions = useMemo(() => {
    return Array.from(new Set(snapshot.records.map((record) => categorisePrivateBookingOccasion(record.eventType))))
      .sort((a, b) => a.localeCompare(b))
  }, [snapshot.records])

  const startYear = resolvePrivateBookingRangeStartYear(range, firstYear, currentYear)
  const filteredRecords = useMemo(() => snapshot.records.filter((record) => {
    const recordYear = Number(record.eventDate.slice(0, 4))
    const matchesRange = recordYear >= startYear
    const matchesOccasion = occasion === 'all' || categorisePrivateBookingOccasion(record.eventType) === occasion
    return matchesRange && matchesOccasion
  }), [occasion, snapshot.records, startYear])

  const annualSeries = useMemo(
    () => buildAnnualPrivateBookingSeries(filteredRecords, startYear, currentYear),
    [currentYear, filteredRecords, startYear],
  )
  const monthlySeries = useMemo(
    () => buildMonthlyPrivateBookingSeries(filteredRecords, startYear, snapshot.asOfDate),
    [filteredRecords, snapshot.asOfDate, startYear],
  )
  const trendSeries: Array<{ period: string; bookings: number; cumulative: number }> = granularity === 'year'
    ? annualSeries.map((row) => ({
        period: row.period,
        bookings: row.bookings,
        cumulative: row.cumulative,
      }))
    : monthlySeries.map((row) => ({
        period: row.label,
        bookings: row.bookings,
        cumulative: row.cumulative,
      }))
  const seasonality = useMemo(() => buildPrivateBookingSeasonality(filteredRecords), [filteredRecords])
  const occasionMix = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of filteredRecords) {
      const category = categorisePrivateBookingOccasion(record.eventType)
      counts.set(category, (counts.get(category) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([category, bookings]) => ({ category, bookings }))
      .sort((a, b) => b.bookings - a.bookings || a.category.localeCompare(b.category))
  }, [filteredRecords])

  const monthDayCutoff = snapshot.asOfDate.slice(5)
  const thisYearCount = countPrivateBookingsYearToDate(filteredRecords, currentYear, monthDayCutoff)
  const priorYearCount = countPrivateBookingsYearToDate(filteredRecords, currentYear - 1, monthDayCutoff)
  const yearToDateChange = thisYearCount - priorYearCount
  const knownGuestRecords = filteredRecords.filter((record) => record.guestCount !== null)
  const knownGuests = knownGuestRecords.reduce((sum, record) => sum + (record.guestCount || 0), 0)
  const guestCoverage = filteredRecords.length === 0
    ? 0
    : Math.round((knownGuestRecords.length / filteredRecords.length) * 100)
  const busiestYear = [...annualSeries].sort((a, b) => b.bookings - a.bookings || b.year - a.year)[0]
  const hasFilters = range !== 'all' || occasion !== 'all'

  const generatedAt = formatDateTimeInLondon(snapshot.generatedAt, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-primary/25 bg-[linear-gradient(120deg,var(--color-primary-soft),var(--color-surface)_62%)] shadow-sm">
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Booking record</p>
            <p className="mt-2 max-w-3xl text-lg font-semibold leading-7 text-text-strong">
              From {snapshot.firstRecordDate ? dateFormatter.format(utcDate(snapshot.firstRecordDate)) : 'the first record'} to {dateFormatter.format(utcDate(snapshot.asOfDate))}
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-text-muted">
              Confirmed and completed customer private bookings, grouped by event date. Cancelled, draft, future and test records are excluded.
            </p>
          </div>
          <p className="text-xs text-text-muted">Updated {generatedAt}</p>
        </div>
        <div className="border-t border-primary/15 bg-surface/70 px-5 py-4 lg:px-7">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Reporting period">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={range === option.value}
                  onClick={() => setRange(option.value)}
                  className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-hidden focus-visible:shadow-ring ${
                    range === option.value
                      ? 'bg-primary text-primary-fg shadow-sm'
                      : 'border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text-strong'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <label className="min-w-0 text-xs font-semibold text-text-muted sm:w-64">
                Occasion
                <Select
                  value={occasion}
                  onChange={(event) => setOccasion(event.target.value)}
                  className="mt-1 w-full"
                >
                  <option value="all">All occasions</option>
                  {occasionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </Select>
              </label>
              {hasFilters && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-end"
                  onClick={() => {
                    setRange('all')
                    setOccasion('all')
                  }}
                >
                  Reset filters
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Growth summary">
        <MetricCard
          label="Bookings shown"
          value={numberFormatter.format(filteredRecords.length)}
          detail={`${startYear} to ${currentYear}, including years with none`}
          accent
        />
        <MetricCard
          label={`${currentYear} to date`}
          value={numberFormatter.format(thisYearCount)}
          detail={`${formatSignedChange(yearToDateChange)} versus the same point in ${currentYear - 1}`}
        />
        <MetricCard
          label="Busiest year"
          value={busiestYear ? String(busiestYear.year) : 'None'}
          detail={busiestYear ? `${numberFormatter.format(busiestYear.bookings)} bookings in the current filter` : 'No bookings match the filter'}
        />
        <MetricCard
          label="Known guests"
          value={numberFormatter.format(knownGuests)}
          detail={`Guest numbers recorded for ${guestCoverage}% of shown bookings`}
        />
      </section>

      <Card className="min-w-0">
        <CardHeader
          title="Bookings and running total"
          subtitle="Bars show events in each period. The line shows the accumulated booking record."
          action={
            <div className="flex rounded-md border border-border bg-surface-2 p-0.5" role="group" aria-label="Chart interval">
              {(['year', 'month'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={granularity === option}
                  onClick={() => setGranularity(option)}
                  className={`rounded-sm px-2.5 py-1 text-xs font-semibold focus-visible:outline-hidden focus-visible:shadow-ring ${
                    granularity === option ? 'bg-surface text-text-strong shadow-sm' : 'text-text-muted'
                  }`}
                >
                  {option === 'year' ? 'Yearly' : 'Monthly'}
                </button>
              ))}
            </div>
          }
        />
        <CardBody className="pt-5">
          {filteredRecords.length === 0 ? (
            <div className="flex h-80 items-center justify-center rounded-lg bg-surface-2 text-sm text-text-muted">
              No bookings match these filters.
            </div>
          ) : (
            <div className="h-[360px] min-w-0 w-full" role="img" aria-label="Private bookings and running total over time">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendSeries} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <defs>
                    <linearGradient id="privateBookingGrowthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 5" />
                  <XAxis
                    dataKey="period"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={granularity === 'month' ? 32 : 8}
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  />
                  <YAxis
                    yAxisId="period"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  />
                  <YAxis
                    yAxisId="total"
                    orientation="right"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    width={34}
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  />
                  <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--color-surface-hover)' }} />
                  <Bar yAxisId="period" dataKey="bookings" fill="var(--color-primary)" radius={[4, 4, 1, 1]} maxBarSize={42} isAnimationActive={false} />
                  <Area yAxisId="total" type="monotone" dataKey="cumulative" stroke="var(--color-chart-3)" strokeWidth={2.5} fill="url(#privateBookingGrowthFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Occasion mix" subtitle="Broad categories combine spelling and naming variations." />
          <CardBody>
            {occasionMix.length === 0 ? (
              <p className="py-12 text-center text-sm text-text-muted">No occasion data for this selection.</p>
            ) : (
              <div className="h-[340px] min-w-0" role="img" aria-label="Private bookings by occasion category">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={occasionMix} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 12 }}>
                    <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeDasharray="3 5" />
                    <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                    <YAxis type="category" dataKey="category" width={142} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                    <Tooltip formatter={(value) => [numberFormatter.format(Number(value)), 'Bookings']} cursor={{ fill: 'var(--color-surface-hover)' }} />
                    <Bar dataKey="bookings" fill="var(--color-chart-3)" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="When bookings happen" subtitle="Month of the event across the selected years." />
          <CardBody>
            <div className="h-[340px] min-w-0" role="img" aria-label="Private bookings by month of year">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={seasonality} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 5" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={28} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                  <Tooltip formatter={(value) => [numberFormatter.format(Number(value)), 'Bookings']} cursor={{ fill: 'var(--color-surface-hover)' }} />
                  <Bar dataKey="bookings" fill="var(--color-primary)" radius={[4, 4, 1, 1]} maxBarSize={34} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Bookings behind the figures"
          subtitle={`${numberFormatter.format(filteredRecords.length)} records, newest first`}
        />
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Date</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Customer</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Event</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-muted">Guests</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">Record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {[...filteredRecords].reverse().map((record) => (
                <tr key={record.id} className="hover:bg-surface-hover">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-text-strong">{shortDateFormatter.format(utcDate(record.eventDate))} {record.eventDate.slice(0, 4)}</td>
                  <td className="px-4 py-3 text-text">{record.customerName}</td>
                  <td className="px-4 py-3 text-text-muted">{record.eventType}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">{record.guestCount === null ? 'Not recorded' : numberFormatter.format(record.guestCount)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-semibold ${
                      record.isHistoricalImport
                        ? 'bg-warning-soft text-warning-fg'
                        : 'bg-primary-soft text-primary-soft-fg'
                    }`}>
                      {record.isHistoricalImport ? 'Archive' : 'Live app'}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredRecords.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-text-muted">No bookings match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs leading-5 text-text-muted">
        Coverage starts with the available archive in 2019. The venue closure affects 2020 and 2021. Current-year figures run to {dateFormatter.format(utcDate(snapshot.asOfDate))}. {numberFormatter.format(snapshot.futureConfirmedCount)} future confirmed bookings are not included.
      </p>
    </div>
  )
}
