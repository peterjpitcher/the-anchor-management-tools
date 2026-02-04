'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Plus, Download, FileText, Calendar, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import type { InvoiceWithDetails, InvoiceStatus } from '@/types/invoices'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Select } from '@/components/ui-v2/forms/Select'
import { Input } from '@/components/ui-v2/forms/Input'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, type Column } from '@/components/ui-v2/display/DataTable'
import { usePermissions } from '@/contexts/PermissionContext'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import { MobileInvoiceCard } from './MobileInvoiceCard'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { toLocalIsoDate } from '@/lib/dateUtils'

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
  initialLimit: number
  initialError: string | null
  permissions: PermissionSnapshot
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('en-GB')

const formatCurrency = (value: number) => currencyFormatter.format(value)
const formatNumber = (value: number) => numberFormatter.format(value)

export default function InvoicesClient({
  initialInvoices,
  initialTotal,
  initialSummary,
  initialStatus,
  initialPage,
  initialSearch,
  initialLimit,
  initialError,
  permissions
}: InvoicesClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { hasPermission, loading: permissionsLoading } = usePermissions()

  const resolvedPermissions = useMemo<PermissionSnapshot>(() => {
    if (permissionsLoading) {
      return permissions
    }

    return {
      canCreate: hasPermission('invoices', 'create'),
      canEdit: hasPermission('invoices', 'edit'),
      canDelete: hasPermission('invoices', 'delete'),
      canExport: hasPermission('invoices', 'export'),
      canManageCatalog: hasPermission('invoices', 'manage'),
    }
  }, [permissionsLoading, permissions, hasPermission])

  const canAccessRecurring = resolvedPermissions.canCreate || resolvedPermissions.canEdit
  const canManageVendors =
    resolvedPermissions.canCreate || resolvedPermissions.canEdit || resolvedPermissions.canDelete
  const isReadOnly =
    !resolvedPermissions.canCreate &&
    !resolvedPermissions.canEdit &&
    !resolvedPermissions.canDelete &&
    !resolvedPermissions.canExport &&
    !resolvedPermissions.canManageCatalog

  // Local state for controlled inputs
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)
  const [searchTerm, setSearchTerm] = useState(initialSearch)
  const [exportStartDate, setExportStartDate] = useState('')
  const [exportEndDate, setExportEndDate] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Sync local state with props (e.g. browser navigation)
  useEffect(() => {
    setStatusFilter(initialStatus)
  }, [initialStatus])

  useEffect(() => {
    setSearchTerm(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    if (!resolvedPermissions.canExport) return
    if (exportStartDate || exportEndDate) return

    const now = new Date()
    const currentQuarter = Math.floor(now.getMonth() / 3)
    const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1)
    const quarterEnd = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0)

    setExportStartDate(toLocalIsoDate(quarterStart))
    setExportEndDate(toLocalIsoDate(quarterEnd))
  }, [resolvedPermissions.canExport, exportStartDate, exportEndDate])

  // URL updates
  const updateUrl = useCallback((newParams: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString())
    
    Object.entries(newParams).forEach(([key, value]) => {
      if (value === undefined || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })

    // Reset page to 1 if filter or search changes, unless page is explicitly set
    if (!newParams.page && (newParams.status !== undefined || newParams.search !== undefined)) {
      params.set('page', '1')
    }

    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, pathname, router])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm !== initialSearch) {
        updateUrl({ search: searchTerm })
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTerm, initialSearch, updateUrl])

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
      const params = new URLSearchParams({
        start_date: exportStartDate,
        end_date: exportEndDate,
        type: 'all',
      })

      const response = await fetch(`/api/invoices/export?${params}`)
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Export failed')
      }

      const contentDisposition = response.headers.get('content-disposition')
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'invoices-export.zip'

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Export downloaded successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export invoices'
      setExportError(message)
      toast.error(message)
    } finally {
      setExportLoading(false)
    }
  }

  function getStatusBadgeVariant(
    status: InvoiceStatus
  ): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary' {
    switch (status) {
      case 'draft':
        return 'default'
      case 'sent':
        return 'info'
      case 'partially_paid':
        return 'warning'
      case 'paid':
        return 'success'
      case 'overdue':
        return 'error'
      case 'void':
        return 'secondary'
      case 'written_off':
        return 'secondary'
      default:
        return 'default'
    }
  }

  const columns: Column<InvoiceWithDetails>[] = useMemo(
    () => [
      {
        key: 'invoice_number',
        header: 'Invoice #',
        cell: (invoice) => (
          <div>
            <div className="font-medium">{invoice.invoice_number}</div>
            {invoice.reference && (
              <div className="text-sm text-gray-500">{invoice.reference}</div>
            )}
          </div>
        ),
        sortable: false, // Server-side sort only (default date)
      },
      {
        key: 'vendor',
        header: 'Vendor',
        cell: (invoice) => invoice.vendor?.name || '-',
        sortable: false,
      },
      {
        key: 'invoice_date',
        header: 'Date',
        cell: (invoice) => new Date(invoice.invoice_date).toLocaleDateString('en-GB'),
        sortable: false,
      },
      {
        key: 'due_date',
        header: 'Due Date',
        cell: (invoice) => new Date(invoice.due_date).toLocaleDateString('en-GB'),
        sortable: false,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (invoice) => (
          <Badge variant={getStatusBadgeVariant(invoice.status)} size="sm">
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
          </Badge>
        ),
        sortable: false,
      },
      {
        key: 'total_amount',
        header: 'Amount',
        align: 'right',
        cell: (invoice) => formatCurrency(invoice.total_amount),
        sortable: false,
      },
      {
        key: 'balance',
        header: 'Balance',
        align: 'right',
        cell: (invoice) => {
          if (invoice.status === 'paid') {
            return <span className="text-green-600">Paid</span>
          }
          return (
            <span className={invoice.status === 'overdue' ? 'text-red-600 font-medium' : ''}>
              {formatCurrency(invoice.total_amount - invoice.paid_amount)}
            </span>
          )
        },
        sortable: false,
      },
    ],
    []
  )

  const navItems = useMemo<HeaderNavItem[]>(() => {
    const items: HeaderNavItem[] = []

    if (resolvedPermissions.canManageCatalog) {
      items.push({ label: 'Catalog', href: '/invoices/catalog' })
    }

    if (canManageVendors) {
      items.push({ label: 'Vendors', href: '/invoices/vendors' })
    }

    if (canAccessRecurring) {
      items.push({ label: 'Recurring', href: '/invoices/recurring' })
    }

    if (resolvedPermissions.canExport) {
      items.push({ label: 'Export', href: '/invoices/export' })
    }

    return items
  }, [resolvedPermissions, canManageVendors, canAccessRecurring])

  const headerActions = resolvedPermissions.canCreate ? (
    <LinkButton href="/invoices/new" variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
      New Invoice
    </LinkButton>
  ) : null

  // Pagination Logic
  const totalPages = Math.ceil(initialTotal / initialLimit)
  const hasNextPage = initialPage < totalPages
  const hasPrevPage = initialPage > 1

  return (
    <PageLayout
      title="Invoices"
      subtitle="Manage invoices and payments"
      navItems={navItems.length > 0 ? navItems : undefined}
      headerActions={headerActions}
    >
      <div className="space-y-6">
        {initialError && (
          <Alert
            variant="error"
            title="We couldn’t refresh everything"
            description={initialError}
          />
        )}
        {isReadOnly && (
          <Alert
            variant="info"
            description="You have read-only access to invoices. Creation, export, and recurring tools are disabled for your role."
          />
        )}

        <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Outstanding"
            value={formatCurrency(initialSummary.total_outstanding)}
            description="Awaiting payment"
            icon={<FileText />}
          />
          <Stat
            label="Overdue"
            value={formatCurrency(initialSummary.total_overdue)}
            description="Past due date"
            icon={<FileText />}
          />
          <Stat
            label="This Month"
            value={formatCurrency(initialSummary.total_this_month)}
            description="Collected"
            icon={<FileText />}
          />
          <Stat
            label="Drafts"
            value={formatNumber(initialSummary.count_draft)}
            description="Unsent invoices"
            icon={<FileText />}
          />
        </div>

        <Card>
          <div className="border-b p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={statusFilter}
                  onChange={(e) => {
                    const newStatus = e.target.value as StatusFilter
                    setStatusFilter(newStatus)
                    updateUrl({ status: newStatus })
                  }}
                  className="w-full sm:w-auto"
                  fullWidth={false}
                >
                  <option value="all">All</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="void">Void</option>
                  <option value="written_off">Written Off</option>
                </Select>

                <Input
                  type="text"
                  placeholder="Search invoices..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  leftIcon={<Search />}
                  className="hidden w-full flex-1 sm:block sm:w-auto"
                  fullWidth={false}
                />
              </div>

              {resolvedPermissions.canExport && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Start date</label>
                        <Input
                          type="date"
                          value={exportStartDate}
                          onChange={(e) => {
                            setExportStartDate(e.target.value)
                            setExportError(null)
                          }}
                          fullWidth={false}
                          className="sm:w-40"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">End date</label>
                        <Input
                          type="date"
                          value={exportEndDate}
                          onChange={(e) => {
                            setExportEndDate(e.target.value)
                            setExportError(null)
                          }}
                          fullWidth={false}
                          className="sm:w-40"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const now = new Date()
                          const currentQuarter = Math.floor(now.getMonth() / 3)
                          const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1)
                          const quarterEnd = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0)
                          setExportStartDate(toLocalIsoDate(quarterStart))
                          setExportEndDate(toLocalIsoDate(quarterEnd))
                        }}
                        leftIcon={<Calendar className="h-4 w-4" />}
                      >
                        This quarter
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleExport}
                        loading={exportLoading}
                        disabled={exportLoading || !exportStartDate || !exportEndDate}
                        leftIcon={<Download className="h-4 w-4" />}
                      >
                        Download
                      </Button>
                    </div>
                  </div>
                  {exportError && (
                    <p className="mt-2 text-sm text-red-600">{exportError}</p>
                  )}
                </div>
              )}

              <div className="flex gap-2 sm:hidden">
                {resolvedPermissions.canExport && (
                  <Button
                    variant="secondary"
                    onClick={() => router.push('/invoices/export')}
                    className="flex-1"
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Export
                  </Button>
                )}
                {canAccessRecurring && (
                  <Button
                    variant="secondary"
                    onClick={() => router.push('/invoices/recurring')}
                    className="flex-1"
                  >
                    <Calendar className="mr-1 h-4 w-4" />
                    Recurring
                  </Button>
                )}
              </div>
            </div>
          </div>

          <DataTable
            data={initialInvoices}
            columns={columns}
            getRowKey={(invoice) => invoice.id}
            onRowClick={(invoice) => router.push(`/invoices/${invoice.id}`)}
            clickableRows
            emptyMessage={
              searchTerm ? 'No invoices match your search.' : 'No invoices found.'
            }
            emptyAction={
              !searchTerm && resolvedPermissions.canCreate ? (
                <Button onClick={() => router.push('/invoices/new')}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Invoice
                </Button>
              ) : undefined
            }
            renderMobileCard={(invoice) => (
              <MobileInvoiceCard 
                invoice={invoice} 
                onClick={(inv) => router.push(`/invoices/${inv.id}`)} 
              />
            )}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 sm:px-6">
              <div className="flex flex-1 justify-between sm:hidden">
                <Button
                  variant="secondary"
                  disabled={!hasPrevPage}
                  onClick={() => updateUrl({ page: (initialPage - 1).toString() })}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={!hasNextPage}
                  onClick={() => updateUrl({ page: (initialPage + 1).toString() })}
                >
                  Next
                </Button>
              </div>
              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">{(initialPage - 1) * initialLimit + 1}</span> to{' '}
                    <span className="font-medium">
                      {Math.min(initialPage * initialLimit, initialTotal)}
                    </span>{' '}
                    of <span className="font-medium">{initialTotal}</span> results
                  </p>
                </div>
                <div>
                  <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                    <button
                      onClick={() => updateUrl({ page: (initialPage - 1).toString() })}
                      disabled={!hasPrevPage}
                      className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="sr-only">Previous</span>
                      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    
                    <button
                        className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 focus:outline-offset-0"
                    >
                        {initialPage}
                    </button>

                    <button
                      onClick={() => updateUrl({ page: (initialPage + 1).toString() })}
                      disabled={!hasNextPage}
                      className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="sr-only">Next</span>
                      <ChevronRight className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  )
}
