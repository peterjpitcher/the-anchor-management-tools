import { getWeeklyReview } from '@/app/actions/checklists-review'
import { currentBusinessDate } from '@/lib/checklists/settings'
import { WeeklyReviewClient } from '../_components/WeeklyReviewClient'

// The default week comes from the current business date. This used to hardcode a
// six hour shift on the instant, which both ignored the configured boundary and
// was wrong on the clock-change mornings.

export default async function ChecklistsWeeklyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ weekStart?: string }>
}) {
  const { weekStart } = await searchParams
  const res = await getWeeklyReview(weekStart ?? (await currentBusinessDate()), {})
  return <WeeklyReviewClient data={res.data} error={res.error} />
}
