import { redirect } from 'next/navigation'
import { PageLayout } from '@/ds'
import { checkUserPermission, getPermissionStatus, getUserPermissions } from '@/app/actions/rbac'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'
import { resolveTradingDayNow } from '@/lib/business-hours/trading-day'
import { FohScheduleClient } from './FohScheduleClient'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import Image from 'next/image'
import FohClockWidget from './FohClockWidget'
import { LinkButton } from '@/ds'
import { ChecklistMidShiftPrompt } from '@/app/(authenticated)/checklists/_components/ChecklistMidShiftPrompt'
import { getDeploymentVersion } from '@/lib/foh/deployment-version'
import { onClockScreen } from '@/lib/employees/current-staff'
import { OpenEarlierBookingsStrip } from '@/components/features/table-bookings/OpenEarlierBookingsStrip'

const MANAGER_IPAD_EMAIL = 'manager@the-anchor.pub'

export default async function TableBookingsFohPage() {
  const supabase = await createClient()

  // Everything the page needs, in one round: the checks, the super-admin and manage lookups for the
  // signed-in user, the manager iPad's clock widget data and the trading day. The user-dependent
  // reads chain off the one auth lookup rather than waiting for the whole first batch. Nothing here
  // is rendered before the view check below has passed.
  const authPromise = supabase.auth.getUser()
  type ClockEmployee = {
    employee_id: string
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
  }
  type ClockSession = import('@/app/actions/timeclock').OpenSessionSummary & { employee_name: string }

  const [
    authResult,
    viewStatus,
    canEdit,
    canViewReports,
    canManageSettings,
    permissionsResult,
    { isSuperAdmin, canWaiveDeposit },
    clockWidget,
    tradingDay,
  ] = await Promise.all([
    authPromise,
    getPermissionStatus('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('reports', 'view'),
    checkUserPermission('settings', 'manage'),
    getUserPermissions(),
    authPromise.then(async (result) => {
      const userId = result.data.user?.id
      if (!userId) return { isSuperAdmin: false, canWaiveDeposit: false }
      const admin = createAdminClient()
      const [{ data: roleRows }, canManage] = await Promise.all([
        admin
          .from('user_roles')
          .select('roles(name)')
          .eq('user_id', userId),
        // Waiving a deposit, or marking a pub event, needs table_bookings manage (D18, BK-106), which
        // the Deputy role holds too; a role-name check refused it.
        checkUserPermission('table_bookings', 'manage', userId),
      ])
      const roles = (roleRows as Array<{ roles: { name: string } | null }> | null) ?? []
      return {
        isSuperAdmin: roles.some((r) => r.roles?.name === 'super_admin'),
        canWaiveDeposit: canManage,
      }
    }),
    // Clock widget data, for the manager kiosk only.
    authPromise.then(async (result): Promise<{ employees: ClockEmployee[]; sessions: ClockSession[] }> => {
      if (result.data.user?.email?.toLowerCase() !== MANAGER_IPAD_EMAIL) {
        return { employees: [], sessions: [] }
      }
      const admin = createAdminClient()
      const [{ data: emps }, sessionsResult] = await Promise.all([
        admin.from('employees').select('employee_id, first_name, last_name, preferred_name, status, employment_end_date').in('status', ['Active', 'Started Separation']).order('first_name').order('last_name'),
        getOpenSessions(),
      ])
      const sessions = sessionsResult.success ? (sessionsResult.data as ClockSession[]) : []
      // As on the kiosk: someone past their last working day is listed only while still clocked in.
      const employees = onClockScreen(
        (emps ?? []) as Array<ClockEmployee & { status: string; employment_end_date: string | null }>,
        new Set(sessions.map((session) => session.employee_id)),
      ).map(({ employee_id, first_name, last_name, preferred_name }) => ({ employee_id, first_name, last_name, preferred_name }))
      return { employees, sessions }
    }),
    // The service the floor is working: the night before, from midnight until an after-midnight
    // close (1am on New Year's Eve), otherwise today.
    resolveTradingDayNow(createAdminClient()),
  ])

  // A failed lookup is a connection problem, not a refusal: show a retry screen, never Access
  // Denied (BK-095). A real refusal still redirects.
  if (viewStatus === 'unavailable') {
    return <PermissionsUnavailable />
  }
  if (viewStatus !== 'allowed') {
    redirect('/unauthorized')
  }

  const permissions = permissionsResult.success && permissionsResult.data
    ? permissionsResult.data
    : []
  const fohOnlyMode = isFohOnlyUser(permissions)
  const navItems = fohOnlyMode
    ? undefined
    : [
        { label: 'Back of House', href: '/table-bookings/boh' },
        { label: 'Front of House', href: '/table-bookings/foh' },
        ...(canViewReports ? [{ label: 'Reports', href: '/table-bookings/reports' }] : [])
      ]
  // No "Back to Dashboard" here. This is the floor screen and the people using it
  // work the floor, so the dashboard is a dead end for them. The nav items above
  // are the only exits this screen offers.
  const useManagerKioskStyle = authResult.data.user?.email?.toLowerCase() === MANAGER_IPAD_EMAIL
  const contentClassName = useManagerKioskStyle ? '!px-2 sm:!px-3 lg:!px-4 !pt-1' : undefined
  const subtitle = useManagerKioskStyle ? undefined : 'Live swimlane view for table bookings and floor actions'

  const clockWidgetEmployees = clockWidget.employees
  const clockWidgetSessions = clockWidget.sessions
  const initialDate = tradingDay.date

  const headerActions = useManagerKioskStyle
    ? (
        <div className="flex items-center gap-2">
          <FohClockWidget employees={clockWidgetEmployees} initialSessions={clockWidgetSessions} />
          <Image
            src="/logo.png"
            alt="The Anchor logo"
            width={320}
            height={110}
            className="h-8 w-auto md:h-10"
            priority
          />
        </div>
      )
    : canManageSettings ? (
        <div className="flex items-center gap-2">
          <LinkButton href="/settings/table-bookings" variant="secondary" size="sm">
            Table Setup
          </LinkButton>
        </div>
      ) : undefined

  return (
    <PageLayout
      title="Front of House Schedule"
      subtitle={subtitle}
      navItems={navItems}
      headerVariant={useManagerKioskStyle ? 'dark' : 'default'}
      contentClassName={contentClassName}
      headerActions={headerActions}
      showHeaderActionsOnMobile={useManagerKioskStyle}
      hideMobileMenuButton
      compactHeader={useManagerKioskStyle}
      padded={!useManagerKioskStyle}
    >
      {/* Earlier bookings nobody marked as arrived or no-show (BK-130). Renders nothing when there are none. */}
      <div className="mb-3">
        <OpenEarlierBookingsStrip canEdit={canEdit} />
      </div>
      <FohScheduleClient
        initialDate={initialDate}
        deploymentVersion={getDeploymentVersion()}
        canEdit={canEdit}
        isSuperAdmin={isSuperAdmin}
        canWaiveDeposit={canWaiveDeposit}
        styleVariant={useManagerKioskStyle ? 'manager_kiosk' : 'default'}
      />
      {/* Renders nothing unless the module + prompts flags are on and a during-service
          check is due (spec 9.2). Dark by default. */}
      <ChecklistMidShiftPrompt />
    </PageLayout>
  )
}
