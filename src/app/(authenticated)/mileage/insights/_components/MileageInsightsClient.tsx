'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  BarChart,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Empty,
  PageLayout,
  PageLoading,
  Segmented,
  Stat,
  StatGrid,
  type Column,
} from '@/ds'
import {
  getMileageInsights,
  type MileageInsightsData,
  type MileageGranularity,
} from '@/app/actions/mileage'
import { MILEAGE_INSIGHTS_LAYOUT } from '../../_shared/nav'

const PERIOD_OPTIONS: Array<{ id: MileageGranularity; label: string }> = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  // The financial year runs 1 January to 31 December, which is how the yearly bars group.
  { id: 'annually', label: 'Financial Year' },
  { id: 'all', label: 'All Time' },
]

const PERIOD_LOAD_FAILED = 'Could not load mileage for that period. Try again.'

type DestinationRow = MileageInsightsData['byDestination'][number]

// Module level so DataTable gets the same function on every render.
const destinationRowKey = (row: DestinationRow): string => row.destinationName

const formatMiles = (miles: number): string => miles.toLocaleString('en-GB', { maximumFractionDigits: 1 })

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function getPeriodEnd(periodStart: string, granularity: MileageGranularity): string {
  const [y, m] = periodStart.split('-').map(Number)
  if (granularity === 'annually' || granularity === 'all') {
    return `${y}-12-31`
  }
  if (granularity === 'quarterly') {
    // periodStart is first day of a calendar quarter (Jan, Apr, Jul, Oct)
    const endMonth = m + 2
    const lastDay = new Date(y, endMonth, 0).getDate()
    return `${y}-${String(endMonth).padStart(2, '0')}-${lastDay}`
  }
  // monthly: last day of the month
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${lastDay}`
}

interface MileageInsightsClientProps {
  initialData: MileageInsightsData
}

export function MileageInsightsClient({ initialData }: MileageInsightsClientProps): React.ReactElement {
  const router = useRouter()
  const [granularity, setGranularity] = useState<MileageGranularity>('monthly')
  const [data, setData] = useState<MileageInsightsData>(initialData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // The destination table opens longest distance first, as it always has. DataTable sorts from
  // there when a header is clicked.
  const destinationsByMiles = useMemo(
    () => [...data.byDestination].sort((a, b) => b.totalMiles - a.totalMiles),
    [data.byDestination],
  )

  const destinationColumns: Column<DestinationRow>[] = [
    {
      key: 'destination',
      header: 'Destination',
      sortable: true,
      sortFn: (a, b) => a.destinationName.localeCompare(b.destinationName),
      cell: (row) => row.destinationName,
    },
    {
      key: 'miles',
      header: 'Miles',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.totalMiles - b.totalMiles,
      cell: (row) => formatMiles(row.totalMiles),
    },
    {
      key: 'amount',
      header: 'Amount Due',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.amountDue - b.amountDue,
      cell: (row) => formatCurrency(row.amountDue),
    },
    {
      key: 'trips',
      header: 'Trips',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.tripCount - b.tripCount,
      cell: (row) => row.tripCount,
    },
  ]

  function handlePeriodChange(key: string): void {
    const newGranularity = key as MileageGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      try {
        const result = await getMileageInsights(newGranularity)
        if (result.success && result.data) {
          setData(result.data)
          setLoadError(null)
        } else {
          // A failed read is shown as a failure, never as the previous period's figures.
          setLoadError(result.error ?? PERIOD_LOAD_FAILED)
        }
      } catch {
        setLoadError(PERIOD_LOAD_FAILED)
      }
    })
  }

  function handleBarClick(index: number): void {
    const bar = data.bars[index]
    if (!bar) return
    const periodEnd = getPeriodEnd(bar.periodStart, granularity)
    router.push(`/mileage?from=${bar.periodStart}&to=${periodEnd}`)
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.totalMiles,
  }))

  return (
    <PageLayout
      {...MILEAGE_INSIGHTS_LAYOUT}
      headerActions={
        <Segmented
          options={PERIOD_OPTIONS}
          value={granularity}
          onChange={handlePeriodChange}
          size="sm"
          aria-label="Period"
        />
      }
    >
      {isPending ? (
        <PageLoading inline />
      ) : loadError ? (
        <Alert tone="danger" title="Couldn't load this period">{loadError}</Alert>
      ) : (
        <>
          <StatGrid columns={3}>
            <Stat label="Total Miles" value={`${formatMiles(data.totals.totalMiles)} mi`} />
            <Stat label="Total Amount Due" value={formatCurrency(data.totals.totalAmountDue)} />
            <Stat label="Number of Trips" value={data.totals.tripCount.toLocaleString('en-GB')} />
          </StatGrid>

          <Card>
            <CardHeader title="Miles Over Time" />
            <CardBody>
              {chartData.length > 0 ? (
                <BarChart
                  data={chartData}
                  height={300}
                  color="var(--color-chart-1)"
                  formatType="number"
                  onBarClick={handleBarClick}
                  seriesLabel="Miles"
                  ariaLabel="Miles over time"
                />
              ) : (
                <Empty size="sm" title="No trips for this period" description="No trips were recorded in this period." />
              )}
            </CardBody>
          </Card>

          {data.byDestination.length > 0 && (
            <Card>
              <CardHeader title="By Destination" />
              <DataTable
                data={destinationsByMiles}
                columns={destinationColumns}
                getRowKey={destinationRowKey}
                bordered={false}
              />
            </Card>
          )}
        </>
      )}
    </PageLayout>
  )
}
