'use client'

import { invoiceBalanceDue } from '@/lib/invoices/balance'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  PageLayout,
  Segmented,
  StatGrid,
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
  LinkButton,
  SearchInput,
  Select,
  Input,
  Stat,
  Alert,
  Empty,
  Avatar,
  IconButton,
} from '@/ds'
import { Icon } from '@/ds/icons'
import type { InvoiceWithDetails, InvoiceStatus } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { toast } from '@/ds'
import { downloadInvoicePdf } from '@/lib/invoices/download-pdf'
import { downloadBlob, filenameFromContentDisposition } from '@/lib/download-file'
import { getCurrentQuarterDateRange } from '@/lib/invoices/date-ranges'
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoices/status-ui'
import { MobileInvoiceCard } from '../MobileInvoiceCard'
import { financeNav } from '../_shared/nav'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InvoiceSummary = {
  total_outstanding: number
  total_overdue: number
  total_this_month: number
  count_draft: number
}

type StatusFilter = InvoiceStatus | 'all' | 'unpaid'

type PermissionSnapshot = {
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  canExport: boolean
  canManageCatalog: boolean
}

interface InvoicesClientProps {
  initialInvoices: InvoiceWithDetails[]
  initialTotal: number
  initialSummary: InvoiceSummary
  initialStatus: StatusFilter
  initialPage: number
  initialSearch: string
  initialVendorSearch: string
  initialStartDate: string
  initialEndDate: string
  initialLimit: number
  initialError: string | null
  /** The invoice list itself failed to load (not just the summary), so an empty list is not "no invoices". */
  initialListFailed?: boolean
  permissions: PermissionSnapshot
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const numberFormatter = new Intl.NumberFormat('en-GB')
const formatCurrency = (value: number) => currencyFormatter.format(value)
const formatNumber = (value: number) => numberFormatter.format(value)

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'void', label: 'Void' },
  { value: 'written_off', label: 'Written Off' },
]

// Quick status filters above the list. The Select beside them holds every status.
const STATUS_QUICK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sent', label: 'Sent' },
  { id: 'paid', label: 'Paid' },
  { id: 'overdue', label: 'Overdue' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InvoicesClient({
  initialInvoices,
  initialTotal,
  initialSummary,
  initialStatus,
  initialPage,
  initialSearch,
  initialVendorSearch,
  initialStartDate,
  initialEndDate,
  initialLimit,
  initialError,
  initialListFailed = false,
  permissions,
}: InvoicesClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { hasPermission, loading: permissionsLoading } = usePermissions()

  // Resolve permissions
  const resolvedPermissions = useMemo<PermissionSnapshot>(() => {
    if (permissionsLoading) return permissions
    return {
      canCreate: hasPermission('invoices', 'create'),
      canEdit: hasPermission('invoices', 'edit'),
      canDelete: hasPermission('invoices', 'delete'),
      canExport: hasPermission('invoices', 'export'),
      canManageCatalog: hasPermission('invoices', 'manage'),
    }
  }, [permissionsLoading, permissions, hasPermission])

  // Local state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)
  const [searchTerm, setSearchTerm] = useState(initialSearch)
  const [vendorSearchTerm, setVendorSearchTerm] = useState(initialVendorSearch)
  const [exportStartDate, setExportStartDate] = useState(initialStartDate)
  const [exportEndDate, setExportEndDate] = useState(initialEndDate)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null)

  // Sync state with props on navigation
  useEffect(() => { setStatusFilter(initialStatus) }, [initialStatus])
  useEffect(() => { setSearchTerm(initialSearch) }, [initialSearch])
  useEffect(() => { setVendorSearchTerm(initialVendorSearch) }, [initialVendorSearch])
  useEffect(() => { setExportStartDate(initialStartDate) }, [initialStartDate])
  useEffect(() => { setExportEndDate(initialEndDate) }, [initialEndDate])

  // URL update helper
  const updateUrl = useCallback((newParams: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(newParams).forEach(([key, value]) => {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, value)
    })
    if (
      !newParams.page &&
      ['status', 'search', 'vendor', 'start_date', 'end_date'].some(
        (key) => newParams[key] !== undefined,
      )
    ) {
      params.set('page', '1')
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, pathname, router])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      const updates: Record<string, string | undefined> = {}
      if (searchTerm !== initialSearch) updates.search = searchTerm
      if (vendorSearchTerm !== initialVendorSearch) updates.vendor = vendorSearchTerm
      if (Object.keys(updates).length > 0) updateUrl(updates)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTerm, initialSearch, vendorSearchTerm, initialVendorSearch, updateUrl])

  // Export handlers
  function setExportToCurrentQuarter() {
    const { startDate, endDate } = getCurrentQuarterDateRange()
    setExportStartDate(startDate)
    setExportEndDate(endDate)
    setExportError(null)
    updateUrl({ start_date: startDate, end_date: endDate })
  }

  async function handleExport() {
    if (!resolvedPermissions.canExport) {
      toast.error('You do not have permission to export invoices')
      return
    }
    if (!exportStartDate || !exportEndDate) {
      setExportError('Please select both start and end dates.')
      return
    }
    if (exportStartDate > exportEndDate) {
      setExportError('Start date must be before end date.')
      return
    }
    setExportLoading(true)
    setExportError(null)
    try {
      const params = new URLSearchParams({ start_date: exportStartDate, end_date: exportEndDate, status: statusFilter })
      const normalizedSearch = searchTerm.trim()
      const normalizedVendor = vendorSearchTerm.trim()
      if (normalizedSearch) params.set('search', normalizedSearch)
      if (normalizedVendor) params.set('vendor', normalizedVendor)
      const response = await fetch(`/api/invoices/export?${params}`)
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Export failed')
      }
      const blob = await response.blob()
      const filename = filenameFromContentDisposition(response.headers.get('content-disposition'), 'invoices-export.zip')
      downloadBlob(blob, filename)
      toast.success('Export downloaded successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export invoices'
      setExportError(message)
      toast.error(message)
    } finally {
      setExportLoading(false)
    }
  }

  const handleInvoicePdfDownload = useCallback(async (invoice: InvoiceWithDetails) => {
    setDownloadingInvoiceId(invoice.id)
    try {
      await downloadInvoicePdf({ id: invoice.id, invoiceNumber: invoice.invoice_number })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download invoice PDF')
    } finally {
      setDownloadingInvoiceId((current) => current === invoice.id ? null : current)
    }
  }, [])

  // Pagination
  const totalPages = Math.ceil(initialTotal / initialLimit)

  return (
    <PageLayout
      title="Invoices"
      subtitle={`${formatNumber(initialTotal)} invoices · ${formatCurrency(initialSummary.total_outstanding)} outstanding`}
      navItems={financeNav({ canExport: resolvedPermissions.canExport })}
      headerActions={
        resolvedPermissions.canCreate ? (
          <LinkButton href="/invoices/new" variant="primary" size="sm">
            New Invoice
          </LinkButton>
        ) : undefined
      }
    >
      <StatGrid columns={4}>
        <Stat label="Total Outstanding" value={formatCurrency(initialSummary.total_outstanding)} hint="Awaiting payment" />
        <Stat
          label="Overdue"
          value={formatCurrency(initialSummary.total_overdue)}
          hint="Past due date"
          tone={initialSummary.total_overdue > 0 ? 'danger' : 'default'}
        />
        <Stat label="This Month" value={formatCurrency(initialSummary.total_this_month)} hint="Collected" />
        <Stat label="Drafts" value={formatNumber(initialSummary.count_draft)} hint="Unsent invoices" />
      </StatGrid>

      {initialError && (
        <Alert tone="danger" title="Could not refresh data">
          {initialError}
        </Alert>
      )}

      {/* Filters: status, search, vendor and the date range the list and the download share */}
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          aria-label="Quick status filter"
          options={STATUS_QUICK_FILTERS}
          value={statusFilter === 'unpaid' ? 'all' : statusFilter}
          onChange={(id) => {
            setStatusFilter(id as StatusFilter)
            updateUrl({ status: id })
          }}
        />
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search invoice or reference..."
          aria-label="Search invoices by number or reference"
          className="w-full sm:w-64"
        />
        <SearchInput
          value={vendorSearchTerm}
          onChange={setVendorSearchTerm}
          placeholder="Filter vendor..."
          aria-label="Filter invoices by vendor"
          className="w-full sm:w-48"
        />
        <Select
          aria-label="Status"
          value={statusFilter}
          onChange={(e) => {
            const v = e.target.value as StatusFilter
            setStatusFilter(v)
            updateUrl({ status: v })
          }}
          options={STATUS_OPTIONS}
          className="sm:w-40"
        />
        <Input
          label="Start date"
          type="date"
          value={exportStartDate}
          onChange={(e) => { setExportStartDate(e.target.value); setExportError(null); updateUrl({ start_date: e.target.value, end_date: exportEndDate }) }}
          className="sm:w-40"
        />
        <Input
          label="End date"
          type="date"
          value={exportEndDate}
          onChange={(e) => { setExportEndDate(e.target.value); setExportError(null); updateUrl({ start_date: exportStartDate, end_date: e.target.value }) }}
          className="sm:w-40"
        />
        <Button variant="secondary" size="sm" onClick={setExportToCurrentQuarter}>This Quarter</Button>
        {resolvedPermissions.canExport && (
          <Button size="sm" onClick={handleExport} loading={exportLoading} disabled={exportLoading || !exportStartDate || !exportEndDate}>
            Download
          </Button>
        )}
      </div>

      {exportError && <Alert tone="danger">{exportError}</Alert>}

      {/* After a failed load the Alert above says so; an empty list here would read as "no invoices". */}
      {initialListFailed && initialInvoices.length === 0 ? null : (
        <Card padding="none">
          {initialInvoices.length === 0 ? (
            <Empty
              size="sm"
              title={searchTerm || vendorSearchTerm ? 'No invoices match your filters' : 'No invoices found'}
              description="Try adjusting your filters or create a new invoice."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead align="right">Amount</TableHead>
                      <TableHead align="right">Balance</TableHead>
                      <TableHead align="right" className="w-14"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {initialInvoices.map((inv) => (
                      <TableRow key={inv.id} onClick={() => router.push(`/invoices/${inv.id}`)}>
                        <TableCell>
                          <div className="font-medium text-xs font-mono">{inv.invoice_number}</div>
                          {inv.reference && <div className="text-xs text-text-muted">{inv.reference}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar name={inv.vendor?.name || '?'} size="sm" />
                            <span className="text-ui">{inv.vendor?.name || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-text-muted">{new Date(inv.invoice_date).toLocaleDateString('en-GB')}</TableCell>
                        <TableCell className={inv.status === 'overdue' ? 'text-danger-fg font-medium' : 'text-text-muted'}>
                          {new Date(inv.due_date).toLocaleDateString('en-GB')}
                        </TableCell>
                        <TableCell>
                          <Badge tone={invoiceStatusTone(inv.status)} dot>{invoiceStatusLabel(inv.status)}</Badge>
                        </TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {inv.total_amount < 0 ? (
                            <span className="text-danger-fg">{formatCurrency(inv.total_amount)}</span>
                          ) : formatCurrency(inv.total_amount)}
                        </TableCell>
                        <TableCell align="right">
                          {inv.status === 'paid' ? (
                            <span className="text-success-fg">Paid</span>
                          ) : (
                            <span className={inv.status === 'overdue' ? 'text-danger-fg font-medium' : ''}>
                              {formatCurrency(invoiceBalanceDue(inv))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <IconButton
                              icon={<Icon name="download" size={16} />}
                              size="sm"
                              label={`Download invoice ${inv.invoice_number}`}
                              disabled={downloadingInvoiceId === inv.id}
                              onClick={() => void handleInvoicePdfDownload(inv)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile rows */}
              <div className="sm:hidden divide-y divide-border">
                {initialInvoices.map((inv) => (
                  <MobileInvoiceCard
                    key={inv.id}
                    invoice={inv}
                    onClick={(i) => router.push(`/invoices/${i.id}`)}
                    onDownload={(i) => void handleInvoicePdfDownload(i)}
                    downloadDisabled={downloadingInvoiceId === inv.id}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <TablePagination
                  page={initialPage}
                  totalPages={totalPages}
                  pageSize={initialLimit}
                  totalItems={initialTotal}
                  onPageChange={(p) => updateUrl({ page: p.toString() })}
                />
              )}
            </>
          )}
        </Card>
      )}
    </PageLayout>
  )
}
