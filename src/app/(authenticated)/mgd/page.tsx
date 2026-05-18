import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCollections, getReturns, getCurrentReturn } from '@/app/actions/mgd'
import { PageHeader, Alert, Card, CardBody } from '@/ds'
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
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[{ label: 'Finance' }, { label: 'MGD' }]}
          title="Machine Games Duty"
          subtitle="Track collections and quarterly MGD returns"
        />
        <Card>
          <CardBody>
            <Alert tone="danger" title="Error loading MGD data">
              {errorMsg || 'An unexpected error occurred.'}
            </Alert>
          </CardBody>
        </Card>
      </div>
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
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'MGD' }]}
        title="Machine Games Duty"
        subtitle="Track collections and quarterly MGD returns"
      />
      <MgdClient
        initialReturn={currentReturn}
        initialCollections={initialCollections}
        initialReturns={allReturns}
      />
    </div>
  )
}
