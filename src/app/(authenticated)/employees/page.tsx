import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEmployeesRoster } from '@/app/actions/employeeQueries'
import EmployeesClientPage from './EmployeesClientPage'

export const dynamic = 'force-dynamic'

export default async function EmployeesPage() {
  const [canView, canCreate, canExport] = await Promise.all([
    checkUserPermission('employees', 'view'),
    checkUserPermission('employees', 'create'),
    checkUserPermission('employees', 'export')
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const initialData = await getEmployeesRoster({
    statusFilter: 'Active',
    page: 1,
    pageSize: 50
  })

  if (initialData.error) {
    throw new Error(initialData.error)
  }

  return (
    <EmployeesClientPage
      initialData={initialData}
      permissions={{
        canCreate,
        canExport
      }}
    />
  )
}
