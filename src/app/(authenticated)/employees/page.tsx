import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEmployeesRoster } from '@/app/actions/employeeQueries'
import EmployeesClientPage from './EmployeesClientPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

type EmployeeStatus = 'all' | 'Active' | 'Former' | 'Onboarding' | 'Started Separation'

export default async function EmployeesPage({ searchParams }: PageProps) {
  const [canView, canCreate, canExport, canEdit] = await Promise.all([
    checkUserPermission('employees', 'view'),
    checkUserPermission('employees', 'create'),
    checkUserPermission('employees', 'export'),
    checkUserPermission('employees', 'edit'),
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const resolvedParams = await searchParams
  
  const page = Number(resolvedParams.page) || 1
  const searchTerm = typeof resolvedParams.search === 'string' ? resolvedParams.search : ''
  const statusParam = typeof resolvedParams.status === 'string' ? resolvedParams.status : 'Active'
  
  let statusFilter: EmployeeStatus = 'Active'
  if (['all', 'Active', 'Former', 'Onboarding', 'Started Separation'].includes(statusParam)) {
    statusFilter = statusParam as EmployeeStatus
  }

  const initialData = await getEmployeesRoster({
    statusFilter,
    searchTerm,
    page,
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
        canExport,
        canEdit,
      }}
    />
  )
}