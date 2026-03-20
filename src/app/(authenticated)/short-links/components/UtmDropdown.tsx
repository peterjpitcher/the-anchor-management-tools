'use client'

import { useState, useRef, useEffect } from 'react'
import {
  ShareIcon,
  PrinterIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline'
import { IconButton } from '@/components/ui-v2/forms/Button'
import { DIGITAL_CHANNELS, PRINT_CHANNELS, type ShortLinkChannel } from '@/lib/short-links/channels'
import { getOrCreateUtmVariant } from '@/app/actions/short-links'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import toast from 'react-hot-toast'

interface Props {
  parentId: string
  parentShortCode: string
}

function ChannelDropdown({
  channels,
  parentId,
  onClose,
  mode,
}: {
  channels: ShortLinkChannel[]
  parentId: string
  onClose: () => void
  mode: 'copy' | 'qr'
}) {
  const [loading, setLoading] = useState<string | null>(null)

  const handleChannelClick = async (channel: ShortLinkChannel): Promise<void> => {
    setLoading(channel.key)
    try {
      const result = await getOrCreateUtmVariant(parentId, channel.key)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to create variant')
        return
      }

      const fullUrl = result.data?.full_url || buildShortLinkUrl(result.data?.short_code || '')

      if (mode === 'copy') {
        await navigator.clipboard.writeText(fullUrl)
        toast.success(`${channel.label} link copied!`)
      } else {
        // Download QR code
        const QRCode = await import('qrcode')
        const dataUrl = await QRCode.toDataURL(fullUrl, { margin: 1, width: 400 })
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `qr-${result.data?.short_code}-${channel.key}.png`
        link.click()
        toast.success(`${channel.label} QR code downloaded!`)
      }

      onClose()
    } catch (error) {
      console.error('Channel variant error:', error)
      toast.error('Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
      {channels.map((channel) => (
        <button
          key={channel.key}
          type="button"
          disabled={!!loading}
          onClick={() => handleChannelClick(channel)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading === channel.key ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          ) : (
            <ClipboardDocumentIcon className="h-4 w-4 text-gray-400" />
          )}
          {channel.label}
        </button>
      ))}
    </div>
  )
}

export function UtmDropdown({ parentId }: Props): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<'share' | 'print' | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    if (openMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMenu])

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      <div className="relative">
        <IconButton
          size="sm"
          variant="secondary"
          onClick={() => setOpenMenu(openMenu === 'share' ? null : 'share')}
          title="Share (digital channels)"
        >
          <ShareIcon className="h-4 w-4 text-gray-600" />
        </IconButton>
        {openMenu === 'share' && (
          <ChannelDropdown
            channels={DIGITAL_CHANNELS}
            parentId={parentId}
            onClose={() => setOpenMenu(null)}
            mode="copy"
          />
        )}
      </div>

      <div className="relative">
        <IconButton
          size="sm"
          variant="secondary"
          onClick={() => setOpenMenu(openMenu === 'print' ? null : 'print')}
          title="Print (QR channels)"
        >
          <PrinterIcon className="h-4 w-4 text-gray-600" />
        </IconButton>
        {openMenu === 'print' && (
          <ChannelDropdown
            channels={PRINT_CHANNELS}
            parentId={parentId}
            onClose={() => setOpenMenu(null)}
            mode="qr"
          />
        )}
      </div>
    </div>
  )
}
