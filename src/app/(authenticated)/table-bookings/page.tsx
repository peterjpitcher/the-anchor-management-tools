import { redirect } from 'next/navigation'
import { getUserPermissions } from '@/app/actions/rbac'
import { isFohOnlyUser } from '@/lib/foh/user-mode'

export default async function TableBookingsPage() {
  const permissionsResult = await getUserPermissions()
  const permissions = permissionsResult.success && permissionsResult.data
    ? permissionsResult.data
    : []

  if (isFohOnlyUser(permissions)) {
    redirect('/table-bookings/foh')
  }

  redirect('/table-bookings/boh')
}
