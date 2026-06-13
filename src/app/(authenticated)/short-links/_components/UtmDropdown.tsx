'use client'

import { useState } from 'react'
import { IconButton } from '@/ds'
import { Loader2, Printer, QrCode, Share2 } from 'lucide-react'
import { getOrCreateUtmVariant } from '@/app/actions/short-links'
import { DIGITAL_CHANNELS, QR_CHANNELS, type ShortLinkChannel } from '@/lib/short-links/channels'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { downloadQrPng, safeQrFilename } from './qr-download'
import { PortalMenu, type PortalMenuEntry } from './PortalMenu'
import toast from 'react-hot-toast'

type VariantMode = 'copy' | 'qr'

interface Props {
  parentId: string
  onVariantReady?: (parentId: string) => void
}

export function UtmDropdown({ parentId, onVariantReady }: Props) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null)

  const handleChannelSelect = async (channel: ShortLinkChannel, mode: VariantMode) => {
    if (loadingKey) return

    const nextLoadingKey = `${mode}:${channel.key}`
    setLoadingKey(nextLoadingKey)

    try {
      const result = await getOrCreateUtmVariant(parentId, channel.key)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to create UTM short link')
        return
      }

      const shortCode = result.data?.short_code || ''
      if (!shortCode) throw new Error('No short code returned')

      const fullUrl = result.data?.full_url || buildShortLinkUrl(shortCode)
      onVariantReady?.(parentId)

      if (mode === 'copy') {
        try {
          await navigator.clipboard.writeText(fullUrl)
          toast.success(`${channel.label} link copied`)
        } catch {
          toast.error('UTM link created, but copying was blocked')
        }
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

  const buildEntries = (channels: ShortLinkChannel[], mode: VariantMode): PortalMenuEntry[] => [
    { type: 'section', key: `${mode}-header`, label: mode === 'copy' ? 'Copy URL for' : 'Download QR for' },
    ...channels.map((channel) => {
      const itemKey = `${mode}:${channel.key}`
      const loading = loadingKey === itemKey
      return {
        key: itemKey,
        label: channel.label,
        icon: loading ? <Loader2 size={14} className="animate-spin" /> : mode === 'qr' ? <QrCode size={14} /> : <Share2 size={14} />,
        disabled: Boolean(loadingKey),
        onClick: () => handleChannelSelect(channel, mode),
      }
    }),
  ]

  return (
    <div className="flex items-center gap-1">
      <PortalMenu
        disabled={Boolean(loadingKey)}
        entries={buildEntries(DIGITAL_CHANNELS, 'copy')}
        trigger={({ ref, onClick, 'aria-expanded': expanded }) => (
          <IconButton
            ref={ref}
            variant="secondary"
            size="sm"
            icon={<Share2 size={14} />}
            label="Create UTM short link"
            loading={loadingKey?.startsWith('copy:')}
            onClick={onClick}
            aria-expanded={expanded}
          />
        )}
      />
      <PortalMenu
        disabled={Boolean(loadingKey)}
        entries={buildEntries(QR_CHANNELS, 'qr')}
        trigger={({ ref, onClick, 'aria-expanded': expanded }) => (
          <IconButton
            ref={ref}
            variant="secondary"
            size="sm"
            icon={<Printer size={14} />}
            label="Download UTM QR"
            loading={loadingKey?.startsWith('qr:')}
            onClick={onClick}
            aria-expanded={expanded}
          />
        )}
      />
    </div>
  )
}
