import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCustomerList, type CustomerSmsFilter } from '@/app/actions/customers'
import CustomersClient from './_components/CustomersClient'

const DEFAULT_PAGE_SIZE = 50

interface Props {
  searchParams: Promise<{
    page?: string
    search?: string
    deactivated?: string
    sms?: string
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
  const canSendBulkMessages = await checkUserPermission('messages', 'send_marketing')

  const page = Math.max(1, Number(resolved.page) || 1)
  const pageSize = Number(resolved.size) || DEFAULT_PAGE_SIZE
  const searchTerm = resolved.search ?? ''
  // `?deactivated=1` is kept so existing links and bookmarks still work.
  const smsFilter: CustomerSmsFilter =
    resolved.sms === 'active' || resolved.sms === 'deactivated'
      ? resolved.sms
      : resolved.deactivated === '1'
        ? 'deactivated'
        : 'all'

  const initialData = await getCustomerList({
    page,
    pageSize,
    searchTerm,
    smsFilter,
  })

  return (
    <CustomersClient
      initialData={initialData}
      initialPage={page}
      initialPageSize={pageSize}
      initialSearch={searchTerm}
      initialSmsFilter={smsFilter}
      canManageCustomers={canManage}
      canSendBulkMessages={canSendBulkMessages}
    />
  )
}
