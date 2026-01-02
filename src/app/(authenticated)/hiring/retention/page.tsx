import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { HiringRetentionPanel } from '@/components/features/hiring/HiringRetentionPanel'
import { getHiringRetentionPolicy, getRetentionCandidates } from '@/lib/hiring/retention'

export default async function HiringRetentionPage() {
  const canManage = await checkUserPermission('hiring', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const policy = await getHiringRetentionPolicy()
  const candidates = await getRetentionCandidates({ retentionDays: policy.retentionDays })

  return (
    <PageLayout
      title="Hiring retention"
      subtitle="Manage retention rules and anonymize or delete expired hiring records"
      breadcrumbs={[
        { label: 'Hiring', href: '/hiring' },
        { label: 'Retention' },
      ]}
      backButton={{ label: 'Back to Hiring', href: '/hiring' }}
    >
      <HiringRetentionPanel initialPolicy={policy} initialCandidates={candidates} />
    </PageLayout>
  )
}
