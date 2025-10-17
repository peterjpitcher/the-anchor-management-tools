import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import WebhookDiagnosticsClient from './WebhookDiagnosticsClient'

export default async function WebhookDiagnosticsPage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  return <WebhookDiagnosticsClient initialReport={null} initialError={null} />
}
