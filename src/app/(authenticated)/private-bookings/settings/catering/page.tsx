import { redirect } from 'next/navigation'
import { getCateringPackagesForManagement } from '@/app/actions/privateBookingActions'
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
    return <CateringManager initialPackages={[]} loadError={packagesResult.error} />
  }

  const packages = packagesResult.data ?? []

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = typeof resolvedSearchParams?.error === 'string' ? resolvedSearchParams.error : null

  return <CateringManager initialPackages={packages} errorMessage={errorMessage} />
}
