import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { HiringStageReminderPanel } from '@/components/features/hiring/HiringStageReminderPanel'
import { getHiringStageReminderConfig } from '@/lib/hiring/reminders'

export default async function HiringRemindersPage() {
  const canManage = await checkUserPermission('hiring', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const config = await getHiringStageReminderConfig()

  return (
    <PageLayout
      title="Hiring reminders"
      subtitle="Configure reminder emails for stalled applications"
      breadcrumbs={[
        { label: 'Hiring', href: '/hiring' },
        { label: 'Reminders' },
      ]}
      backButton={{ label: 'Back to Hiring', href: '/hiring' }}
      containerSize="lg"
    >
      <HiringStageReminderPanel initialConfig={config} />
    </PageLayout>
  )
}
