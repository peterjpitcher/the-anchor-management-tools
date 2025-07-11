'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getRecurringInvoices, deleteRecurringInvoice, generateInvoiceFromRecurring, toggleRecurringInvoiceStatus } from '@/app/actions/recurring-invoices'
import { Button } from '@/components/ui/Button'
import { Plus, Calendar, Trash2, Edit, Play, Pause, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { RecurringInvoiceWithDetails } from '@/types/invoices'

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoiceWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  useEffect(() => {
    loadRecurringInvoices()
  }, [])

  async function loadRecurringInvoices() {
    try {
      const result = await getRecurringInvoices()
      if (result.recurringInvoices) {
        setRecurringInvoices(result.recurringInvoices)
      }
    } catch (error) {
      console.error('Error loading recurring invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this recurring invoice?')) {
      return
    }

    setProcessing(id)
    try {
      const formData = new FormData()
      formData.append('id', id)
      
      const result = await deleteRecurringInvoice(formData)
      if (result.success) {
        await loadRecurringInvoices()
      } else {
        alert(result.error || 'Failed to delete recurring invoice')
      }
    } catch (error) {
      console.error('Error deleting recurring invoice:', error)
      alert('Failed to delete recurring invoice')
    } finally {
      setProcessing(null)
    }
  }

  async function handleGenerateNow(id: string) {
    if (!confirm('Generate invoice now? This will create a new invoice immediately.')) {
      return
    }

    setProcessing(id)
    try {
      const result = await generateInvoiceFromRecurring(id)
      if (result.success && result.invoice) {
        alert(`Invoice ${result.invoice.invoice_number} generated successfully`)
        await loadRecurringInvoices()
        router.push(`/invoices/${result.invoice.id}`)
      } else {
        alert(result.error || 'Failed to generate invoice')
      }
    } catch (error) {
      console.error('Error generating invoice:', error)
      alert('Failed to generate invoice')
    } finally {
      setProcessing(null)
    }
  }

  async function handleToggleStatus(id: string, currentStatus: boolean) {
    const action = currentStatus ? 'deactivate' : 'activate'
    if (!confirm(`Are you sure you want to ${action} this recurring invoice?`)) {
      return
    }

    setProcessing(id)
    try {
      const formData = new FormData()
      formData.append('id', id)
      formData.append('current_status', currentStatus.toString())
      
      const result = await toggleRecurringInvoiceStatus(formData)
      if (result.success) {
        await loadRecurringInvoices()
      } else {
        alert(result.error || `Failed to ${action} recurring invoice`)
      }
    } catch (error) {
      console.error(`Error ${action}ing recurring invoice:`, error)
      alert(`Failed to ${action} recurring invoice`)
    } finally {
      setProcessing(null)
    }
  }

  function getFrequencyLabel(frequency: string): string {
    return frequency.charAt(0).toUpperCase() + frequency.slice(1)
  }

  function getNextInvoiceLabel(date: string): string {
    const nextDate = new Date(date)
    const today = new Date()
    const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysUntil < 0) {
      return 'Overdue'
    } else if (daysUntil === 0) {
      return 'Today'
    } else if (daysUntil === 1) {
      return 'Tomorrow'
    } else if (daysUntil <= 7) {
      return `In ${daysUntil} days`
    } else {
      return nextDate.toLocaleDateString('en-GB')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading recurring invoices...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/invoices">
        <Button variant="ghost" className="mb-4">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Invoices
        </Button>
      </Link>
      
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Recurring Invoices</h1>
            <p className="text-gray-600 mt-2">Manage automated invoice generation</p>
          </div>
          <Button
            onClick={() => router.push('/invoices/recurring/new')}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Recurring Invoice
          </Button>
        </div>
      </div>

      {recurringInvoices.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No recurring invoices</h3>
          <p className="text-gray-600 mb-6">Create recurring invoices to automate your billing</p>
          <Button
            onClick={() => router.push('/invoices/recurring/new')}
          >
            Create First Recurring Invoice
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Vendor
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Frequency
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Next Invoice
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reference
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recurringInvoices.map((recurring) => (
                <tr key={recurring.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {recurring.vendor?.name || 'Unknown Vendor'}
                      </div>
                      {recurring.vendor?.contact_name && (
                        <div className="text-sm text-gray-500">
                          {recurring.vendor.contact_name}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {getFrequencyLabel(recurring.frequency)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {getNextInvoiceLabel(recurring.next_invoice_date)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(recurring.next_invoice_date).toLocaleDateString('en-GB')}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {recurring.reference || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {recurring.is_active ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <Play className="h-3 w-3 mr-1" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        <Pause className="h-3 w-3 mr-1" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(recurring.id, recurring.is_active)}
                        disabled={processing === recurring.id}
                        title={recurring.is_active ? "Deactivate recurring invoice" : "Activate recurring invoice"}
                      >
                        {recurring.is_active ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleGenerateNow(recurring.id)}
                        disabled={processing === recurring.id || !recurring.is_active}
                        title="Generate invoice now"
                      >
                        <Calendar className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/invoices/recurring/${recurring.id}/edit`)}
                        disabled={processing === recurring.id}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(recurring.id)}
                        disabled={processing === recurring.id}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}