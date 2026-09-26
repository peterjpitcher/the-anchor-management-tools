import { redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { Card, CardBody, CardHeader, Icon, LinkButton, PageLayout } from '@/ds'
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
  const canViewSmsQueue = actions.has('view_sms_queue') || actions.has('manage')

  if (!canView) {
    redirect('/unauthorized')
  }

  // Catering, Vendors and Spaces are tabs in this row, so this page links only to what the
  // row does not carry: the SMS approval queue.
  return (
    <PageLayout
      title={PB_SETTINGS_TITLE}
      subtitle="General"
      backButton={PB_BACK_TO_LIST}
      navItems={privateBookingSettingsNav(actions)}
    >
      <Card>
        <CardHeader title="SMS Queue" />
        <CardBody>
          <div className="flex items-start gap-4">
            <Icon name="message" size={24} className="text-text-muted" />
            <div className="flex-1 space-y-4">
              <p className="text-sm text-text-muted">Approve and send queued SMS messages</p>
              <LinkButton href="/private-bookings/sms-queue" variant="secondary" disabled={!canViewSmsQueue}>
                View SMS Queue
              </LinkButton>
            </div>
          </div>
        </CardBody>
      </Card>
    </PageLayout>
  )
}
