'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getInvoices, getInvoiceSummary } from '@/app/actions/invoices'
import { Plus, Download, FileText, Calendar, Search } from 'lucide-react'
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
  initialSummary: InvoiceSummary
  initialStatus: StatusFilter
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
  initialSummary,
  initialStatus,
  initialError,
  permissions
}: InvoicesClientProps) {
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

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)
  const [searchTerm, setSearchTerm] = useState('')
  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>(initialInvoices)
  const [summary, setSummary] = useState<InvoiceSummary>(initialSummary)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    let active = true

    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const [invoicesResult, summaryResult] = await Promise.all([
          getInvoices(
            statusFilter === 'all'
              ? undefined
              : statusFilter === 'unpaid'
              ? 'unpaid'
              : statusFilter
          ),
          getInvoiceSummary(),
        ])

        if (!active) {
          return
        }

        if (invoicesResult.error || !invoicesResult.invoices) {
          throw new Error(invoicesResult.error || 'Failed to load invoices')
        }

        if (summaryResult.error || !summaryResult.summary) {
          throw new Error(summaryResult.error || 'Failed to load summary')
        }

        setInvoices(invoicesResult.invoices)
        setSummary(summaryResult.summary)
      } catch (err) {
        if (!active) {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      active = false
    }
  }, [statusFilter, permissionsLoading])

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((invoice) => {
        if (!searchTerm) return true
        const search = searchTerm.toLowerCase()
        const invoiceNumber = invoice.invoice_number ? invoice.invoice_number.toLowerCase() : ''
        const vendorName = invoice.vendor?.name ? invoice.vendor.name.toLowerCase() : ''
        const reference = invoice.reference ? invoice.reference.toLowerCase() : ''
        return (
          invoiceNumber.includes(search) ||
          vendorName.includes(search) ||
          reference.includes(search)
        )
      }),
    [invoices, searchTerm]
  )

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
        sortable: true,
      },
      {
        key: 'vendor',
        header: 'Vendor',
        cell: (invoice) => invoice.vendor?.name || '-',
        sortable: true,
      },
      {
        key: 'invoice_date',
        header: 'Date',
        cell: (invoice) => new Date(invoice.invoice_date).toLocaleDateString('en-GB'),
        sortable: true,
      },
      {
        key: 'due_date',
        header: 'Due Date',
        cell: (invoice) => new Date(invoice.due_date).toLocaleDateString('en-GB'),
        sortable: true,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (invoice) => (
          <Badge variant={getStatusBadgeVariant(invoice.status)} size="sm">
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
          </Badge>
        ),
        sortable: true,
      },
      {
        key: 'total_amount',
        header: 'Amount',
        align: 'right',
        cell: (invoice) => formatCurrency(invoice.total_amount),
        sortable: true,
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
        sortable: true,
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

    
      

    
          if (resolvedPermissions.canCreate) {

    
            items.push({ label: 'New Invoice', href: '/invoices/new' })

    
          }

    
      

    
          return items

    
        }, [resolvedPermissions, canManageVendors, canAccessRecurring])

    
      

    
        const showLoadingState = loading && filteredInvoices.length === 0

    
      

    
        return (

    
                    <PageLayout

    
                      title="Invoices"

    
                      subtitle="Manage invoices and payments"

    
                      navItems={navItems.length > 0 ? navItems : undefined}

    
                      loading={showLoadingState}

    
                      loadingLabel="Loading invoices..."

    
                    >      <div className="space-y-6">
        {error && (
          <Alert
            variant="error"
            title="We couldn’t refresh everything"
            description={error}
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
            value={formatCurrency(summary.total_outstanding)}
            description="Awaiting payment"
            icon={<FileText />}
          />
          <Stat
            label="Overdue"
            value={formatCurrency(summary.total_overdue)}
            description="Past due date"
            icon={<FileText />}
          />
          <Stat
            label="This Month"
            value={formatCurrency(summary.total_this_month)}
            description="Collected"
            icon={<FileText />}
          />
          <Stat
            label="Drafts"
            value={formatNumber(summary.count_draft)}
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
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="w-full sm:w-auto"
                  fullWidth={false}
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="all">All Invoices</option>
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
            data={filteredInvoices}
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
            renderMobileCard={(invoice) => {
            const isOverdue = invoice.status === 'overdue'
            const isPaid = invoice.status === 'paid'

            return (
              <Card className="cursor-pointer p-4 transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">
                      {invoice.invoice_number}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      {invoice.vendor?.name || 'No vendor'}
                    </div>
                    {invoice.reference && (
                      <div className="mt-1 text-xs text-gray-500">
                        Ref: {invoice.reference}
                      </div>
                    )}
                  </div>
                  <Badge variant={getStatusBadgeVariant(invoice.status)} size="sm">
                    {invoice.status.charAt(0).toUpperCase() +
                      invoice.status.slice(1).replace('_', ' ')}
                  </Badge>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Invoice Date:</span>
                    <span className="font-medium">
                      {new Date(invoice.invoice_date).toLocaleDateString('en-GB')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Due Date:</span>
                    <span className={`font-medium ${isOverdue ? 'text-red-600' : ''}`}>
                      {new Date(invoice.due_date).toLocaleDateString('en-GB')}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  <div>
                    <div className="text-xs text-gray-500">Total Amount</div>
                    <div className="text-lg font-semibold">
                      {formatCurrency(invoice.total_amount)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Balance</div>
                    {isPaid ? (
                      <div className="font-semibold text-green-600">Paid</div>
                    ) : (
                      <div
                        className={`font-semibold ${isOverdue ? 'text-red-600' : ''}`}
                      >
                        {formatCurrency(invoice.total_amount - invoice.paid_amount)}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          }}
          />
        </Card>
      </div>
    </PageLayout>
  )
}
