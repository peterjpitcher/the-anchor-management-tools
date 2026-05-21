'use client'

import { useState } from 'react'
import { Dropdown, DropdownItem, IconButton } from '@/ds'
import { Loader2, Printer, QrCode, Share2 } from 'lucide-react'
import { getOrCreateUtmVariant } from '@/app/actions/short-links'
import { DIGITAL_CHANNELS, PRINT_CHANNELS, type ShortLinkChannel } from '@/lib/short-links/channels'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { downloadQrPng, safeQrFilename } from './qr-download'
import toast from 'react-hot-toast'

type VariantMode = 'copy' | 'qr'

interface Props {
  parentId: string
  onVariantReady?: (parentId: string) => void
}

interface ChannelMenuProps {
  channels: ShortLinkChannel[]
  mode: VariantMode
  loadingKey: string | null
  onChannelSelect: (channel: ShortLinkChannel, mode: VariantMode) => void
}

function ChannelMenu({ channels, mode, loadingKey, onChannelSelect }: ChannelMenuProps) {
  return (
    <>
      {channels.map((channel) => {
        const itemKey = `${mode}:${channel.key}`
        const loading = loadingKey === itemKey

        return (
          <DropdownItem
            key={channel.key}
            icon={loading ? <Loader2 size={14} className="animate-spin" /> : mode === 'qr' ? <QrCode size={14} /> : <Share2 size={14} />}
            onClick={() => onChannelSelect(channel, mode)}
          >
            <span className={loadingKey && !loading ? 'opacity-50' : undefined}>{channel.label}</span>
          </DropdownItem>
        )
      })}
    </>
  )
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

  return (
    <div className="flex items-center gap-1">
      <Dropdown
        align="right"
        trigger={
          <IconButton
            variant="secondary"
            size="sm"
            icon={<Share2 size={14} />}
            label="Create UTM short link"
            loading={loadingKey?.startsWith('copy:')}
          />
        }
      >
        <ChannelMenu
          channels={DIGITAL_CHANNELS}
          mode="copy"
          loadingKey={loadingKey}
          onChannelSelect={handleChannelSelect}
        />
      </Dropdown>

      <Dropdown
        align="right"
        trigger={
          <IconButton
            variant="secondary"
            size="sm"
            icon={<Printer size={14} />}
            label="Download UTM QR"
            loading={loadingKey?.startsWith('qr:')}
          />
        }
      >
        <ChannelMenu
          channels={PRINT_CHANNELS}
          mode="qr"
          loadingKey={loadingKey}
          onChannelSelect={handleChannelSelect}
        />
      </Dropdown>
    </div>
  )
}
