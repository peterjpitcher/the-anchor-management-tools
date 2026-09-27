import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getExpenseInsights } from '@/app/actions/expenses'
import { Alert, PageLayout } from '@/ds'
import { EXPENSES_INSIGHTS_LAYOUT } from '../_shared/nav'
import { ExpensesInsightsClient } from './_components/ExpensesInsightsClient'

export default async function ExpensesInsightsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('expenses', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getExpenseInsights('monthly')

  if (!result.success || !result.data) {
    return (
      <PageLayout {...EXPENSES_INSIGHTS_LAYOUT}>
        <Alert tone="danger" title="Error loading insights">{result.error ?? 'Unknown error'}</Alert>
      </PageLayout>
    )
  }

  // The client renders the PageLayout, so the period switch can sit in the header.
  return <ExpensesInsightsClient initialData={result.data} />
}
