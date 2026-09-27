import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCollections, getReturns, getCurrentReturn } from '@/app/actions/mgd'
import { Alert, PageLayout } from '@/ds'
import { MGD_COLLECTIONS_LAYOUT } from './_shared/nav'
import { MgdClient } from './_components/MgdClient'

export default async function MgdPage(): Promise<React.ReactElement> {
  const canView = await checkUserPermission('mgd', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const [currentReturnResult, returnsResult] = await Promise.all([
    getCurrentReturn(),
    getReturns(),
  ])

  if ('error' in currentReturnResult || 'error' in returnsResult) {
    const errorMsg =
      ('error' in currentReturnResult ? currentReturnResult.error : '') ||
      ('error' in returnsResult ? returnsResult.error : '')
    return (
      <PageLayout {...MGD_COLLECTIONS_LAYOUT}>
        <Alert tone="danger" title="Error loading MGD data">
          {errorMsg || 'An unexpected error occurred.'}
        </Alert>
      </PageLayout>
    )
  }

  const currentReturn = currentReturnResult.data ?? null
  const allReturns = returnsResult.data ?? []

  // Pre-fetch collections for the current return period
  let initialCollections: Awaited<ReturnType<typeof getCollections>> extends
    | { data?: infer D }
    | { error: string }
    ? NonNullable<D>
    : never = []
  // A failed read is shown as a failure in the Collections card, never as "No collections".
  let initialCollectionsError: string | null = null
  if (currentReturn) {
    const colResult = await getCollections(
      currentReturn.period_start,
      currentReturn.period_end
    )
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
