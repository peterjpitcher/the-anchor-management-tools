import { redirect } from 'next/navigation'
import { Alert, PageLayout } from '@/ds'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { listChristmasFollowUps, type ChristmasFollowUpItem } from '@/lib/table-bookings/christmas-follow-up-list'
import { tableBookingsNav } from '../_shared/nav'
import { ChristmasFollowUpsClient } from './ChristmasFollowUpsClient'

export const dynamic = 'force-dynamic'

/**
 * Unfinished Christmas dinner bookings for staff to ring (Christmas funnel spec, owner decision 7).
 * Same permissions as the awaiting-confirmation call list: table_bookings view to see the list,
 * edit to mark a guest called. The FOH kiosk login keeps its own page, as on Back of House.
 */
export default async function ChristmasFollowUpsPage(): Promise<React.JSX.Element> {
  const [canView, canEdit, canViewReports, permissionsResult] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('reports', 'view'),
    getUserPermissions(),
  ])

  if (!canView) {
    redirect('/unauthorized')
  }
  if (permissionsResult.success && permissionsResult.data && isFohOnlyUser(permissionsResult.data)) {
    redirect('/table-bookings/foh')
  }

  let items: ChristmasFollowUpItem[] = []
  let loadFailed = false
  try {
    items = await listChristmasFollowUps(createAdminClient())
  } catch (error) {
    loadFailed = true
    logger.error('Christmas follow-ups list could not be loaded', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }

  return (
    <PageLayout
      title="Table Bookings"
      subtitle="Christmas follow-ups: people who started a Christmas dinner booking and did not finish"
      navItems={tableBookingsNav({ canViewReports })}
    >
      {loadFailed ? (
        <Alert tone="danger" title="The list could not be loaded">
          Refresh the page to try again.
        </Alert>
      ) : (
        <ChristmasFollowUpsClient items={items} canEdit={canEdit} />
      )}
    </PageLayout>
  )
}
