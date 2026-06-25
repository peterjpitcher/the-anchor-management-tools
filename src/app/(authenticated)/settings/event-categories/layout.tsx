import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

export default async function EventCategoriesSettingsLayout({ children }: { children: React.ReactNode }) {
  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    redirect('/unauthorized')
  }

  return children
}
