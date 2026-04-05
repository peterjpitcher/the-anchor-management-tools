'use client'

import { useState, useTransition } from 'react'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { StatGroup, Stat } from '@/components/ui-v2/display/Stat'
import { Card } from '@/components/ui-v2/layout/Card'
import { BarChart } from '@/components/charts/BarChart'
import {
  getExpenseInsights,
  type ExpenseInsightsData,
  type ExpenseGranularity,
} from '@/app/actions/expenses'

const PERIOD_TABS = [
  { key: 'monthly' as const, label: 'Monthly' },
  { key: 'quarterly' as const, label: 'Quarterly' },
  { key: 'annually' as const, label: 'Annually' },
  { key: 'all' as const, label: 'All Time' },
]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

interface ExpensesInsightsClientProps {
  initialData: ExpenseInsightsData
}

export function ExpensesInsightsClient({ initialData }: ExpensesInsightsClientProps): React.ReactElement {
  const [granularity, setGranularity] = useState<ExpenseGranularity>('monthly')
  const [data, setData] = useState<ExpenseInsightsData>(initialData)
  const [isPending, startTransition] = useTransition()

  function handlePeriodChange(key: string): void {
    const newGranularity = key as ExpenseGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      const result = await getExpenseInsights(newGranularity)
      if (result.success && result.data) {
        setData(result.data)
      }
    })
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.amount,
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
          label="Total Spend"
          value={formatCurrency(data.totals.totalAmount)}
          loading={isPending}
        />
        <Stat
          label="VAT Reclaimable"
          value={formatCurrency(data.totals.totalVat)}
          loading={isPending}
        />
        <Stat
          label="Number of Expenses"
          value={data.totals.count.toLocaleString('en-GB')}
          loading={isPending}
        />
      </StatGroup>

      <Card>
        <h3 className="text-lg font-semibold mb-4">Expenses Over Time</h3>
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            height={300}
            color="#10B981"
            formatType="shorthandCurrency"
          />
        ) : (
          <p className="text-gray-500 text-center py-12">No expense data available.</p>
        )}
      </Card>

      {data.byCompany.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">By Company</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Company</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Total</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">VAT</th>
                  <th className="text-right py-2 pl-4 font-medium text-gray-500">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.byCompany.map((company) => (
                  <tr key={company.companyRef} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{company.companyRef}</td>
                    <td className="text-right py-2 px-4">{formatCurrency(company.totalAmount)}</td>
                    <td className="text-right py-2 px-4">{formatCurrency(company.totalVat)}</td>
                    <td className="text-right py-2 pl-4">{company.count}</td>
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
