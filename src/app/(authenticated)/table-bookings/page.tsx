import { redirect } from 'next/navigation'
import { PageLayout } from '@/ds'
import { getUserPermissions } from '@/app/actions/rbac'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'

export default async function TableBookingsPage() {
  const permissionsResult = await getUserPermissions()
  // Without the list we cannot tell an FOH-only login from a manager, so retry rather than guess.
  if (!permissionsResult.success) {
    return (
      <PageLayout title="Table bookings">
        <PermissionsUnavailable />
      </PageLayout>
    )
  }
  const permissions = permissionsResult.success && permissionsResult.data
    ? permissionsResult.data
    : []

  if (isFohOnlyUser(permissions)) {
    redirect('/table-bookings/foh')
  }

  redirect('/table-bookings/boh')
}
