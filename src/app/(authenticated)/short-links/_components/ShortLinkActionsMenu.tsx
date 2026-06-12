'use client'

import { useState } from 'react'
import {
  BarChart3,
  Copy,
  Download,
  Edit3,
  Link2,
  Loader2,
  MoreHorizontal,
  Printer,
  QrCode,
  Share2,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { IconButton } from '@/ds'
import { getOrCreateUtmVariant } from '@/app/actions/short-links'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { DIGITAL_CHANNELS, PRINT_CHANNELS, type ShortLinkChannel } from '@/lib/short-links/channels'
import type { ShortLink } from '@/types/short-links'
import { downloadQrPng, safeQrFilename } from './qr-download'
import { PortalMenu, type PortalMenuEntry } from './PortalMenu'

type VariantMode = 'copy' | 'qr'

interface Props {
  link: ShortLink
  canManage: boolean
  onAnalytics: (link: ShortLink) => void
  onEdit: (link: ShortLink) => void
  onDelete: (link: ShortLink) => void
  onVariantReady?: (parentId: string) => void | Promise<void>
}

async function copyText(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(successMessage)
  } catch {
    toast.error('Copy was blocked')
  }
}

export function ShortLinkActionsMenu({ link, canManage, onAnalytics, onEdit, onDelete, onVariantReady }: Props) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const isParent = !link.parent_link_id
  const shortUrl = buildShortLinkUrl(link.short_code)

  const handleBaseQr = async () => {
    setLoadingKey('base-qr')
    try {
      await downloadQrPng(shortUrl, safeQrFilename(link.short_code))
      toast.success('QR code downloaded')
    } catch (error) {
      console.error('Failed to download QR code', error)
      toast.error('Failed to download QR code')
    } finally {
      setLoadingKey(null)
    }
  }

  const handleChannelSelect = async (channel: ShortLinkChannel, mode: VariantMode) => {
    if (loadingKey) return

    const nextLoadingKey = `${mode}:${channel.key}`
    setLoadingKey(nextLoadingKey)

    try {
      const result = await getOrCreateUtmVariant(link.id, channel.key)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to create UTM short link')
        return
      }

      const shortCode = result.data?.short_code || ''
      if (!shortCode) throw new Error('No short code returned')

      const fullUrl = result.data?.full_url || buildShortLinkUrl(shortCode)
      await onVariantReady?.(link.id)

      if (mode === 'copy') {
        await copyText(fullUrl, `${channel.label} link copied`)
      } else {
        await downloadQrPng(fullUrl, safeQrFilename(shortCode, channel.key))
        toast.success(`${channel.label} QR downloaded`)
      }
    } catch (error) {
      console.error('Failed to create UTM variant', error)
      toast.error(mode === 'copy' ? 'Failed to create UTM link' : 'Failed to download QR code')
    } finally {
      setLoadingKey(null)
    }
  }

  const handleAllPrintQrs = async () => {
    if (loadingKey) return
    setLoadingKey('qr:all')

    let successCount = 0
    let failureCount = 0

    try {
      for (const channel of PRINT_CHANNELS) {
        const result = await getOrCreateUtmVariant(link.id, channel.key)
        if (!result || 'error' in result) {
          failureCount += 1
          continue
        }

        const shortCode = result.data?.short_code || ''
        if (!shortCode) {
          failureCount += 1
          continue
        }

        const fullUrl = result.data?.full_url || buildShortLinkUrl(shortCode)
        await downloadQrPng(fullUrl, safeQrFilename(shortCode, channel.key))
        successCount += 1
      }

      await onVariantReady?.(link.id)

      if (successCount > 0) toast.success(`${successCount} print QR codes downloaded`)
      if (failureCount > 0) toast.error(`${failureCount} print QR codes failed`)
    } catch (error) {
      console.error('Failed to download print QR codes', error)
      toast.error('Failed to download print QR codes')
    } finally {
      setLoadingKey(null)
    }
  }

  const channelEntries = (channels: ShortLinkChannel[], mode: VariantMode): PortalMenuEntry[] =>
    channels.map((channel) => {
      const itemKey = `${mode}:${channel.key}`
      const loading = loadingKey === itemKey
      return {
        key: itemKey,
        label: channel.label,
        icon: loading ? <Loader2 className="animate-spin" /> : mode === 'qr' ? <QrCode /> : <Share2 />,
        disabled: Boolean(loadingKey),
        onClick: () => handleChannelSelect(channel, mode),
      }
    })

  const entries: PortalMenuEntry[] = [
    { type: 'section', key: 'link-section', label: 'Link' },
    {
      key: 'copy-short',
      label: 'Copy short URL',
      icon: <Copy />,
      onClick: () => copyText(shortUrl, 'Short URL copied'),
    },
    {
      key: 'copy-destination',
      label: 'Copy destination URL',
      icon: <Link2 />,
      onClick: () => copyText(link.destination_url, 'Destination URL copied'),
    },
    {
      key: 'download-qr',
      label: 'Download QR',
      icon: loadingKey === 'base-qr' ? <Loader2 className="animate-spin" /> : <Download />,
      disabled: Boolean(loadingKey),
      onClick: handleBaseQr,
    },
    {
      key: 'analytics',
      label: 'Analytics',
      icon: <BarChart3 />,
      onClick: () => onAnalytics(link),
    },
  ]

  if (canManage && isParent) {
    entries.push(
      { type: 'section', key: 'digital-section', label: 'Digital UTM links' },
      ...channelEntries(DIGITAL_CHANNELS, 'copy'),
      { type: 'section', key: 'print-section', label: 'Print QR codes' },
      {
        key: 'qr:all',
        label: 'Download all print QRs',
        icon: loadingKey === 'qr:all' ? <Loader2 className="animate-spin" /> : <Printer />,
        disabled: Boolean(loadingKey),
        onClick: handleAllPrintQrs,
      },
      ...channelEntries(PRINT_CHANNELS, 'qr')
    )
  }

  if (canManage) {
    entries.push(
      { type: 'section', key: 'manage-section', label: 'Manage' },
      {
        key: 'edit',
        label: 'Edit',
        icon: <Edit3 />,
        onClick: () => onEdit(link),
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: <Trash2 />,
        danger: true,
        onClick: () => onDelete(link),
      }
    )
  }

  return (
    <PortalMenu
      entries={entries}
      width={260}
      maxHeight={560}
      disabled={Boolean(loadingKey)}
      trigger={({ ref, onClick, 'aria-expanded': expanded }) => (
        <IconButton
          ref={ref}
          variant="secondary"
          size="sm"
          icon={loadingKey ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
          label="Short link actions"
          onClick={onClick}
          aria-expanded={expanded}
        />
      )}
    />
  )
}
