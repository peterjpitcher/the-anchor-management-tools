'use client'

import type { CampaignGroup, AnalyticsLinkRow } from '@/types/short-links'
import { ChannelLeaderboard } from './ChannelLeaderboard'
import { CampaignTable } from './CampaignTable'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Card } from '@/components/ui-v2/layout/Card'

interface Props {
  campaigns: CampaignGroup[]
  standalone: AnalyticsLinkRow[]
  channelTotals: Array<{ channel: string; label: string; type: string; clicks: number }>
  searchTerm: string
}

export function CampaignsTab({ campaigns, standalone, channelTotals, searchTerm }: Props): React.ReactElement {
  if (campaigns.length === 0 && standalone.length === 0) {
    return (
      <Card>
        <div className="p-4 sm:p-6">
          <EmptyState
            icon="chart"
            title={searchTerm ? `No campaigns found for "${searchTerm}"` : 'No campaigns found in this period'}
            description={searchTerm
              ? 'Try a broader search term.'
              : 'Create a short link and use the Share/Print buttons to generate channel variants.'}
          />
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {channelTotals.length > 0 && <ChannelLeaderboard channelTotals={channelTotals} />}
      <CampaignTable campaigns={campaigns} standalone={standalone} />
    </div>
  )
}
