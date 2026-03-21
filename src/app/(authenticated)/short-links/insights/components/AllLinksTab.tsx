'use client'

import { useState } from 'react'
import type { AnalyticsLinkRow, ShortLink } from '@/types/short-links'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { IconButton } from '@/components/ui-v2/forms/Button'
import { ShortLinkAnalyticsModal } from '../../components/ShortLinkAnalyticsModal'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { formatDate } from '@/lib/dateUtils'
import {
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Props {
  links: AnalyticsLinkRow[]
  searchTerm: string
}

function toShortLink(item: AnalyticsLinkRow): ShortLink {
  return {
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
}

function getChannelLabel(item: AnalyticsLinkRow): string | null {
  if (!item.parentLinkId || !item.metadata) return null
  const channel = item.metadata.channel
  return typeof channel === 'string' ? channel : null
}

export function AllLinksTab({ links, searchTerm }: Props): React.ReactElement {
  const [selectedLink, setSelectedLink] = useState<ShortLink | null>(null)
  const [showModal, setShowModal] = useState(false)

  function handleCopyLink(shortCode: string): void {
    const url = buildShortLinkUrl(shortCode)
    void navigator.clipboard.writeText(url).then(() => {
      toast.success('Link copied to clipboard')
    }).catch(() => {
      toast.error('Failed to copy link')
    })
  }

  function handleOpenLink(shortCode: string): void {
    window.open(buildShortLinkUrl(shortCode), '_blank', 'noopener')
  }

  function handleViewAnalytics(item: AnalyticsLinkRow): void {
    setSelectedLink(toShortLink(item))
    setShowModal(true)
  }

  function handleCloseModal(): void {
    setShowModal(false)
    setSelectedLink(null)
  }

  return (
    <>
      <Card variant="bordered">
        <DataTable<AnalyticsLinkRow>
          data={links}
          getRowKey={(item) => item.id}
          emptyMessage={
            searchTerm
              ? `No links found for "${searchTerm}"`
              : 'No short links found in this period'
          }
          emptyDescription={
            searchTerm
              ? 'Try a broader search term or clear filters.'
              : 'Try selecting a different timeframe.'
          }
          columns={[
            {
              key: 'name',
              header: 'Name',
              sortable: true,
              sortFn: (a, b) => (a.name || '').localeCompare(b.name || ''),
              cell: (item) => {
                const channel = getChannelLabel(item)
                return (
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {item.name || item.shortCode}
                    </p>
                    {channel && (
                      <p className="truncate text-xs text-gray-500">{channel}</p>
                    )}
                  </div>
                )
              },
            },
            {
              key: 'shortCode',
              header: 'Short Link',
              sortable: true,
              sortFn: (a, b) => a.shortCode.localeCompare(b.shortCode),
              cell: (item) => (
                <div>
                  <code className="rounded bg-gray-100 px-2 py-1 text-xs font-mono">
                    /{item.shortCode}
                  </code>
                  <p className="mt-1 text-xs text-gray-500">
                    {buildShortLinkUrl(item.shortCode).replace(/^https?:\/\//, '')}
                  </p>
                </div>
              ),
            },
            {
              key: 'destinationUrl',
              header: 'Destination',
              hideOnMobile: true,
              cell: (item) => (
                <p className="max-w-xs truncate text-sm text-gray-700" title={item.destinationUrl}>
                  {item.destinationUrl}
                </p>
              ),
            },
            {
              key: 'linkType',
              header: 'Type',
              sortable: true,
              sortFn: (a, b) => a.linkType.localeCompare(b.linkType),
              hideOnMobile: true,
              cell: (item) => (
                <Badge variant="info" size="sm">{item.linkType}</Badge>
              ),
            },
            {
              key: 'totalClicks',
              header: 'Clicks',
              align: 'right',
              sortable: true,
              sortFn: (a, b) => a.totalClicks - b.totalClicks,
              cell: (item) => item.totalClicks.toLocaleString('en-GB'),
            },
            {
              key: 'uniqueVisitors',
              header: 'Unique',
              align: 'right',
              sortable: true,
              sortFn: (a, b) => a.uniqueVisitors - b.uniqueVisitors,
              cell: (item) => item.uniqueVisitors.toLocaleString('en-GB'),
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (item) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopyLink(item.shortCode)}
                    title="Copy link"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleOpenLink(item.shortCode)}
                    title="Open in new tab"
                  >
                    <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleViewAnalytics(item)}
                    title="View analytics"
                  >
                    <ChartBarIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                </div>
              ),
            },
          ]}
          renderMobileCard={(item) => {
            const channel = getChannelLabel(item)
            return (
              <Card padding="sm">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {item.name || item.shortCode}
                      </p>
                      {channel && (
                        <p className="truncate text-xs text-gray-500">{channel}</p>
                      )}
                      <code className="mt-1 inline-block rounded bg-gray-100 px-2 py-1 text-xs font-mono">
                        /{item.shortCode}
                      </code>
                      <p className="mt-1 truncate text-xs text-gray-500">
                        {item.destinationUrl}
                      </p>
                    </div>
                    <Badge variant="info" size="sm">{item.linkType}</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-500">Clicks</p>
                      <p className="font-semibold text-gray-900">
                        {item.totalClicks.toLocaleString('en-GB')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Unique</p>
                      <p className="font-semibold text-gray-900">
                        {item.uniqueVisitors.toLocaleString('en-GB')}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-1 border-t pt-3">
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopyLink(item.shortCode)}
                      title="Copy link"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleOpenLink(item.shortCode)}
                      title="Open in new tab"
                    >
                      <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleViewAnalytics(item)}
                      title="View analytics"
                    >
                      <ChartBarIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                  </div>
                </div>
              </Card>
            )
          }}
        />
      </Card>

      <ShortLinkAnalyticsModal
        link={selectedLink}
        open={showModal}
        onClose={handleCloseModal}
      />
    </>
  )
}
