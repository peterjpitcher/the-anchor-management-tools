import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCustomerList } from '@/app/actions/customers'
import CustomersClient from './CustomersClient'

const DEFAULT_PAGE_SIZE = 50

interface Props {
  searchParams: Promise<{
    page?: string
    search?: string
    deactivated?: string
    size?: string
  }>
}

export default async function CustomersPage({ searchParams }: Props) {
  const resolved = await searchParams

  const canView = await checkUserPermission('customers', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const canManage = await checkUserPermission('customers', 'manage')

  const page = Math.max(1, Number(resolved.page) || 1)
  const pageSize = Number(resolved.size) || DEFAULT_PAGE_SIZE
  const searchTerm = resolved.search ?? ''
  const showDeactivated = resolved.deactivated === '1'

  const initialData = await getCustomerList({
    page,
    pageSize,
    searchTerm,
    showDeactivated,
  })

  return (
    <CustomersClient
      initialData={initialData}
      initialPage={page}
      initialPageSize={pageSize}
      initialSearch={searchTerm}
      initialShowDeactivated={showDeactivated}
      canManageCustomers={canManage}
    />
  )
}
