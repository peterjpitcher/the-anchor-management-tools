'use client'

import { useState, useTransition } from 'react'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { StatGroup } from '@/components/ui-v2/display/Stat'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Card } from '@/components/ui-v2/layout/Card'
import { BarChart } from '@/components/charts/BarChart'
import { getMgdInsights, type MgdInsightsData, type MgdGranularity } from '@/app/actions/mgd'

const PERIOD_TABS = [
  { key: 'quarterly' as const, label: 'Quarterly' },
  { key: 'annually' as const, label: 'Annually' },
  { key: 'all' as const, label: 'All Time' },
]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

interface MgdInsightsClientProps {
  initialData: MgdInsightsData
}

export function MgdInsightsClient({ initialData }: MgdInsightsClientProps): React.ReactElement {
  const [granularity, setGranularity] = useState<MgdGranularity>('quarterly')
  const [data, setData] = useState<MgdInsightsData>(initialData)
  const [isPending, startTransition] = useTransition()

  function handlePeriodChange(key: string): void {
    const newGranularity = key as MgdGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      const result = await getMgdInsights(newGranularity)
      if (!('error' in result) && result.data) {
        setData(result.data)
      }
    })
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.netTake,
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
          label="Total Net Takings"
          value={formatCurrency(data.totals.totalNetTake)}
          loading={isPending}
        />
        <Stat
          label="Total MGD Due (20%)"
          value={formatCurrency(data.totals.totalMgd)}
          loading={isPending}
        />
        <Stat
          label="Total VAT on Supplier"
          value={formatCurrency(data.totals.totalVatOnSupplier)}
          loading={isPending}
        />
      </StatGroup>

      <Card>
        <h3 className="text-lg font-semibold mb-4">Net Takings Over Time</h3>
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            height={300}
            color="#10B981"
            formatType="shorthandCurrency"
          />
        ) : (
          <p className="text-gray-500 text-center py-12">No collection data available.</p>
        )}
      </Card>
    </div>
  )
}
