import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getExpenseInsights } from '@/app/actions/expenses'
import { PageLayout } from '@/ds'
import { Alert } from '@/ds'
import { ExpensesInsightsClient } from './_components/ExpensesInsightsClient'
import type { HeaderNavItem } from '@/ds'

const navItems: HeaderNavItem[] = [
  { label: 'Expenses', href: '/expenses' },
  { label: 'Insights', href: '/expenses/insights' },
]

export default async function ExpensesInsightsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('expenses', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getExpenseInsights('monthly')

  if (!result.success || !result.data) {
    return (
      <PageLayout title="Expenses" subtitle="Insights" navItems={navItems}>
        <Alert variant="error" title="Error loading insights" description={result.error ?? 'Unknown error'} />
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Expenses" subtitle="Insights" navItems={navItems}>
      <ExpensesInsightsClient initialData={result.data} />
    </PageLayout>
  )
}
