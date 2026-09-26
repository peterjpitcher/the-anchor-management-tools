'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart, Card, CardBody, CardHeader, Empty, PageLayout, Segmented, Stat, StatGrid } from '@/ds'
import type { MgdInsightsData, MgdGranularity } from '@/app/actions/mgd'
import { MGD_INSIGHTS_LAYOUT } from '../../_shared/nav'

const PERIOD_OPTIONS: Array<{ id: MgdGranularity; label: string }> = [
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annually', label: 'Annually' },
  { id: 'all', label: 'All Time' },
]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

/**
 * Returns the MGD quarter end date for a given periodStart.
 * MGD quarters run: Feb–Apr, May–Jul, Aug–Oct, Nov–Jan
 */
function getMgdPeriodEnd(periodStart: string, granularity: MgdGranularity): string {
  const [y, m] = periodStart.split('-').map(Number)
  if (granularity === 'annually' || granularity === 'all') {
    return `${y}-12-31`
  }
  // quarterly: map month to MGD quarter end
  switch (m) {
    case 2:  return `${y}-04-30`  // Feb quarter ends Apr 30
    case 5:  return `${y}-07-31`  // May quarter ends Jul 31
    case 8:  return `${y}-10-31`  // Aug quarter ends Oct 31
    case 11: return `${y + 1}-01-31` // Nov quarter ends Jan 31 next year
    default: return `${y}-${String(m + 2).padStart(2, '0')}-28` // fallback
  }
}

interface MgdInsightsClientProps {
  initialData: Record<MgdGranularity, MgdInsightsData>
}

export function MgdInsightsClient({ initialData }: MgdInsightsClientProps): React.ReactElement {
  const router = useRouter()
  const [granularity, setGranularity] = useState<MgdGranularity>('quarterly')
  const data = initialData[granularity]

  function handlePeriodChange(key: string): void {
    setGranularity(key as MgdGranularity)
  }

  function handleBarClick(index: number): void {
    const bar = data.bars[index]
    if (!bar) return
    const periodEnd = getMgdPeriodEnd(bar.periodStart, granularity)
    router.push(`/mgd?from=${bar.periodStart}&to=${periodEnd}`)
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.netTake,
  }))

  return (
    <PageLayout
      {...MGD_INSIGHTS_LAYOUT}
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
      <StatGrid columns={3}>
        <Stat
          label="Total Net Takings"
          value={formatCurrency(data.totals.totalNetTake)}
        />
        <Stat
          label="Total MGD Due (20%)"
          value={formatCurrency(data.totals.totalMgd)}
        />
        <Stat
          label="Total VAT on Supplier"
          value={formatCurrency(data.totals.totalVatOnSupplier)}
        />
      </StatGrid>

      <Card>
        <CardHeader title="Net Takings Over Time" />
        <CardBody>
          {chartData.length > 0 ? (
            <BarChart
              data={chartData}
              height={300}
              color="var(--color-chart-1)"
              formatType="shorthandCurrency"
              onBarClick={handleBarClick}
              seriesLabel="Net takings"
              ariaLabel="Net takings over time"
            />
          ) : (
            <Empty size="sm" title="No collections for this period" description="No machine game collections were recorded in this period." />
          )}
        </CardBody>
      </Card>
    </PageLayout>
  )
}
