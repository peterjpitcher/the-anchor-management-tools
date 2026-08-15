import Link from 'next/link'
import { PageLayout } from '@/ds'
import { getTodayChecklist } from '@/app/actions/checklists'
import { formatDateInLondon } from '@/lib/dateUtils'
import { ChecklistScreen } from './_components/ChecklistScreen'

export default async function ChecklistsTodayPage() {
  const res = await getTodayChecklist(undefined, { dueOnly: true })

  // The business date is on the subtitle because the list no longer matches the
  // calendar date after midnight. Someone locking up at 01:00 needs to see which
  // night they are ticking off.
  const businessDate = res.data?.businessDate
  const subtitle = businessDate
    ? `Opening and closing tasks, ${formatDateInLondon(businessDate, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })}`
    : 'Opening and closing tasks'

  // Matches the FOH vouchers screen: same PageLayout, same solid green
  // "Back to the floor" action in the header. Both are iPad screens a member of
  // staff steps up to mid-shift, so they should not look like two different apps.
  const backToFloor = (
    <Link
      href="/table-bookings/foh"
      className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-sidebar px-4 py-2 text-sm font-semibold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40"
    >
      Back to the floor
    </Link>
  )

  return (
    <PageLayout
      title="Checklists"
      subtitle={subtitle}
      headerActions={backToFloor}
      showHeaderActionsOnMobile
    >
      <ChecklistScreen initial={res.data} error={res.error} />
    </PageLayout>
  )
}
