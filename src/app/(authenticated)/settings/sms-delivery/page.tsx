import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getDeliveryFailureReport, getSmsDeliveryStats } from '@/app/actions/customerSmsActions'
import SmsDeliveryClient, {
  type FailedCustomer,
  type SmsStats,
} from './SmsDeliveryClient'

type ErrorResult = { error: string }

function isErrorResult(result: unknown): result is ErrorResult {
  return Boolean(
    result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof (result as { error: unknown }).error === 'string',
  )
}

export default async function SmsDeliveryPage() {
  const [canViewSmsHealth, canViewCustomers] = await Promise.all([
    checkUserPermission('sms_health', 'view'),
    checkUserPermission('customers', 'view'),
  ])

  if (!canViewSmsHealth || !canViewCustomers) {
    redirect('/unauthorized')
  }

  const [statsResult, failureResult] = await Promise.all([
    getSmsDeliveryStats(),
    getDeliveryFailureReport(),
  ])

  const stats: SmsStats | null = isErrorResult(statsResult)
    ? null
    : (statsResult as SmsStats)

  const failedCustomers: FailedCustomer[] =
    !isErrorResult(failureResult) &&
    failureResult &&
    typeof failureResult === 'object' &&
    'customers' in failureResult &&
    Array.isArray((failureResult as { customers?: unknown }).customers)
      ? ((failureResult as { customers: FailedCustomer[] }).customers ?? [])
      : []

  const initialError =
    (isErrorResult(statsResult) && statsResult.error) ||
    (isErrorResult(failureResult) && failureResult.error) ||
    null

  return (
    <SmsDeliveryClient
      initialStats={stats}
      initialFailedCustomers={failedCustomers}
      initialError={initialError}
    />
  )
}
