'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PageLayout,
  PageLoading,
  StatGrid,
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  LinkButton,
  SearchInput,
  Select,
  Stat,
  Alert,
  Empty,
  Avatar,
} from '@/ds'
import { getQuotes, getQuoteSummary } from '@/app/actions/quotes'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { quoteStatusLabel, quoteStatusTone } from '@/lib/invoices/status-ui'
import { FINANCE_NAV } from '@/app/(authenticated)/invoices/_shared/nav'

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
    <PageLayout
      title="Quotes"
      subtitle="Pre-invoice proposals for OJ consultancy work"
      navItems={FINANCE_NAV}
      headerActions={
        resolvedPermissions.canCreate ? (
          <LinkButton href="/quotes/new" variant="primary" size="sm">
            New Quote
          </LinkButton>
        ) : undefined
      }
    >
      <StatGrid columns={4}>
        <Stat label="Pending" value={formatCurrency(summary.total_pending)} hint="Awaiting response" />
        <Stat label="Expired" value={formatCurrency(summary.total_expired)} hint="Past validity date" />
        <Stat label="Accepted" value={formatCurrency(summary.total_accepted)} hint="Ready to convert" />
        <Stat label="Drafts" value={String(summary.draft_badge)} hint="Not yet sent" />
      </StatGrid>

      {error && (
        <Alert tone="danger" title="Could not load quotes">
          {error}
        </Alert>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          aria-label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | 'all')}
          options={STATUS_OPTIONS}
          className="sm:w-44"
        />
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search quotes..."
          aria-label="Search quotes by number, client or reference"
          className="w-full sm:w-64"
        />
      </div>

      {/* Table. While a fetch is in flight with nothing to show yet it shows the loader; after a
          failed load with nothing to show, the Alert above says so and no card is drawn, because
          an empty card or the empty state would read as "no quotes". */}
      {filteredQuotes.length === 0 && error && !loading ? null : (
        <Card padding="none">
          {filteredQuotes.length === 0 ? (
            loading ? (
              <PageLoading inline label="Loading quotes" />
            ) : (
              <Empty
                size="sm"
                title={searchTerm ? 'No quotes match your search' : 'No quotes found'}
                description="Try a different filter or create a new quote."
              />
            )
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
                      <TableRow key={q.id} onClick={() => router.push(`/quotes/${q.id}`)}>
                        <TableCell>
                          <div className="font-medium text-xs font-mono">{q.quote_number}</div>
                          {q.reference && <div className="text-xs text-text-muted">{q.reference}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar name={q.vendor?.name || '?'} size="sm" />
                            <span className="text-ui">{q.vendor?.name || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-text-muted">{new Date(q.quote_date).toLocaleDateString('en-GB')}</TableCell>
                        <TableCell className="text-text-muted">{new Date(q.valid_until).toLocaleDateString('en-GB')}</TableCell>
                        <TableCell>
                          <Badge tone={quoteStatusTone(q.status)} dot>
                            {quoteStatusLabel(q.status)}
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
                              <span className="text-sm text-success-fg font-medium">Converted</span>
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
                  <div
                    key={q.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer p-pad-card transition-colors hover:bg-surface-hover"
                    onClick={() => router.push(`/quotes/${q.id}`)}
                    onKeyDown={(event) => {
                      // Only the row itself: Enter on the Convert button inside must not open the quote.
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        router.push(`/quotes/${q.id}`)
                      }
                    }}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-text">{q.quote_number}</p>
                        {q.reference && <p className="text-sm text-text-muted truncate">{q.reference}</p>}
                        <p className="text-sm text-text-muted mt-1">{q.vendor?.name || '-'}</p>
                      </div>
                      <Badge tone={quoteStatusTone(q.status)} dot>
                        {quoteStatusLabel(q.status)}
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
                          <span className="text-sm text-success-fg font-medium">Converted</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}
    </PageLayout>
  )
}
