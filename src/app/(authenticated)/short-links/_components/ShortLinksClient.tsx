'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  PageHeader, SectionNav,
  Card,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TablePagination,
} from '@/ds'
import { Button, Badge, SearchInput, IconButton, ConfirmDialog } from '@/ds'
import { Icon } from '@/ds/icons'
import toast from 'react-hot-toast'
import {
  deleteShortLink,
  getShortLinks,
} from '@/app/actions/short-links'
import { ShortLinkFormModal } from './ShortLinkFormModal'
import { ShortLinkAnalyticsModal } from './ShortLinkAnalyticsModal'
import { UtmDropdown } from './UtmDropdown'
import { downloadQrPng, safeQrFilename } from './qr-download'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { formatDate } from '@/lib/dateUtils'
import type { ShortLink } from '@/types/short-links'

const SHORT_LINKS_NAV = [
  { id: 'links', label: 'Links', href: '/short-links' },
  { id: 'insights', label: 'Insights', href: '/short-links/insights' },
]

interface Props {
  initialLinks: ShortLink[]
  initialTotal: number
  initialLinkTotal: number
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

type TrendTone = 'success' | 'danger' | 'neutral'

function getVariantLabel(link: ShortLink): string {
  if (link.name?.includes('\u2014')) {
    return link.name.split('\u2014').pop()?.trim() || 'UTM variant'
  }
  return link.name || 'UTM variant'
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

function getClicksTrend(current: number, previous: number): { text: string; tone: TrendTone } {
  if (previous === 0 && current === 0) return { text: 'No change vs prev 30d', tone: 'neutral' }
  if (previous === 0) return { text: `Up from 0: ${current.toLocaleString('en-GB')} clicks`, tone: 'success' }

  const percent = Math.round(((current - previous) / previous) * 100)
  if (percent === 0) return { text: 'Flat vs prev 30d', tone: 'neutral' }
  return {
    text: `${percent > 0 ? 'Up' : 'Down'} ${Math.abs(percent)}% vs prev 30d`,
    tone: percent > 0 ? 'success' : 'danger',
  }
}

function CompactStat({
  label,
  value,
  hint,
  title,
  trend,
}: {
  label: string
  value: string | number
  hint?: string
  title?: string
  trend?: { text: string; tone: TrendTone }
}) {
  const numericValue = typeof value === 'number'

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</span>
        <span
          className={
            numericValue
              ? 'font-mono text-lg font-bold leading-none text-text'
              : 'min-w-0 max-w-[68%] whitespace-normal break-words text-right text-sm font-semibold leading-tight text-text [overflow-wrap:anywhere]'
          }
          title={title}
        >
          {numericValue ? value.toLocaleString('en-GB') : value}
        </span>
      </div>
      {trend && (
        <div
          className={
            trend.tone === 'success'
              ? 'mt-0.5 text-[11px] leading-none text-success-fg'
              : trend.tone === 'danger'
                ? 'mt-0.5 text-[11px] leading-none text-danger-fg'
                : 'mt-0.5 text-[11px] leading-none text-text-subtle'
          }
        >
          {trend.text}
        </div>
      )}
      {hint && <div className="mt-0.5 text-[11px] leading-none text-text-subtle">{hint}</div>}
    </div>
  )
}

export function ShortLinksClient({ initialLinks, initialTotal, initialLinkTotal, volume, previousVolume, canManage }: Props) {
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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const refreshLinks = useCallback(async (page: number = currentPage) => {
    const searchStr = debouncedSearch.trim() || undefined
    const result = await getShortLinks(page, pageSize, false, searchStr)
    if (!result || 'error' in result) {
      toast.error(result?.error || 'Failed to load short links')
      return
    }
    setLinks(Array.isArray(result.data) ? (result.data as ShortLink[]) : [])
    setTotalLinks(result.total ?? 0)
    setLinkTotal(result.linkTotal ?? 0)
    setCurrentPage(result.page ?? page)
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

  useEffect(() => {
    refreshLinks(1)
  }, [debouncedSearch])

  const handleCopyLink = async (link: ShortLink) => {
    const fullUrl = buildShortLinkUrl(link.short_code)
    await navigator.clipboard.writeText(fullUrl)
    toast.success('Link copied!')
  }

  const handleDownloadQrCode = async (link: ShortLink) => {
    try {
      const fullUrl = buildShortLinkUrl(link.short_code)
      await downloadQrPng(fullUrl, safeQrFilename(link.short_code))
      toast.success('QR code downloaded')
    } catch (error) {
      console.error('Failed to download QR code', error)
      toast.error('Failed to download QR code')
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

  return (
    <div>
      <PageHeader
        title="Short Links"
        subtitle="URL shortener and analytics"
        className="mb-3 pb-3"
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => { setActiveLink(null); setFormModalOpen(true) }} icon={<Icon name="plus" size={16} />}>
              Create Link
            </Button>
          ) : undefined
        }
      />
      <SectionNav items={SHORT_LINKS_NAV} activeId="links" className="mb-3" />

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CompactStat label="Total links" value={linkTotal} />
        <CompactStat label="Clicks 30d" value={totalClicks} trend={clicksTrend} />
        <CompactStat label="Unique 30d" value={uniqueVisitors} />
        <CompactStat label="Top destination" value={topDestination.label} title={topDestination.title} />
      </div>

      <div className="mb-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search links..."
          className="max-w-md"
        />
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[29%] py-1.5">Short URL</TableHead>
              <TableHead className="w-[41%] py-1.5">Destination</TableHead>
              <TableHead align="right" className="w-[7%] py-1.5">Clicks</TableHead>
              <TableHead className="w-[10%] py-1.5">Created</TableHead>
              <TableHead className="w-[6%] py-1.5">Type</TableHead>
              <TableHead align="right" className="w-[7%] py-1.5">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.length === 0 ? (
              <TableRow>
                <TableCell className="text-center text-text-muted py-8" align="center">
                  No short links found
                </TableCell>
              </TableRow>
            ) : (
              displayLinks.map((link) => (
                <TableRow key={link.id} className={link.isVariant ? 'bg-surface-2/40' : undefined}>
                  <TableCell className="py-2 align-middle">
                    <div className={link.isVariant ? 'pl-6' : undefined}>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        {!link.isVariant && (link.variantCount ?? 0) > 0 && (
                          <IconButton
                            icon={<Icon name={expandedParents.has(link.id) ? 'chevronDown' : 'chevronRight'} size={14} />}
                            label={expandedParents.has(link.id) ? 'Hide variants' : 'Show variants'}
                            size="sm"
                            onClick={() => toggleExpanded(link.id)}
                          />
                        )}
                        <code className="whitespace-nowrap text-xs font-mono bg-surface-2 px-2 py-0.5 rounded">
                          {buildShortLinkUrl(link.short_code).replace(/^https?:\/\//, '')}
                        </code>
                        <IconButton
                          icon={<Icon name="copy" size={14} />}
                          label="Copy link"
                          size="sm"
                          onClick={() => handleCopyLink(link)}
                        />
                        {link.isVariant ? (
                          <Badge tone="neutral">{getVariantLabel(link)}</Badge>
                        ) : (
                          <>
                            {link.name && <span className="text-xs text-text-muted">{link.name}</span>}
                            {(link.variantCount ?? 0) > 0 && <Badge tone="neutral">{link.variantCount} variants</Badge>}
                          </>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 align-middle">
                    <span className="block whitespace-nowrap text-xs text-text-muted" title={link.destination_url}>
                      {link.destination_url}
                    </span>
                  </TableCell>
                  <TableCell align="right" className="py-2 font-mono align-middle">
                    {link.click_count ?? 0}
                  </TableCell>
                  <TableCell className="py-2 text-text-muted text-xs align-middle">
                    {formatDate(link.created_at)}
                  </TableCell>
                  <TableCell className="py-2 align-middle">
                    <Badge tone="info">{link.link_type}</Badge>
                  </TableCell>
                  <TableCell align="right" className="py-2 align-middle">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && !link.parent_link_id && (
                        <UtmDropdown parentId={link.id} onVariantReady={handleVariantReady} />
                      )}
                      <IconButton
                        icon={<Icon name="download" size={14} />}
                        label="Download QR"
                        size="sm"
                        onClick={() => handleDownloadQrCode(link)}
                      />
                      <IconButton
                        icon={<Icon name="trendUp" size={14} />}
                        label="Analytics"
                        size="sm"
                        onClick={() => { setActiveLink(link); setAnalyticsModalOpen(true) }}
                      />
                      {canManage && (
                        <>
                          <IconButton
                            icon={<Icon name="edit" size={14} />}
                            label="Edit"
                            size="sm"
                            onClick={() => { setActiveLink(link); setFormModalOpen(true) }}
                          />
                          <IconButton
                            icon={<Icon name="trash" size={14} />}
                            label="Delete"
                            size="sm"
                            onClick={() => setDeleteTarget(link)}
                          />
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
    </div>
  )
}
