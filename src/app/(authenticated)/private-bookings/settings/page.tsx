import { redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { Card, CardBody, CardHeader, Icon, LinkButton, PageLayout, type IconName } from '@/ds'
import { PB_BACK_TO_LIST, PB_SETTINGS_NAV } from '../_shared/nav'

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
  const canManageSpaces = actions.has('manage_spaces') || actions.has('manage')
  const canManageCatering = actions.has('manage_catering') || actions.has('manage')
  const canManageVendors = actions.has('manage_vendors') || actions.has('manage')
  const canViewSmsQueue = actions.has('view_sms_queue') || actions.has('manage')

  if (!canView) {
    redirect('/unauthorized')
  }

  const settingsCards: Array<{
    title: string
    description: string
    icon: IconName
    href: string
    action: string
    enabled: boolean
  }> = [
    {
      title: 'Venue Spaces',
      description: 'Configure spaces available for private hire',
      icon: 'mapPin',
      href: '/private-bookings/settings/spaces',
      action: 'Manage Spaces',
      enabled: canManageSpaces,
    },
    {
      title: 'Catering Packages',
      description: 'Manage food and drink options for events',
      icon: 'sparkles',
      href: '/private-bookings/settings/catering',
      action: 'Manage Catering',
      enabled: canManageCatering,
    },
    {
      title: 'Vendors',
      description: 'Maintain your preferred vendor list',
      icon: 'users',
      href: '/private-bookings/settings/vendors',
      action: 'Manage Vendors',
      enabled: canManageVendors,
    },
    {
      title: 'SMS Queue',
      description: 'Approve and send queued SMS messages',
      icon: 'message',
      href: '/private-bookings/sms-queue',
      action: 'View SMS Queue',
      enabled: canViewSmsQueue,
    },
  ]

  return (
    <PageLayout
      title="Private Bookings Settings"
      subtitle="Manage spaces, catering, vendors, and SMS approvals"
      backButton={PB_BACK_TO_LIST}
      navItems={PB_SETTINGS_NAV}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {settingsCards.map((card) => (
          <Card key={card.href}>
            <CardHeader title={card.title} />
            <CardBody>
              <div className="flex items-start gap-4">
                <Icon name={card.icon} size={24} className="text-text-muted" />
                <div className="flex-1 space-y-4">
                  <p className="text-sm text-text-muted">{card.description}</p>
                  <LinkButton href={card.href} variant="secondary" disabled={!card.enabled}>
                    {card.action}
                  </LinkButton>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </PageLayout>
  )
}
