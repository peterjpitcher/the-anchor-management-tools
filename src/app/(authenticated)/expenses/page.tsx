import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'

export default async function ExpensesPage() {
  const canView = await checkUserPermission('expenses', 'view')
  if (!canView) redirect('/unauthorized')

  return (
    <PageLayout
      title="Expenses"
      subtitle="Track petty cash and personal business expenses."
    >
      <p className="text-muted-foreground">No expenses recorded yet — add your first expense.</p>
    </PageLayout>
  )
}
