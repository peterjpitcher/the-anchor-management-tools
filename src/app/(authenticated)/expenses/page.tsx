import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getExpenses, getExpenseStats } from '@/app/actions/expenses'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { ExpensesClient } from './_components/ExpensesClient'

export default async function ExpensesPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('expenses', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  let loadError: string | null = null

  const [expensesResult, statsResult] = await Promise.all([
    getExpenses(),
    getExpenseStats(),
  ])

  if (!expensesResult.success) {
    loadError = expensesResult.error ?? 'Failed to load expenses'
  }
  if (!statsResult.success) {
    loadError = loadError ?? statsResult.error ?? 'Failed to load expense stats'
  }

  if (loadError) {
    return (
      <PageLayout title="Expenses" subtitle="Track and manage business expenses with receipt images.">
        <Alert variant="error" title="Failed to load expenses" description={loadError} />
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Expenses" subtitle="Track and manage business expenses with receipt images.">
      <ExpensesClient
        initialExpenses={expensesResult.data ?? []}
        initialStats={statsResult.data ?? { quarterTotal: 0, vatReclaimable: 0, missingReceipts: 0 }}
      />
    </PageLayout>
  )
}
