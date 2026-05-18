'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  PageHeader,
  SectionNav,
  Tabs,
  Card,
  CardHeader,
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
  Input,
  Stat,
  Alert,
  Empty,
  Avatar,
  IconButton,
  Dropdown,
  DropdownItem,
} from '@/ds'
import type { InvoiceWithDetails, InvoiceStatus } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { toast } from '@/ds'
import { downloadInvoicePdf } from '@/lib/invoices/download-pdf'
import { downloadBlob, filenameFromContentDisposition } from '@/lib/download-file'
import { getCurrentQuarterDateRange } from '@/lib/invoices/date-ranges'
import { MobileInvoiceCard } from '../MobileInvoiceCard'

// ---------------------------------------------------------------------------
// Shared SectionNav items — Invoices + Quotes share this nav
// ---------------------------------------------------------------------------

const FINANCE_SECTION_NAV = [
  { id: 'invoices', label: 'Invoices', href: '/invoices' },
  { id: 'quotes', label: 'Quotes', href: '/quotes' },
  { id: 'catalog', label: 'Catalog', href: '/invoices/catalog' },
  { id: 'recurring', label: 'Recurring', href: '/invoices/recurring' },
  { id: 'vendors', label: 'Vendors', href: '/invoices/vendors' },
  { id: 'export', label: 'Export', href: '/invoices/export' },
]

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

const STATUS_TAB_LIST = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sent', label: 'Sent' },
  { id: 'paid', label: 'Paid' },
  { id: 'overdue', label: 'Overdue' },
]

function statusBadgeTone(status: InvoiceStatus): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'draft': return 'neutral'
    case 'sent': return 'info'
    case 'partially_paid': return 'warning'
    case 'paid': return 'success'
    case 'overdue': return 'danger'
    case 'void': return 'neutral'
    case 'written_off': return 'neutral'
    default: return 'neutral'
  }
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')
}

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

  // Determine active SectionNav item from pathname
  const activeSectionId = useMemo(() => {
    if (pathname.startsWith('/invoices/catalog')) return 'catalog'
    if (pathname.startsWith('/invoices/recurring')) return 'recurring'
    if (pathname.startsWith('/invoices/vendors')) return 'vendors'
    if (pathname.startsWith('/invoices/export')) return 'export'
    if (pathname.startsWith('/quotes')) return 'quotes'
    return 'invoices'
  }, [pathname])

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
    if (!newParams.page && (newParams.status !== undefined || newParams.search !== undefined || newParams.vendor !== undefined)) {
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
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'Invoices' }]}
        title="Invoices"
        subtitle={`${formatNumber(initialTotal)} invoices · ${formatCurrency(initialSummary.total_outstanding)} outstanding`}
        actions={
          <div className="flex items-center gap-2">
            {resolvedPermissions.canExport && (
              <Button variant="secondary" size="sm" onClick={() => router.push('/invoices/export')}>
                Export
              </Button>
            )}
            {resolvedPermissions.canCreate && (
              <Button variant="primary" size="sm" onClick={() => router.push('/invoices/new')}>
                New Invoice
              </Button>
            )}
          </div>
        }
      />

      <SectionNav items={FINANCE_SECTION_NAV} activeId={activeSectionId} />

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Outstanding" value={formatCurrency(initialSummary.total_outstanding)} hint="Awaiting payment" />
        <Stat label="Overdue" value={formatCurrency(initialSummary.total_overdue)} hint="Past due date" />
        <Stat label="This Month" value={formatCurrency(initialSummary.total_this_month)} hint="Collected" />
        <Stat label="Drafts" value={formatNumber(initialSummary.count_draft)} hint="Unsent invoices" />
      </div>

      {initialError && (
        <Alert tone="danger" title="Could not refresh data">
          {initialError}
        </Alert>
      )}

      {/* Tabs — filter by status */}
      <Tabs
        tabs={STATUS_TAB_LIST}
        activeTab={statusFilter === 'unpaid' ? 'all' : statusFilter}
        onTabChange={(id) => {
          setStatusFilter(id as StatusFilter)
          updateUrl({ status: id })
        }}
      />

      {/* Main table card */}
      <Card>
        {/* Search / filter bar */}
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search invoice or reference..."
            className="sm:w-64"
          />
          <SearchInput
            value={vendorSearchTerm}
            onChange={setVendorSearchTerm}
            placeholder="Filter vendor..."
            className="sm:w-48"
          />
          <Select
            value={statusFilter}
            onChange={(e) => {
              const v = e.target.value as StatusFilter
              setStatusFilter(v)
              updateUrl({ status: v })
            }}
            options={STATUS_OPTIONS}
            className="sm:w-40"
          />
        </div>

        {/* Date range / export */}
        <div className="border-b border-border bg-surface-2 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Start date</label>
                <Input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => { setExportStartDate(e.target.value); setExportError(null); updateUrl({ start_date: e.target.value, end_date: exportEndDate }) }}
                  className="w-40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">End date</label>
                <Input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => { setExportEndDate(e.target.value); setExportError(null); updateUrl({ start_date: exportStartDate, end_date: e.target.value }) }}
                  className="w-40"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={setExportToCurrentQuarter}>This quarter</Button>
              {resolvedPermissions.canExport && (
                <Button size="sm" onClick={handleExport} loading={exportLoading} disabled={exportLoading || !exportStartDate || !exportEndDate}>
                  Download
                </Button>
              )}
            </div>
          </div>
          {exportError && <p className="mt-2 text-sm text-danger">{exportError}</p>}
        </div>

        {/* Table */}
        {initialInvoices.length === 0 ? (
          <Empty
            title={searchTerm || vendorSearchTerm ? 'No invoices match your filters.' : 'No invoices found.'}
            description="Try adjusting your filters or create a new invoice."
            action={
              resolvedPermissions.canCreate ? (
                <Button variant="primary" onClick={() => router.push('/invoices/new')}>New Invoice</Button>
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
                    <TableRow key={inv.id} onClick={() => router.push(`/invoices/${inv.id}`)} className="cursor-pointer">
                      <TableCell>
                        <div className="font-medium text-[12px] font-mono">{inv.invoice_number}</div>
                        {inv.reference && <div className="text-xs text-text-muted">{inv.reference}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar name={inv.vendor?.name || '?'} size="sm" />
                          <span className="text-[13px]">{inv.vendor?.name || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-text-muted">{new Date(inv.invoice_date).toLocaleDateString('en-GB')}</TableCell>
                      <TableCell className={inv.status === 'overdue' ? 'text-danger font-medium' : 'text-text-muted'}>
                        {new Date(inv.due_date).toLocaleDateString('en-GB')}
                      </TableCell>
                      <TableCell>
                        <Badge tone={statusBadgeTone(inv.status)} dot>{statusLabel(inv.status)}</Badge>
                      </TableCell>
                      <TableCell align="right" className="font-medium tabular-nums">
                        {inv.total_amount < 0 ? (
                          <span className="text-danger">{formatCurrency(inv.total_amount)}</span>
                        ) : formatCurrency(inv.total_amount)}
                      </TableCell>
                      <TableCell align="right">
                        {inv.status === 'paid' ? (
                          <span className="text-success">Paid</span>
                        ) : (
                          <span className={inv.status === 'overdue' ? 'text-danger font-medium' : ''}>
                            {formatCurrency(inv.total_amount - inv.paid_amount)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            icon={<DownloadIcon />}
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

            {/* Mobile cards */}
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
    </div>
  )
}

// Simple inline SVG icon for download button
function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
