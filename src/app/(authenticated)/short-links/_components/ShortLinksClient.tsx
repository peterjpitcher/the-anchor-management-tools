'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  PageHeader, SectionNav,
  Card, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TablePagination,
} from '@/ds'
import { Button, Badge, Stat, SearchInput, IconButton, ConfirmDialog } from '@/ds'
import { Icon } from '@/ds/icons'
import toast from 'react-hot-toast'
import {
  deleteShortLink,
  getShortLinks,
} from '@/app/actions/short-links'
import { ShortLinkFormModal } from './ShortLinkFormModal'
import { ShortLinkAnalyticsModal } from './ShortLinkAnalyticsModal'
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
  volume: unknown
  canManage: boolean
}

export function ShortLinksClient({ initialLinks, initialTotal, volume, canManage }: Props) {
  const [links, setLinks] = useState<ShortLink[]>(initialLinks)
  const [totalLinks, setTotalLinks] = useState(initialTotal)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 25
  const totalPages = Math.ceil(totalLinks / pageSize)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false)
  const [activeLink, setActiveLink] = useState<ShortLink | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ShortLink | null>(null)

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
    setCurrentPage(result.page ?? page)
  }, [currentPage, debouncedSearch])

  useEffect(() => {
    refreshLinks(1)
  }, [debouncedSearch])

  const handleCopyLink = async (link: ShortLink) => {
    const fullUrl = buildShortLinkUrl(link.short_code)
    await navigator.clipboard.writeText(fullUrl)
    toast.success('Link copied!')
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

  // Stats
  const totalClicks = useMemo(() => links.reduce((sum, l) => sum + (l.click_count || 0), 0), [links])
  const topPerformer = useMemo(() => {
    if (links.length === 0) return '-'
    const top = links.reduce((best, l) => (l.click_count > best.click_count ? l : best), links[0])
    return `/${top.short_code}`
  }, [links])

  return (
    <div>
      <PageHeader
        title="Short Links"
        subtitle="URL shortener and analytics"
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => { setActiveLink(null); setFormModalOpen(true) }} icon={<Icon name="plus" size={16} />}>
              Create Link
            </Button>
          ) : undefined
        }
      />
      <SectionNav items={SHORT_LINKS_NAV} activeId="links" className="mb-6" />

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardBody>
            <Stat label="Total Links" value={totalLinks} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Total Clicks (30d)" value={totalClicks} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Avg CTR" value="-" hint="Coming soon" />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Top Performer" value={topPerformer} />
          </CardBody>
        </Card>
      </div>

      {/* Search */}
      <div className="mb-4">
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
              <TableHead>Short URL</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead align="right">Clicks</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Type</TableHead>
              <TableHead align="right">Actions</TableHead>
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
              links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono bg-surface-2 px-2 py-0.5 rounded">
                        {buildShortLinkUrl(link.short_code).replace(/^https?:\/\//, '')}
                      </code>
                      <IconButton
                        icon={<Icon name="copy" size={14} />}
                        label="Copy link"
                        size="sm"
                        onClick={() => handleCopyLink(link)}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-text-muted truncate block max-w-[200px]" title={link.destination_url}>
                      {link.destination_url}
                    </span>
                  </TableCell>
                  <TableCell align="right" className="font-mono">
                    {link.click_count ?? 0}
                  </TableCell>
                  <TableCell className="text-text-muted text-xs">
                    {formatDate(link.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge tone="info">{link.link_type}</Badge>
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-1">
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
