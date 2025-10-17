import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listWebhookLogs } from '@/app/actions/webhooks'
import WebhookMonitorClient from './WebhookMonitorClient'

export default async function WebhookMonitorPage() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const result = await listWebhookLogs()

  return (
    <WebhookMonitorClient
      initialLogs={result.logs ?? []}
      initialError={result.error ?? null}
    />
  )
}
