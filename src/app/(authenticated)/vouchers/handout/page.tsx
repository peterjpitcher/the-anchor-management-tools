import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getHandoutContext } from '@/app/actions/vouchers'
import { PageLayout, Alert } from '@/ds'
import { VOUCHERS_NAV } from '../_shared/nav'
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

  // A top-level tab: no back button. One form and no table, so the narrow form width.
  const layoutProps = {
    title: 'Vouchers',
    subtitle: 'Hand-out mode: set the context once, then log each card as you hand it over',
    navItems: VOUCHERS_NAV,
    containerSize: 'md' as const,
  }

  if (contextResult.error || !contextResult.data) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Could not load hand-out mode">
          {contextResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout {...layoutProps}>
      <HandoutClient context={contextResult.data} prefillNumber={params.number ?? null} />
    </PageLayout>
  )
}
