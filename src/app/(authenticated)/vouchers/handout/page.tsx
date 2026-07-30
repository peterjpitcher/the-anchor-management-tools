import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getHandoutContext } from '@/app/actions/vouchers'
import { PageLayout, Alert } from '@/ds'
import { VOUCHER_SECTION_NAV } from '../_shared/voucher-ui'
import { HandoutClient } from './HandoutClient'

export const dynamic = 'force-dynamic'

export default async function HandoutModePage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string }>
}) {
  const canManage = await checkUserPermission('vouchers', 'manage')
  if (!canManage) redirect('/unauthorized')

  const params = await searchParams
  const contextResult = await getHandoutContext()

  if (contextResult.error || !contextResult.data) {
    return (
      <PageLayout title="Hand-out mode" navItems={VOUCHER_SECTION_NAV}>
        <Alert tone="danger" title="Could not load hand-out mode">
          {contextResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Hand-out mode"
      subtitle="Set the context once, then log each card as you hand it to a winner"
      navItems={VOUCHER_SECTION_NAV}
      backButton={{ label: 'Back to vouchers', href: '/vouchers' }}
    >
      <HandoutClient context={contextResult.data} prefillNumber={params.number ?? null} />
    </PageLayout>
  )
}
