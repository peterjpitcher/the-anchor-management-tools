'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createCreditNote, getInvoice, updateInvoiceStatus, deleteInvoice } from '@/app/actions/invoices'
import {
  getOjInvoiceReissuePreview,
  reissueOjInvoice,
  type OjInvoiceReissuePreview,
} from '@/app/actions/oj-projects/invoice-reissue'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Button } from '@/ds'
import { Badge } from '@/ds'
import { Alert } from '@/ds'
import { DataTable } from '@/ds'
import { toast } from '@/ds'
import { ConfirmDialog } from '@/ds'
import { Modal } from '@/ds'
import { Input } from '@/ds'
import { Textarea } from '@/ds'
import { Download, Mail, Edit, Trash2, Copy, CheckCircle, XCircle, Clock, RefreshCw, FileMinus } from 'lucide-react'
import dynamic from 'next/dynamic'

const EmailInvoiceModal = dynamic(
  () => import('@/components/features/invoices/EmailInvoiceModal').then(mod => mod.EmailInvoiceModal),
  { ssr: false }
)
const ChasePaymentModal = dynamic(
  () => import('@/components/modals/ChasePaymentModal').then(mod => mod.ChasePaymentModal),
  { ssr: false }
)
import type { InvoiceWithDetails, InvoiceStatus, InvoiceLineItem, InvoiceLineItemInput } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
import { downloadInvoicePdf } from '@/lib/invoices/download-pdf'

interface InvoiceDetailClientProps {
  initialInvoice: InvoiceWithDetails
  emailConfigured: boolean
}

type EligibleOjInvoiceReissuePreview = Extract<OjInvoiceReissuePreview, { eligible: true }>
type ReissuePreviewEntry = EligibleOjInvoiceReissuePreview['includedEntries'][number]
type ReissuePreviewRecurring = EligibleOjInvoiceReissuePreview['includedRecurring'][number]

function formatMoney(value: number | null | undefined): string {
  return `£${Number(value || 0).toFixed(2)}`
}

function formatPreviewDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatStatus(value: string | null | undefined): string {
  return String(value || '').replace(/_/g, ' ')
}

function isOjInvoiceCandidate(invoice: InvoiceWithDetails): boolean {
  const haystack = [
    invoice.reference || '',
    invoice.notes || '',
    invoice.internal_notes || '',
  ].join('\n')
  return /OJ Projects\s+\d{4}-\d{2}/i.test(haystack) || /OJ Projects/i.test(haystack)
}

function canAttemptOjReissue(invoice: InvoiceWithDetails): boolean {
  if (!isOjInvoiceCandidate(invoice)) return false
  if (!['draft', 'sent', 'overdue', 'void'].includes(invoice.status)) return false
  if (Number(invoice.paid_amount || 0) > 0) return false
  if ((invoice.payments || []).length > 0) return false
  return true
}

function PreviewSection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {typeof count === 'number' && (
          <span className="text-xs font-medium text-gray-500">{count}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function EmptyPreviewMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
      {children}
    </div>
  )
}

function EntryPreviewTable({
  entries,
  showReason = false,
}: {
  entries: ReissuePreviewEntry[]
  showReason?: boolean
}) {
  if (entries.length === 0) {
    return <EmptyPreviewMessage>No entries</EmptyPreviewMessage>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-left font-semibold">Project</th>
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-left font-semibold">Type</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            {showReason && <th className="px-3 py-2 text-left font-semibold">Reason</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatPreviewDate(entry.entry_date)}</td>
              <td className="min-w-[180px] px-3 py-2">
                <div className="font-medium text-gray-900">{entry.project_name}</div>
                {entry.project_code && <div className="text-xs text-gray-500">{entry.project_code}</div>}
              </td>
              <td className="min-w-[220px] px-3 py-2 text-gray-700">{entry.description || '-'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-700">{entry.entry_type}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{entry.quantity_label}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-gray-900">{formatMoney(entry.amount_ex_vat)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                {formatStatus(entry.status)}
                {entry.invoice_number && <div className="text-xs text-gray-500">{entry.invoice_number}</div>}
              </td>
              {showReason && <td className="min-w-[180px] px-3 py-2 text-gray-700">{entry.reason || '-'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RecurringPreviewTable({
  items,
  showReason = false,
}: {
  items: ReissuePreviewRecurring[]
  showReason?: boolean
}) {
  if (items.length === 0) {
    return <EmptyPreviewMessage>No recurring charges</EmptyPreviewMessage>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-left font-semibold">Period</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
            <th className="px-3 py-2 text-right font-semibold">VAT</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            {showReason && <th className="px-3 py-2 text-left font-semibold">Reason</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="min-w-[220px] px-3 py-2 font-medium text-gray-900">
                {item.description}
                {item.is_virtual && <div className="text-xs text-gray-500">Will be created on reissue</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-700">{item.period_yyyymm}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-gray-900">{formatMoney(item.amount_ex_vat)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{item.vat_rate}%</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                {formatStatus(item.status)}
                {item.invoice_number && <div className="text-xs text-gray-500">{item.invoice_number}</div>}
              </td>
              {showReason && <td className="min-w-[180px] px-3 py-2 text-gray-700">{item.reason || '-'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LineItemsPreviewTable({ lineItems }: { lineItems: InvoiceLineItemInput[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Unit price</th>
            <th className="px-3 py-2 text-right font-semibold">VAT</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {lineItems.map((item, index) => (
            <tr key={`${item.description}-${index}`}>
              <td className="min-w-[260px] px-3 py-2 font-medium text-gray-900">{item.description}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{item.quantity}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{formatMoney(item.unit_price)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{item.vat_rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function InvoiceDetailClient({ 
  initialInvoice, 
  emailConfigured: initialEmailConfigured 
}: InvoiceDetailClientProps) {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  
  // We use client-side permissions for UI elements, but server validated the page access
  const canEdit = hasPermission('invoices', 'edit')
  const canDelete = hasPermission('invoices', 'delete')
  const canCreateCreditNote = hasPermission('invoices', 'create')
  
  const [invoice, setInvoice] = useState<InvoiceWithDetails>(initialInvoice)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [showChaseModal, setShowChaseModal] = useState(false)
  // We accept initial state but can also check again if needed, though passing from server is better
  const [emailConfigured] = useState(initialEmailConfigured) 
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showReissueModal, setShowReissueModal] = useState(false)
  const [reissuePreview, setReissuePreview] = useState<OjInvoiceReissuePreview | null>(null)
  const [reissueLoading, setReissueLoading] = useState(false)
  const [reissueSubmitting, setReissueSubmitting] = useState(false)
  const [showCreditNoteModal, setShowCreditNoteModal] = useState(false)
  const [creditNoteAmount, setCreditNoteAmount] = useState('')
  const [creditNoteReason, setCreditNoteReason] = useState('')
  const [creditNoteSubmitting, setCreditNoteSubmitting] = useState(false)
  
  const readOnly = !permissionsLoading && !canEdit && !canDelete

  const invoiceMath = useMemo(() => {
    if (!invoice || !invoice.line_items || invoice.line_items.length === 0) {
      return {
        totals: {
          subtotalBeforeInvoiceDiscount: 0,
          invoiceDiscountAmount: 0,
          vatAmount: 0,
          totalAmount: 0,
          lineBreakdown: [],
        },
        lineTotals: new Map<string, InvoiceTotalsResult['lineBreakdown'][number]>(),
      }
    }

    const calcInput = invoice.line_items.map((item) => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_percentage: item.discount_percentage,
      vat_rate: item.vat_rate,
    }))

    const totals = calculateInvoiceTotals(
      calcInput,
      invoice.invoice_discount_percentage || 0
    )

    const lineTotalsMap = new Map<string, InvoiceTotalsResult['lineBreakdown'][number]>()
    invoice.line_items.forEach((item, index) => {
      const breakdown = totals.lineBreakdown[index]
      if (breakdown) {
        lineTotalsMap.set(item.id, breakdown)
      }
    })

    return { totals, lineTotals: lineTotalsMap }
  }, [invoice])

  async function handleStatusChange(newStatus: InvoiceStatus) {
    if (!invoice || actionLoading) return
    if (!canEdit) {
      setError('You do not have permission to update invoices')
      return
    }

    if (newStatus === 'void') {
      const confirmed = window.confirm('Void this invoice?')
      if (!confirmed) return
    }

    setActionLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      formData.append('status', newStatus)

      let result: any = await updateInvoiceStatus(formData)

      if (newStatus === 'void' && result?.error && result?.code === 'OJ_LINKED_ITEMS') {
        const force = window.confirm(`${result.error}\n\nVoid and unbill linked OJ Projects items?`)
        if (!force) {
          throw new Error(result.error)
        }

        const forceFormData = new FormData()
        forceFormData.append('invoiceId', invoice.id)
        forceFormData.append('status', newStatus)
        forceFormData.append('force', 'true')
        result = await updateInvoiceStatus(forceFormData)
      }

      if (result.error) {
        throw new Error(result.error)
      }

      // Reload invoice
      const refreshResult = await getInvoice(invoice.id)
      if (refreshResult.invoice) {
        setInvoice(refreshResult.invoice)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete() {
    if (!invoice || actionLoading) return
    if (!canDelete) {
      toast.error('You do not have permission to delete invoices')
      return
    }

    setActionLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)

      const result = await deleteInvoice(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Invoice deleted successfully')
      router.push('/invoices')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete invoice')
      setActionLoading(false)
    }
  }

  async function handleOpenReissuePreview() {
    if (!invoice || reissueLoading || reissueSubmitting) return
    if (!canEdit) {
      toast.error('You do not have permission to reissue invoices')
      return
    }

    setShowReissueModal(true)
    setReissuePreview(null)
    setReissueLoading(true)

    try {
      const preview = await getOjInvoiceReissuePreview(invoice.id)
      setReissuePreview(preview)
      if (!preview.eligible) {
        toast.error(preview.error)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build OJ invoice reissue preview'
      setReissuePreview({ eligible: false, error: message })
      toast.error(message)
    } finally {
      setReissueLoading(false)
    }
  }

  async function handleSubmitReissue() {
    if (!invoice || !reissuePreview?.eligible || reissueSubmitting) return
    if (!canEdit) {
      toast.error('You do not have permission to reissue invoices')
      return
    }

    setReissueSubmitting(true)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      const result = await reissueOjInvoice(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      const prefix = result.mode === 'rebuild_draft' ? 'Draft' : 'Replacement draft'
      const verb = result.mode === 'rebuild_draft' ? 'rebuilt from' : 'created from'
      toast.success(`${prefix} ${result.invoice_number} ${verb} OJ Projects ${result.period_label}`)
      setShowReissueModal(false)
      setReissuePreview(null)

      if (result.invoice_id === invoice.id) {
        const refreshResult = await getInvoice(invoice.id)
        if (refreshResult.invoice) {
          setInvoice(refreshResult.invoice)
        }
        router.refresh()
      } else {
        router.push(`/invoices/${result.invoice_id}`)
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reissue OJ invoice')
    } finally {
      setReissueSubmitting(false)
    }
  }

  async function handleDownloadPdf() {
    if (!invoice || actionLoading) return

    setActionLoading(true)
    setError(null)

    try {
      await downloadInvoicePdf({
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download invoice PDF')
    } finally {
      setActionLoading(false)
    }
  }

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

  function getStatusIcon(status: InvoiceStatus) {
    switch (status) {
      case 'paid': return <CheckCircle className="h-4 w-4" />
      case 'overdue': return <XCircle className="h-4 w-4" />
      case 'partially_paid': return <Clock className="h-4 w-4" />
      default: return null
    }
  }

  const { totals: invoiceTotals, lineTotals } = invoiceMath
  const showOjReissueAction = canEdit && canAttemptOjReissue(invoice)
  const invoiceVatRate = Number(invoice.subtotal_amount || 0) > 0
    ? Math.round((Number(invoice.vat_amount || 0) / Number(invoice.subtotal_amount || 0)) * 100 * 100) / 100
    : 20
  const maxCreditNoteExVat = Number(invoice.total_amount || 0) > 0
    ? Math.max(0, Math.min(
      Number(invoice.subtotal_amount || 0),
      Number(invoice.paid_amount || 0) / (1 + invoiceVatRate / 100)
    ))
    : 0
  const parsedCreditNoteAmount = Number.parseFloat(creditNoteAmount)
  const creditNoteAmountValid =
    Number.isFinite(parsedCreditNoteAmount) &&
    parsedCreditNoteAmount > 0 &&
    parsedCreditNoteAmount <= maxCreditNoteExVat
  const estimatedCreditNoteIncVat = creditNoteAmountValid
    ? Math.round(parsedCreditNoteAmount * (1 + invoiceVatRate / 100) * 100) / 100
    : 0
  const canSubmitCreditNote =
    creditNoteAmountValid &&
    creditNoteReason.trim().length > 0 &&
    !creditNoteSubmitting
  const canShowCreditNoteAction =
    canCreateCreditNote &&
    maxCreditNoteExVat > 0 &&
    (invoice.status === 'paid' || invoice.status === 'partially_paid' || Number(invoice.paid_amount || 0) > 0) &&
    invoice.status !== 'void' &&
    invoice.status !== 'written_off'

  function openCreditNoteModal() {
    setCreditNoteAmount(maxCreditNoteExVat.toFixed(2))
    setCreditNoteReason('')
    setShowCreditNoteModal(true)
  }

  async function handleCreateCreditNote() {
    if (!invoice || !canSubmitCreditNote) return

    setCreditNoteSubmitting(true)
    try {
      const result = await createCreditNote(invoice.id, parsedCreditNoteAmount, creditNoteReason.trim())
      if (result.error) {
        throw new Error(result.error)
      }

      toast.success(
        result.creditNote
          ? `Credit note ${result.creditNote.credit_note_number} issued for ${formatMoney(result.creditNote.amount_inc_vat)}`
          : 'Credit note issued'
      )
      setShowCreditNoteModal(false)

      const refreshResult = await getInvoice(invoice.id)
      if (refreshResult.invoice) {
        setInvoice(refreshResult.invoice)
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to issue credit note')
    } finally {
      setCreditNoteSubmitting(false)
    }
  }

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {showOjReissueAction && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleOpenReissuePreview()}
          disabled={actionLoading || reissueLoading || reissueSubmitting}
          loading={reissueLoading}
          leftIcon={<RefreshCw className="h-4 w-4" />}
        >
          Reissue OJ Invoice
        </Button>
      )}

      {canShowCreditNoteAction && (
        <Button
          variant="secondary"
          size="sm"
          onClick={openCreditNoteModal}
          disabled={actionLoading || creditNoteSubmitting}
          leftIcon={<FileMinus className="h-4 w-4" />}
        >
          Issue Credit Note
        </Button>
      )}

      {invoice.status === 'draft' && canEdit && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleStatusChange('sent')}
          disabled={actionLoading}
          leftIcon={<Mail className="h-4 w-4" />}
        >
          Mark as Sent
        </Button>
      )}

      {invoice.status === 'draft' && canEdit && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.push(`/invoices/${invoice.id}/edit`)}
          leftIcon={<Edit className="h-4 w-4" />}
        >
          Edit
        </Button>
      )}

      {(invoice.status === 'sent' || invoice.status === 'overdue' || invoice.status === 'partially_paid') && canEdit && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleStatusChange('paid')}
          disabled={actionLoading}
          leftIcon={<CheckCircle className="h-4 w-4" />}
        >
          Mark as Paid
        </Button>
      )}

      {emailConfigured && canEdit && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowEmailModal(true)}
          disabled={actionLoading}
          leftIcon={<Mail className="h-4 w-4" />}
        >
          Email
        </Button>
      )}

      {emailConfigured && canEdit && (invoice.status === 'overdue' || (invoice.status === 'sent' && new Date(invoice.due_date) < new Date())) && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowChaseModal(true)}
          disabled={actionLoading}
          leftIcon={<Clock className="h-4 w-4" />}
        >
          Chase
        </Button>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={() => void handleDownloadPdf()}
        disabled={actionLoading}
        leftIcon={<Download className="h-4 w-4" />}
      >
        PDF
      </Button>

      {invoice.status === 'draft' && canDelete && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={actionLoading}
          leftIcon={<Trash2 className="h-4 w-4" />}
        >
          Delete
        </Button>
      )}
    </div>
  )

  return (
    <PageLayout
      title={`Invoice ${invoice.invoice_number}`}
      subtitle={invoice.vendor?.name}
      backButton={{
        label: 'Back to Invoices',
        href: '/invoices',
      }}
      headerActions={headerActions}
    >
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Badge variant={getStatusBadgeVariant(invoice.status)} icon={getStatusIcon(invoice.status)}>
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
          </Badge>
          {invoice.reference && (
            <span className="text-sm sm:text-base text-gray-600">
              Reference: {invoice.reference}
            </span>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="error" description={error} className="mb-6" />
      )}
      {!error && readOnly && (
        <Alert
          variant="info"
          description="You have read-only access to invoices. Edit, delete, and payment actions are disabled for your role."
          className="mb-6"
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Invoice Details</h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <h3 className="font-medium text-sm text-gray-600 mb-1">From</h3>
                <p className="font-medium">Orange Jelly Limited</p>
                <p className="text-sm text-gray-600">The Anchor, Horton Road</p>
                <p className="text-sm text-gray-600">Stanwell Moor Village, Surrey</p>
                <p className="text-sm text-gray-600">TW19 6AQ</p>
                <p className="text-sm text-gray-600">VAT: GB315203647</p>
              </div>

              <div>
                <h3 className="font-medium text-sm text-gray-600 mb-1">To</h3>
                {invoice.vendor ? (
                  <>
                    <p className="font-medium">{invoice.vendor.name}</p>
                    {invoice.vendor.contact_name && (
                      <p className="text-sm text-gray-600">{invoice.vendor.contact_name}</p>
                    )}
                    {invoice.vendor.email && (
                      <p className="text-sm text-gray-600">{invoice.vendor.email}</p>
                    )}
                    {invoice.vendor.phone && (
                      <p className="text-sm text-gray-600">{invoice.vendor.phone}</p>
                    )}
                    {invoice.vendor.address && (
                      <p className="text-sm text-gray-600 whitespace-pre-line">{invoice.vendor.address}</p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500">No vendor details</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-6 border-t">
              <div>
                <p className="text-sm text-gray-600">Invoice Date</p>
                <p className="font-medium">
                  {new Date(invoice.invoice_date).toLocaleDateString('en-GB')}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Due Date</p>
                <p className="font-medium">
                  {new Date(invoice.due_date).toLocaleDateString('en-GB')}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Line Items</h2>
            <DataTable<InvoiceLineItem>
              data={invoice.line_items || []}
              getRowKey={(it) => it.id}
              columns={[
                { key: 'description', header: 'Description', cell: (it) => <span className="text-sm">{it.description}</span> },
                { key: 'quantity', header: 'Qty', align: 'right', cell: (it) => <span className="text-sm">{it.quantity}</span> },
                { key: 'unit_price', header: 'Unit Price', align: 'right', cell: (it) => <span className="text-sm">£{it.unit_price.toFixed(2)}</span> },
                { key: 'discount', header: 'Discount', align: 'right', cell: (it) => <span className="text-sm text-green-600">{it.discount_percentage > 0 ? `-${it.discount_percentage}%` : ''}</span> },
                { key: 'vat', header: 'VAT', align: 'right', cell: (it) => <span className="text-sm">{it.vat_rate}%</span> },
                { key: 'total', header: 'Total', align: 'right', cell: (it) => {
                  const breakdown = lineTotals.get(it.id)
                  const total = breakdown ? breakdown.total : 0
                  return <span className="text-sm font-medium">£{total.toFixed(2)}</span>
                } },
              ]}
              emptyMessage="No line items"
              renderMobileCard={(it) => {
                const breakdown = lineTotals.get(it.id)
                const lineTotal = breakdown ? breakdown.total : 0
                return (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <div className="font-medium text-sm mb-3">{it.description}</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-gray-600">Quantity:</span><span>{it.quantity}</span></div>
                      <div className="flex justify-between"><span className="text-gray-600">Unit Price:</span><span>£{it.unit_price.toFixed(2)}</span></div>
                      {it.discount_percentage > 0 && (
                        <div className="flex justify-between"><span className="text-gray-600">Discount:</span><span className="text-green-600">-{it.discount_percentage}%</span></div>
                      )}
                      <div className="flex justify-between"><span className="text-gray-600">VAT:</span><span>{it.vat_rate}%</span></div>
                    </div>
                    <div className="mt-3 pt-3 border-t flex justify-between font-medium">
                      <span>Total:</span>
                      <span>£{lineTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )
              }}
            />

            <div className="mt-6 pt-6 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>£{invoiceTotals.subtotalBeforeInvoiceDiscount.toFixed(2)}</span>
              </div>
              {invoiceTotals.invoiceDiscountAmount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Invoice Discount ({invoice.invoice_discount_percentage}%):</span>
                  <span>-£{invoiceTotals.invoiceDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span>VAT:</span>
                <span>£{invoiceTotals.vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                <span>Total:</span>
                <span>£{invoiceTotals.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          {(invoice.notes || invoice.internal_notes) && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Notes</h2>
              
              {invoice.notes && (
                <div className="mb-4">
                  <h3 className="font-medium text-sm text-gray-600 mb-1">Invoice Notes</h3>
                  <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
              
              {invoice.internal_notes && (
                <div>
                  <h3 className="font-medium text-sm text-gray-600 mb-1">Internal Notes</h3>
                  <p className="text-sm whitespace-pre-wrap bg-yellow-50 p-3 rounded-md">
                    {invoice.internal_notes}
                  </p>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:space-y-6">
          <Card className="p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-4">Payment Status</h2>
            
            <div className="space-y-3 sm:space-y-4">
              <div>
                <p className="text-sm text-gray-600">Total Amount</p>
                <p className="text-xl sm:text-2xl font-bold">£{invoice.total_amount.toFixed(2)}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-600">Paid Amount</p>
                <p className="text-lg sm:text-xl font-semibold text-green-600">£{invoice.paid_amount.toFixed(2)}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-600">Outstanding</p>
                <p className="text-lg sm:text-xl font-semibold text-red-600">
                  £{(invoice.total_amount - invoice.paid_amount).toFixed(2)}
                </p>
              </div>

              {invoice.status !== 'paid' && invoice.status !== 'void' && (
                <Button
                  fullWidth
                  onClick={() => router.push(`/invoices/${invoice.id}/payment`)}
                  disabled={!canEdit}
                  title={
                    !canEdit
                      ? 'You need invoice edit permission to record payments.'
                      : undefined
                  }
                >
                  Record Payment
                </Button>
              )}
            </div>
          </Card>

          {invoice.payments && invoice.payments.length > 0 && (
            <Card className="p-4 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold mb-4">Payment History</h2>
              
              <div className="space-y-3">
                {invoice.payments.map((payment) => (
                  <div key={payment.id} className="border-b pb-3 last:border-b-0">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                      <div className="flex-1">
                        <p className="font-medium">£{payment.amount.toFixed(2)}</p>
                        <p className="text-sm text-gray-600">
                          {new Date(payment.payment_date).toLocaleDateString('en-GB')}
                        </p>
                        {payment.reference && (
                          <p className="text-sm text-gray-500 truncate">{payment.reference}</p>
                        )}
                      </div>
                      <span className="text-sm text-gray-500 self-start sm:self-auto">{payment.payment_method}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-4">Actions</h2>
            
            <div className="space-y-2">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  toast.success('Link copied to clipboard!')
                }}
                leftIcon={<Copy className="h-4 w-4" />}
              >
                Copy Link
              </Button>

              {showOjReissueAction && (
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => void handleOpenReissuePreview()}
                  disabled={actionLoading || reissueLoading || reissueSubmitting}
                  loading={reissueLoading}
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                >
                  Reissue OJ Invoice
                </Button>
              )}

              {canShowCreditNoteAction && (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={openCreditNoteModal}
                  disabled={actionLoading || creditNoteSubmitting}
                  leftIcon={<FileMinus className="h-4 w-4" />}
                >
                  Issue Credit Note
                </Button>
              )}
              
              {invoice.status !== 'void' && invoice.status !== 'written_off' && canEdit && (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => handleStatusChange('void')}
                  disabled={actionLoading}
                  loading={actionLoading}
                >
                  Void Invoice
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={showReissueModal}
        onClose={() => {
          if (!reissueSubmitting) {
            setShowReissueModal(false)
          }
        }}
        title="Reissue OJ Invoice"
        width="xl"
        footer={(
          <>
            <Button
              variant="secondary"
              onClick={() => setShowReissueModal(false)}
              disabled={reissueSubmitting}
            >
              Cancel
            </Button>
            {reissuePreview?.eligible && (
              <Button
                variant="primary"
                onClick={() => void handleSubmitReissue()}
                loading={reissueSubmitting}
                disabled={reissueLoading}
              >
                {reissuePreview.actionLabel}
              </Button>
            )}
          </>
        )}
      >
        {reissueLoading && (
          <div className="py-8 text-center text-sm text-gray-600">
            Building OJ invoice reissue preview...
          </div>
        )}

        {!reissueLoading && reissuePreview && !reissuePreview.eligible && (
          <div className="space-y-4">
            <Alert variant="error" description={reissuePreview.error} />
            {reissuePreview.warnings && reissuePreview.warnings.length > 0 && (
              <Alert variant="warning">
                <ul className="list-disc space-y-1 pl-4">
                  {reissuePreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}

        {!reissueLoading && reissuePreview?.eligible && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold uppercase text-gray-500">Source</div>
                <div className="mt-1 font-medium text-gray-900">{reissuePreview.sourceInvoice.invoice_number}</div>
                <div className="text-xs text-gray-600">{formatStatus(reissuePreview.sourceInvoice.status)}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold uppercase text-gray-500">Client</div>
                <div className="mt-1 font-medium text-gray-900">{reissuePreview.sourceInvoice.vendor_name || 'Unknown client'}</div>
                <div className="text-xs text-gray-600">{reissuePreview.period.label}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold uppercase text-gray-500">Paid</div>
                <div className="mt-1 font-medium text-gray-900">{formatMoney(reissuePreview.sourceInvoice.paid_amount)}</div>
                <div className="text-xs text-gray-600">No email will be sent</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold uppercase text-gray-500">Rebuilt Total</div>
                <div className="mt-1 font-medium text-gray-900">{formatMoney(reissuePreview.totals.totalAmount)}</div>
                <div className="text-xs text-gray-600">{reissuePreview.actionLabel}</div>
              </div>
            </div>

            {reissuePreview.warnings.length > 0 && (
              <Alert variant="warning">
                <ul className="list-disc space-y-1 pl-4">
                  {reissuePreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <Alert variant="info" description="Review this preview, then create the draft. The client is not emailed until you send the resulting draft invoice." />

            <PreviewSection title="Included Month Entries" count={reissuePreview.includedEntries.length}>
              <EntryPreviewTable entries={reissuePreview.includedEntries} />
            </PreviewSection>

            <PreviewSection title="Included Active Recurring Charges" count={reissuePreview.includedRecurring.length}>
              <RecurringPreviewTable items={reissuePreview.includedRecurring} />
            </PreviewSection>

            <PreviewSection
              title="Excluded Entries"
              count={reissuePreview.excludedEntries.length}
            >
              <EntryPreviewTable entries={reissuePreview.excludedEntries} showReason />
            </PreviewSection>

            <PreviewSection
              title="Excluded Recurring Charges"
              count={reissuePreview.excludedRecurring.length}
            >
              <RecurringPreviewTable items={reissuePreview.excludedRecurring} showReason />
            </PreviewSection>

            <PreviewSection title="Replacement Line Items" count={reissuePreview.lineItems.length}>
              <LineItemsPreviewTable lineItems={reissuePreview.lineItems} />
              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatMoney(reissuePreview.totals.subtotalBeforeInvoiceDiscount)}</span>
                </div>
                {reissuePreview.totals.invoiceDiscountAmount > 0 && (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Invoice discount</span>
                    <span className="font-medium">-{formatMoney(reissuePreview.totals.invoiceDiscountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">VAT</span>
                  <span className="font-medium">{formatMoney(reissuePreview.totals.vatAmount)}</span>
                </div>
                <div className="mt-2 flex justify-between gap-4 border-t border-gray-200 pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(reissuePreview.totals.totalAmount)}</span>
                </div>
              </div>
            </PreviewSection>
          </div>
        )}
      </Modal>

      <Modal
        open={showCreditNoteModal}
        onClose={() => {
          if (!creditNoteSubmitting) {
            setShowCreditNoteModal(false)
          }
        }}
        title="Issue Credit Note"
        footer={(
          <>
            <Button
              variant="secondary"
              onClick={() => setShowCreditNoteModal(false)}
              disabled={creditNoteSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleCreateCreditNote()}
              loading={creditNoteSubmitting}
              disabled={!canSubmitCreditNote}
            >
              Issue Credit Note
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Alert
            variant="info"
            description="Use a credit note to record a refund or adjustment against a paid invoice."
          />

          <div className="rounded-lg border border-border bg-surface-2 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-text-muted">Paid amount</span>
              <span className="font-medium text-text-strong">{formatMoney(invoice.paid_amount)}</span>
            </div>
            <div className="mt-2 flex justify-between gap-4">
              <span className="text-text-muted">Maximum credit ex VAT</span>
              <span className="font-medium text-text-strong">{formatMoney(maxCreditNoteExVat)}</span>
            </div>
            <div className="mt-2 flex justify-between gap-4">
              <span className="text-text-muted">Invoice VAT rate</span>
              <span className="font-medium text-text-strong">{invoiceVatRate}%</span>
            </div>
          </div>

          <div>
            <label htmlFor="credit-note-amount" className="mb-1 block text-sm font-medium text-text">
              Amount ex VAT
            </label>
            <Input
              id="credit-note-amount"
              type="number"
              min="0.01"
              max={maxCreditNoteExVat.toFixed(2)}
              step="0.01"
              value={creditNoteAmount}
              onChange={(event) => setCreditNoteAmount(event.target.value)}
            />
            {creditNoteAmount && !creditNoteAmountValid && (
              <p className="mt-1 text-xs text-danger">
                Enter an amount between £0.01 and {formatMoney(maxCreditNoteExVat)}.
              </p>
            )}
            {creditNoteAmountValid && (
              <p className="mt-1 text-xs text-text-muted">
                Estimated credit including VAT: {formatMoney(estimatedCreditNoteIncVat)}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="credit-note-reason" className="mb-1 block text-sm font-medium text-text">
              Reason
            </label>
            <Textarea
              id="credit-note-reason"
              value={creditNoteReason}
              onChange={(event) => setCreditNoteReason(event.target.value)}
              placeholder="Refund, discount, service adjustment..."
              rows={3}
            />
          </div>
        </div>
      </Modal>

      {invoice && canEdit && (
        <>
          <EmailInvoiceModal
            invoice={invoice}
            isOpen={showEmailModal}
            onClose={() => setShowEmailModal(false)}
            onSuccess={async () => {
              const result = await getInvoice(invoice.id)
              if (result.invoice) {
                setInvoice(result.invoice)
              }
            }}
          />
          <ChasePaymentModal
            invoice={invoice}
            isOpen={showChaseModal}
            onClose={() => setShowChaseModal(false)}
            onSuccess={async () => {
              const result = await getInvoice(invoice.id)
              if (result.invoice) {
                setInvoice(result.invoice)
              }
            }}
          />
        </>
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Invoice"
        message="Are you sure you want to delete this invoice? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="danger"
      />
    </PageLayout>
  )
}
