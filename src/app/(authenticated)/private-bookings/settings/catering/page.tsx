import { redirect } from 'next/navigation'
import { getCateringPackagesForManagement } from '@/app/actions/privateBookingActions'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
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
    return (
      <PageLayout
        title="Catering Packages"
        subtitle="Manage food and drink options for private events"
        backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
        navActions={
          <NavGroup>
            <NavLink href="/private-bookings/settings">Settings Home</NavLink>
          </NavGroup>
        }
        error={packagesResult.error}
      />
    )
  }

  const packages = packagesResult.data ?? []

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null

  return (
    <PageLayout
      title="Catering Packages"
      subtitle="Manage food and drink options for private events"
      backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
      navActions={
        <NavGroup>
          <NavLink href="/private-bookings/settings">
            Settings Home
          </NavLink>
        </NavGroup>
      }
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
