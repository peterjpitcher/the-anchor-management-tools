import { getChecklistInsights } from '@/app/actions/checklists-insights'
import { InsightsClient } from '../_components/InsightsClient'

export default async function ChecklistsInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { from, to } = await searchParams
  const res = await getChecklistInsights(from, to)
  return <InsightsClient data={res.data} error={res.error} />
}
