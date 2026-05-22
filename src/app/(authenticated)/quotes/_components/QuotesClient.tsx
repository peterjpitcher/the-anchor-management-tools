'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  PageHeader,
  SectionNav,
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TablePagination,
  Badge,
  Button,
  SearchInput,
  Select,
  Stat,
  Alert,
  Empty,
  Avatar,
  IconButton,
} from '@/ds'
import { getQuotes, getQuoteSummary } from '@/app/actions/quotes'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'

// ---------------------------------------------------------------------------
// Shared finance SectionNav items.
// ---------------------------------------------------------------------------

const FINANCE_SECTION_NAV = [
  { id: 'invoices', label: 'Invoices', href: '/invoices' },
  { id: 'catalog', label: 'Catalog', href: '/invoices/catalog' },
  { id: 'recurring', label: 'Recurring', href: '/invoices/recurring' },
  { id: 'vendors', label: 'Vendors', href: '/invoices/vendors' },
  { id: 'export', label: 'Export', href: '/invoices/export' },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuoteSummary = {
  total_pending: number
  total_expired: number
  total_accepted: number
  draft_badge: number
}

type PermissionSnapshot = {
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

type QuotesClientProps = {
  initialQuotes: QuoteWithDetails[]
  initialSummary: QuoteSummary
  initialStatus: QuoteStatus | 'all'
  initialError: string | null
  permissions: PermissionSnapshot
}

// ---------------------------------------------------------------------------
// Formatters + helpers
// ---------------------------------------------------------------------------

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(value)

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Quotes' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
]

function statusBadgeTone(status: QuoteStatus): 'neutral' | 'success' | 'info' | 'danger' | 'warning' {
  switch (status) {
    case 'draft': return 'neutral'
    case 'sent': return 'info'
    case 'accepted': return 'success'
    case 'rejected': return 'danger'
    case 'expired': return 'warning'
    default: return 'neutral'
  }
}

const FALLBACK_SUMMARY: QuoteSummary = {
  total_pending: 0,
  total_expired: 0,
  total_accepted: 0,
  draft_badge: 0,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuotesClient({
  initialQuotes,
  initialSummary,
  initialStatus,
  initialError,
  permissions,
}: QuotesClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { hasPermission, loading: permissionsLoading } = usePermissions()

  const resolvedPermissions = useMemo<PermissionSnapshot>(() => {
    if (permissionsLoading) return permissions
    return {
      canCreate: hasPermission('invoices', 'create'),
      canEdit: hasPermission('invoices', 'edit'),
      canDelete: hasPermission('invoices', 'delete'),
    }
  }, [permissionsLoading, permissions, hasPermission])

  const canConvert = resolvedPermissions.canCreate

  // Determine active SectionNav item
  const activeSectionId = useMemo(() => {
    if (pathname.startsWith('/quotes')) return 'quotes'
    return 'invoices'
  }, [pathname])

  // State
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>(initialStatus)
  const [searchTerm, setSearchTerm] = useState('')
  const [quotes, setQuotes] = useState<QuoteWithDetails[]>(initialQuotes)
  const [summary, setSummary] = useState<QuoteSummary>(initialSummary ?? FALLBACK_SUMMARY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  // Reload data when filter changes
  const loadData = useCallback(async () => {
    if (permissionsLoading) return
    setLoading(true)
    setError(null)
    try {
      const [quotesResult, summaryResult] = await Promise.all([
        getQuotes(statusFilter === 'all' ? undefined : statusFilter),
        getQuoteSummary(),
      ])
      if (quotesResult.error || !quotesResult.quotes) {
        throw new Error(quotesResult.error || 'Failed to load quotes')
      }
      setQuotes(quotesResult.quotes)
      setSummary(summaryResult.summary ?? FALLBACK_SUMMARY)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [permissionsLoading, statusFilter])

  useEffect(() => { void loadData() }, [loadData])

  // Client-side search filter
  const filteredQuotes = useMemo(
    () =>
      quotes.filter((q) => {
        if (!searchTerm) return true
        const s = searchTerm.toLowerCase()
        return (
          q.quote_number.toLowerCase().includes(s) ||
          q.vendor?.name.toLowerCase().includes(s) ||
          q.reference?.toLowerCase().includes(s)
        )
      }),
    [quotes, searchTerm],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'Quotes' }]}
        title="Quotes"
        subtitle="Pre-invoice proposals for OJ consultancy work"
        className="mb-0"
        actions={
          resolvedPermissions.canCreate ? (
            <Button variant="primary" size="sm" onClick={() => router.push('/quotes/new')}>
              New Quote
            </Button>
          ) : undefined
        }
      />

      <SectionNav items={FINANCE_SECTION_NAV} activeId={activeSectionId} />

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pending" value={formatCurrency(summary.total_pending)} hint="Awaiting response" />
        <Stat label="Expired" value={formatCurrency(summary.total_expired)} hint="Past validity date" />
        <Stat label="Accepted" value={formatCurrency(summary.total_accepted)} hint="Ready to convert" />
        <Stat label="Drafts" value={String(summary.draft_badge)} hint="Not yet sent" />
      </div>

      {error && (
        <Alert tone="danger" title="Error">
          {error}
        </Alert>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | 'all')}
          options={STATUS_OPTIONS}
          className="sm:w-44"
        />
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search quotes..."
          className="sm:w-64"
        />
      </div>

      {/* Table */}
      <Card>
        {filteredQuotes.length === 0 ? (
          <Empty
            title={searchTerm ? 'No quotes match your search.' : 'No quotes found.'}
            description="Try a different filter or create a new quote."
            action={
              resolvedPermissions.canCreate ? (
                <Button variant="primary" onClick={() => router.push('/quotes/new')}>New Quote</Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Valid Until</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead align="right">Amount</TableHead>
                    <TableHead align="center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredQuotes.map((q) => (
                    <TableRow key={q.id} onClick={() => router.push(`/quotes/${q.id}`)} className="cursor-pointer">
                      <TableCell>
                        <div className="font-medium text-[12px] font-mono">{q.quote_number}</div>
                        {q.reference && <div className="text-xs text-text-muted">{q.reference}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar name={q.vendor?.name || '?'} size="sm" />
                          <span className="text-[13px]">{q.vendor?.name || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-text-muted">{new Date(q.quote_date).toLocaleDateString('en-GB')}</TableCell>
                      <TableCell className="text-text-muted">{new Date(q.valid_until).toLocaleDateString('en-GB')}</TableCell>
                      <TableCell>
                        <Badge tone={statusBadgeTone(q.status)} dot>
                          {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell align="right" className="font-medium tabular-nums">
                        {formatCurrency(q.total_amount)}
                      </TableCell>
                      <TableCell align="center">
                        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                          {q.status === 'accepted' && !q.converted_to_invoice_id ? (
                            <Button
                              size="sm"
                              onClick={() => router.push(`/quotes/${q.id}/convert`)}
                              disabled={!canConvert}
                            >
                              Convert
                            </Button>
                          ) : null}
                          {q.converted_to_invoice_id && (
                            <span className="text-sm text-success font-medium">Converted</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border">
              {filteredQuotes.map((q) => (
                <div key={q.id} className="p-4 cursor-pointer" onClick={() => router.push(`/quotes/${q.id}`)}>
                  <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-text">{q.quote_number}</p>
                      {q.reference && <p className="text-sm text-text-muted truncate">{q.reference}</p>}
                      <p className="text-sm text-text-muted mt-1">{q.vendor?.name || '-'}</p>
                    </div>
                    <Badge tone={statusBadgeTone(q.status)} dot>
                      {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div>
                      <p className="text-text-muted">Date</p>
                      <p className="font-medium">{new Date(q.quote_date).toLocaleDateString('en-GB')}</p>
                    </div>
                    <div>
                      <p className="text-text-muted">Valid Until</p>
                      <p className="font-medium">{new Date(q.valid_until).toLocaleDateString('en-GB')}</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-border">
                    <p className="text-lg font-semibold">{formatCurrency(q.total_amount)}</p>
                    <div onClick={(e) => e.stopPropagation()}>
                      {q.status === 'accepted' && !q.converted_to_invoice_id ? (
                        <Button size="sm" onClick={() => router.push(`/quotes/${q.id}/convert`)} disabled={!canConvert}>
                          Convert
                        </Button>
                      ) : null}
                      {q.converted_to_invoice_id && (
                        <span className="text-sm text-success font-medium">Converted</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
