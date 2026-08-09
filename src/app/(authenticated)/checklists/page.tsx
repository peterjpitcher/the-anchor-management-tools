import Link from 'next/link'
import { PageLayout } from '@/ds'
import { getTodayChecklist } from '@/app/actions/checklists'
import { ChecklistScreen } from './_components/ChecklistScreen'

export default async function ChecklistsTodayPage() {
  const res = await getTodayChecklist(undefined, { dueOnly: true })

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
      subtitle="Opening and closing tasks"
      headerActions={backToFloor}
      showHeaderActionsOnMobile
    >
      <ChecklistScreen initial={res.data} error={res.error} />
    </PageLayout>
  )
}
