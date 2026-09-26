'use client'

import { useEffect, useRef, useState } from 'react'
import { Dropdown, DropdownItem, DropdownLabel, IconButton, Spinner, toast, Icon } from '@/ds'
import { getOrCreateUtmVariant } from '@/app/actions/short-links'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { DIGITAL_CHANNELS, QR_CHANNELS, type ShortLinkChannel } from '@/lib/short-links/channels'
import type { ShortLink } from '@/types/short-links'
import { downloadQrPng, safeQrFilename } from './qr-download'

type VariantMode = 'copy' | 'qr'
type ExpandedSection = 'digital' | 'qr' | null

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

  const handleAllQrs = async () => {
    if (loadingKey) return
    setLoadingKey('qr:all')

    let successCount = 0
    let failureCount = 0

    try {
      for (const channel of QR_CHANNELS) {
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

      if (successCount > 0) toast.success(`${successCount} QR codes downloaded`)
      if (failureCount > 0) toast.error(`${failureCount} QR codes failed`)
    } catch (error) {
      console.error('Failed to download QR codes', error)
      toast.error('Failed to download QR codes')
    } finally {
      setLoadingKey(null)
    }
  }

  return (
    <Dropdown
      align="right"
      trigger={
        <IconButton
          variant="secondary"
          size="sm"
          icon={loadingKey ? <Spinner size="sm" /> : <Icon name="moreHorizontal" size={14} />}
          label="Short link actions"
          disabled={Boolean(loadingKey)}
        />
      }
    >
      <ShortLinkMenuEntries
        canManage={canManage}
        isParent={isParent}
        loadingKey={loadingKey}
        onAnalytics={() => onAnalytics(link)}
        onEdit={() => onEdit(link)}
        onDelete={() => onDelete(link)}
        onCopyShort={() => copyText(shortUrl, 'Short URL copied')}
        onCopyDestination={() => copyText(link.destination_url, 'Destination URL copied')}
        onBaseQr={() => void handleBaseQr()}
        onChannelSelect={(channel, mode) => void handleChannelSelect(channel, mode)}
        onAllQrs={() => void handleAllQrs()}
      />
    </Dropdown>
  )
}

interface ShortLinkMenuEntriesProps {
  canManage: boolean
  isParent: boolean
  loadingKey: string | null
  onAnalytics: () => void
  onEdit: () => void
  onDelete: () => void
  onCopyShort: () => void
  onCopyDestination: () => void
  onBaseQr: () => void
  onChannelSelect: (channel: ShortLinkChannel, mode: VariantMode) => void
  onAllQrs: () => void
}

/**
 * The menu's contents. It lives inside the open menu, so the sub-list it shows (the UTM links
 * or the QR codes) resets to the top level each time the menu closes and reopens. Opening a
 * sub-list, and Back, keep the menu open; everything else closes it.
 */
function ShortLinkMenuEntries({
  canManage,
  isParent,
  loadingKey,
  onAnalytics,
  onEdit,
  onDelete,
  onCopyShort,
  onCopyDestination,
  onBaseQr,
  onChannelSelect,
  onAllQrs,
}: ShortLinkMenuEntriesProps) {
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null)
  const busy = Boolean(loadingKey)

  // Switching list removes the item that had focus, which would drop focus to the page and
  // leave Escape and the arrow keys with nothing to act on. Hand it back to the menu instead.
  const focusAnchorRef = useRef<HTMLSpanElement>(null)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    focusAnchorRef.current?.closest<HTMLElement>('[role="menu"]')?.focus()
  }, [expandedSection])
  // Last, so it never counts as a DropdownLabel's first sibling.
  const focusAnchor = <span ref={focusAnchorRef} hidden />

  const channelItems = (channels: ShortLinkChannel[], mode: VariantMode) =>
    channels.map((channel) => {
      const itemKey = `${mode}:${channel.key}`
      return (
        <DropdownItem
          key={itemKey}
          icon={
            loadingKey === itemKey ? (
              <Spinner size="sm" />
            ) : mode === 'qr' ? (
              <Icon name="qrCode" size={16} />
            ) : (
              <Icon name="share" size={16} />
            )
          }
          disabled={busy}
          onClick={() => onChannelSelect(channel, mode)}
        >
          {channel.label}
        </DropdownItem>
      )
    })

  const backItem = (
    <DropdownItem
      icon={<Icon name="chevronLeft" size={16} />}
      closeOnSelect={false}
      onClick={() => setExpandedSection(null)}
    >
      Back
    </DropdownItem>
  )

  if (expandedSection === 'digital') {
    return (
      <>
        {backItem}
        <DropdownLabel>Digital UTM links</DropdownLabel>
        {channelItems(DIGITAL_CHANNELS, 'copy')}
        {focusAnchor}
      </>
    )
  }

  if (expandedSection === 'qr') {
    return (
      <>
        {backItem}
        <DropdownLabel>QR codes</DropdownLabel>
        <DropdownItem
          icon={loadingKey === 'qr:all' ? <Spinner size="sm" /> : <Icon name="printer" size={16} />}
          disabled={busy}
          onClick={onAllQrs}
        >
          Download All QRs
        </DropdownItem>
        {channelItems(QR_CHANNELS, 'qr')}
        {focusAnchor}
      </>
    )
  }

  return (
    <>
      <DropdownItem icon={<Icon name="barChart" size={16} />} onClick={onAnalytics}>
        Analytics
      </DropdownItem>

      {canManage && (
        <>
          <DropdownLabel>Manage</DropdownLabel>
          <DropdownItem icon={<Icon name="edit" size={16} />} onClick={onEdit}>
            Edit
          </DropdownItem>
          <DropdownItem icon={<Icon name="trash" size={16} />} danger onClick={onDelete}>
            Delete
          </DropdownItem>
        </>
      )}

      <DropdownLabel>Link</DropdownLabel>
      <DropdownItem icon={<Icon name="copy" size={16} />} onClick={onCopyShort}>
        Copy Short URL
      </DropdownItem>
      <DropdownItem icon={<Icon name="link" size={16} />} onClick={onCopyDestination}>
        Copy Destination URL
      </DropdownItem>
      <DropdownItem
        icon={loadingKey === 'base-qr' ? <Spinner size="sm" /> : <Icon name="download" size={16} />}
        disabled={busy}
        onClick={onBaseQr}
      >
        Download QR
      </DropdownItem>

      {canManage && isParent && (
        <>
          <DropdownLabel>Campaign links</DropdownLabel>
          <DropdownItem
            icon={<Icon name="share" size={16} />}
            closeOnSelect={false}
            onClick={() => setExpandedSection('digital')}
          >
            <span className="flex flex-1 items-center justify-between gap-2">
              <span>Digital UTM Links ({DIGITAL_CHANNELS.length})</span>
              <Icon name="chevronRight" size={16} className="shrink-0 text-text-muted" />
            </span>
          </DropdownItem>
          <DropdownItem
            icon={<Icon name="qrCode" size={16} />}
            closeOnSelect={false}
            onClick={() => setExpandedSection('qr')}
          >
            <span className="flex flex-1 items-center justify-between gap-2">
              <span>QR Codes ({QR_CHANNELS.length})</span>
              <Icon name="chevronRight" size={16} className="shrink-0 text-text-muted" />
            </span>
          </DropdownItem>
        </>
      )}
      {focusAnchor}
    </>
  )
}
