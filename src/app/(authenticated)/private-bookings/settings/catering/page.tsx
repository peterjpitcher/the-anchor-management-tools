import { redirect } from 'next/navigation'
import { getCateringPackagesForManagement } from '@/app/actions/privateBookingActions'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { CateringManager } from '@/components/features/catering/CateringManager'

export default async function CateringPackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  const canManageCatering = actions.has('manage_catering') || actions.has('manage')

  if (!canManageCatering) {
    redirect('/unauthorized')
  }

  const packagesResult = await getCateringPackagesForManagement()

  if ('error' in packagesResult) {
    const navItems = [
      { label: 'General', href: '/private-bookings/settings' },
      { label: 'Catering', href: '/private-bookings/settings/catering' },
      { label: 'Vendors', href: '/private-bookings/settings/vendors' },
      { label: 'Spaces', href: '/private-bookings/settings/spaces' },
    ];

    return (
      <PageLayout
        title="Catering Packages"
        subtitle="Manage food and drink options for private events"
        backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
        navItems={navItems}
        error={packagesResult.error}
      />
    )
  }

  const packages = packagesResult.data ?? []

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null

  const navItems = [
    { label: 'General', href: '/private-bookings/settings' },
    { label: 'Catering', href: '/private-bookings/settings/catering' },
    { label: 'Vendors', href: '/private-bookings/settings/vendors' },
    { label: 'Spaces', href: '/private-bookings/settings/spaces' },
  ];

  return (
    <PageLayout
      title="Catering Packages"
      subtitle="Manage food and drink options for private events"
      backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
      navItems={navItems}
    >
      <div className="space-y-6">
        {errorMessage && (
          <Alert
            variant="error"
            title="Error"
            description={errorMessage}
          />
        )}

        <CateringManager initialPackages={packages} />
      </div>
    </PageLayout>
  )
}
