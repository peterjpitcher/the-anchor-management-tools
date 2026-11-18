import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getQuotesPageData } from '@/app/actions/quotes'
import { emptyQuoteSummary } from '@/lib/quotes/summary'
import QuotesClient from './_components/QuotesClient'

export default async function QuotesPage() {
  const canView = await checkUserPermission('invoices', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const [pageData, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    getQuotesPageData(),
    checkUserPermission('invoices', 'create'),
    checkUserPermission('invoices', 'edit'),
    checkUserPermission('invoices', 'delete'),
    checkUserPermission('invoices', 'export'),
  ])

  const initialQuotes = pageData.quotes ?? []
  const initialSummary = pageData.summary ?? emptyQuoteSummary()
  const initialError = pageData.error ?? null

  return (
    <QuotesClient
      initialQuotes={initialQuotes}
      initialSummary={initialSummary}
      initialStatus="all"
      initialError={initialError}
      permissions={{
        canCreate,
        canEdit,
        canDelete,
        canExport,
      }}
    />
  )
}
