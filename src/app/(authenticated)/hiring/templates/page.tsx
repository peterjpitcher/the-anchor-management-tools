import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { HiringTemplatesPanel } from '@/components/features/hiring/HiringTemplatesPanel'
import { getJobTemplates } from '@/lib/hiring/service'

export const dynamic = 'force-dynamic'

export default async function HiringTemplatesPage() {
  const canManage = await checkUserPermission('hiring', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const templates = await getJobTemplates()

  return (
    <PageLayout
      title="Job templates"
      subtitle="Manage reusable hiring templates"
      breadcrumbs={[
        { label: 'Hiring', href: '/hiring' },
        { label: 'Templates' },
      ]}
      backButton={{ label: 'Back to Hiring', href: '/hiring' }}
    >
      <HiringTemplatesPanel initialTemplates={templates} />
    </PageLayout>
  )
}
