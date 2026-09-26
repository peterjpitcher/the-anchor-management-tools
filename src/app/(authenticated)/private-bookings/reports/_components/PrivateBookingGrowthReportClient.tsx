'use client'

import { useMemo, useState } from 'react'
import {
  Badge,
  BarChart,
  Button,
  Card,
  CardBody,
  CardHeader,
  ComboChart,
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
import { formatDateTimeInLondon } from '@/lib/dateUtils'

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
        <Segmented
          aria-label="Reporting period"
          options={RANGE_OPTIONS}
          value={range}
          onChange={(id) => setRange(id as PrivateBookingGrowthRange)}
        />
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
            <Segmented
              aria-label="Chart interval"
              size="sm"
              options={GRANULARITY_OPTIONS}
              value={granularity}
              onChange={(id) => setGranularity(id as Granularity)}
            />
          }
        />
        <CardBody>
          {filteredRecords.length === 0 ? (
            <Empty size="sm" icon="chart" title="No bookings match these filters" />
          ) : (
            <ComboChart
              data={trendSeries}
              xKey="period"
              height={360}
              xMinTickGap={granularity === 'month' ? 32 : 8}
              leftAxis={{ allowDecimals: false }}
              rightAxis={{ allowDecimals: false }}
              maxBarSize={42}
              series={[
                { key: 'bookings', label: 'Bookings', color: 'var(--color-chart-1)' },
                { key: 'cumulative', label: 'Running total', type: 'area', axis: 'right', color: 'var(--color-chart-3)' },
              ]}
              ariaLabel="Private bookings and running total over time"
            />
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
              <BarChart
                data={occasionMix.map((row) => ({ label: row.category, value: row.bookings }))}
                horizontal
                height={340}
                color="var(--color-chart-3)"
                seriesLabel="Bookings"
                maxBarSize={28}
                ariaLabel="Private bookings by occasion category"
              />
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="When Bookings Happen" subtitle="Month of the event across the selected years." />
          <CardBody>
            <ComboChart
              data={seasonality}
              xKey="month"
              height={340}
              xInterval={0}
              leftAxis={{ allowDecimals: false }}
              maxBarSize={34}
              series={[{ key: 'bookings', label: 'Bookings', color: 'var(--color-chart-1)' }]}
              ariaLabel="Private bookings by month of year"
            />
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
