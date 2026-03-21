# Insights Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic short link insights page with a campaign-performance-focused analytics dashboard featuring a channel leaderboard and grouped campaign table.

**Architecture:** The 866-line monolithic `InsightsClient.tsx` is decomposed into a thin shell (controls + tabs + data fetching) and five focused child components. A DB migration extends the analytics RPC with `id`, `name`, `parent_link_id`, and `metadata` columns. Client-side grouping logic classifies links into campaigns, variants, and standalone links. Two tabs: Campaigns (default) and All Links.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL RPC), TypeScript, Tailwind CSS, existing `BarChart`/`LineChart` components.

**Spec:** `docs/superpowers/specs/2026-03-20-insights-redesign-design.md`

---

## File Map

### Files to Create

| Path | Responsibility |
|------|---------------|
| `supabase/migrations/YYYYMMDD_extend_analytics_v2_response.sql` | Extend RPC with `id`, `name`, `parent_link_id`, `metadata` |
| `src/app/(authenticated)/short-links/insights/components/CampaignsTab.tsx` | Channel leaderboard + campaign table container |
| `src/app/(authenticated)/short-links/insights/components/ChannelLeaderboard.tsx` | Horizontal bar chart of clicks per channel |
| `src/app/(authenticated)/short-links/insights/components/CampaignTable.tsx` | Grouped campaign table with expandable rows |
| `src/app/(authenticated)/short-links/insights/components/ChannelMixBar.tsx` | Inline stacked bar for channel distribution |
| `src/app/(authenticated)/short-links/insights/components/AllLinksTab.tsx` | Flat per-link performance table |
| `src/lib/short-links/insights-grouping.ts` | Client-side campaign grouping logic (pure functions) |
| `src/tests/lib/short-links/insights-grouping.test.ts` | Tests for grouping logic |

### Files to Modify

| Path | Changes |
|------|---------|
| `src/types/short-links.ts` | Add `AnalyticsLinkRow` type + `CHANNEL_COLOURS` |
| `src/lib/short-links/channels.ts` | Add `CHANNEL_COLOURS` constant |
| `src/app/(authenticated)/short-links/insights/InsightsClient.tsx` | Gut and rebuild: controls + tabs + data fetching shell only |
| `src/app/actions/short-links.ts` | Update `getShortLinkVolumeAdvanced` response mapping (if needed) |

---

## Task 1: DB migration — extend analytics RPC

**Files:**
- Create: `supabase/migrations/20260321000001_extend_analytics_v2_response.sql`

- [ ] **Step 1: Create migration file**

The migration replaces `get_all_links_analytics_v2` with an extended version. Read the existing function at `supabase/migrations/20260422090000_short_link_bot_filtering_and_timeframe_analytics.sql` lines 48-158 first. Then create a new migration that does `CREATE OR REPLACE FUNCTION` with the same body but:

1. Add to the `returns table` clause:
   - `id uuid` (first column)
   - `name varchar` (after `destination_url`)
   - `parent_link_id uuid` (after `name`)
   - `metadata jsonb` (after `parent_link_id`)
   - `created_at timestamptz` (after `metadata`)

2. In the `link_totals` CTE, add `sl.name`, `sl.parent_link_id`, `sl.metadata` to the SELECT and GROUP BY.

3. In the `per_link_bucket` CTE, carry `name`, `parent_link_id`, `metadata` through from `link_totals`.

4. In the final SELECT, add these new columns using `max()` aggregates (they are functionally dependent on `short_link_id` but PostgreSQL requires aggregation since they're not in the GROUP BY):
   - `max(plb.short_link_id)` as `id` (first column)
   - `max(plb.name)` as `name`
   - `max(plb.parent_link_id)` as `parent_link_id`
   - `max(plb.metadata)` as `metadata`
   - `max(plb.created_at)` as `created_at` (needed for "Created" column in campaign table)

5. The existing GROUP BY (`plb.short_code, plb.link_type, plb.destination_url`) remains unchanged. The `max()` aggregates are safe because each `short_code` maps to exactly one `id`, `name`, etc.

6. Also add `sl.created_at` to the `link_totals` CTE SELECT and carry it through `per_link_bucket`.

- [ ] **Step 2: Verify migration syntax**

Read the complete migration file to verify SQL correctness before applying.

- [ ] **Step 3: Commit**

```
feat: extend analytics v2 RPC with id, name, parent_link_id, metadata
```

---

## Task 2: Add `AnalyticsLinkRow` type and channel colours

**Files:**
- Modify: `src/types/short-links.ts`
- Modify: `src/lib/short-links/channels.ts`

- [ ] **Step 1: Add `AnalyticsLinkRow` type**

In `src/types/short-links.ts`, add below the existing `ShortLink` interface:

```typescript
/** Row returned by the extended get_all_links_analytics_v2 RPC */
export interface AnalyticsLinkRow {
  id: string
  shortCode: string
  linkType: string
  destinationUrl: string
  name: string | null
  parentLinkId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string | null
  totalClicks: number
  uniqueVisitors: number
  data: Array<{ date: string; value: number }>
}

/** Campaign: a parent link with its grouped variants */
export interface CampaignGroup {
  parent: AnalyticsLinkRow
  variants: AnalyticsLinkRow[]
  channelBreakdown: Array<{ channel: string; label: string; clicks: number; unique: number }>
  totalClicks: number
  totalUnique: number
  topChannel: { label: string; clicks: number } | null
}
```

- [ ] **Step 2: Add `CHANNEL_COLOURS` to channels.ts**

In `src/lib/short-links/channels.ts`, add at the bottom:

```typescript
/** Shared colour mapping for channel charts — digital=blue tones, print=amber tones */
export const CHANNEL_COLOURS: Record<string, string> = {
  // Digital — blue spectrum
  facebook: '#3b82f6',
  lnk_bio: '#6366f1',
  google_business: '#2563eb',
  meta_ads: '#818cf8',
  newsletter: '#60a5fa',
  sms: '#38bdf8',
  whatsapp: '#34d399',
  // Print — amber spectrum
  poster: '#f59e0b',
  table_talker: '#fbbf24',
  bar_strut: '#d97706',
  flyer: '#fb923c',
  menu_insert: '#f97316',
}

/** Fallback colour for unknown channels */
export const CHANNEL_COLOUR_DEFAULT = '#9ca3af'
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```
feat: add AnalyticsLinkRow type and channel colour constants
```

---

## Task 3: Campaign grouping logic with tests

**Files:**
- Create: `src/lib/short-links/insights-grouping.ts`
- Create: `src/tests/lib/short-links/insights-grouping.test.ts`

- [ ] **Step 1: Write the grouping module**

`src/lib/short-links/insights-grouping.ts`:

```typescript
import type { AnalyticsLinkRow, CampaignGroup } from '@/types/short-links'
import { CHANNEL_MAP } from './channels'

/** Classify links into campaigns, standalone, and build the channel leaderboard */
export function groupLinksIntoCampaigns(links: AnalyticsLinkRow[]): {
  campaigns: CampaignGroup[]
  standalone: AnalyticsLinkRow[]
  channelTotals: Array<{ channel: string; label: string; type: string; clicks: number }>
} {
  // Step 1: Build set of IDs that are parents (referenced by at least one variant)
  const parentIds = new Set<string>()
  for (const link of links) {
    if (link.parentLinkId) parentIds.add(link.parentLinkId)
  }

  // Step 2: Classify each link
  const parentMap = new Map<string, AnalyticsLinkRow>()
  const variantsByParent = new Map<string, AnalyticsLinkRow[]>()
  const standalone: AnalyticsLinkRow[] = []

  for (const link of links) {
    if (link.parentLinkId) {
      // Variant
      const existing = variantsByParent.get(link.parentLinkId) || []
      existing.push(link)
      variantsByParent.set(link.parentLinkId, existing)
    } else if (parentIds.has(link.id)) {
      // Campaign parent
      parentMap.set(link.id, link)
    } else {
      // Standalone
      standalone.push(link)
    }
  }

  // Step 3: Build campaign groups
  const campaigns: CampaignGroup[] = []
  const channelTotalsMap = new Map<string, number>()

  for (const [parentId, parent] of parentMap) {
    const variants = variantsByParent.get(parentId) || []
    const channelBreakdown: CampaignGroup['channelBreakdown'] = []

    for (const variant of variants) {
      const channelKey = (variant.metadata as any)?.channel as string | undefined
      if (!channelKey) continue
      const channelConfig = CHANNEL_MAP.get(channelKey)
      channelBreakdown.push({
        channel: channelKey,
        label: channelConfig?.label || channelKey,
        clicks: variant.totalClicks,
        unique: variant.uniqueVisitors,
      })
      channelTotalsMap.set(channelKey, (channelTotalsMap.get(channelKey) || 0) + variant.totalClicks)
    }

    channelBreakdown.sort((a, b) => b.clicks - a.clicks)

    const totalClicks = variants.reduce((sum, v) => sum + v.totalClicks, 0)
    const totalUnique = variants.reduce((sum, v) => sum + v.uniqueVisitors, 0)
    const topChannel = channelBreakdown.length > 0
      ? { label: channelBreakdown[0].label, clicks: channelBreakdown[0].clicks }
      : null

    campaigns.push({ parent, variants, channelBreakdown, totalClicks, totalUnique, topChannel })
  }

  campaigns.sort((a, b) => b.totalClicks - a.totalClicks)

  // Step 4: Build channel leaderboard
  const channelTotals = Array.from(channelTotalsMap.entries())
    .map(([channel, clicks]) => {
      const config = CHANNEL_MAP.get(channel)
      return {
        channel,
        label: config?.label || channel,
        type: config?.type || 'digital',
        clicks,
      }
    })
    .sort((a, b) => b.clicks - a.clicks)

  return { campaigns, standalone, channelTotals }
}
```

- [ ] **Step 2: Write tests**

`src/tests/lib/short-links/insights-grouping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { groupLinksIntoCampaigns } from '@/lib/short-links/insights-grouping'
import type { AnalyticsLinkRow } from '@/types/short-links'

function makeLink(overrides: Partial<AnalyticsLinkRow> = {}): AnalyticsLinkRow {
  return {
    id: 'link-1',
    shortCode: 'abc123',
    linkType: 'custom',
    destinationUrl: 'https://example.com',
    name: 'Test Link',
    parentLinkId: null,
    metadata: null,
    totalClicks: 10,
    uniqueVisitors: 5,
    data: [],
    ...overrides,
  }
}

describe('groupLinksIntoCampaigns', () => {
  it('should classify a standalone link (no variants)', () => {
    const links = [makeLink({ id: 'standalone-1' })]
    const result = groupLinksIntoCampaigns(links)
    expect(result.campaigns).toHaveLength(0)
    expect(result.standalone).toHaveLength(1)
    expect(result.standalone[0].id).toBe('standalone-1')
  })

  it('should group parent + variants into a campaign', () => {
    const links = [
      makeLink({ id: 'parent-1', name: 'Easter Lunch', totalClicks: 0 }),
      makeLink({ id: 'variant-fb', parentLinkId: 'parent-1', metadata: { channel: 'facebook' }, totalClicks: 30, uniqueVisitors: 20 }),
      makeLink({ id: 'variant-sms', parentLinkId: 'parent-1', metadata: { channel: 'sms' }, totalClicks: 10, uniqueVisitors: 8 }),
    ]
    const result = groupLinksIntoCampaigns(links)
    expect(result.campaigns).toHaveLength(1)
    expect(result.standalone).toHaveLength(0)
    expect(result.campaigns[0].parent.name).toBe('Easter Lunch')
    expect(result.campaigns[0].variants).toHaveLength(2)
    expect(result.campaigns[0].totalClicks).toBe(40)
    expect(result.campaigns[0].topChannel?.label).toBe('Facebook')
  })

  it('should build channel totals across all campaigns', () => {
    const links = [
      makeLink({ id: 'p1' }),
      makeLink({ id: 'v1', parentLinkId: 'p1', metadata: { channel: 'facebook' }, totalClicks: 20 }),
      makeLink({ id: 'p2' }),
      makeLink({ id: 'v2', parentLinkId: 'p2', metadata: { channel: 'facebook' }, totalClicks: 15 }),
      makeLink({ id: 'v3', parentLinkId: 'p2', metadata: { channel: 'sms' }, totalClicks: 5 }),
    ]
    const result = groupLinksIntoCampaigns(links)
    expect(result.channelTotals.find(c => c.channel === 'facebook')?.clicks).toBe(35)
    expect(result.channelTotals.find(c => c.channel === 'sms')?.clicks).toBe(5)
  })

  it('should handle empty input', () => {
    const result = groupLinksIntoCampaigns([])
    expect(result.campaigns).toHaveLength(0)
    expect(result.standalone).toHaveLength(0)
    expect(result.channelTotals).toHaveLength(0)
  })

  it('should sort campaigns by total clicks descending', () => {
    const links = [
      makeLink({ id: 'p1' }),
      makeLink({ id: 'v1', parentLinkId: 'p1', metadata: { channel: 'facebook' }, totalClicks: 10 }),
      makeLink({ id: 'p2' }),
      makeLink({ id: 'v2', parentLinkId: 'p2', metadata: { channel: 'sms' }, totalClicks: 50 }),
    ]
    const result = groupLinksIntoCampaigns(links)
    expect(result.campaigns[0].parent.id).toBe('p2')
    expect(result.campaigns[1].parent.id).toBe('p1')
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/tests/lib/short-links/insights-grouping.test.ts`
Expected: All 5 pass.

- [ ] **Step 4: Commit**

```
feat: add campaign grouping logic with tests
```

---

## Task 4: ChannelMixBar component

**Files:**
- Create: `src/app/(authenticated)/short-links/insights/components/ChannelMixBar.tsx`

- [ ] **Step 1: Create the component**

A small inline stacked horizontal bar showing channel distribution for a single campaign. Each segment is coloured per channel. Hover shows a tooltip.

```tsx
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
feat: add ChannelMixBar inline stacked bar component
```

---

## Task 5: ChannelLeaderboard component

**Files:**
- Create: `src/app/(authenticated)/short-links/insights/components/ChannelLeaderboard.tsx`

- [ ] **Step 1: Create the component**

A horizontal bar chart showing total clicks per channel. Uses the `CHANNEL_COLOURS` constant. Shows all known channels, greying out those with zero clicks.

```tsx
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
  // Merge with ALL_CHANNELS to include zero-click channels
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
feat: add ChannelLeaderboard bar chart component
```

---

## Task 6: CampaignTable component

**Files:**
- Create: `src/app/(authenticated)/short-links/insights/components/CampaignTable.tsx`

- [ ] **Step 1: Create the component**

Read the existing `DataTable` component API from `src/components/ui-v2/display/DataTable.tsx` first to understand props/patterns.

The campaign table shows parent links as rows with expandable channel variant sub-rows. Uses `ChannelMixBar` for the inline channel distribution. Columns: Campaign, Channels, Total Clicks, Unique, Top Channel, Channel Mix, Created.

Use a custom `<table>` (not DataTable) since DataTable doesn't support expandable sub-rows natively. Key implementation:

```tsx
'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Badge } from '@/components/ui-v2/display/Badge'
import { IconButton } from '@/components/ui-v2/forms/Button'
import { ChannelMixBar } from './ChannelMixBar'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { formatDate } from '@/lib/dateUtils'
import type { CampaignGroup, AnalyticsLinkRow } from '@/types/short-links'
import toast from 'react-hot-toast'

interface Props {
  campaigns: CampaignGroup[]
  standalone: AnalyticsLinkRow[]
}

export function CampaignTable({ campaigns, standalone }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyLink = async (shortCode: string) => {
    await navigator.clipboard.writeText(buildShortLinkUrl(shortCode))
    toast.success('Link copied')
  }

  const fmt = (n: number) => n.toLocaleString('en-GB')

  return (
    <Card variant="bordered">
      <Section title="Campaign Performance" padding="sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="py-2 pl-3 pr-2 w-8"></th>
                <th className="py-2 px-2">Campaign</th>
                <th className="py-2 px-2">Channels</th>
                <th className="py-2 px-2 text-right">Clicks</th>
                <th className="py-2 px-2 text-right">Unique</th>
                <th className="py-2 px-2">Top Channel</th>
                <th className="py-2 px-2 w-32">Channel Mix</th>
                <th className="py-2 px-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(campaign => (
                <>
                  <tr
                    key={campaign.parent.id}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggle(campaign.parent.id)}
                  >
                    <td className="py-2 pl-3 pr-2">
                      {expanded.has(campaign.parent.id)
                        ? <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                        : <ChevronRightIcon className="h-4 w-4 text-gray-400" />}
                    </td>
                    <td className="py-2 px-2 font-medium">{campaign.parent.name || campaign.parent.shortCode}</td>
                    <td className="py-2 px-2">{campaign.variants.length} channels</td>
                    <td className="py-2 px-2 text-right font-mono">{fmt(campaign.totalClicks)}</td>
                    <td className="py-2 px-2 text-right font-mono">{fmt(campaign.totalUnique)}</td>
                    <td className="py-2 px-2 text-xs">{campaign.topChannel ? `${campaign.topChannel.label} (${fmt(campaign.topChannel.clicks)})` : '—'}</td>
                    <td className="py-2 px-2"><ChannelMixBar segments={campaign.channelBreakdown} totalClicks={campaign.totalClicks} /></td>
                    <td className="py-2 px-2 text-xs text-gray-500">{campaign.parent.createdAt ? formatDate(campaign.parent.createdAt) : '—'}</td>
                  </tr>
                  {expanded.has(campaign.parent.id) && campaign.variants.map(v => (
                    <tr key={v.id} className="bg-gray-50/50 border-b">
                      <td></td>
                      <td className="py-1.5 px-2 pl-6">
                        <span className="text-gray-400 mr-1">{'\u21B3'}</span>
                        <Badge variant="secondary" size="sm">{(v.metadata as any)?.channel || 'unknown'}</Badge>
                      </td>
                      <td className="py-1.5 px-2">
                        <code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                          {buildShortLinkUrl(v.shortCode).replace(/^https?:\/\//, '')}
                        </code>
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(v.totalClicks)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(v.uniqueVisitors)}</td>
                      <td colSpan={2}></td>
                      <td className="py-1.5 px-2">
                        <IconButton size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); void copyLink(v.shortCode) }} title="Copy link">
                          <ClipboardDocumentIcon className="h-3.5 w-3.5 text-gray-500" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Standalone links section */}
      {standalone.length > 0 && (
        <Section title={`Other Links (${standalone.length})`} padding="sm" variant="gray">
          {/* Simple flat table — same column structure minus Channel Mix */}
        </Section>
      )}
    </Card>
  )
}
```

This is the skeleton — the implementing agent should fill in the standalone links table and add mobile card rendering.

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
feat: add CampaignTable with expandable channel variant rows
```

---

## Task 7: CampaignsTab container

**Files:**
- Create: `src/app/(authenticated)/short-links/insights/components/CampaignsTab.tsx`

- [ ] **Step 1: Create the container**

Receives the grouped data (campaigns, standalone, channelTotals) and renders the channel leaderboard + campaign table + standalone section + empty states.

```tsx
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

export function CampaignsTab({ campaigns, standalone, channelTotals, searchTerm }: Props) {
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
feat: add CampaignsTab container component
```

---

## Task 8: AllLinksTab component

**Files:**
- Create: `src/app/(authenticated)/short-links/insights/components/AllLinksTab.tsx`

- [ ] **Step 1: Create the component**

A cleaned-up version of the current performance breakdown table from `InsightsClient.tsx`. Read the current table columns (lines ~690-860) and reproduce them in a standalone component. Changes from current:
- Remove "Share %" column
- Add "Name" column (first column, showing link name or "(no name)")
- Add variant indicator: if `parentLinkId` is set, show parent campaign name in muted sub-label
- Keep: Short Link, Destination, Type, Clicks, Unique, Actions (copy, open in new tab)
- **New addition** (not in current insights page): Add a "View analytics" button in the Actions column. Import `ShortLinkAnalyticsModal` from `@/app/(authenticated)/short-links/components/ShortLinkAnalyticsModal`. Construct a partial `ShortLink` prop from `AnalyticsLinkRow` data:
  ```typescript
  const modalLink: ShortLink = {
    id: item.id,
    name: item.name,
    short_code: item.shortCode,
    destination_url: item.destinationUrl,
    link_type: item.linkType,
    click_count: item.totalClicks,
    created_at: item.createdAt || '',
    expires_at: null,
    last_clicked_at: null,
    parent_link_id: item.parentLinkId,
  }
  ```
- Include `renderMobileCard` following the existing pattern

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
feat: add AllLinksTab component for per-link performance view
```

---

## Task 9: Rebuild InsightsClient as a thin shell

**Files:**
- Modify: `src/app/(authenticated)/short-links/insights/InsightsClient.tsx`

- [ ] **Step 1: Read the current file completely**

Read all 866 lines to understand every piece of state, data fetching, and rendering.

- [ ] **Step 2: Rewrite as a thin shell**

The new `InsightsClient` should contain ONLY:
- Controls bar (time range preset, custom dates, traffic filter, search, refresh)
- Tab state (`'campaigns' | 'all-links'`)
- Data fetching (`loadVolumeData` with debounce — keep existing pattern)
- Response mapping to `AnalyticsLinkRow[]` — update the existing mapping to include new fields:

```typescript
const chartData = (result.data || []).map((link: any) => {
  const clickDates = Array.isArray(link.click_dates) ? link.click_dates : []
  const clickCounts = Array.isArray(link.click_counts) ? link.click_counts : []
  const dataPoints = clickDates.map((date: string, index: number) => ({
    date,
    value: toNumber(clickCounts[index]),
  }))

  return {
    id: String(link.id ?? ''),
    shortCode: String(link.short_code ?? ''),
    linkType: String(link.link_type ?? 'unknown'),
    destinationUrl: String(link.destination_url ?? ''),
    name: link.name ? String(link.name) : null,
    parentLinkId: link.parent_link_id ? String(link.parent_link_id) : null,
    metadata: link.metadata ?? null,
    createdAt: link.created_at ? String(link.created_at) : null,
    totalClicks: toNumber(link.total_clicks),
    uniqueVisitors: toNumber(link.unique_visitors),
    data: dataPoints,
  } as AnalyticsLinkRow
})
```
- `groupLinksIntoCampaigns()` call (memoised)
- Summary stats row (4 stat cards, content varies by active tab)
- Tab rendering: `<CampaignsTab>` or `<AllLinksTab>` based on active tab
- Loading/error/empty states (keep existing patterns)

**Remove:**
- All chart components (LineChart, BarChart) — now in sub-components
- All column definitions — now in tab components
- Sort state, volumeChartType state, trendData/topChartData memos — no longer needed
- All granularity-related state and controls — hardcode to `'day'`

**Keep:**
- `useShortLinkClickToasts` hook
- Debounced data fetching pattern
- Time range preset logic
- Search + bot filter state (passed as props to tabs)

**Tab UI**: Use a simple toggle group (same pattern as the existing Human/Bot toggle) at the top of the content area:
```tsx
<div className="flex gap-1 rounded-lg bg-gray-100 p-1">
  <Button size="sm" variant={activeTab === 'campaigns' ? 'primary' : 'ghost'} onClick={() => setActiveTab('campaigns')}>
    Campaigns
  </Button>
  <Button size="sm" variant={activeTab === 'all-links' ? 'primary' : 'ghost'} onClick={() => setActiveTab('all-links')}>
    All Links
  </Button>
</div>
```

**Summary stats**: Conditionally render based on tab:
- Campaigns: "Campaigns with Activity" | "Total Human Clicks" | "Unique Visitors" | "Top Channel"
- All Links: "Active Links" | "Total Human Clicks" | "Unique Visitors" | "Top Link"

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```
feat: rebuild InsightsClient as thin shell with Campaigns + All Links tabs
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

All must pass.

- [ ] **Step 2: Manual smoke test**

Start dev server (`npm run dev`) and verify:
1. Insights page loads with Campaigns tab active
2. Tab toggle switches between Campaigns and All Links
3. Channel leaderboard shows all channels (zero-click ones greyed out)
4. Campaign table shows grouped parent links with variant count
5. Expanding a campaign shows channel variant rows
6. Channel mix bar renders coloured segments
7. All Links tab shows flat per-link table
8. Analytics modal opens from All Links tab
9. Search filters both tabs
10. Time range and bot filter work
11. Stats row updates per tab

- [ ] **Step 3: Final commit if any fixes needed**

```
fix: address smoke test findings
```

---

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| Data layer | Tasks 1-3 | RPC migration, types, grouping logic with tests |
| Components | Tasks 4-8 | ChannelMixBar, ChannelLeaderboard, CampaignTable, CampaignsTab, AllLinksTab |
| Integration | Tasks 9-10 | Rebuilt InsightsClient shell, e2e verification |

**Total: 10 tasks.**
