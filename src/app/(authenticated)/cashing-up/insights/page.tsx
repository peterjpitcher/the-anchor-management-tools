import { getInsightsDataAction } from '@/app/actions/cashing-up'
import { InsightsClient } from './_components/InsightsClient'

export default async function CashupInsightsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: paramYear } = await searchParams
  const selectedYear = paramYear ? parseInt(paramYear) : undefined

  const res = await getInsightsDataAction(undefined, selectedYear)

  return (
    <InsightsClient
      initialData={res.data ?? null}
      selectedYear={selectedYear}
      error={res.error}
    />
  )
}
