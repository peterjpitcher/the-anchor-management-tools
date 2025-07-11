'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getInvoices, getInvoiceSummary } from '@/app/actions/invoices'
import { Button } from '@/components/ui/Button'
import { Plus, Download, Users, Settings, FileText, Calendar, Package } from 'lucide-react'
import type { InvoiceWithDetails, InvoiceStatus } from '@/types/invoices'

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
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    async function loadData() {
      try {
        const [invoicesResult, summaryResult] = await Promise.all([
          getInvoices(statusFilter === 'all' ? undefined : statusFilter),
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


  function getStatusColor(status: InvoiceStatus): string {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800'
      case 'sent': return 'bg-blue-100 text-blue-800'
      case 'partially_paid': return 'bg-yellow-100 text-yellow-800'
      case 'paid': return 'bg-green-100 text-green-800'
      case 'overdue': return 'bg-red-100 text-red-800'
      case 'void': return 'bg-gray-100 text-gray-800'
      case 'written_off': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading invoices...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Invoices</h1>
          <p className="text-muted-foreground">Manage your invoices and payments</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/quotes')}
          >
            <FileText className="h-4 w-4 mr-2" />
            Quotes
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/invoices/recurring')}
          >
            <Calendar className="h-4 w-4 mr-2" />
            Recurring
          </Button>
          <Button onClick={() => router.push('/invoices/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Outstanding</span>
            <FileText className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold">£{summary.total_outstanding.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Awaiting payment</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Overdue</span>
            <FileText className="h-4 w-4 text-red-400" />
          </div>
          <p className="text-2xl font-bold text-red-600">£{summary.total_overdue.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Past due date</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">This Month</span>
            <FileText className="h-4 w-4 text-green-400" />
          </div>
          <p className="text-2xl font-bold text-green-600">£{summary.total_this_month.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Collected</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Drafts</span>
            <FileText className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold">{summary.count_draft}</p>
          <p className="text-sm text-gray-500 mt-1">Unsent invoices</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-4 border-b flex flex-col md:flex-row gap-4 justify-between">
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}
              className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Invoices</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="void">Void</option>
              <option value="written_off">Written Off</option>
            </select>
            
            <input
              type="text"
              placeholder="Search invoices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/invoices/export')}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" onClick={() => router.push('/invoices/vendors')}>
              <Users className="h-4 w-4 mr-2" />
              Vendors
            </Button>
            <Button variant="outline" onClick={() => router.push('/invoices/recurring')}>
              <Settings className="h-4 w-4 mr-2" />
              Recurring
            </Button>
            <Button variant="outline" onClick={() => router.push('/invoices/settings')}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 mb-4">
              {searchTerm ? 'No invoices match your search.' : 'No invoices found.'}
            </p>
            {!searchTerm && (
              <Button onClick={() => router.push('/invoices/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Invoice
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-4 font-medium text-gray-700">Invoice #</th>
                  <th className="text-left p-4 font-medium text-gray-700">Vendor</th>
                  <th className="text-left p-4 font-medium text-gray-700">Date</th>
                  <th className="text-left p-4 font-medium text-gray-700">Due Date</th>
                  <th className="text-left p-4 font-medium text-gray-700">Status</th>
                  <th className="text-right p-4 font-medium text-gray-700">Amount</th>
                  <th className="text-right p-4 font-medium text-gray-700">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr 
                    key={invoice.id} 
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/invoices/${invoice.id}`)}
                  >
                    <td className="p-4">
                      <div className="font-medium">{invoice.invoice_number}</div>
                      {invoice.reference && (
                        <div className="text-sm text-gray-500">{invoice.reference}</div>
                      )}
                    </td>
                    <td className="p-4">{invoice.vendor?.name || '-'}</td>
                    <td className="p-4 text-sm">
                      {new Date(invoice.invoice_date).toLocaleDateString('en-GB')}
                    </td>
                    <td className="p-4 text-sm">
                      {new Date(invoice.due_date).toLocaleDateString('en-GB')}
                    </td>
                    <td className="p-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
                        {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-right font-medium">
                      £{invoice.total_amount.toFixed(2)}
                    </td>
                    <td className="p-4 text-right">
                      {invoice.status === 'paid' ? (
                        <span className="text-green-600">Paid</span>
                      ) : (
                        <span className={invoice.status === 'overdue' ? 'text-red-600 font-medium' : ''}>
                          £{(invoice.total_amount - invoice.paid_amount).toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Button
          variant="outline"
          onClick={() => router.push('/invoices/vendors')}
          className="flex items-center justify-center gap-2 py-6"
        >
          <Users className="h-5 w-5" />
          <span>Vendors</span>
        </Button>
        
        <Button
          variant="outline"
          onClick={() => router.push('/invoices/catalog')}
          className="flex items-center justify-center gap-2 py-6"
        >
          <Package className="h-5 w-5" />
          <span>Line Items</span>
        </Button>
        
        <Button
          variant="outline"
          onClick={() => router.push('/invoices/export')}
          className="flex items-center justify-center gap-2 py-6"
        >
          <Download className="h-5 w-5" />
          <span>Export</span>
        </Button>
        
        <Button
          variant="outline"
          onClick={() => router.push('/settings/cron-test')}
          className="flex items-center justify-center gap-2 py-6"
        >
          <Settings className="h-5 w-5" />
          <span>Settings</span>
        </Button>
      </div>
    </div>
  )
}