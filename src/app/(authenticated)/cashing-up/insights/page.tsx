import { getInsightsDataAction } from '@/app/actions/cashing-up'
import { InsightsClient } from './_components/InsightsClient'
import type { CashupInsightsPeriod } from '@/types/cashing-up'

const CASHUP_INSIGHTS_PERIODS: CashupInsightsPeriod[] = ['30d', '90d', '180d', '365d', '12m']

function parseInsightsPeriod(value?: string): CashupInsightsPeriod | undefined {
  return CASHUP_INSIGHTS_PERIODS.includes(value as CashupInsightsPeriod)
    ? value as CashupInsightsPeriod
    : undefined
}

export default async function CashupInsightsPage({ searchParams }: { searchParams: Promise<{ year?: string; period?: string }> }) {
  const { year: paramYear, period: paramPeriod } = await searchParams
  const selectedYear = paramYear ? parseInt(paramYear) : undefined
  const selectedPeriod = selectedYear ? undefined : parseInsightsPeriod(paramPeriod) ?? '12m'

  const res = await getInsightsDataAction(undefined, selectedYear, selectedPeriod)

  return (
    <InsightsClient
      initialData={res.data ?? null}
      selectedYear={selectedYear}
      selectedPeriod={selectedPeriod}
      error={res.error}
    />
  )
}
