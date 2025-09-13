'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getRecurringInvoice, deleteRecurringInvoice, toggleRecurringInvoiceStatus, generateInvoiceFromRecurring } from '@/app/actions/recurring-invoices'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Edit2, Trash2, Play, Pause, FileText, Calendar, Clock } from 'lucide-react'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import type { RecurringInvoiceWithDetails } from '@/types/invoices'

export default function RecurringInvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  
  const [recurringInvoice, setRecurringInvoice] = useState<RecurringInvoiceWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    loadRecurringInvoice()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRecurringInvoice() {
    try {
      const result = await getRecurringInvoice(id)
      
      if (result.error || !result.recurringInvoice) {
        throw new Error(result.error || 'Failed to load recurring invoice')
      }
      
      setRecurringInvoice(result.recurringInvoice)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recurring invoice')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleStatus() {
    if (!recurringInvoice) return
    
    setActionLoading(true)
    try {
      const formData = new FormData()
      formData.append('id', id)
      formData.append('current_status', recurringInvoice.is_active.toString())
      const result = await toggleRecurringInvoiceStatus(formData)
      
      if (result.error) {
        throw new Error(result.error)
      }
      
      await loadRecurringInvoice()
      toast.success(`Recurring invoice ${recurringInvoice.is_active ? 'deactivated' : 'activated'} successfully`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle status')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGenerateNow() {
    setActionLoading(true)
    try {
      const result = await generateInvoiceFromRecurring(id)
      
      if (result.error) {
        throw new Error(result.error)
      }
      
      toast.success('Invoice generated successfully')
      if (result.invoice) {
        router.push(`/invoices/${result.invoice.id}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate invoice')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete() {
    setActionLoading(true)
    try {
      const formData = new FormData()
      formData.append('id', id)
      const result = await deleteRecurringInvoice(formData)
      
      if (result.error) {
        throw new Error(result.error)
      }
      
      toast.success('Recurring invoice deleted successfully')
      router.push('/invoices/recurring')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete recurring invoice')
    } finally {
      setActionLoading(false)
      setShowDeleteDialog(false)
    }
  }

  function calculateNextInvoiceDate(): string | null {
    if (!recurringInvoice || !recurringInvoice.is_active) return null
    
    const today = new Date()
    const startDate = new Date(recurringInvoice.start_date)
    
    if (recurringInvoice.end_date) {
      const endDate = new Date(recurringInvoice.end_date)
      if (today > endDate) return null
    }
    
    if (today < startDate) {
      return startDate.toISOString().split('T')[0]
    }
    
    // Calculate next date based on frequency
    // Calculate next date based on last invoice or start date
    const lastGenerated = recurringInvoice.last_invoice?.invoice_date
      ? new Date(recurringInvoice.last_invoice.invoice_date)
      : new Date(startDate.getTime() - 1) // Day before start date to trigger first generation
    
    const nextDate = new Date(lastGenerated)
    
    switch (recurringInvoice.frequency) {
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7)
        break
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1)
        break
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3)
        break
      case 'yearly':
        nextDate.setFullYear(nextDate.getFullYear() + 1)
        break
    }
    
    // Ensure next date is after today
    while (nextDate <= today) {
      switch (recurringInvoice.frequency) {
        case 'weekly':
          nextDate.setDate(nextDate.getDate() + 7)
          break
        case 'monthly':
          nextDate.setMonth(nextDate.getMonth() + 1)
          break
        case 'quarterly':
          nextDate.setMonth(nextDate.getMonth() + 3)
          break
        case 'yearly':
          nextDate.setFullYear(nextDate.getFullYear() + 1)
          break
      }
    }
    
    // Check if next date exceeds end date
    if (recurringInvoice.end_date) {
      const endDate = new Date(recurringInvoice.end_date)
      if (nextDate > endDate) return null
    }
    
    return nextDate.toISOString().split('T')[0]
  }

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Recurring Invoice Details"
          subtitle="View recurring invoice template"
          backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  if (error || !recurringInvoice) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Recurring Invoice Details"
          subtitle="View recurring invoice template"
          backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
        />
        <PageContent>
          <Alert variant="error" description={error || 'Recurring invoice not found'} />
        </PageContent>
      </PageWrapper>
    )
  }

  const nextInvoiceDate = calculateNextInvoiceDate()
  const totals = recurringInvoice.line_items?.reduce((acc, item) => {
    const lineSubtotal = item.quantity * item.unit_price
    const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
    const lineAfterDiscount = lineSubtotal - lineDiscount
    const lineVat = lineAfterDiscount * (item.vat_rate / 100)
    return {
      subtotal: acc.subtotal + lineAfterDiscount,
      vat: acc.vat + lineVat,
      total: acc.total + lineAfterDiscount + lineVat
    }
  }, { subtotal: 0, vat: 0, total: 0 }) || { subtotal: 0, vat: 0, total: 0 }

  // Apply invoice-level discount
  const invoiceDiscountAmount = totals.subtotal * (recurringInvoice.invoice_discount_percentage / 100)
  const finalSubtotal = totals.subtotal - invoiceDiscountAmount
  const finalTotal = finalSubtotal + totals.vat

  return (
    <PageWrapper>
      <PageHeader 
        title="Recurring Invoice Details"
        subtitle={`Template for ${recurringInvoice.vendor?.name || 'Unknown Vendor'}`}
        backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push(`/invoices/recurring/${id}/edit`)}
              leftIcon={<Edit2 className="h-4 w-4" />}
            >
              Edit
            </Button>
            <Button
              variant={recurringInvoice.is_active ? 'secondary' : 'primary'}
              onClick={handleToggleStatus}
              loading={actionLoading}
              leftIcon={recurringInvoice.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            >
              {recurringInvoice.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              variant="primary"
              onClick={handleGenerateNow}
              loading={actionLoading}
              disabled={!recurringInvoice.is_active}
              leftIcon={<FileText className="h-4 w-4" />}
            >
              Generate Now
            </Button>
          </div>
        }
      />
      <PageContent>
        <div className="space-y-6">
          <Card title="Template Information">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-gray-500">Status</div>
                <div className="mt-1">
                  <Badge 
                    variant={recurringInvoice.is_active ? 'success' : 'default'}
                    size="sm"
                  >
                    {recurringInvoice.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Vendor</div>
                <div className="mt-1 font-medium">{recurringInvoice.vendor?.name || 'Unknown'}</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Frequency</div>
                <div className="mt-1 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="capitalize">{recurringInvoice.frequency}</span>
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Payment Terms</div>
                <div className="mt-1 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span>{recurringInvoice.days_before_due} days</span>
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Start Date</div>
                <div className="mt-1">{new Date(recurringInvoice.start_date).toLocaleDateString('en-GB')}</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">End Date</div>
                <div className="mt-1">
                  {recurringInvoice.end_date 
                    ? new Date(recurringInvoice.end_date).toLocaleDateString('en-GB')
                    : 'Ongoing'}
                </div>
              </div>

              {recurringInvoice.reference && (
                <div>
                  <div className="text-sm text-gray-500">Reference</div>
                  <div className="mt-1">{recurringInvoice.reference}</div>
                </div>
              )}

              <div>
                <div className="text-sm text-gray-500">Next Invoice Date</div>
                <div className="mt-1 font-medium">
                  {nextInvoiceDate 
                    ? new Date(nextInvoiceDate).toLocaleDateString('en-GB')
                    : 'N/A'}
                </div>
              </div>

              {recurringInvoice.last_invoice && (
                <div>
                  <div className="text-sm text-gray-500">Last Generated</div>
                  <div className="mt-1">
                    {new Date(recurringInvoice.last_invoice.invoice_date).toLocaleDateString('en-GB')}
                  </div>
                </div>
              )}

              <div>
                <div className="text-sm text-gray-500">Last Invoice</div>
                <div className="mt-1">
                  {recurringInvoice.last_invoice 
                    ? `${recurringInvoice.last_invoice.invoice_number} (${recurringInvoice.last_invoice.status})`
                    : 'None'}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Line Items">
            <DataTable
              data={recurringInvoice.line_items || []}
              getRowKey={(item) => `${item.description}-${item.unit_price}-${item.quantity}-${item.vat_rate}-${item.discount_percentage}`}
              columns={[
                {
                  key: 'description',
                  header: 'Description',
                  cell: (item: any) => (
                    <span className="text-sm text-gray-900">{item.description}</span>
                  ),
                },
                {
                  key: 'quantity',
                  header: 'Qty',
                  align: 'right',
                  cell: (item: any) => (
                    <span className="text-sm text-gray-900">{item.quantity}</span>
                  ),
                },
                {
                  key: 'unit_price',
                  header: 'Unit Price',
                  align: 'right',
                  cell: (item: any) => (
                    <span className="text-sm text-gray-900">£{item.unit_price.toFixed(2)}</span>
                  ),
                },
                {
                  key: 'discount_percentage',
                  header: 'Discount',
                  align: 'right',
                  cell: (item: any) => (
                    <span className="text-sm text-gray-900">{item.discount_percentage > 0 ? `${item.discount_percentage}%` : '-'}</span>
                  ),
                },
                {
                  key: 'vat_rate',
                  header: 'VAT',
                  align: 'right',
                  cell: (item: any) => (
                    <span className="text-sm text-gray-900">{item.vat_rate}%</span>
                  ),
                },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  cell: (item: any) => {
                    const lineSubtotal = item.quantity * item.unit_price
                    const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
                    const lineAfterDiscount = lineSubtotal - lineDiscount
                    const lineVat = lineAfterDiscount * (item.vat_rate / 100)
                    const lineTotal = lineAfterDiscount + lineVat
                    return <span className="text-sm text-gray-900 font-medium">£{lineTotal.toFixed(2)}</span>
                  },
                },
              ]}
              emptyMessage="No line items"
            />
          </Card>

          <Card title="Summary">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>£{totals.subtotal.toFixed(2)}</span>
              </div>
              {recurringInvoice.invoice_discount_percentage > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Invoice Discount ({recurringInvoice.invoice_discount_percentage}%):</span>
                  <span>-£{invoiceDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>VAT:</span>
                <span>£{totals.vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total:</span>
                <span>£{finalTotal.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          {(recurringInvoice.notes || recurringInvoice.internal_notes) && (
            <Card title="Notes">
              {recurringInvoice.notes && (
                <div className="mb-4">
                  <div className="text-sm text-gray-500 mb-1">Customer Notes</div>
                  <div className="text-gray-900 whitespace-pre-wrap">{recurringInvoice.notes}</div>
                </div>
              )}
              {recurringInvoice.internal_notes && (
                <div>
                  <div className="text-sm text-gray-500 mb-1">Internal Notes</div>
                  <div className="text-gray-900 whitespace-pre-wrap">{recurringInvoice.internal_notes}</div>
                </div>
              )}
            </Card>
          )}

          <Card>
            <div className="flex justify-end">
              <Button
                variant="danger"
                onClick={() => setShowDeleteDialog(true)}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Delete Template
              </Button>
            </div>
          </Card>
        </div>

        <ConfirmDialog
          open={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          onConfirm={handleDelete}
          title="Delete Recurring Invoice"
          message="Are you sure you want to delete this recurring invoice template? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          type="danger"
        />
      </PageContent>
    </PageWrapper>
  )
}
