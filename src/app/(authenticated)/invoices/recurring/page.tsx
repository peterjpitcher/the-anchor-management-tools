'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getRecurringInvoices, deleteRecurringInvoice, generateInvoiceFromRecurring, toggleRecurringInvoiceStatus } from '@/app/actions/recurring-invoices'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Plus, Calendar, Trash2, Edit, Play, Pause, ChevronLeft } from 'lucide-react'
import type { RecurringInvoiceWithDetails } from '@/types/invoices'

export default function RecurringInvoicesPage() {
  const router = useRouter()
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoiceWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

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
    setProcessing(id)
    try {
      const formData = new FormData()
      formData.append('id', id)
      
      const result = await deleteRecurringInvoice(formData)
      if (result.success) {
        toast.success('Recurring invoice deleted successfully')
        await loadRecurringInvoices()
      } else {
        toast.error(result.error || 'Failed to delete recurring invoice')
      }
    } catch (error) {
      console.error('Error deleting recurring invoice:', error)
      toast.error('Failed to delete recurring invoice')
    } finally {
      setProcessing(null)
      setShowDeleteConfirm(null)
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
        toast.success(`Invoice ${result.invoice.invoice_number} generated successfully`)
        await loadRecurringInvoices()
        router.push(`/invoices/${result.invoice.id}`)
      } else {
        toast.error(result.error || 'Failed to generate invoice')
      }
    } catch (error) {
      console.error('Error generating invoice:', error)
      toast.error('Failed to generate invoice')
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
        toast.success(`Recurring invoice ${action}d successfully`)
        await loadRecurringInvoices()
      } else {
        toast.error(result.error || `Failed to ${action} recurring invoice`)
      }
    } catch (error) {
      console.error(`Error ${action}ing recurring invoice:`, error)
      toast.error(`Failed to ${action} recurring invoice`)
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
      <PageWrapper>
        <PageHeader 
          title="Recurring Invoices"
          backButton={{ label: 'Back to Invoices', href: '/invoices' }}
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
        title="Recurring Invoices"
        subtitle="Manage automated invoice generation"
        breadcrumbs={[
          { label: 'Invoices', href: '/invoices' }
        ]}
        actions={
          <Button
            onClick={() => router.push('/invoices/recurring/new')}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            New Recurring Invoice
          </Button>
        }
      />
      <PageContent>
        {recurringInvoices.length === 0 ? (
        <EmptyState icon="calendar"
          title="No recurring invoices"
          description="Create recurring invoices to automate your billing"
          action={
            <Button onClick={() => router.push('/invoices/recurring/new')}>
              Create First Recurring Invoice
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
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
                        variant="secondary"
                        size="sm"
                        onClick={() => handleToggleStatus(recurring.id, recurring.is_active)}
                        disabled={processing === recurring.id}
                        loading={processing === recurring.id}
                        title={recurring.is_active ? "Deactivate recurring invoice" : "Activate recurring invoice"}
                        iconOnly
                      >
                        {recurring.is_active ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleGenerateNow(recurring.id)}
                        disabled={processing === recurring.id || !recurring.is_active}
                        loading={processing === recurring.id}
                        title="Generate invoice now"
                        iconOnly
                      >
                        <Calendar className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/invoices/recurring/${recurring.id}`)}
                        disabled={processing === recurring.id}
                        title="View details"
                        iconOnly
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setShowDeleteConfirm(recurring.id)}
                        disabled={processing === recurring.id}
                        loading={processing === recurring.id}
                        iconOnly
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      
      <ConfirmDialog
        open={showDeleteConfirm !== null}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        title="Delete Recurring Invoice"
        message="Are you sure you want to delete this recurring invoice? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="danger"
      />
      </PageContent>
    </PageWrapper>
  )
}