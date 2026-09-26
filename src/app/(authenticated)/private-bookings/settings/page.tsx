import { redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { Card, Empty, PageLayout } from '@/ds'
import { PB_BACK_TO_LIST, PB_SETTINGS_TITLE, privateBookingSettingsNav } from '../_shared/nav'

export default async function PrivateBookingsSettingsPage() {
  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  const canView = actions.has('view') || actions.has('manage')

  if (!canView) {
    redirect('/unauthorized')
  }

  // Catering, Vendors and Spaces are tabs in this row, and the SMS approval queue is a tab in the
  // Private Bookings row, so this page repeats none of them.
  return (
    <PageLayout
      title={PB_SETTINGS_TITLE}
      subtitle="General: settings that apply to every private booking"
      backButton={PB_BACK_TO_LIST}
      navItems={privateBookingSettingsNav(actions)}
    >
      <Card>
        <Empty
          size="sm"
          icon="folder"
          title="No general settings yet"
          description="Catering packages, vendors and spaces each have their own tab."
        />
      </Card>
    </PageLayout>
  )
}
