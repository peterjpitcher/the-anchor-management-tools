import { redirect } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import { getLondonDateIso } from '@/lib/foh/api-auth'
import { FohScheduleClient } from './FohScheduleClient'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import Image from 'next/image'
import FohClockWidget from './FohClockWidget'

const MANAGER_IPAD_EMAIL = 'manager@the-anchor.pub'

export default async function TableBookingsFohPage() {
  const supabase = await createClient()

  const [authResult, canView, canEdit, canViewReports, permissionsResult] = await Promise.all([
    supabase.auth.getUser(),
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('reports', 'view'),
    getUserPermissions()
  ])

  const userId = authResult.data.user?.id
  let isSuperAdmin = false
  if (userId) {
    const admin = createAdminClient()
    const { data: roleRows } = await admin
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', userId)
    isSuperAdmin = (roleRows as Array<{ roles: { name: string } | null }> | null)
      ?.some((r) => r.roles?.name === 'super_admin') ?? false
  }

  if (!canView) {
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
        { label: 'Front of House', href: '/table-bookings/foh', active: true },
        ...(canViewReports ? [{ label: 'Reports', href: '/table-bookings/reports' }] : [])
      ]
  const backButton = fohOnlyMode
    ? undefined
    : {
        label: 'Back to Dashboard',
        href: '/'
      }
  const useManagerKioskStyle = authResult.data.user?.email?.toLowerCase() === MANAGER_IPAD_EMAIL
  const pageClassName = useManagerKioskStyle ? '!bg-sidebar' : undefined
  const headerClassName = useManagerKioskStyle
    ? '!bg-sidebar !border-green-700 [&_h1]:!text-white [&_.text-gray-900]:!text-white [&_.text-gray-500]:!text-green-100 [&_button]:!text-white [&_button]:hover:!text-white [&_button]:hover:!bg-green-700'
    : undefined
  const contentClassName = useManagerKioskStyle ? '!px-2 sm:!px-3 lg:!px-4 !pt-1' : undefined
  const subtitle = useManagerKioskStyle ? undefined : 'Live swimlane view for table bookings and floor actions'

  // Fetch clock widget data for manager kiosk
  type ClockEmployee = { employee_id: string; first_name: string | null; last_name: string | null }
  type ClockSession = import('@/app/actions/timeclock').TimeclockSession & { employee_name: string }
  let clockWidgetEmployees: ClockEmployee[] = []
  let clockWidgetSessions: ClockSession[] = []
  if (useManagerKioskStyle) {
    const admin = createAdminClient()
    const [{ data: emps }, sessionsResult] = await Promise.all([
      admin.from('employees').select('employee_id, first_name, last_name').eq('status', 'Active').order('first_name').order('last_name'),
      getOpenSessions(),
    ])
    clockWidgetEmployees = (emps ?? []) as ClockEmployee[]
    if (sessionsResult.success) clockWidgetSessions = sessionsResult.data as ClockSession[]
  }

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
    : undefined

  return (
    <PageLayout
      title="Front of House Schedule"
      subtitle={subtitle}
      navItems={navItems}
      backButton={backButton}
      className={pageClassName}
      headerClassName={headerClassName}
      contentClassName={contentClassName}
      headerActions={headerActions}
      showHeaderActionsOnMobile={useManagerKioskStyle}
      hideMobileMenuButton={useManagerKioskStyle}
      compactHeader={useManagerKioskStyle}
      padded={!useManagerKioskStyle}
    >
      <FohScheduleClient
        initialDate={getLondonDateIso()}
        canEdit={canEdit}
        isSuperAdmin={isSuperAdmin}
        styleVariant={useManagerKioskStyle ? 'manager_kiosk' : 'default'}
      />
    </PageLayout>
  )
}
