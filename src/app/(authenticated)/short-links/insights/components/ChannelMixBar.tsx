'use client'

import { CHANNEL_COLOURS, CHANNEL_COLOUR_DEFAULT } from '@/lib/short-links/channels'

interface Segment {
  channel: string
  label: string
  clicks: number
}

interface Props {
  segments: Segment[]
  totalClicks: number
}

export function ChannelMixBar({ segments, totalClicks }: Props) {
  if (totalClicks === 0 || segments.length === 0) {
    return <div className="h-4 w-full rounded bg-gray-100" />
  }

  return (
    <div className="flex h-4 w-full overflow-hidden rounded" title={segments.map(s => `${s.label}: ${s.clicks}`).join(', ')}>
      {segments.map((seg) => {
        const pct = (seg.clicks / totalClicks) * 100
        if (pct < 1) return null
        return (
          <div
            key={seg.channel}
            className="h-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: CHANNEL_COLOURS[seg.channel] || CHANNEL_COLOUR_DEFAULT,
            }}
            title={`${seg.label}: ${seg.clicks} (${pct.toFixed(0)}%)`}
          />
        )
      })}
    </div>
  )
}
