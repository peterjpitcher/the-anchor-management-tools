import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getAllCandidates, getJobDashboardSummaries } from '@/lib/hiring/service'
import { getDuplicateReviewQueue } from '@/lib/hiring/duplicates'
import { HiringDashboardClient } from '@/components/features/hiring/HiringDashboardClient'

export const dynamic = 'force-dynamic'

export default async function HiringPage() {
  const canView = await checkUserPermission('hiring', 'view')
  const canCreate = await checkUserPermission('hiring', 'create')
  const canManage = await checkUserPermission('hiring', 'manage')
  const canEdit = await checkUserPermission('hiring', 'edit')

  if (!canView) {
    redirect('/unauthorized')
  }

  const [jobs, candidates, duplicates] = await Promise.all([
    getJobDashboardSummaries(),
    getAllCandidates(),
    getDuplicateReviewQueue()
  ])

  return (
    <HiringDashboardClient
      jobs={jobs}
      candidates={candidates}
      canCreate={canCreate}
      canManage={canManage}
      canEdit={canEdit}
      duplicateItems={duplicates}
    />
  )
}
