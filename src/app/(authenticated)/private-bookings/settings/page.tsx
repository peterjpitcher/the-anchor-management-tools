import { redirect } from 'next/navigation'
import {
  ChatBubbleLeftRightIcon,
  MapPinIcon,
  SparklesIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'

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

  return (
    <PageLayout
      title="Private Bookings Settings"
      subtitle="Manage spaces, catering, vendors, and SMS approvals"
      backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              <MapPinIcon className="h-6 w-6 text-gray-600" />
              <div className="flex-1">
                <div className="text-lg font-semibold text-gray-900">Venue Spaces</div>
                <div className="mt-1 text-sm text-gray-600">Configure spaces available for private hire.</div>
                <div className="mt-4">
                  <LinkButton
                    href="/private-bookings/settings/spaces"
                    variant="secondary"
                    disabled={!canManageSpaces}
                  >
                    Manage Spaces
                  </LinkButton>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <SparklesIcon className="h-6 w-6 text-gray-600" />
              <div className="flex-1">
                <div className="text-lg font-semibold text-gray-900">Catering Packages</div>
                <div className="mt-1 text-sm text-gray-600">Manage food and drink options for events.</div>
                <div className="mt-4">
                  <LinkButton
                    href="/private-bookings/settings/catering"
                    variant="secondary"
                    disabled={!canManageCatering}
                  >
                    Manage Catering
                  </LinkButton>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <UserGroupIcon className="h-6 w-6 text-gray-600" />
              <div className="flex-1">
                <div className="text-lg font-semibold text-gray-900">Vendors</div>
                <div className="mt-1 text-sm text-gray-600">Maintain your preferred vendor list.</div>
                <div className="mt-4">
                  <LinkButton
                    href="/private-bookings/settings/vendors"
                    variant="secondary"
                    disabled={!canManageVendors}
                  >
                    Manage Vendors
                  </LinkButton>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <ChatBubbleLeftRightIcon className="h-6 w-6 text-gray-600" />
              <div className="flex-1">
                <div className="text-lg font-semibold text-gray-900">SMS Queue</div>
                <div className="mt-1 text-sm text-gray-600">Approve and send queued SMS messages.</div>
                <div className="mt-4">
                  <LinkButton
                    href="/private-bookings/sms-queue"
                    variant="secondary"
                    disabled={!canViewSmsQueue}
                  >
                    View SMS Queue
                  </LinkButton>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </PageLayout>
  )
}
