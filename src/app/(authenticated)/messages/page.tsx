import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { MessagesClient } from './_components/MessagesClient'

export default async function MessagesPage() {
  const canViewMessages = await checkUserPermission('messages', 'view')
  if (!canViewMessages) {
    redirect('/unauthorized')
  }

  return <MessagesClient />
}
