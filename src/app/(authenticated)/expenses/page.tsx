import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getExpenses, getExpenseStats } from '@/app/actions/expenses'
import { Alert, PageLayout } from '@/ds'
import { EXPENSES_LIST_LAYOUT } from './_shared/nav'
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
      <PageLayout {...EXPENSES_LIST_LAYOUT}>
        <Alert tone="danger" title="Failed to load expenses">
          {loadError}
        </Alert>
      </PageLayout>
    )
  }

  // ExpensesClient renders the PageLayout, so the New Expense header action can open its form.
  return (
    <ExpensesClient
      initialExpenses={expensesResult.data ?? []}
      initialStats={statsResult.data ?? { quarterTotal: 0, vatReclaimable: 0, missingReceipts: 0, supplierSpend: [] }}
    />
  )
}
