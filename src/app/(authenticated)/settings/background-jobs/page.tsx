import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listBackgroundJobs } from '@/app/actions/backgroundJobs'
import { getReminderQueueSummary } from '@/app/actions/reminderQueue'
import BackgroundJobsClient from './BackgroundJobsClient'

export default async function BackgroundJobsPage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const result = await listBackgroundJobs()
  const reminderSummaryResult = await getReminderQueueSummary()

  return (
    <BackgroundJobsClient
      initialJobs={result.jobs ?? []}
      initialSummary={result.summary ?? { total: 0, pending: 0, completed: 0, failed: 0 }}
      canManage={canManage}
      initialError={result.error ?? null}
      initialReminderSummary={reminderSummaryResult.summary ?? {
        pendingDue: 0,
        pendingScheduled: 0,
        failed: 0,
        cancelled: 0,
        nextDueAt: null,
        lastSentAt: null,
        activeJobs: 0
      }}
      initialReminderError={reminderSummaryResult.error ?? null}
    />
  )
}
