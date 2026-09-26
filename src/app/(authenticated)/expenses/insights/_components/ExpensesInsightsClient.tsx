'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
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
import { BarChart } from '@/components/charts/BarChart'
import {
  getExpenseInsights,
  type ExpenseInsightsData,
  type ExpenseGranularity,
} from '@/app/actions/expenses'
import { EXPENSES_INSIGHTS_LAYOUT } from '../../_shared/nav'

const PERIOD_OPTIONS: Array<{ id: ExpenseGranularity; label: string }> = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annually', label: 'Annually' },
  { id: 'all', label: 'All Time' },
]

const PERIOD_LOAD_FAILED = 'Could not load expenses for that period. Try again.'

type CompanyRow = ExpenseInsightsData['byCompany'][number]

// Module level so DataTable gets the same function on every render.
const companyRowKey = (row: CompanyRow): string => row.companyRef

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function getPeriodEnd(periodStart: string, granularity: ExpenseGranularity): string {
  const [y, m] = periodStart.split('-').map(Number)
  if (granularity === 'annually' || granularity === 'all') {
    return `${y}-12-31`
  }
  if (granularity === 'quarterly') {
    // periodStart is the first day of a calendar quarter (Jan, Apr, Jul, Oct)
    const endMonth = m + 2
    const lastDay = new Date(y, endMonth, 0).getDate()
    return `${y}-${String(endMonth).padStart(2, '0')}-${lastDay}`
  }
  // monthly: last day of the month
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${lastDay}`
}

interface ExpensesInsightsClientProps {
  initialData: ExpenseInsightsData
}

export function ExpensesInsightsClient({ initialData }: ExpensesInsightsClientProps): React.ReactElement {
  const router = useRouter()
  const [granularity, setGranularity] = useState<ExpenseGranularity>('monthly')
  const [data, setData] = useState<ExpenseInsightsData>(initialData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // The company table opens in the order it always had, biggest spend first. DataTable sorts
  // from there when a header is clicked.
  const companiesBySpend = useMemo(
    () => [...data.byCompany].sort((a, b) => b.totalAmount - a.totalAmount),
    [data.byCompany],
  )

  const companyColumns: Column<CompanyRow>[] = [
    {
      key: 'company',
      header: 'Company',
      sortable: true,
      sortFn: (a, b) => a.companyRef.localeCompare(b.companyRef),
      cell: (row) => row.companyRef,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.totalAmount - b.totalAmount,
      cell: (row) => formatCurrency(row.totalAmount),
    },
    {
      key: 'vat',
      header: 'VAT',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.totalVat - b.totalVat,
      cell: (row) => formatCurrency(row.totalVat),
    },
    {
      key: 'count',
      header: 'Count',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.count - b.count,
      cell: (row) => row.count,
    },
  ]

  function handlePeriodChange(key: string): void {
    const newGranularity = key as ExpenseGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      try {
        const result = await getExpenseInsights(newGranularity)
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
    router.push(`/expenses?from=${bar.periodStart}&to=${periodEnd}`)
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.amount,
  }))

  return (
    <PageLayout
      {...EXPENSES_INSIGHTS_LAYOUT}
      headerActions={
        <Segmented
          options={PERIOD_OPTIONS}
          value={granularity}
          onChange={handlePeriodChange}
          size="sm"
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
            <Stat label="Total Spend" value={formatCurrency(data.totals.totalAmount)} />
            <Stat label="VAT Reclaimable" value={formatCurrency(data.totals.totalVat)} />
            <Stat label="Number of Expenses" value={data.totals.count.toLocaleString('en-GB')} />
          </StatGrid>

          <Card>
            <CardHeader title="Expenses Over Time" />
            <CardBody>
              {chartData.length > 0 ? (
                <BarChart
                  data={chartData}
                  height={300}
                  color="var(--color-chart-1)"
                  formatType="shorthandCurrency"
                  onBarClick={handleBarClick}
                />
              ) : (
                <Empty size="sm" title="No expense data available" />
              )}
            </CardBody>
          </Card>

          {data.byCompany.length > 0 && (
            <Card>
              <CardHeader title="By Company" />
              <DataTable
                data={companiesBySpend}
                columns={companyColumns}
                getRowKey={companyRowKey}
                bordered={false}
              />
            </Card>
          )}
        </>
      )}
    </PageLayout>
  )
}
