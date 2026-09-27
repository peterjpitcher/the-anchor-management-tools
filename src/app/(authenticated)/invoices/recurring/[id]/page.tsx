'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getRecurringInvoice, deleteRecurringInvoice, toggleRecurringInvoiceStatus, generateInvoiceFromRecurring } from '@/app/actions/recurring-invoices'
import {
  PageLayout,
  Icon,
  Card,
  CardHeader,
  CardBody,
  Alert,
  Badge,
  DataTable,
  DescriptionList,
  ConfirmDialog,
  toast,
} from '@/ds'
import type { RecurringInvoiceWithDetails } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatDateInLondon } from '@/lib/dateUtils'
import { invoiceStatusLabel } from '@/lib/invoices/status-ui'
import { BACK_TO_RECURRING } from '../../_shared/nav'
import { recurringScheduleLabel, recurringScheduleTone } from '../../_shared/status-ui'
import { DetailHeaderActions, type DetailHeaderAction } from '../../_components/DetailHeaderActions'

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

  function getNextInvoiceDate(): string | null {
    if (!recurringInvoice || !recurringInvoice.is_active) return null

    if (recurringInvoice.end_date && recurringInvoice.next_invoice_date > recurringInvoice.end_date) {
      return null
    }

    return recurringInvoice.next_invoice_date
  }

  const layoutProps = {
    title: 'Recurring Invoice',
    subtitle: 'View recurring invoice template',
    backButton: BACK_TO_RECURRING,
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading recurring invoice" />
  }

  if (!canView) {
    return null
  }

  if (error || !recurringInvoice) {
    return <PageLayout {...layoutProps} error={error || 'Recurring invoice not found'} />
  }

  const nextInvoiceDate = getNextInvoiceDate()
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
  const lastInvoiceLabel = recurringInvoice.last_invoice
    ? `${recurringInvoice.last_invoice.invoice_number} (${invoiceStatusLabel(recurringInvoice.last_invoice.status)})`
    : null

  // Page-level actions in priority order: the first ones show, the rest go in the "More" menu
  // (DetailHeaderActions), with Generate Now, the next step, always last.
  const headerActions: DetailHeaderAction[] = [
    ...(canEdit
      ? [{ key: 'edit', label: 'Edit', icon: 'edit' as const, href: `/invoices/recurring/${recurringInvoice.id}/edit` }]
      : []),
    {
      key: 'delete',
      label: 'Delete',
      icon: 'trash',
      tone: 'danger',
      onSelect: () => setShowDeleteDialog(true),
      disabled: !canDelete,
      title: !canDelete ? 'You need invoice delete permission to remove recurring invoices.' : undefined,
    },
    ...(canEdit
      ? [{
        key: 'toggle',
        label: recurringInvoice.is_active ? 'Deactivate' : 'Activate',
        icon: recurringInvoice.is_active ? 'pause' as const : 'play' as const,
        onSelect: () => void handleToggleStatus(),
        disabled: actionLoading,
      }]
      : []),
    ...(canCreate
      ? [{
        key: 'generate',
        label: 'Generate Now',
        icon: 'fileText' as const,
        tone: 'primary' as const,
        onSelect: () => void handleGenerateNow(),
        disabled: !recurringInvoice.is_active || actionLoading,
        loading: actionLoading,
        title: !recurringInvoice.is_active ? 'Activate this template before generating.' : undefined,
      }]
      : []),
  ]

  return (
    <PageLayout {...layoutProps} headerActions={<DetailHeaderActions actions={headerActions} />}>
      {isReadOnly && (
        <Alert tone="info">
          You have read-only access to this recurring invoice. Management actions are disabled.
        </Alert>
      )}

      <Card>
        <CardHeader title="Template Information" />
        <CardBody>
          <DescriptionList
            items={[
              {
                key: 'status',
                label: 'Status',
                value: (
                  <Badge tone={recurringScheduleTone(recurringInvoice.is_active)} size="sm">
                    {recurringScheduleLabel(recurringInvoice.is_active)}
                  </Badge>
                ),
              },
              {
                key: 'vendor',
                label: 'Vendor',
                value: <span className="font-medium">{recurringInvoice.vendor?.name || 'Unknown'}</span>,
              },
              {
                key: 'frequency',
                label: 'Frequency',
                value: (
                  <span className="flex items-center gap-2">
                    <Icon name="calendar" size={16} className="text-text-subtle" />
                    <span className="capitalize">{recurringInvoice.frequency}</span>
                  </span>
                ),
              },
              {
                key: 'terms',
                label: 'Payment Terms',
                value: (
                  <span className="flex items-center gap-2">
                    <Icon name="clock" size={16} className="text-text-subtle" />
                    <span>{recurringInvoice.days_before_due} days</span>
                  </span>
                ),
              },
              { key: 'start', label: 'Start Date', value: formatDateInLondon(recurringInvoice.start_date) },
              {
                key: 'end',
                label: 'End Date',
                value: recurringInvoice.end_date ? formatDateInLondon(recurringInvoice.end_date) : 'Ongoing',
              },
              ...(recurringInvoice.reference
                ? [{ key: 'reference', label: 'Reference', value: recurringInvoice.reference }]
                : []),
              {
                key: 'next',
                label: 'Next Invoice Date',
                value: (
                  <span className="font-medium">
                    {nextInvoiceDate ? formatDateInLondon(nextInvoiceDate) : 'N/A'}
                  </span>
                ),
              },
              ...(recurringInvoice.last_invoice
                ? [{
                  key: 'last_generated',
                  label: 'Last Generated',
                  value: formatDateInLondon(recurringInvoice.last_invoice.invoice_date),
                }]
                : []),
              { key: 'last_invoice', label: 'Last Invoice', value: lastInvoiceLabel ?? 'None' },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Line Items" />
        <DataTable
          data={recurringInvoice.line_items || []}
          getRowKey={(item) => `${item.description}-${item.unit_price}-${item.quantity}-${item.vat_rate}-${item.discount_percentage}`}
          bordered={false}
          columns={[
            {
              key: 'description',
              header: 'Description',
              cell: (item: any) => (
                <span className="text-sm text-text">{item.description}</span>
              ),
            },
            {
              key: 'quantity',
              header: 'Qty',
              align: 'right',
              cell: (item: any) => (
                <span className="text-sm text-text">{item.quantity}</span>
              ),
            },
            {
              key: 'unit_price',
              header: 'Unit Price',
              align: 'right',
              cell: (item: any) => (
                <span className="text-sm text-text">£{item.unit_price.toFixed(2)}</span>
              ),
            },
            {
              key: 'discount_percentage',
              header: 'Discount',
              align: 'right',
              cell: (item: any) => (
                <span className="text-sm text-text">{item.discount_percentage > 0 ? `${item.discount_percentage}%` : '-'}</span>
              ),
            },
            {
              key: 'vat_rate',
              header: 'VAT',
              align: 'right',
              cell: (item: any) => (
                <span className="text-sm text-text">{item.vat_rate}%</span>
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
                return <span className="text-sm font-medium text-text">£{lineTotal.toFixed(2)}</span>
              },
            },
          ]}
          emptyMessage="No line items"
        />
      </Card>

      <Card>
        <CardHeader title="Summary" />
        <CardBody className="space-y-2">
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
          <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold">
            <span>Total:</span>
            <span>£{finalTotal.toFixed(2)}</span>
          </div>
        </CardBody>
      </Card>

      {(recurringInvoice.notes || recurringInvoice.internal_notes) && (
        <Card>
          <CardHeader title="Notes" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                ...(recurringInvoice.notes
                  ? [{
                    key: 'notes',
                    label: 'Customer Notes',
                    value: <span className="whitespace-pre-wrap">{recurringInvoice.notes}</span>,
                  }]
                  : []),
                ...(recurringInvoice.internal_notes
                  ? [{
                    key: 'internal_notes',
                    label: 'Internal Notes',
                    value: <span className="whitespace-pre-wrap">{recurringInvoice.internal_notes}</span>,
                  }]
                  : []),
              ]}
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Last Invoice Generated"
          subtitle="Track the latest invoice produced by this schedule"
        />
        <CardBody>
          <DescriptionList
            items={[
              {
                key: 'last_generated_invoice',
                label: 'Last generated invoice',
                value: <span className="text-base font-medium">{lastInvoiceLabel ?? 'Not yet generated'}</span>,
              },
              {
                key: 'generated_on',
                label: 'Generated on',
                value: (
                  <span className="text-base font-medium">
                    {recurringInvoice.last_invoice
                      ? new Date(recurringInvoice.last_invoice.invoice_date).toLocaleDateString('en-GB')
                      : 'Not yet generated'}
                  </span>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>

      <ConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Delete Recurring Invoice"
        message="Are you sure you want to delete this recurring invoice template? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
      />
    </PageLayout>
  )
}
