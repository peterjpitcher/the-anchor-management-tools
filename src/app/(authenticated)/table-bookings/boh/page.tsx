import { redirect } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { BohBookingsClient } from './BohBookingsClient'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'

export default async function TableBookingsBohPage() {
  const [canView, canEdit, canManage, canViewReports, canManageSettings, permissionsResult] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('table_bookings', 'manage'),
    checkUserPermission('reports', 'view'),
    checkUserPermission('settings', 'manage'),
    getUserPermissions()
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const permissions = permissionsResult.success && permissionsResult.data
    ? permissionsResult.data
    : []

  if (isFohOnlyUser(permissions)) {
    redirect('/table-bookings/foh')
  }

  return (
    <PageLayout
      title="Back of House Table Bookings"
      subtitle="Manage table bookings across day, week, and month views"
      navItems={[
        { label: 'Back of House', href: '/table-bookings/boh' },
        { label: 'Front of House', href: '/table-bookings/foh' },
        ...(canViewReports ? [{ label: 'Reports', href: '/table-bookings/reports' }] : [])
      ]}
      backButton={{
        label: 'Back to Dashboard',
        href: '/'
      }}
      headerActions={
        canManageSettings ? (
          <div className="flex items-center gap-2">
            <LinkButton href="/settings/table-bookings" variant="secondary" size="sm">
              Table Setup
            </LinkButton>
          </div>
        ) : undefined
      }
    >
      <BohBookingsClient canEdit={canEdit} canManage={canManage} />
    </PageLayout>
  )
}
