'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { StatGroup } from '@/components/ui-v2/display/Stat'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Card } from '@/components/ui-v2/layout/Card'
import { BarChart } from '@/components/charts/BarChart'
import {
  getMileageInsights,
  type MileageInsightsData,
  type MileageGranularity,
} from '@/app/actions/mileage'
import { useSort } from '@/hooks/useSort'
import { SortableHeader } from '@/components/ui/SortableHeader'

const PERIOD_TABS = [
  { key: 'monthly' as const, label: 'Monthly' },
  { key: 'quarterly' as const, label: 'Quarterly' },
  { key: 'annually' as const, label: 'Annually' },
  { key: 'all' as const, label: 'All Time' },
]

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
  // monthly — last day of the month
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
  const [isPending, startTransition] = useTransition()

  // ---------------------------------------------------------------------------
  // Sorting — By Destination table
  // ---------------------------------------------------------------------------

  type DestinationSortKey = 'destination' | 'miles' | 'amount' | 'trips'

  const destinationComparators = useMemo(
    () => ({
      destination: (a: MileageInsightsData['byDestination'][number], b: MileageInsightsData['byDestination'][number]) =>
        a.destinationName.localeCompare(b.destinationName),
      miles: (a: MileageInsightsData['byDestination'][number], b: MileageInsightsData['byDestination'][number]) =>
        a.totalMiles - b.totalMiles,
      amount: (a: MileageInsightsData['byDestination'][number], b: MileageInsightsData['byDestination'][number]) =>
        a.amountDue - b.amountDue,
      trips: (a: MileageInsightsData['byDestination'][number], b: MileageInsightsData['byDestination'][number]) =>
        a.tripCount - b.tripCount,
    }),
    []
  )

  const {
    sortedData: sortedByDestination,
    sort: destinationSort,
    toggleSort: toggleDestinationSort,
  } = useSort<MileageInsightsData['byDestination'][number], DestinationSortKey>(
    data.byDestination,
    'miles',
    'desc',
    destinationComparators
  )

  function handlePeriodChange(key: string): void {
    const newGranularity = key as MileageGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      const result = await getMileageInsights(newGranularity)
      if (result.success && result.data) {
        setData(result.data)
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
    <div className="space-y-6">
      <TabNav
        tabs={PERIOD_TABS}
        activeKey={granularity}
        onChange={handlePeriodChange}
        variant="pills"
      />

      <StatGroup columns={3}>
        <Stat
          label="Total Miles"
          value={`${data.totals.totalMiles.toLocaleString('en-GB', { maximumFractionDigits: 1 })} mi`}
          loading={isPending}
        />
        <Stat
          label="Total Amount Due"
          value={formatCurrency(data.totals.totalAmountDue)}
          loading={isPending}
        />
        <Stat
          label="Number of Trips"
          value={data.totals.tripCount.toLocaleString('en-GB')}
          loading={isPending}
        />
      </StatGroup>

      <Card>
        <h3 className="text-lg font-semibold mb-4">Miles Over Time</h3>
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            height={300}
            color="#10B981"
            formatType="number"
            onBarClick={handleBarClick}
          />
        ) : (
          <p className="text-gray-500 text-center py-12">No mileage data available.</p>
        )}
      </Card>

      {data.byDestination.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">By Destination</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <SortableHeader
                    label="Destination"
                    column="destination"
                    currentColumn={destinationSort.column}
                    currentDirection={destinationSort.direction}
                    onSort={toggleDestinationSort}
                    className="text-left py-2 pr-4 font-medium text-gray-500"
                  />
                  <SortableHeader
                    label="Miles"
                    column="miles"
                    currentColumn={destinationSort.column}
                    currentDirection={destinationSort.direction}
                    onSort={toggleDestinationSort}
                    className="text-right py-2 px-4 font-medium text-gray-500"
                  />
                  <SortableHeader
                    label="Amount Due"
                    column="amount"
                    currentColumn={destinationSort.column}
                    currentDirection={destinationSort.direction}
                    onSort={toggleDestinationSort}
                    className="text-right py-2 px-4 font-medium text-gray-500"
                  />
                  <SortableHeader
                    label="Trips"
                    column="trips"
                    currentColumn={destinationSort.column}
                    currentDirection={destinationSort.direction}
                    onSort={toggleDestinationSort}
                    className="text-right py-2 pl-4 font-medium text-gray-500"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedByDestination.map((dest) => (
                  <tr key={dest.destinationName} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{dest.destinationName}</td>
                    <td className="text-right py-2 px-4">{dest.totalMiles.toLocaleString('en-GB', { maximumFractionDigits: 1 })}</td>
                    <td className="text-right py-2 px-4">{formatCurrency(dest.amountDue)}</td>
                    <td className="text-right py-2 pl-4">{dest.tripCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
