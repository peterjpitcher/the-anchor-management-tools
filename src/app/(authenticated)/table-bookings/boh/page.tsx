import { redirect } from 'next/navigation'
import { getUserPermissions } from '@/app/actions/rbac'
import { PermissionService } from '@/services/permission'
import { getCurrentUser } from '@/lib/supabase/current-user'
import type { ActionType, ModuleName } from '@/types/rbac'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { createClient } from '@/lib/supabase/server'
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

  // One permission list and one super-admin answer, both from the shared 60-second cache, instead of
  // six separate checks that each read both. The answers are the same as checkUserPermission gives:
  // a super admin holds everything; otherwise the permission must be in the list; a failed read
  // answers no (the super-admin read failing still lets a listed permission through, as before).
  const [authResult, permissionsResult, isSuperAdmin] = await Promise.all([
    supabase.auth.getUser(),
    getUserPermissions(),
    getCurrentUser()
      .then(({ user }) => (user ? PermissionService.getRoleNames(user.id) : []))
      .then((roleNames) => roleNames.includes('super_admin'))
      .catch(() => false),
  ])

  const permissions = permissionsResult.success && permissionsResult.data
    ? permissionsResult.data
    : []
  const has = (moduleName: ModuleName, action: ActionType): boolean =>
    isSuperAdmin || permissions.some((p) => p.module_name === moduleName && p.action === action)

  const canView = has('table_bookings', 'view')
  const canEdit = has('table_bookings', 'edit')
  const canManage = has('table_bookings', 'manage')
  const canViewReports = has('reports', 'view')
  const canManageSettings = has('settings', 'manage')
  const canSendMessages = has('messages', 'send_transactional')

  if (!canView) {
    redirect('/unauthorized')
  }

  if (isFohOnlyUser(permissions)) {
    redirect('/table-bookings/foh')
  }

  // Waiving a deposit needs table_bookings manage (D18, BK-106), which the Deputy role holds too;
  // the role-name check this replaced refused it.
  const canWaiveDeposit = Boolean(authResult.data.user?.id) && canManage

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
