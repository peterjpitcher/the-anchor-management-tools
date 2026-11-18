import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCollections, getReturns } from '@/app/actions/mgd'
import { findCurrentMgdReturn } from '@/lib/mgd/collectionCounts'
import { getCurrentMgdQuarter } from '@/lib/mgd/quarterMapping'
import { Alert, PageLayout } from '@/ds'
import { MGD_COLLECTIONS_LAYOUT } from './_shared/nav'
import { MgdClient } from './_components/MgdClient'

export default async function MgdPage(): Promise<React.ReactElement> {
  const canView = await checkUserPermission('mgd', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  // The current return is one of the rows getReturns() already loads, so it is
  // picked out by the current MGD quarter rather than read again. Collections
  // for that quarter are read in the same round trip.
  const quarter = getCurrentMgdQuarter()
  const [returnsResult, colResult] = await Promise.all([
    getReturns(),
    getCollections(quarter.periodStart, quarter.periodEnd),
  ])

  if ('error' in returnsResult) {
    return (
      <PageLayout {...MGD_COLLECTIONS_LAYOUT}>
        <Alert tone="danger" title="Error loading MGD data">
          {returnsResult.error || 'An unexpected error occurred.'}
        </Alert>
      </PageLayout>
    )
  }

  const allReturns = returnsResult.data ?? []
  const currentReturn = findCurrentMgdReturn(allReturns, quarter)

  // Collections for the current return period
  let initialCollections: Awaited<ReturnType<typeof getCollections>> extends
    | { data?: infer D }
    | { error: string }
    ? NonNullable<D>
    : never = []
  // A failed read is shown as a failure in the Collections card, never as "No collections".
  let initialCollectionsError: string | null = null
  if (currentReturn) {
    if ('error' in colResult) {
      initialCollectionsError = colResult.error
    } else {
      initialCollections = colResult.data ?? []
    }
  }

  // MgdClient renders the PageLayout, so Record Collection can sit in the header.
  return (
    <MgdClient
      initialReturn={currentReturn}
      initialCollections={initialCollections}
      initialCollectionsError={initialCollectionsError}
      initialReturns={allReturns}
    />
  )
}
