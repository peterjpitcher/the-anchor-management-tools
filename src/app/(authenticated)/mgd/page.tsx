import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCollections, getReturns, getCurrentReturn } from '@/app/actions/mgd'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Card } from '@/components/ui-v2/layout/Card'
import { MgdClient } from './_components/MgdClient'

export default async function MgdPage(): Promise<React.ReactElement> {
  const canManage = await checkUserPermission('mgd', 'manage')
  if (!canManage) {
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
      <PageLayout title="Machine Games Duty">
        <Card>
          <Alert
            variant="error"
            title="Error loading MGD data"
            description={errorMsg || 'An unexpected error occurred.'}
          />
        </Card>
      </PageLayout>
    )
  }

  const currentReturn = currentReturnResult.data ?? null
  const allReturns = returnsResult.data ?? []

  // Pre-fetch collections for the current return period (or empty)
  let initialCollections: Awaited<ReturnType<typeof getCollections>> extends
    | { data?: infer D }
    | { error: string }
    ? NonNullable<D>
    : never = []
  if (currentReturn) {
    const colResult = await getCollections(
      currentReturn.period_start,
      currentReturn.period_end
    )
    if (!('error' in colResult)) {
      initialCollections = colResult.data ?? []
    }
  }

  return (
    <PageLayout title="Machine Games Duty" subtitle="Track collections and quarterly MGD returns">
      <MgdClient
        initialReturn={currentReturn}
        initialCollections={initialCollections}
        initialReturns={allReturns}
      />
    </PageLayout>
  )
}
