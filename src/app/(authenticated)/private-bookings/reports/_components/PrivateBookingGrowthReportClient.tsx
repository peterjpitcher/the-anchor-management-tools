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
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Empty,
  Segmented,
  Select,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { growthRecordSourceTone } from '../../_shared/status-ui'
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

type Granularity = 'year' | 'month'

const RANGE_OPTIONS: Array<{ id: PrivateBookingGrowthRange; label: string }> = [
  { id: 'all', label: 'All history' },
  { id: 'five_years', label: 'Last 5 years' },
  { id: 'three_years', label: 'Last 3 years' },
]

const GRANULARITY_OPTIONS: Array<{ id: Granularity; label: string }> = [
  { id: 'year', label: 'Yearly' },
  { id: 'month', label: 'Monthly' },
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

  const generatedAt = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(snapshot.generatedAt))

  // Blocks only: the page wraps them in PageLayout, which spaces its direct children.
  return (
    <>
      <Card>
        <CardHeader
          title="Booking Record"
          subtitle={`From ${snapshot.firstRecordDate ? dateFormatter.format(utcDate(snapshot.firstRecordDate)) : 'the first record'} to ${dateFormatter.format(utcDate(snapshot.asOfDate))}`}
          action={<span className="text-xs text-text-muted">Updated {generatedAt}</span>}
        />
        <CardBody>
          <p className="text-sm text-text-muted">
            Confirmed and completed customer private bookings, grouped by event date. Cancelled, draft, future and test records are excluded.
          </p>
        </CardBody>
      </Card>

      {/* Filters, directly above the figures they filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Reporting period">
          <Segmented
            options={RANGE_OPTIONS}
            value={range}
            onChange={(id) => setRange(id as PrivateBookingGrowthRange)}
          />
        </div>
        <div className="w-full sm:w-64">
          <Select
            label="Occasion"
            value={occasion}
            onChange={(event) => setOccasion(event.target.value)}
          >
            <option value="all">All occasions</option>
            {occasionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </div>
        {hasFilters && (
          <Button
            variant="secondary"
            onClick={() => {
              setRange('all')
              setOccasion('all')
            }}
          >
            Reset Filters
          </Button>
        )}
      </div>

      <StatGrid columns={4}>
        <Stat
          label="Bookings shown"
          value={numberFormatter.format(filteredRecords.length)}
          hint={`${startYear} to ${currentYear}, including years with none`}
        />
        <Stat
          label={`${currentYear} to date`}
          value={numberFormatter.format(thisYearCount)}
          hint={`${formatSignedChange(yearToDateChange)} versus the same point in ${currentYear - 1}`}
        />
        <Stat
          label="Busiest year"
          value={busiestYear ? String(busiestYear.year) : 'None'}
          hint={busiestYear ? `${numberFormatter.format(busiestYear.bookings)} bookings in the current filter` : 'No bookings match the filter'}
        />
        <Stat
          label="Known guests"
          value={numberFormatter.format(knownGuests)}
          hint={`Guest numbers recorded for ${guestCoverage}% of shown bookings`}
        />
      </StatGrid>

      <Card className="min-w-0">
        <CardHeader
          title="Bookings and Running Total"
          subtitle="Bars show events in each period. The line shows the accumulated booking record."
          action={
            <div role="group" aria-label="Chart interval">
              <Segmented
                size="sm"
                options={GRANULARITY_OPTIONS}
                value={granularity}
                onChange={(id) => setGranularity(id as Granularity)}
              />
            </div>
          }
        />
        <CardBody>
          {filteredRecords.length === 0 ? (
            <Empty size="sm" icon="chart" title="No bookings match these filters" />
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

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Occasion Mix" subtitle="Broad categories combine spelling and naming variations." />
          <CardBody>
            {occasionMix.length === 0 ? (
              <Empty size="sm" icon="chart" title="No occasion data for this selection" />
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
          <CardHeader title="When Bookings Happen" subtitle="Month of the event across the selected years." />
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
      </div>

      <Card padding="none">
        <CardHeader
          title="Bookings Behind the Figures"
          subtitle={`${numberFormatter.format(filteredRecords.length)} records, newest first`}
        />
        <div className="max-h-[520px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Event</TableHead>
                <TableHead align="right">Guests</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...filteredRecords].reverse().map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium text-text-strong">{shortDateFormatter.format(utcDate(record.eventDate))} {record.eventDate.slice(0, 4)}</TableCell>
                  <TableCell className="whitespace-normal">{record.customerName}</TableCell>
                  <TableCell className="whitespace-normal text-text-muted">{record.eventType}</TableCell>
                  <TableCell align="right" className="tabular-nums">{record.guestCount === null ? 'Not recorded' : numberFormatter.format(record.guestCount)}</TableCell>
                  <TableCell>
                    <Badge tone={growthRecordSourceTone(record.isHistoricalImport ? 'archive' : 'live')}>
                      {record.isHistoricalImport ? 'Archive' : 'Live app'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {filteredRecords.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Empty size="sm" title="No bookings match these filters" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="text-xs leading-5 text-text-muted">
        Coverage starts with the available archive in 2019. The venue closure affects 2020 and 2021. Current-year figures run to {dateFormatter.format(utcDate(snapshot.asOfDate))}. {numberFormatter.format(snapshot.futureConfirmedCount)} future confirmed bookings are not included.
      </p>
    </>
  )
}
