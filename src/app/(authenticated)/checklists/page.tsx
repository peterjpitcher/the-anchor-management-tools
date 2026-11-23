import { PageLayout } from '@/ds'
import { BackToFrontOfHouse } from '@/components/foh/BackToFrontOfHouse'
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

  return (
    <PageLayout
      title="Checklists"
      subtitle={subtitle}
      // The till's one way back, in the same place on every till page.
      headerActions={<BackToFrontOfHouse />}
      showHeaderActionsOnMobile
    >
      <ChecklistScreen initial={res.data} error={res.error} />
    </PageLayout>
  )
}
