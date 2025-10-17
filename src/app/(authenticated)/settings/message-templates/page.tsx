import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listMessageTemplates } from '@/app/actions/messageTemplates'
import MessageTemplatesClient from './MessageTemplatesClient'

export default async function MessageTemplatesPage() {
  const canView = await checkUserPermission('messages', 'manage_templates')
  if (!canView) {
    redirect('/unauthorized')
  }

  const result = await listMessageTemplates()

  return (
    <MessageTemplatesClient
      initialTemplates={result.templates ?? []}
      canManage={canView}
      initialError={result.error ?? null}
    />
  )
}
