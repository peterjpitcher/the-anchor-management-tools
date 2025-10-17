import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getQuotes, getQuoteSummary } from '@/app/actions/quotes'
import QuotesClient from './QuotesClient'

export default async function QuotesPage() {
  const canView = await checkUserPermission('invoices', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const [quotesResult, summaryResult, canCreate, canEdit, canDelete] = await Promise.all([
    getQuotes(),
    getQuoteSummary(),
    checkUserPermission('invoices', 'create'),
    checkUserPermission('invoices', 'edit'),
    checkUserPermission('invoices', 'delete'),
  ])

  const initialQuotes = quotesResult.quotes ?? []
  const initialSummary = summaryResult.summary ?? {
    total_pending: 0,
    total_expired: 0,
    total_accepted: 0,
    draft_badge: 0,
  }
  const initialError = quotesResult.error ?? summaryResult.error ?? null

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
      }}
    />
  )
}
