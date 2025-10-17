import { redirect } from 'next/navigation'
import ImportMessagesClient from './ImportMessagesClient'
import { checkUserPermission } from '@/app/actions/rbac'
import { getLocalIsoDateDaysAgo, getTodayIsoDate } from '@/lib/dateUtils'

export default async function ImportMessagesPage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('messages', 'view'),
    checkUserPermission('messages', 'manage'),
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  return (
    <ImportMessagesClient
      canManage={!!canManage}
      defaultStartDate={getLocalIsoDateDaysAgo(7)}
      defaultEndDate={getTodayIsoDate()}
    />
  )
}
