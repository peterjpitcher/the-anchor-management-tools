'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getQuotes, getQuoteSummary } from '@/app/actions/quotes'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { Plus, FileText, TrendingUp, Clock, FileEdit, Download, Package, ArrowRight } from 'lucide-react'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'

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

function getStatusColor(status: QuoteStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-800'
    case 'sent':
      return 'bg-blue-100 text-blue-800'
    case 'accepted':
      return 'bg-green-100 text-green-800'
    case 'rejected':
      return 'bg-red-100 text-red-800'
    case 'expired':
      return 'bg-yellow-100 text-yellow-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

const FALLBACK_SUMMARY: QuoteSummary = {
  total_pending: 0,
  total_expired: 0,
  total_accepted: 0,
  draft_badge: 0,
}

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
    if (permissionsLoading) {
      return permissions
    }

    return {
      canCreate: hasPermission('invoices', 'create'),
      canEdit: hasPermission('invoices', 'edit'),
      canDelete: hasPermission('invoices', 'delete'),
    }
  }, [permissionsLoading, permissions, hasPermission])

  const canConvert = resolvedPermissions.canCreate
  const isReadOnly =
    !resolvedPermissions.canCreate &&
    !resolvedPermissions.canEdit &&
    !resolvedPermissions.canDelete

  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>(initialStatus)
  const [searchTerm, setSearchTerm] = useState('')
  const [quotes, setQuotes] = useState<QuoteWithDetails[]>(initialQuotes)
  const [summary, setSummary] = useState<QuoteSummary>(initialSummary ?? FALLBACK_SUMMARY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  const navActions = (
    <div className="flex flex-wrap gap-2">
      <LinkButton href="/invoices" variant="secondary">
        <FileText className="h-4 w-4 mr-1 sm:mr-2" />
        <span className="hidden sm:inline">Invoices</span>
        <span className="sm:hidden">Inv</span>
      </LinkButton>
      <LinkButton
        href="/quotes/new"
        variant="primary"
        disabled={!resolvedPermissions.canCreate}
        title={
          resolvedPermissions.canCreate
            ? undefined
            : 'You need invoice create permission to add quotes.'
        }
      >
        <Plus className="h-4 w-4 mr-1 sm:mr-2" />
        <span className="hidden sm:inline">New Quote</span>
        <span className="sm:hidden">New</span>
      </LinkButton>
    </div>
  )

  const loadData = useCallback(async () => {
    if (permissionsLoading) {
      return
    }

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

      if (summaryResult.summary) {
        setSummary(summaryResult.summary)
      } else {
        setSummary(FALLBACK_SUMMARY)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [permissionsLoading, statusFilter])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredQuotes = useMemo(
    () =>
      quotes.filter((quote) => {
        if (!searchTerm) return true
        const search = searchTerm.toLowerCase()
        return (
          quote.quote_number.toLowerCase().includes(search) ||
          quote.vendor?.name.toLowerCase().includes(search) ||
          quote.reference?.toLowerCase().includes(search)
        )
      }),
    [quotes, searchTerm],
  )

  if (loading && quotes.length === 0) {
    return (
      <PageLayout
        title="Quotes"
        subtitle="Manage quotes and estimates for your vendors"
        navActions={navActions}
        loading
        loadingLabel="Loading quotes..."
      />
    )
  }

  return (
    <PageLayout
      title="Quotes"
      subtitle="Manage quotes and estimates for your vendors"
      navActions={navActions}
    >
      <div className="space-y-6">
        {isReadOnly && (
          <Alert
            variant="info"
            description="You have read-only access to quotes. Creation, conversion, and status changes are disabled for your role."
          />
        )}

        <Card>
          <StatGroup>
            <Stat
              label="Pending"
              value={`£${summary.total_pending.toFixed(2)}`}
              icon={<TrendingUp className="h-5 w-5 text-blue-500" />}
            />
            <Stat
              label="Expired"
              value={`£${summary.total_expired.toFixed(2)}`}
              icon={<Clock className="h-5 w-5 text-yellow-500" />}
            />
            <Stat
              label="Accepted"
              value={`£${summary.total_accepted.toFixed(2)}`}
              icon={<TrendingUp className="h-5 w-5 text-green-500" />}
            />
            <Stat
              label="Drafts"
              value={summary.draft_badge}
              icon={<FileEdit className="h-5 w-5 text-gray-500" />}
            />
          </StatGroup>
        </Card>

        {error && <Alert variant="error" title="Error" description={error} />}

        <Section
          title="Quotes List"
          actions={
            <Button variant="secondary" size="sm" disabled>
              <Download className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Export</span>
              <span className="sm:hidden">Exp</span>
            </Button>
          }
        >
          <Card>
            <div className="border-b p-4">
              <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | 'all')}
                    className="sm:w-auto"
                  >
                    <option value="all">All Quotes</option>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="accepted">Accepted</option>
                    <option value="rejected">Rejected</option>
                    <option value="expired">Expired</option>
                  </Select>
  
                  <Input
                    type="text"
                    placeholder="Search quotes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
  
          {filteredQuotes.length === 0 ? (
            <EmptyState
              title={searchTerm ? 'No quotes match your search.' : 'No quotes found.'}
              action={
                !searchTerm && resolvedPermissions.canCreate ? (
                  <LinkButton href="/quotes/new">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Quote
                  </LinkButton>
                ) : undefined
              }
            />
          ) : (
            <DataTable<QuoteWithDetails>
              data={filteredQuotes}
              getRowKey={(q) => q.id}
              columns={[
                {
                  key: 'number',
                  header: 'Quote #',
                  cell: (q) => (
                    <div>
                      <div className="font-medium">{q.quote_number}</div>
                      {q.reference && <div className="text-sm text-gray-500">{q.reference}</div>}
                    </div>
                  ),
                },
                {
                  key: 'vendor',
                  header: 'Vendor',
                  cell: (q) => <span>{q.vendor?.name || '-'}</span>,
                },
                {
                  key: 'date',
                  header: 'Date',
                  cell: (q) => (
                    <span className="text-sm">
                      {new Date(q.quote_date).toLocaleDateString('en-GB')}
                    </span>
                  ),
                },
                {
                  key: 'valid',
                  header: 'Valid Until',
                  cell: (q) => (
                    <span className="text-sm">
                      {new Date(q.valid_until).toLocaleDateString('en-GB')}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (q) => (
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                        q.status,
                      )}`}
                    >
                      {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                    </span>
                  ),
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right',
                  cell: (q) => <span className="font-medium">£{q.total_amount.toFixed(2)}</span>,
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  align: 'center',
                  cell: (q) => (
                    <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                      {q.status === 'accepted' && !q.converted_to_invoice_id ? (
                        <Button
                          size="sm"
                          onClick={() => router.push(`/quotes/${q.id}/convert`)}
                          disabled={!canConvert}
                          title={
                            canConvert
                              ? undefined
                              : 'You need invoice create permission to convert quotes.'
                          }
                        >
                          <ArrowRight className="h-4 w-4 mr-1" />
                          Convert
                        </Button>
                      ) : null}
                      {q.converted_to_invoice_id && (
                        <span className="text-sm text-green-600">Converted</span>
                      )}
                    </div>
                  ),
                },
              ]}
              clickableRows
              onRowClick={(q) => router.push(`/quotes/${q.id}`)}
              renderMobileCard={(q) => (
                <div className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">{q.quote_number}</p>
                      {q.reference && (
                        <p className="text-sm text-gray-500 truncate">{q.reference}</p>
                      )}
                      <p className="text-sm text-gray-600 mt-1">{q.vendor?.name || '-'}</p>
                    </div>
                    <span
                      className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                        q.status,
                      )}`}
                    >
                      {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div>
                      <p className="text-gray-500">Date</p>
                      <p className="font-medium">
                        {new Date(q.quote_date).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Valid Until</p>
                      <p className="font-medium">
                        {new Date(q.valid_until).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t">
                    <p className="text-lg font-semibold">£{q.total_amount.toFixed(2)}</p>
                    <div onClick={(e) => e.stopPropagation()}>
                      {q.status === 'accepted' && !q.converted_to_invoice_id ? (
                        <Button
                          size="sm"
                          onClick={() => router.push(`/quotes/${q.id}/convert`)}
                          disabled={!canConvert}
                          title={
                            canConvert
                              ? undefined
                              : 'You need invoice create permission to convert quotes.'
                          }
                          className="text-sm"
                        >
                          <ArrowRight className="h-3 w-3 mr-1" />
                          Convert
                        </Button>
                      ) : null}
                      {q.converted_to_invoice_id && (
                        <span className="text-sm text-green-600 font-medium">Converted</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            />
          )}
        </Card>
      </Section>

      <Section title="Quick Actions">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <Card padding="sm" interactive onClick={() => router.push('/invoices/vendors')}>
            <div className="flex flex-col items-center justify-center h-20 sm:h-24 gap-1 sm:gap-2">
              <FileText className="h-6 w-6 sm:h-8 sm:w-8 text-gray-600" />
              <span className="text-xs sm:text-sm">Vendors</span>
            </div>
          </Card>

          <Card padding="sm" interactive onClick={() => router.push('/invoices/catalog')}>
            <div className="flex flex-col items-center justify-center h-20 sm:h-24 gap-1 sm:gap-2">
              <Package className="h-6 w-6 sm:h-8 sm:w-8 text-gray-600" />
              <span className="text-xs sm:text-sm text-center">Line Item Catalog</span>
            </div>
          </Card>

          <Card padding="sm" className="sm:col-span-2 lg:col-span-1" interactive>
            <div className="flex flex-col items-center justify-center h-20 sm:h-24 gap-1 sm:gap-2">
              <Download className="h-6 w-6 sm:h-8 sm:w-8 text-gray-600" />
              <span className="text-xs sm:text-sm">Export Quotes</span>
            </div>
          </Card>
        </div>
      </Section>
      </div>
    </PageLayout>
  )
}
