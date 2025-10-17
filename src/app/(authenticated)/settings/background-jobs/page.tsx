import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listBackgroundJobs } from '@/app/actions/backgroundJobs'
import BackgroundJobsClient from './BackgroundJobsClient'

export default async function BackgroundJobsPage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const result = await listBackgroundJobs()

  return (
    <BackgroundJobsClient
      initialJobs={result.jobs ?? []}
      initialSummary={result.summary ?? { total: 0, pending: 0, completed: 0, failed: 0 }}
      canManage={canManage}
      initialError={result.error ?? null}
    />
  )
}
