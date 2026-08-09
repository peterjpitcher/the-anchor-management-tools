import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PageLayout } from '@/ds'
import { getUserPermissions } from '@/app/actions/rbac'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import { VouchersFohClient } from './VouchersFohClient'
import { displayName } from '@/lib/employees/display-name'
import type { FohStaffMember } from './lib'

export default async function VouchersFohPage() {
  const viewCheck = await requireFohVoucherPermission('view')
  if (!viewCheck.ok) {
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
    .select('employee_id, first_name, last_name, preferred_name')
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
    }>
  ).map((row) => ({
    id: row.employee_id,
    // Staff pick themselves off this list, so show the name the team uses. The
    // helper falls back to the legal name, keeping the old "Unknown" backstop.
    name: displayName(row),
    clockedIn: clockedInIds.has(row.employee_id)
  }))

  const permissions =
    permissionsResult.success && permissionsResult.data ? permissionsResult.data : []
  const fohOnlyMode = isFohOnlyUser(permissions)

  // FOH-only users get no sidebar and no topbar, and the iPad kiosk has no
  // address bar, so this link is their only way off this screen. It stays for
  // everyone else too, and is the only exit offered: see the note below.
  const backToFloor = (
    <Link
      href="/table-bookings/foh"
      className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-sidebar px-4 py-2 text-sm font-semibold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40"
    >
      Back to the floor
    </Link>
  )

  // No "Back to Dashboard". This is a floor screen reached from the FOH header,
  // and the people using it work the floor: sending them to the dashboard is a
  // dead end. "Back to the floor" is the only exit anyone needs from here, and
  // it is what the Checklists screen offers too.
  return (
    <PageLayout
      title="Vouchers"
      subtitle={fohOnlyMode ? undefined : 'Redeem and hand out gift vouchers'}
      headerActions={backToFloor}
      showHeaderActionsOnMobile
    >
      <VouchersFohClient canEdit={editCheck.ok} staff={staff} todayIso={getLondonDateIso()} />
    </PageLayout>
  )
}
