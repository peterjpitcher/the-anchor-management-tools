import { redirect } from 'next/navigation'
import { PageLayout } from '@/ds'
import { BackToFrontOfHouse } from '@/components/foh/BackToFrontOfHouse'
import { getUserPermissions } from '@/app/actions/rbac'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import { VouchersFohClient } from './VouchersFohClient'
import { displayName } from '@/lib/employees/display-name'
import { isCurrentStaff } from '@/lib/employees/current-staff'
import type { FohStaffMember } from './lib'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'

export default async function VouchersFohPage() {
  const viewCheck = await requireFohVoucherPermission('view')
  if (!viewCheck.ok) {
    // 503 means the lookup failed, not a refusal: retry instead of Access Denied (BK-095).
    if (viewCheck.response.status === 503) {
      return <PermissionsUnavailable />
    }
    redirect('/unauthorized')
  }

  const [editCheck, permissionsResult, sessionsResult] = await Promise.all([
    requireFohVoucherPermission('edit'),
    getUserPermissions(),
    getOpenSessions()
  ])

  const admin = createAdminClient()
  const { data: employeeRows } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, preferred_name, status, employment_end_date')
    .in('status', ['Active', 'Started Separation'])
    .order('first_name')
    .order('last_name')

  const clockedInIds = new Set<string>(
    sessionsResult.success ? sessionsResult.data.map((session) => session.employee_id) : []
  )

  const staff: FohStaffMember[] = (
    (employeeRows ?? []) as Array<{
      employee_id: string
      first_name: string | null
      last_name: string | null
      preferred_name: string | null
      status: string
      employment_end_date: string | null
    }>
  )
    // Someone on notice past their last working day has left, so cannot hand out or take a voucher.
    .filter((row) => isCurrentStaff(row))
    .map((row) => ({
      id: row.employee_id,
      // Staff pick themselves off this list, so show the name the team uses. The
      // helper falls back to the legal name, keeping the old "Unknown" backstop.
      name: displayName(row),
      clockedIn: clockedInIds.has(row.employee_id)
    }))

  const permissions =
    permissionsResult.success && permissionsResult.data ? permissionsResult.data : []
  const fohOnlyMode = isFohOnlyUser(permissions)

  // FOH-only users get no sidebar and no topbar, and the iPad kiosk has no address bar, so the
  // header's Back to Front of House is their only way off this screen. It is the only exit
  // offered to everyone: this is a floor screen, and the dashboard would be a dead end.
  return (
    <PageLayout
      title="Vouchers"
      subtitle={fohOnlyMode ? undefined : 'Redeem and hand out gift vouchers'}
      headerActions={<BackToFrontOfHouse />}
      showHeaderActionsOnMobile
    >
      <VouchersFohClient canEdit={editCheck.ok} staff={staff} todayIso={getLondonDateIso()} />
    </PageLayout>
  )
}
