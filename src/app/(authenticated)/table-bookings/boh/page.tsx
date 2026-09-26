import { redirect } from 'next/navigation'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BohBookingsClient, type BohViewMode } from './BohBookingsClient'
import { isValidIsoDate } from '@/lib/dateUtils'

const VIEW_MODES: BohViewMode[] = ['day', 'week', 'month']

interface TableBookingsBohPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function TableBookingsBohPage({ searchParams }: TableBookingsBohPageProps) {
  const supabase = await createClient()
  // ?date=YYYY-MM-DD&view=day opens the board on a given day (the weekly Insights report links here).
  // Anything invalid is ignored, so the page opens on today as before.
  const params = searchParams ? await searchParams : {}
  const rawDate = typeof params.date === 'string' ? params.date : undefined
  const rawView = typeof params.view === 'string' ? params.view : undefined
  const initialDate = rawDate && isValidIsoDate(rawDate) ? rawDate : undefined
  const initialView = VIEW_MODES.find((mode) => mode === rawView)

  const [authResult, canView, canEdit, canManage, canViewReports, canManageSettings, canSendMessages, permissionsResult] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('table_bookings', 'manage'),
    checkUserPermission('reports', 'view'),
    checkUserPermission('settings', 'manage'),
    checkUserPermission('messages', 'send_transactional'),
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

  const userId = authResult.data.user?.id
  let canWaiveDeposit = false
  if (userId) {
    const admin = createAdminClient()
    const { data: roleRows } = await admin
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', userId)
    const roles = (roleRows as Array<{ roles: { name: string } | null }> | null) ?? []
    canWaiveDeposit = roles.some(
      (role) => role.roles?.name === 'manager' || role.roles?.name === 'super_admin'
    )
  }

  // The client renders PageLayout itself: its header actions (view switch, Refresh, Download PDF,
  // Book Table) drive the client's own state.
  return (
    <BohBookingsClient
      canEdit={canEdit}
      canManage={canManage}
      canWaiveDeposit={canWaiveDeposit}
      canSendMessages={canSendMessages}
      canViewReports={canViewReports}
      canManageSettings={canManageSettings}
      initialDate={initialDate}
      initialView={initialView}
    />
  )
}
