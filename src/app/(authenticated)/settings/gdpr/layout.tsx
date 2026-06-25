import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'

export default async function GdprSettingsLayout({ children }: { children: React.ReactNode }) {
  const canManageSettings = await checkUserPermission('settings', 'manage')
  if (!canManageSettings) {
    redirect('/unauthorized')
  }

  return children
}
