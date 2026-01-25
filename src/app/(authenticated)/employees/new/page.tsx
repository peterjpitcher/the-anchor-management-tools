import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import NewEmployeeOnboardingClient from './NewEmployeeOnboardingClient'

export const dynamic = 'force-dynamic'

export default async function NewEmployeePage() {
  const canCreate = await checkUserPermission('employees', 'create')

  if (!canCreate) {
    redirect('/unauthorized')
  }

  return <NewEmployeeOnboardingClient />
}

