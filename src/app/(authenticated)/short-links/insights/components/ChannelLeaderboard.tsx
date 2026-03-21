'use client'

import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { ALL_CHANNELS, CHANNEL_COLOURS, CHANNEL_COLOUR_DEFAULT } from '@/lib/short-links/channels'

interface ChannelTotal {
  channel: string
  label: string
  type: string
  clicks: number
}

interface Props {
  channelTotals: ChannelTotal[]
}

export function ChannelLeaderboard({ channelTotals }: Props) {
  const totalsMap = new Map(channelTotals.map(c => [c.channel, c.clicks]))
  const maxClicks = Math.max(...channelTotals.map(c => c.clicks), 1)

  const rows = ALL_CHANNELS.map(ch => ({
    channel: ch.key,
    label: ch.label,
    type: ch.type,
    clicks: totalsMap.get(ch.key) || 0,
  })).sort((a, b) => b.clicks - a.clicks)

  return (
    <Card variant="bordered">
      <Section title="Channel Performance" description="Total clicks per channel across all campaigns" padding="sm">
        <div className="space-y-2">
          {rows.map(row => {
            const pct = maxClicks > 0 ? (row.clicks / maxClicks) * 100 : 0
            const isZero = row.clicks === 0
            const colour = CHANNEL_COLOURS[row.channel] || CHANNEL_COLOUR_DEFAULT

            return (
              <div key={row.channel} className="flex items-center gap-3">
                <span className={`w-28 text-right text-xs font-medium ${isZero ? 'text-gray-300' : 'text-gray-700'}`}>
                  {row.label}
                </span>
                <div className="flex-1 h-5 rounded bg-gray-100 overflow-hidden">
                  {!isZero && (
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: colour }}
                    />
                  )}
                </div>
                <span className={`w-12 text-right text-xs font-mono ${isZero ? 'text-gray-300' : 'text-gray-900'}`}>
                  {row.clicks.toLocaleString('en-GB')}
                </span>
              </div>
            )
          })}
        </div>
      </Section>
    </Card>
  )
}
