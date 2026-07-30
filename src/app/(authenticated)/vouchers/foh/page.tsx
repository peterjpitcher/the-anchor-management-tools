import { redirect } from 'next/navigation'
import { PageLayout } from '@/ds'
import { getUserPermissions } from '@/app/actions/rbac'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import { VouchersFohClient } from './VouchersFohClient'
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
    .select('employee_id, first_name, last_name')
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
    }>
  ).map((row) => ({
    id: row.employee_id,
    name:
      [row.first_name, row.last_name]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join(' ') || 'Unknown',
    clockedIn: clockedInIds.has(row.employee_id)
  }))

  const permissions =
    permissionsResult.success && permissionsResult.data ? permissionsResult.data : []
  const fohOnlyMode = isFohOnlyUser(permissions)

  return (
    <PageLayout
      title="Vouchers"
      subtitle={fohOnlyMode ? undefined : 'Redeem and hand out gift vouchers'}
      backButton={fohOnlyMode ? undefined : { label: 'Back to Dashboard', href: '/' }}
    >
      <VouchersFohClient canEdit={editCheck.ok} staff={staff} todayIso={getLondonDateIso()} />
    </PageLayout>
  )
}
