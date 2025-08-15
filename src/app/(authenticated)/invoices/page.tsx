'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getInvoices, getInvoiceSummary } from '@/app/actions/invoices'
import { Plus, Download, FileText, Calendar } from 'lucide-react'
import type { InvoiceWithDetails, InvoiceStatus } from '@/types/invoices'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Select } from '@/components/ui-v2/forms/Select'
import { Input } from '@/components/ui-v2/forms/Input'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

export default function InvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([])
  const [summary, setSummary] = useState({
    total_outstanding: 0,
    total_overdue: 0,
    total_this_month: 0,
    count_draft: 0
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all' | 'unpaid'>('unpaid')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    async function loadData() {
      try {
        const [invoicesResult, summaryResult] = await Promise.all([
          getInvoices(statusFilter === 'all' ? undefined : statusFilter === 'unpaid' ? 'unpaid' : statusFilter),
          getInvoiceSummary()
        ])

        if (invoicesResult.error || !invoicesResult.invoices) {
          throw new Error(invoicesResult.error || 'Failed to load invoices')
        }

        if (summaryResult.error || !summaryResult.summary) {
          throw new Error(summaryResult.error || 'Failed to load summary')
        }

        setInvoices(invoicesResult.invoices)
        setSummary(summaryResult.summary)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    
    loadData()
  }, [statusFilter])


  function getStatusBadgeVariant(status: InvoiceStatus): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary' {
    switch (status) {
      case 'draft': return 'default'
      case 'sent': return 'info'
      case 'partially_paid': return 'warning'
      case 'paid': return 'success'
      case 'overdue': return 'error'
      case 'void': return 'secondary'
      case 'written_off': return 'secondary'
      default: return 'default'
    }
  }

  const filteredInvoices = invoices.filter(invoice => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      invoice.invoice_number.toLowerCase().includes(search) ||
      invoice.vendor?.name.toLowerCase().includes(search) ||
      invoice.reference?.toLowerCase().includes(search)
    )
  })

  // Define table columns
  const columns: Column<InvoiceWithDetails>[] = [
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
      sortable: true
    },
    {
      key: 'vendor',
      header: 'Vendor',
      cell: (invoice) => invoice.vendor?.name || '-',
      sortable: true
    },
    {
      key: 'invoice_date',
      header: 'Date',
      cell: (invoice) => new Date(invoice.invoice_date).toLocaleDateString('en-GB'),
      sortable: true
    },
    {
      key: 'due_date',
      header: 'Due Date',
      cell: (invoice) => new Date(invoice.due_date).toLocaleDateString('en-GB'),
      sortable: true
    },
    {
      key: 'status',
      header: 'Status',
      cell: (invoice) => (
        <Badge variant={getStatusBadgeVariant(invoice.status)} size="sm">
          {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
        </Badge>
      ),
      sortable: true
    },
    {
      key: 'total_amount',
      header: 'Amount',
      align: 'right',
      cell: (invoice) => `£${invoice.total_amount.toFixed(2)}`,
      sortable: true
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
            £{(invoice.total_amount - invoice.paid_amount).toFixed(2)}
          </span>
        )
      },
      sortable: true
    }
  ]

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Invoices"
          subtitle="Manage invoices and payments"
          backButton={{ label: 'Back to Dashboard', href: '/' }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper>
      <PageHeader 
        title="Invoices"
        subtitle="Manage invoices and payments"
        backButton={{ label: 'Back to Dashboard', href: '/' }}
        actions={
          <NavGroup>
            <NavLink href="/invoices/catalog">
              Catalog
            </NavLink>
            <NavLink href="/invoices/vendors">
              Vendors
            </NavLink>
            <NavLink href="/invoices/export">
              Export
            </NavLink>
            <NavLink href="/invoices/new">
              New Invoice
            </NavLink>
          </NavGroup>
        }
      />
      <PageContent>

      {error && (
        <Alert variant="error" description={error} className="mb-6" />
      )}

      <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Outstanding"
          value={`£${summary.total_outstanding.toFixed(2)}`}
          description="Awaiting payment"
          icon={<FileText />}
        />
        <Stat label="Overdue"
          value={`£${summary.total_overdue.toFixed(2)}`}
          description="Past due date"
          icon={<FileText />}
        />
        <Stat label="This Month"
          value={`£${summary.total_this_month.toFixed(2)}`}
          description="Collected"
          icon={<FileText />}
        />
        <Stat label="Drafts"
          value={summary.count_draft.toString()}
          description="Unsent invoices"
          icon={<FileText />}
        />
      </div>

      <Card>
        <div className="p-4 border-b">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all' | 'unpaid')}
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
                leftIcon={<MagnifyingGlassIcon />}
                className="hidden sm:block w-full sm:w-auto flex-1"
                fullWidth={false}
              />
            </div>

            <div className="flex gap-2 sm:hidden">
              <Button variant="secondary" onClick={() => router.push('/invoices/export')} className="flex-1">
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
              <Button variant="secondary" onClick={() => router.push('/invoices/recurring')} className="flex-1">
                <Calendar className="h-4 w-4 mr-1" />
                Recurring
              </Button>
            </div>
          </div>
        </div>

        <DataTable
          data={filteredInvoices}
          columns={columns}
          getRowKey={(invoice) => invoice.id}
          onRowClick={(invoice) => router.push(`/invoices/${invoice.id}`)}
          clickableRows
          emptyMessage={searchTerm ? 'No invoices match your search.' : 'No invoices found.'}
          emptyAction={
            !searchTerm && (
              <Button onClick={() => router.push('/invoices/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Invoice
              </Button>
            )
          }
          renderMobileCard={(invoice) => {
            const isOverdue = invoice.status === 'overdue'
            const isPaid = invoice.status === 'paid'
            
            return (
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">
                      {invoice.invoice_number}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {invoice.vendor?.name || 'No vendor'}
                    </div>
                    {invoice.reference && (
                      <div className="text-xs text-gray-500 mt-1">
                        Ref: {invoice.reference}
                      </div>
                    )}
                  </div>
                  <Badge variant={getStatusBadgeVariant(invoice.status)} size="sm">
                    {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
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

                <div className="mt-3 pt-3 border-t flex justify-between items-center">
                  <div>
                    <div className="text-xs text-gray-500">Total Amount</div>
                    <div className="font-semibold text-lg">
                      £{invoice.total_amount.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Balance</div>
                    {isPaid ? (
                      <div className="font-semibold text-green-600">Paid</div>
                    ) : (
                      <div className={`font-semibold ${isOverdue ? 'text-red-600' : ''}`}>
                        £{(invoice.total_amount - invoice.paid_amount).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          }}
        />
      </Card>
      </PageContent>
    </PageWrapper>
  )
}