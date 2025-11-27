'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ChartBarIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  PencilIcon,
  QrCodeIcon,
  PlusIcon
} from '@heroicons/react/24/outline'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import toast from 'react-hot-toast'
import {
  deleteShortLink,
  getShortLinks
} from '@/app/actions/short-links'
import { ShortLinkAnalyticsModal } from './components/ShortLinkAnalyticsModal'
import { ShortLinkFormModal } from './components/ShortLinkFormModal'

interface ShortLink {
  id: string
  name?: string | null
  short_code: string
  destination_url: string
  link_type: string
  click_count: number
  created_at: string
  expires_at: string | null
  last_clicked_at: string | null
}

interface Props {
  initialLinks: ShortLink[]
  canManage: boolean
}

const SHORT_LINK_BASE_URL = 'https://the-anchor.pub/l'

export default function ShortLinksClient({ initialLinks, canManage }: Props) {
  const [links, setLinks] = useState<ShortLink[]>(initialLinks)
  const [showFormModal, setShowFormModal] = useState(false)
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false)
  const [selectedLink, setSelectedLink] = useState<ShortLink | null>(null)

  const refreshLinks = useCallback(async () => {
    const result = await getShortLinks()
    if (!result || 'error' in result) {
      toast.error(result?.error || 'Failed to load short links')
      return
    }
    const list = Array.isArray(result.data) ? result.data : []
    setLinks(list as ShortLink[])
  }, [])

  useEffect(() => {
    setLinks(initialLinks)
  }, [initialLinks])

  const handleCreateClick = () => {
    setSelectedLink(null)
    setShowFormModal(true)
  }

  const handleEditClick = (link: ShortLink) => {
    setSelectedLink(link)
    setShowFormModal(true)
  }

  const handleAnalyticsClick = (link: ShortLink) => {
    setSelectedLink(link)
    setShowAnalyticsModal(true)
  }

  const handleCopyLink = async (link: ShortLink) => {
    const fullUrl = `${SHORT_LINK_BASE_URL}/${link.short_code}`
    await navigator.clipboard.writeText(fullUrl)
    toast.success('Link copied to clipboard!')
  }

  const handleCopyQrCode = async (link: ShortLink) => {
    const fullUrl = `${SHORT_LINK_BASE_URL}/${link.short_code}`

    try {
      const QRCode = await import('qrcode')
      const dataUrl = await QRCode.toDataURL(fullUrl, { margin: 1 })

      if (
        navigator.clipboard &&
        'write' in navigator.clipboard &&
        typeof window !== 'undefined' &&
        'ClipboardItem' in window
      ) {
        const response = await fetch(dataUrl)
        const blob = await response.blob()
        const clipboardItem = new (window as any).ClipboardItem({ [blob.type]: blob })
        await navigator.clipboard.write([clipboardItem])
        toast.success('QR code copied to clipboard!')
        return
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(dataUrl)
        toast.success('QR code copied as data URL!')
        return
      }

      throw new Error('Clipboard API not available')
    } catch (error) {
      console.error('Failed to copy QR code', error)
      toast.error('Failed to copy QR code')
    }
  }

  const handleDelete = async (linkId: string) => {
    const link = links.find(l => l.id === linkId)
    if (!link) return

    const message = `Are you sure you want to delete this short link?\n\n${SHORT_LINK_BASE_URL}/${link.short_code}\n\nAfter deletion, anyone visiting this link will no longer be redirected.`
    if (!confirm(message)) return

    try {
      const result = await deleteShortLink(linkId)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to delete short link')
        return
      }

      toast.success('Short link deleted')
      await refreshLinks()
    } catch (error) {
      console.error('Failed to delete short link', error)
      toast.error('Failed to delete short link')
    }
  }

  const navItems: HeaderNavItem[] = [
    {
      label: 'Overview',
      href: '/short-links',
      active: true,
    },
    {
      label: 'Insights',
      href: '/short-links/insights',
    },
  ]

  const headerActions = canManage ? (
    <Button
      variant="primary"
      onClick={handleCreateClick}
      leftIcon={<PlusIcon className="h-5 w-5" />}
    >
      Create Short Link
    </Button>
  ) : null

  return (
    <PageLayout
      title="Short Links"
      subtitle="Create and manage vip-club.uk short links"
      backButton={{
        label: 'Back to Settings',
        href: '/settings'
      }}
      navItems={navItems}
      headerActions={headerActions}
    >
      <div className="space-y-6">
        <Card id="links" variant="bordered">
          <DataTable
            data={links}
            getRowKey={(link) => link.id}
            emptyMessage="No short links"
            emptyDescription="Get started by creating a new short link."
            columns={[
              {
                key: 'name',
                header: 'Name',
                cell: (link) =>
                  link.name ? (
                    <span className="text-sm">{link.name}</span>
                  ) : (
                    <span className="text-xs text-gray-400">(no name)</span>
                  ),
                sortable: true
              },
              {
                key: 'short_code',
                header: 'Short Link',
                cell: (link) => (
                  <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                    {SHORT_LINK_BASE_URL.replace(/^https?:\/\//, '')}/{link.short_code}
                  </code>
                )
              },
              {
                key: 'destination_url',
                header: 'Destination',
                cell: (link) => (
                  <div className="text-sm text-gray-900 truncate max-w-xs" title={link.destination_url}>
                    {link.destination_url}
                  </div>
                )
              },
              {
                key: 'link_type',
                header: 'Type',
                cell: (link) => (
                  <Badge variant="info" size="sm">
                    {link.link_type}
                  </Badge>
                )
              },
              {
                key: 'click_count',
                header: 'Clicks',
                cell: (link) => link.click_count ?? 0,
                sortable: true
              },
              {
                key: 'created_at',
                header: 'Created',
                cell: (link) => new Date(link.created_at).toLocaleDateString(),
                sortable: true
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                cell: (link) => (
                  <div className="flex items-center justify-end gap-1">
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopyQrCode(link)}
                      title="Copy QR code"
                    >
                      <QrCodeIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopyLink(link)}
                      title="Copy link"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      onClick={() => handleAnalyticsClick(link)}
                      title="View analytics"
                    >
                      <ChartBarIcon className="h-4 w-4 text-gray-600" />
                    </IconButton>
                    {canManage && (
                      <>
                        <IconButton
                          size="sm"
                          variant="secondary"
                          onClick={() => handleEditClick(link)}
                          title="Edit"
                        >
                          <PencilIcon className="h-4 w-4 text-gray-600" />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDelete(link.id)}
                          title="Delete"
                        >
                          <TrashIcon className="h-4 w-4 text-red-600" />
                        </IconButton>
                      </>
                    )}
                  </div>
                )
              }
            ]}
            renderMobileCard={(link) => (
              <Card padding="sm">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0 mr-4">
                    {link.name && <div className="text-sm font-medium mb-1">{link.name}</div>}
                    <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded inline-block mb-2">
                      {SHORT_LINK_BASE_URL.replace(/^https?:\/\//, '')}/{link.short_code}
                    </code>
                    <p className="text-xs text-gray-600 truncate">{link.destination_url}</p>
                  </div>
                  <Badge variant="info" size="sm">
                    {link.link_type}
                  </Badge>
                </div>

                <div className="flex justify-between items-center text-sm text-gray-500 mb-3">
                  <span>{link.click_count ?? 0} clicks</span>
                  <span>{new Date(link.created_at).toLocaleDateString()}</span>
                </div>

                <div className="flex justify-between border-t pt-3">
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopyQrCode(link)}
                    title="Copy QR code"
                  >
                    <QrCodeIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopyLink(link)}
                    title="Copy link"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAnalyticsClick(link)}
                    title="View analytics"
                  >
                    <ChartBarIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  {canManage && (
                    <>
                      <IconButton
                        size="sm"
                        variant="secondary"
                        onClick={() => handleEditClick(link)}
                        title="Edit"
                      >
                        <PencilIcon className="h-4 w-4 text-gray-600" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDelete(link.id)}
                        title="Delete"
                      >
                        <TrashIcon className="h-4 w-4 text-red-600" />
                      </IconButton>
                    </>
                  )}
                </div>
              </Card>
            )}
          />
        </Card>

        <ShortLinkFormModal
          open={showFormModal}
          onClose={() => setShowFormModal(false)}
          onSuccess={refreshLinks}
          link={selectedLink}
          canManage={canManage}
        />

        <ShortLinkAnalyticsModal
          open={showAnalyticsModal}
          onClose={() => setShowAnalyticsModal(false)}
          link={selectedLink}
        />
      </div>
    </PageLayout>
  )
}

