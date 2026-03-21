'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Badge } from '@/components/ui-v2/display/Badge'
import { IconButton } from '@/components/ui-v2/forms/Button'
import { formatDate } from '@/lib/dateUtils'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { CHANNEL_MAP } from '@/lib/short-links/channels'
import { ChannelMixBar } from './ChannelMixBar'
import type { CampaignGroup, AnalyticsLinkRow } from '@/types/short-links'

interface Props {
  campaigns: CampaignGroup[]
  standalone: AnalyticsLinkRow[]
}

function fmt(n: number): string {
  return n.toLocaleString('en-GB')
}

function channelLabel(key: string): string {
  return CHANNEL_MAP.get(key)?.label ?? key
}

function getChannel(variant: AnalyticsLinkRow): string {
  const meta = variant.metadata
  if (meta && typeof meta.channel === 'string') return meta.channel
  return 'unknown'
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  toast.success('Copied to clipboard')
}

/* ------------------------------------------------------------------ */
/*  Desktop table                                                      */
/* ------------------------------------------------------------------ */

function CampaignDesktopTable({
  campaigns,
  expanded,
  onToggle,
}: {
  campaigns: CampaignGroup[]
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="hidden sm:block overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="w-8 px-3 py-3" />
            <th scope="col" className="px-3 py-3 text-left font-medium text-gray-500">
              Campaign
            </th>
            <th scope="col" className="px-3 py-3 text-left font-medium text-gray-500">
              Channels
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium text-gray-500">
              Total Clicks
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium text-gray-500">
              Unique
            </th>
            <th scope="col" className="px-3 py-3 text-left font-medium text-gray-500">
              Top Channel
            </th>
            <th scope="col" className="px-3 py-3 text-left font-medium text-gray-500 min-w-[140px]">
              Channel Mix
            </th>
            <th scope="col" className="px-3 py-3 text-left font-medium text-gray-500">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {campaigns.map((campaign) => {
            const isOpen = expanded.has(campaign.parent.id)
            return (
              <CampaignRowGroup
                key={campaign.parent.id}
                campaign={campaign}
                isOpen={isOpen}
                onToggle={() => onToggle(campaign.parent.id)}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CampaignRowGroup({
  campaign,
  isOpen,
  onToggle,
}: {
  campaign: CampaignGroup
  isOpen: boolean
  onToggle: () => void
}) {
  const { parent, variants, channelBreakdown, totalClicks, totalUnique, topChannel } = campaign
  const ChevronIcon = isOpen ? ChevronDownIcon : ChevronRightIcon

  return (
    <>
      {/* Parent campaign row */}
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <td className="px-3 py-3">
          <ChevronIcon className="h-4 w-4 text-gray-400" />
        </td>
        <td className="px-3 py-3 font-medium text-gray-900">
          {parent.name || parent.shortCode}
        </td>
        <td className="px-3 py-3 text-gray-600">
          {variants.length}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-gray-900">
          {fmt(totalClicks)}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-gray-600">
          {fmt(totalUnique)}
        </td>
        <td className="px-3 py-3 text-gray-600">
          {topChannel ? (
            <span>
              {topChannel.label}{' '}
              <span className="text-gray-400">({fmt(topChannel.clicks)})</span>
            </span>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>
        <td className="px-3 py-3">
          <ChannelMixBar segments={channelBreakdown} totalClicks={totalClicks} />
        </td>
        <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
          {parent.createdAt ? formatDate(parent.createdAt) : '-'}
        </td>
      </tr>

      {/* Expanded variant sub-rows */}
      {isOpen &&
        variants.map((variant) => {
          const ch = getChannel(variant)
          const shortUrl = buildShortLinkUrl(variant.shortCode)

          return (
            <tr key={variant.id} className="bg-gray-50/50">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 pl-10">
                <span className="inline-flex items-center gap-2">
                  <span className="text-gray-400" aria-hidden="true">
                    &#8627;
                  </span>
                  <Badge size="sm" variant="info">
                    {channelLabel(ch)}
                  </Badge>
                  <code className="text-xs text-gray-500">{shortUrl}</code>
                </span>
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                {fmt(variant.totalClicks)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                {fmt(variant.uniqueVisitors)}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2">
                <IconButton
                  size="xs"
                  variant="ghost"
                  leftIcon={<ClipboardDocumentIcon />}
                  aria-label={`Copy short URL for ${channelLabel(ch)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(shortUrl)
                  }}
                />
              </td>
            </tr>
          )
        })}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Mobile cards                                                       */
/* ------------------------------------------------------------------ */

function CampaignMobileCards({
  campaigns,
  expanded,
  onToggle,
}: {
  campaigns: CampaignGroup[]
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="sm:hidden space-y-3">
      {campaigns.map((campaign) => {
        const isOpen = expanded.has(campaign.parent.id)
        const { parent, variants, channelBreakdown, totalClicks, totalUnique, topChannel } =
          campaign
        const ChevronIcon = isOpen ? ChevronDownIcon : ChevronRightIcon

        return (
          <Card key={parent.id} padding="sm" variant="bordered">
            {/* Campaign header */}
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onToggle(parent.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="font-medium text-gray-900 truncate">
                  {parent.name || parent.shortCode}
                </span>
              </div>
              <span className="ml-2 text-sm text-gray-500 flex-shrink-0">
                {fmt(totalClicks)} clicks
              </span>
            </button>

            {/* Summary row */}
            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
              <span>{variants.length} channels</span>
              <span>{fmt(totalUnique)} unique</span>
              {topChannel && (
                <span>
                  Top: {topChannel.label}
                </span>
              )}
            </div>

            {/* Channel mix */}
            <div className="mt-2">
              <ChannelMixBar segments={channelBreakdown} totalClicks={totalClicks} />
            </div>

            {/* Expanded variants */}
            {isOpen && (
              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                {variants.map((variant) => {
                  const ch = getChannel(variant)
                  const shortUrl = buildShortLinkUrl(variant.shortCode)

                  return (
                    <div
                      key={variant.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge size="sm" variant="info">
                          {channelLabel(ch)}
                        </Badge>
                        <code className="text-xs text-gray-500 truncate">
                          {variant.shortCode}
                        </code>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs tabular-nums text-gray-700">
                          {fmt(variant.totalClicks)}
                        </span>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          leftIcon={<ClipboardDocumentIcon />}
                          aria-label={`Copy short URL for ${channelLabel(ch)}`}
                          onClick={() => copyToClipboard(shortUrl)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Standalone links section                                           */
/* ------------------------------------------------------------------ */

function StandaloneSection({ links }: { links: AnalyticsLinkRow[] }) {
  if (links.length === 0) return null

  return (
    <Section
      title={`Other Links (${links.length})`}
      collapsible
      defaultCollapsed
      variant="bordered"
      padding="none"
    >
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500">
                Short Code
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500">
                Clicks
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-gray-500">
                Unique
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {links.map((link) => (
              <tr key={link.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {link.name || link.shortCode}
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs text-gray-500">{link.shortCode}</code>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                  {fmt(link.totalClicks)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {fmt(link.uniqueVisitors)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden divide-y divide-gray-100">
        {links.map((link) => (
          <div key={link.id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {link.name || link.shortCode}
              </p>
              <code className="text-xs text-gray-500">{link.shortCode}</code>
            </div>
            <div className="ml-2 text-right flex-shrink-0">
              <p className="text-sm tabular-nums text-gray-900">{fmt(link.totalClicks)}</p>
              <p className="text-xs tabular-nums text-gray-500">{fmt(link.uniqueVisitors)} unique</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Main export                                                        */
/* ------------------------------------------------------------------ */

export function CampaignTable({ campaigns, standalone }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpand(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (campaigns.length === 0 && standalone.length === 0) {
    return (
      <Card padding="lg">
        <p className="text-center text-gray-500">No campaign data available.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {campaigns.length > 0 && (
        <Card padding="none">
          <CampaignDesktopTable
            campaigns={campaigns}
            expanded={expanded}
            onToggle={toggleExpand}
          />
          <CampaignMobileCards
            campaigns={campaigns}
            expanded={expanded}
            onToggle={toggleExpand}
          />
        </Card>
      )}

      <StandaloneSection links={standalone} />
    </div>
  )
}
