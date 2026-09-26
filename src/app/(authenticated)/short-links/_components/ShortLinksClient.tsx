'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  PageLayout,
  Alert,
  Card,
  CardBody,
  Empty,
  Stat,
  StatGrid,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TablePagination,
  toast,
} from '@/ds'
import { Button, Badge, SearchInput, IconButton, ConfirmDialog } from '@/ds'
import { Icon } from '@/ds/icons'
import {
  deleteShortLink,
  getShortLinks,
} from '@/app/actions/short-links'
import { ShortLinkFormModal } from './ShortLinkFormModal'
import { ShortLinkAnalyticsModal } from './ShortLinkAnalyticsModal'
import { ShortLinkActionsMenu } from './ShortLinkActionsMenu'
import { SHORT_LINKS_NAV, SHORT_LINKS_TITLE } from '../_shared/nav'
import { SHORT_LINK_KIND_TONE } from '../_shared/status-ui'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { CHANNEL_MAP } from '@/lib/short-links/channels'
import { formatDate } from '@/lib/dateUtils'
import { cn } from '@/lib/utils'
import type { ShortLink } from '@/types/short-links'

interface Props {
  initialLinks: ShortLink[]
  initialTotal: number
  initialLinkTotal: number
  /** Set when the server could not read the list, so it is not shown as an empty one. */
  initialError: string | null
  volume: unknown
  previousVolume: unknown
  canManage: boolean
}

type DisplayLink = ShortLink & {
  isVariant?: boolean
  variantCount?: number
}

type VolumeRow = {
  destination_url?: unknown
  name?: unknown
  short_code?: unknown
  total_clicks?: unknown
  unique_visitors?: unknown
}


function getVariantLabel(link: ShortLink): string {
  const channelKey = typeof link.metadata?.channel === 'string' ? link.metadata.channel : null
  const channelConfig = channelKey ? CHANNEL_MAP.get(channelKey) : null
  if (channelConfig) return channelConfig.label

  if (link.name?.includes('\u2014')) {
    return link.name.split('\u2014').pop()?.trim() || 'UTM variant'
  }
  return link.name || 'UTM variant'
}

function formatUrlForDisplay(value: string): string {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname}${url.search}${url.hash}`
  } catch {
    return value.replace(/^https?:\/\//, '')
  }
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function getVolumeRows(value: unknown): VolumeRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is VolumeRow => Boolean(row) && typeof row === 'object')
}

function sumVolumeRows(rows: VolumeRow[], key: 'total_clicks' | 'unique_visitors'): number {
  return rows.reduce((sum, row) => sum + toNumber(row[key]), 0)
}

function formatDestination(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-'

  try {
    const url = new URL(value)
    if (url.hostname === 'www.the-anchor.pub' || url.hostname === 'the-anchor.pub') {
      return `${url.pathname}${url.search}`
    }
    return `${url.hostname}${url.pathname}${url.search}`
  } catch {
    return value
  }
}

function getTopDestination(rows: VolumeRow[]): { label: string; title: string } {
  if (rows.length === 0) return { label: '-', title: '' }

  const top = [...rows].sort((a, b) => toNumber(b.total_clicks) - toNumber(a.total_clicks))[0]
  const name = typeof top.name === 'string' && top.name.trim() ? top.name.trim() : ''
  const destination = typeof top.destination_url === 'string' ? top.destination_url : ''
  return {
    label: name || formatDestination(destination),
    title: destination || name,
  }
}

/**
 * Clicks in the last 30 days against the 30 before. A percentage needs a previous figure, so
 * growth from nothing is said in words instead.
 */
function getClicksTrend(current: number, previous: number): { delta?: number; hint: string } {
  if (previous === 0 && current === 0) return { hint: 'No change vs prev 30d' }
  if (previous === 0) return { hint: `Up from 0: ${current.toLocaleString('en-GB')} clicks` }
  return { delta: Math.round(((current - previous) / previous) * 100), hint: 'vs prev 30d' }
}

/** A long destination is cut for the figure; the hint carries it in full. */
function shortenForStat(value: string, max = 40): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

export function ShortLinksClient({ initialLinks, initialTotal, initialLinkTotal, initialError, volume, previousVolume, canManage }: Props) {
  const [links, setLinks] = useState<ShortLink[]>(initialLinks)
  const [totalLinks, setTotalLinks] = useState(initialTotal)
  const [linkTotal, setLinkTotal] = useState(initialLinkTotal)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 25
  const totalPages = Math.ceil(totalLinks / pageSize)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false)
  const [activeLink, setActiveLink] = useState<ShortLink | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ShortLink | null>(null)
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(initialError)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const refreshLinks = useCallback(async (page: number = currentPage) => {
    setIsRefreshing(true)
    try {
      const searchStr = debouncedSearch.trim() || undefined
      const result = await getShortLinks(page, pageSize, false, searchStr)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to load short links')
        // Only a list that never loaded is replaced by the error; a failed refresh keeps the
        // rows already on screen and says so in the toast.
        setLoadError((current) => (current ? result?.error || 'Failed to load short links' : current))
        return
      }
      setLoadError(null)
      setLinks(Array.isArray(result.data) ? (result.data as ShortLink[]) : [])
      setTotalLinks(result.total ?? 0)
      setLinkTotal(result.linkTotal ?? 0)
      setCurrentPage(result.page ?? page)
    } finally {
      setIsRefreshing(false)
    }
  }, [currentPage, debouncedSearch])

  const displayLinks = useMemo<DisplayLink[]>(() => {
    const variantsByParent = new Map<string, ShortLink[]>()
    const parents: ShortLink[] = []

    for (const link of links) {
      if (link.parent_link_id) {
        const variants = variantsByParent.get(link.parent_link_id) || []
        variants.push(link)
        variantsByParent.set(link.parent_link_id, variants)
      } else {
        parents.push(link)
      }
    }

    return parents.flatMap((parent) => {
      const variants = variantsByParent.get(parent.id) || []
      const parentRow: DisplayLink = { ...parent, variantCount: variants.length }
      if (!expandedParents.has(parent.id)) return [parentRow]
      return [parentRow, ...variants.map((variant) => ({ ...variant, isVariant: true }))]
    })
  }, [expandedParents, links])

  const toggleExpanded = (parentId: string) => {
    setExpandedParents((current) => {
      const next = new Set(current)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  const handleVariantReady = async (parentId: string) => {
    setExpandedParents((current) => new Set(current).add(parentId))
    await refreshLinks()
  }

  // Skip the first run: page 1 is already rendered from the server-fetched
  // initial props, so refetching on mount is redundant.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    refreshLinks(1)
  }, [debouncedSearch])

  const handleCopyLink = async (link: ShortLink) => {
    try {
      const fullUrl = buildShortLinkUrl(link.short_code)
      await navigator.clipboard.writeText(fullUrl)
      toast.success('Link copied!')
    } catch {
      toast.error('Copy was blocked')
    }
  }

  const handleCopyDestination = async (destinationUrl: string) => {
    try {
      await navigator.clipboard.writeText(destinationUrl)
      toast.success('Destination URL copied')
    } catch {
      toast.error('Copy was blocked')
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      const result = await deleteShortLink(deleteTarget.id)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to delete')
        return
      }
      toast.success('Short link deleted')
      setDeleteTarget(null)
      await refreshLinks()
    } catch {
      toast.error('Failed to delete short link')
    }
  }

  const currentVolumeRows = useMemo(() => getVolumeRows(volume), [volume])
  const previousVolumeRows = useMemo(() => getVolumeRows(previousVolume), [previousVolume])
  const totalClicks = useMemo(() => sumVolumeRows(currentVolumeRows, 'total_clicks'), [currentVolumeRows])
  const previousTotalClicks = useMemo(() => sumVolumeRows(previousVolumeRows, 'total_clicks'), [previousVolumeRows])
  const uniqueVisitors = useMemo(() => sumVolumeRows(currentVolumeRows, 'unique_visitors'), [currentVolumeRows])
  const clicksTrend = useMemo(() => getClicksTrend(totalClicks, previousTotalClicks), [previousTotalClicks, totalClicks])
  const topDestination = useMemo(() => getTopDestination(currentVolumeRows), [currentVolumeRows])

  const linkKind = (link: DisplayLink): 'link' | 'variant' => (link.isVariant ? 'variant' : 'link')

  return (
    <PageLayout
      title={SHORT_LINKS_TITLE}
      subtitle="URL shortener and analytics"
      navItems={SHORT_LINKS_NAV}
      headerActions={
        canManage ? (
          <Button variant="primary" size="sm" onClick={() => { setActiveLink(null); setFormModalOpen(true) }} icon={<Icon name="plus" size={16} />}>
            New Short Link
          </Button>
        ) : undefined
      }
    >
      <StatGrid columns={4}>
        <Stat label="Total links" value={linkTotal.toLocaleString('en-GB')} />
        <Stat
          label="Clicks 30d"
          value={totalClicks.toLocaleString('en-GB')}
          delta={clicksTrend.delta}
          hint={clicksTrend.hint}
        />
        <Stat label="Unique 30d" value={uniqueVisitors.toLocaleString('en-GB')} />
        <Stat
          label="Top destination"
          value={shortenForStat(topDestination.label)}
          hint={topDestination.title && topDestination.title !== topDestination.label ? topDestination.title : undefined}
          className="min-w-0 break-words"
        />
      </StatGrid>

      {/* Search sits directly above the list it filters. */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search links..."
          aria-label="Search short links"
          className="w-full max-w-md"
        />
      </div>

      {/* Links */}
      {loadError ? (
        <Alert tone="danger" title="Could not load short links">
          {loadError}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void refreshLinks(currentPage)} loading={isRefreshing}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : (
      <Card padding="none">
        {displayLinks.length === 0 ? (
          <CardBody>
            <Empty size="sm" title="No short links found" />
          </CardBody>
        ) : (
        <div className={cn('transition-opacity', isRefreshing && 'pointer-events-none opacity-50')} aria-busy={isRefreshing}>
          {/* Mobile card list */}
          <div className="divide-y divide-border sm:hidden">
            {displayLinks.map((link) => (
                <div key={link.id} className={cn('space-y-2 p-4', link.isVariant && 'bg-surface-2 pl-7')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="max-w-full justify-start font-mono font-medium"
                        onClick={() => handleCopyLink(link)}
                        title="Copy short URL"
                        icon={<Icon name="copy" size={12} className="shrink-0 text-text-muted" />}
                      >
                        <code className="min-w-0 truncate">{buildShortLinkUrl(link.short_code).replace(/^https?:\/\//, '')}</code>
                      </Button>
                      {link.isVariant ? (
                        <div><Badge tone={SHORT_LINK_KIND_TONE.variant}>{getVariantLabel(link)}</Badge></div>
                      ) : (
                        link.name && <div className="truncate text-xs text-text-muted">{link.name}</div>
                      )}
                    </div>
                    <ShortLinkActionsMenu
                      link={link}
                      canManage={canManage}
                      onVariantReady={handleVariantReady}
                      onAnalytics={(target) => { setActiveLink(target); setAnalyticsModalOpen(true) }}
                      onEdit={(target) => { setActiveLink(target); setFormModalOpen(true) }}
                      onDelete={setDeleteTarget}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full items-start justify-start whitespace-normal py-1.5 text-left text-xs font-normal text-text-muted hover:text-text"
                    title="Copy destination URL"
                    onClick={() => handleCopyDestination(link.destination_url)}
                    icon={<Icon name="copy" size={12} className="mt-0.5 shrink-0" />}
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">{formatUrlForDisplay(link.destination_url)}</span>
                  </Button>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                    <Badge tone={SHORT_LINK_KIND_TONE[linkKind(link)]}>{link.isVariant ? 'variant' : link.link_type}</Badge>
                    <span className="font-mono">{(link.click_count ?? 0).toLocaleString('en-GB')} clicks</span>
                    <span>{formatDate(link.created_at)}</span>
                    {!link.isVariant && (link.variantCount ?? 0) > 0 && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-expanded={expandedParents.has(link.id)}
                        onClick={() => toggleExpanded(link.id)}
                      >
                        {expandedParents.has(link.id) ? 'Hide' : 'Show'} {link.variantCount} Variants
                      </Button>
                    )}
                  </div>
                </div>
              ))}
          </div>

          {/* Desktop table */}
          <Table className="hidden sm:block sm:[&>table]:table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="sm:w-[32%] py-1.5">Short URL</TableHead>
              <TableHead className="sm:w-[42%] py-1.5">Destination</TableHead>
              <TableHead align="right" className="sm:w-[7%] py-1.5">Clicks</TableHead>
              <TableHead className="sm:w-[10%] py-1.5">Created</TableHead>
              <TableHead className="sm:w-[5%] py-1.5">Type</TableHead>
              <TableHead align="right" className="sm:w-[4%] py-1.5">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLinks.map((link) => (
                <TableRow key={link.id} className={link.isVariant ? 'bg-surface-2' : undefined}>
                  <TableCell className="min-w-0 py-2 align-middle">
                    <div className={link.isVariant ? 'pl-6' : undefined}>
                      <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                        {!link.isVariant && (link.variantCount ?? 0) > 0 && (
                          <IconButton
                            icon={<Icon name={expandedParents.has(link.id) ? 'chevronDown' : 'chevronRight'} size={14} />}
                            label={expandedParents.has(link.id) ? 'Hide variants' : 'Show variants'}
                            size="sm"
                            onClick={() => toggleExpanded(link.id)}
                          />
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="min-w-0 flex-shrink-0 font-mono font-medium focus-visible:shadow-ring-inset"
                          onClick={() => handleCopyLink(link)}
                          title="Click to copy short URL"
                          icon={<Icon name="copy" size={12} className="shrink-0 text-text-muted" />}
                        >
                          <code>{buildShortLinkUrl(link.short_code).replace(/^https?:\/\//, '')}</code>
                        </Button>
                        {link.isVariant ? (
                          <Badge tone={SHORT_LINK_KIND_TONE.variant}>{getVariantLabel(link)}</Badge>
                        ) : (
                          <>
                            {link.name && <span className="min-w-0 truncate text-xs text-text-muted">{link.name}</span>}
                            {(link.variantCount ?? 0) > 0 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                className="flex-shrink-0 focus-visible:shadow-ring-inset"
                                aria-expanded={expandedParents.has(link.id)}
                                onClick={() => toggleExpanded(link.id)}
                              >
                                {link.variantCount} Variants
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-0 py-2 align-middle">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="max-w-full justify-start text-left text-xs font-normal text-text-muted hover:text-text focus-visible:shadow-ring-inset"
                      title={`${link.destination_url}\nClick to copy destination URL`}
                      onClick={() => handleCopyDestination(link.destination_url)}
                      icon={<Icon name="copy" size={12} className="shrink-0" />}
                    >
                      <span className="min-w-0 truncate">{formatUrlForDisplay(link.destination_url)}</span>
                    </Button>
                  </TableCell>
                  <TableCell align="right" className="py-2 font-mono align-middle">
                    {link.click_count ?? 0}
                  </TableCell>
                  <TableCell className="py-2 text-text-muted text-xs align-middle">
                    {formatDate(link.created_at)}
                  </TableCell>
                  <TableCell className="py-2 align-middle">
                    <Badge tone={SHORT_LINK_KIND_TONE[linkKind(link)]}>{link.isVariant ? 'variant' : link.link_type}</Badge>
                  </TableCell>
                  <TableCell align="right" className="py-2 align-middle">
                    <div className="flex items-center justify-end gap-1">
                      <ShortLinkActionsMenu
                        link={link}
                        canManage={canManage}
                        onVariantReady={handleVariantReady}
                        onAnalytics={(target) => { setActiveLink(target); setAnalyticsModalOpen(true) }}
                        onEdit={(target) => { setActiveLink(target); setFormModalOpen(true) }}
                        onDelete={setDeleteTarget}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
          </Table>
        </div>
        )}
        {totalPages > 1 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={(p) => { setCurrentPage(p); refreshLinks(p) }}
            pageSize={pageSize}
            totalItems={totalLinks}
          />
        )}
      </Card>
      )}

      {/* Modals */}
      <ShortLinkFormModal
        open={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        link={activeLink}
        onSave={() => refreshLinks()}
      />

      <ShortLinkAnalyticsModal
        open={analyticsModalOpen}
        onClose={() => setAnalyticsModalOpen(false)}
        shortCode={activeLink?.short_code || ''}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Short Link"
        message={deleteTarget ? `Are you sure you want to delete ${buildShortLinkUrl(deleteTarget.short_code)}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  )
}
