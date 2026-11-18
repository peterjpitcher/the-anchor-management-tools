import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getExpenses, getExpenseStats, type ExpenseFilters } from '@/app/actions/expenses'
import { isValidIsoDate } from '@/lib/dateUtils'
import { Alert, PageLayout } from '@/ds'
import { EXPENSES_LIST_LAYOUT } from './_shared/nav'
import { ExpensesClient } from './_components/ExpensesClient'

interface ExpensesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** A `from` or `to` date in the address, or undefined when it is missing or not a real date. */
function readDateParam(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  return text && isValidIsoDate(text) ? text : undefined
}

export default async function ExpensesPage({ searchParams }: ExpensesPageProps): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('expenses', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  // The insights chart links here with ?from=&to= for one period. Those dates are applied here, so
  // the first render is already the filtered list and the browser does not load it a second time.
  const params = await searchParams
  const initialFilters: ExpenseFilters = {
    dateFrom: readDateParam(params.from),
    dateTo: readDateParam(params.to),
  }

  let loadError: string | null = null

  const [expensesResult, statsResult] = await Promise.all([
    getExpenses(initialFilters),
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
      key={`${initialFilters.dateFrom ?? ''}|${initialFilters.dateTo ?? ''}`}
      initialExpenses={expensesResult.data ?? []}
      initialFilters={initialFilters}
      initialStats={statsResult.data ?? { quarterTotal: 0, vatReclaimable: 0, missingReceipts: 0, supplierSpend: [] }}
    />
  )
}
