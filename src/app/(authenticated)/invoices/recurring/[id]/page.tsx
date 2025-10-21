'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getRecurringInvoice, deleteRecurringInvoice, toggleRecurringInvoiceStatus, generateInvoiceFromRecurring } from '@/app/actions/recurring-invoices'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Edit2, Trash2, Play, Pause, FileText, Calendar, Clock } from 'lucide-react'
import { toLocalIsoDate } from '@/lib/dateUtils'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import type { RecurringInvoiceWithDetails } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'

type GenerateInvoiceActionResult = Awaited<ReturnType<typeof generateInvoiceFromRecurring>>

export default function RecurringInvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const rawId = params?.id
  const recurringInvoiceId = Array.isArray(rawId) ? rawId[0] : rawId ?? null
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('invoices', 'view')
  const canCreate = hasPermission('invoices', 'create')
  const canEdit = hasPermission('invoices', 'edit')
  const canDelete = hasPermission('invoices', 'delete')
  const isReadOnly = canView && !canCreate && !canEdit && !canDelete

  const [recurringInvoice, setRecurringInvoice] = useState<RecurringInvoiceWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (!recurringInvoiceId) {
      setError('Recurring invoice not found')
      setLoading(false)
      return
    }

    if (permissionsLoading) {
      return
    }

    if (!canView) {
      router.replace('/unauthorized')
      return
    }

    loadRecurringInvoice(recurringInvoiceId)
  }, [recurringInvoiceId, permissionsLoading, canView, router])

  async function loadRecurringInvoice(targetId: string | null = recurringInvoiceId) {
    if (!targetId) {
      setError('Recurring invoice not found')
      setLoading(false)
      return
    }

    if (!canView) {
      return
    }

    setLoading(true)

    try {
      const result = await getRecurringInvoice(targetId)

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
    if (!canEdit) {
      toast.error('You do not have permission to update recurring invoices')
      return
    }

    setActionLoading(true)
    try {
      if (!recurringInvoiceId) {
        throw new Error('Recurring invoice not found')
      }

      const formData = new FormData()
      formData.append('id', recurringInvoiceId)
      formData.append('current_status', recurringInvoice.is_active.toString())
      const result = await toggleRecurringInvoiceStatus(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      await loadRecurringInvoice(recurringInvoiceId)
      toast.success(`Recurring invoice ${recurringInvoice.is_active ? 'deactivated' : 'activated'} successfully`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle status')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGenerateNow() {
    if (!canCreate) {
      toast.error('You do not have permission to generate invoices')
      return
    }

    setActionLoading(true)
    try {
      if (!recurringInvoiceId) {
        throw new Error('Recurring invoice not found')
      }

      const result = await generateInvoiceFromRecurring(recurringInvoiceId) as GenerateInvoiceActionResult

      if ('error' in result && result.error) {
        throw new Error(result.error)
      }

      if (!('success' in result) || !result.success || !('invoice' in result) || !result.invoice) {
        throw new Error('Failed to generate invoice')
      }

      toast.success('Invoice generated successfully')
      router.push(`/invoices/${result.invoice.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate invoice')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete() {
    if (!canDelete) {
      toast.error('You do not have permission to delete recurring invoices')
      return
    }

    setActionLoading(true)
    try {
      if (!recurringInvoiceId) {
        throw new Error('Recurring invoice not found')
      }

      const formData = new FormData()
      formData.append('id', recurringInvoiceId)
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
      return toLocalIsoDate(startDate)
    }

    const lastGenerated = recurringInvoice.last_invoice?.invoice_date
      ? new Date(recurringInvoice.last_invoice.invoice_date)
      : new Date(startDate.getTime() - 1)

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
      default:
        nextDate.setMonth(nextDate.getMonth() + 1)
    }

    if (recurringInvoice.end_date) {
      const endDate = new Date(recurringInvoice.end_date)
      if (nextDate > endDate) return null
    }

    return toLocalIsoDate(nextDate)
  }

  if (permissionsLoading || loading) {
    return (
      <PageLayout
        title="Recurring Invoice"
        subtitle="View recurring invoice template"
        backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
        loading
        loadingLabel="Loading recurring invoice..."
      />
    )
  }

  if (!canView) {
    return null
  }

  if (error || !recurringInvoice) {
    return (
      <PageLayout
        title="Recurring Invoice"
        subtitle="View recurring invoice template"
        backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
        error={error || 'Recurring invoice not found'}
      />
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

  const invoiceDiscountAmount = totals.subtotal * (recurringInvoice.invoice_discount_percentage / 100)
  const finalSubtotal = totals.subtotal - invoiceDiscountAmount
  const finalTotal = finalSubtotal + totals.vat

  const navActions = (
    <NavGroup>
      <NavLink
        href={`/invoices/recurring/${recurringInvoice.id}/edit`}
        disabled={!canEdit}
        title={!canEdit ? 'You need invoice edit permission to update recurring invoices.' : undefined}
      >
        <Edit2 className="h-4 w-4" />
        Edit
      </NavLink>
      <NavLink
        onClick={actionLoading || !canEdit ? undefined : handleToggleStatus}
        disabled={actionLoading || !canEdit}
        title={!canEdit ? 'You need invoice edit permission to change status.' : undefined}
        className={recurringInvoice.is_active ? 'text-amber-200' : 'text-green-200'}
      >
        {recurringInvoice.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {recurringInvoice.is_active ? 'Deactivate' : 'Activate'}
      </NavLink>
      <NavLink
        onClick={!recurringInvoice.is_active || actionLoading || !canCreate ? undefined : handleGenerateNow}
        disabled={!recurringInvoice.is_active || actionLoading || !canCreate}
        title={
          !canCreate
            ? 'You need invoice create permission to generate invoices.'
            : !recurringInvoice.is_active
              ? 'Activate this template before generating.'
              : undefined
        }
        className="font-semibold"
      >
        <FileText className="h-4 w-4" />
        {actionLoading ? 'Generating...' : 'Generate Now'}
      </NavLink>
    </NavGroup>
  )

  return (
    <PageLayout
      title="Recurring Invoice Details"
      subtitle={`Template for ${recurringInvoice.vendor?.name || 'Unknown Vendor'}`}
      backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
      navActions={navActions}
    >
      {isReadOnly && (
        <Alert
          variant="info"
          description="You have read-only access to this recurring invoice. Management actions are disabled."
          className="mb-6"
        />
      )}

      <div className="space-y-6">
        <Card title="Template Information">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="text-sm text-gray-500">Status</div>
              <div className="mt-1">
                <Badge variant={recurringInvoice.is_active ? 'success' : 'default'} size="sm">
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
                  return <span className="text-sm font-medium text-gray-900">£{lineTotal.toFixed(2)}</span>
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
            <div className="flex justify-between border-t pt-2 text-lg font-semibold">
              <span>Total:</span>
              <span>£{finalTotal.toFixed(2)}</span>
            </div>
          </div>
        </Card>

        {(recurringInvoice.notes || recurringInvoice.internal_notes) && (
          <Card title="Notes">
            {recurringInvoice.notes && (
              <div className="mb-4">
                <div className="mb-1 text-sm text-gray-500">Customer Notes</div>
                <div className="whitespace-pre-wrap text-gray-900">{recurringInvoice.notes}</div>
              </div>
            )}
            {recurringInvoice.internal_notes && (
              <div>
                <div className="mb-1 text-sm text-gray-500">Internal Notes</div>
                <div className="whitespace-pre-wrap text-gray-900">{recurringInvoice.internal_notes}</div>
              </div>
            )}
          </Card>
        )}

        <Card title="Last invoice generated">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500">Track the latest invoice produced by this schedule.</p>
            <Button
              variant="secondary"
              onClick={() => router.push(`/invoices/recurring/${recurringInvoice.id}/edit`)}
              leftIcon={<Edit2 className="h-4 w-4" />}
              disabled={!canEdit}
            >
              Edit schedule
            </Button>
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-500">Last generated invoice</dt>
              <dd className="text-base font-medium text-gray-900">
                {recurringInvoice.last_invoice
                  ? `${recurringInvoice.last_invoice.invoice_number} (${recurringInvoice.last_invoice.status})`
                  : 'Not yet generated'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Generated on</dt>
              <dd className="text-base font-medium text-gray-900">
                {recurringInvoice.last_invoice
                  ? new Date(recurringInvoice.last_invoice.invoice_date).toLocaleDateString('en-GB')
                  : 'Not yet generated'}
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <div className="flex justify-end">
            <Button
              variant="danger"
              onClick={() => setShowDeleteDialog(true)}
              leftIcon={<Trash2 className="h-4 w-4" />}
              disabled={!canDelete}
              title={!canDelete ? 'You need invoice delete permission to remove recurring invoices.' : undefined}
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
    </PageLayout>
  )
}
