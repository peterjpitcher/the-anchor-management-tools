import { redirect } from 'next/navigation'

import { checkUserPermission } from '@/app/actions/rbac'
import { getMarketingSettings } from '@/app/actions/marketing-campaigns'
import { Alert, PageLayout } from '@/ds'
import { getMarketingConfig } from '@/lib/email/marketing/config'

import { MARKETING_SECTION_NAV } from '../_shared/marketing-ui'
import { MarketingSettingsClient } from './MarketingSettingsClient'

export const dynamic = 'force-dynamic'

export default async function MarketingSettingsPage() {
  const canManage = await checkUserPermission('marketing', 'manage')
  if (!canManage) redirect('/unauthorized')

  const settingsResult = await getMarketingSettings()

  if (settingsResult.error || !settingsResult.data) {
    return (
      <PageLayout title="Marketing" subtitle="Settings" navItems={MARKETING_SECTION_NAV}>
        <Alert tone="danger" title="Could not load marketing settings">
          {settingsResult.error ?? 'Something went wrong. Refresh to try again.'}
        </Alert>
      </PageLayout>
    )
  }

  // Read on the server: these come from environment variables, which a client component
  // cannot see and must never be handed the raw values of.
  const config = getMarketingConfig()
  const readiness = config.ok
    ? { ok: true as const, from: config.from, replyTo: config.replyTo ?? null }
    : { ok: false as const, missing: config.missing }

  return (
    <MarketingSettingsClient settings={settingsResult.data} readiness={readiness} />
  )
}
