import { formatInTimeZone } from 'date-fns-tz'
import { getWeeklyReview } from '@/app/actions/checklists-review'
import { WeeklyReviewClient } from '../_components/WeeklyReviewClient'

const LONDON = 'Europe/London'

// Today's business date: the London calendar day rolled back by the 06:00 business-day
// start, so early-morning close tasks sit under the prior day (matches checklist generation).
// getWeeklyReview normalises this to the containing Monday, so an approximate default is fine.
function todaysBusinessDateIso(): string {
  const shifted = new Date(Date.now() - 6 * 60 * 60 * 1000)
  return formatInTimeZone(shifted, LONDON, 'yyyy-MM-dd')
}

export default async function ChecklistsWeeklyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ weekStart?: string }>
}) {
  const { weekStart } = await searchParams
  const res = await getWeeklyReview(weekStart ?? todaysBusinessDateIso(), {})
  return <WeeklyReviewClient data={res.data} error={res.error} />
}
