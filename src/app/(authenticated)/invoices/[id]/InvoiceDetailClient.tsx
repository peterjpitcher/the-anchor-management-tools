'use client'

import { invoiceBalanceDue } from '@/lib/invoices/balance'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createCreditNote, getInvoice, updateInvoiceStatus, deleteInvoice, updateInvoiceDueDate } from '@/app/actions/invoices'
import {
  getOjInvoiceReissuePreview,
  reissueOjInvoice,
  type OjInvoiceReissuePreview,
} from '@/app/actions/oj-projects/invoice-reissue'
import {
  getInvoicePortalLink,
  sendInvoicePaymentLink,
} from '@/app/actions/invoicePayPalActions'
import {
  PageLayout,
  PageLoading,
  Icon,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Button,
  Badge,
  Alert,
  DataTable,
  DescriptionList,
  Empty,
  StatGrid,
  Stat,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  toast,
  ConfirmDialog,
  Modal,
  Input,
  Textarea,
} from '@/ds'
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
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoices/status-ui'
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils'
import { BACK_TO_INVOICES, invoicePageTitle } from '../_shared/nav'
import { DetailHeaderActions, type DetailHeaderAction } from '../_components/DetailHeaderActions'
import { ReminderHoldControl } from './_components/ReminderHoldControl'
import { InvoiceEmailsPanel } from './_components/InvoiceEmailsPanel'

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
    <Card>
      <CardHeader
        title={title}
        action={typeof count === 'number' ? <Badge tone="neutral">{count}</Badge> : undefined}
      />
      {children}
    </Card>
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
    return <Empty size="sm" title="No entries" />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Type</TableHead>
          <TableHead align="right">Qty</TableHead>
          <TableHead align="right">Amount</TableHead>
          <TableHead>Status</TableHead>
          {showReason && <TableHead>Reason</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{formatPreviewDate(entry.entry_date)}</TableCell>
            <TableCell className="min-w-[180px] whitespace-normal">
              <div className="font-medium">{entry.project_name}</div>
              {entry.project_code && <div className="text-xs text-text-muted">{entry.project_code}</div>}
            </TableCell>
            <TableCell className="min-w-[220px] whitespace-normal">{entry.description || '-'}</TableCell>
            <TableCell>{entry.entry_type}</TableCell>
            <TableCell align="right">{entry.quantity_label}</TableCell>
            <TableCell align="right" className="font-medium">{formatMoney(entry.amount_ex_vat)}</TableCell>
            <TableCell>
              {formatStatus(entry.status)}
              {entry.invoice_number && <div className="text-xs text-text-muted">{entry.invoice_number}</div>}
            </TableCell>
            {showReason && <TableCell className="min-w-[180px] whitespace-normal">{entry.reason || '-'}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    return <Empty size="sm" title="No recurring charges" />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Description</TableHead>
          <TableHead>Period</TableHead>
          <TableHead align="right">Amount</TableHead>
          <TableHead align="right">VAT</TableHead>
          <TableHead>Status</TableHead>
          {showReason && <TableHead>Reason</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="min-w-[220px] whitespace-normal font-medium">
              {item.description}
              {item.is_virtual && <div className="text-xs font-normal text-text-muted">Will be created on reissue</div>}
            </TableCell>
            <TableCell>{item.period_yyyymm}</TableCell>
            <TableCell align="right" className="font-medium">{formatMoney(item.amount_ex_vat)}</TableCell>
            <TableCell align="right">{item.vat_rate}%</TableCell>
            <TableCell>
              {formatStatus(item.status)}
              {item.invoice_number && <div className="text-xs text-text-muted">{item.invoice_number}</div>}
            </TableCell>
            {showReason && <TableCell className="min-w-[180px] whitespace-normal">{item.reason || '-'}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function LineItemsPreviewTable({ lineItems }: { lineItems: InvoiceLineItemInput[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Description</TableHead>
          <TableHead align="right">Qty</TableHead>
          <TableHead align="right">Unit price</TableHead>
          <TableHead align="right">VAT</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lineItems.map((item, index) => (
          <TableRow key={`${item.description}-${index}`}>
            <TableCell className="min-w-[260px] whitespace-normal font-medium">{item.description}</TableCell>
            <TableCell align="right">{item.quantity}</TableCell>
            <TableCell align="right">{formatMoney(item.unit_price)}</TableCell>
            <TableCell align="right">{item.vat_rate}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
  const [showDueDateModal, setShowDueDateModal] = useState(false)
  const [newDueDate, setNewDueDate] = useState('')
  const [dueDateReason, setDueDateReason] = useState('')
  const [savingDueDate, setSavingDueDate] = useState(false)
  const [copyingPayLink, setCopyingPayLink] = useState(false)
  const [sendingPayLink, setSendingPayLink] = useState(false)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)
  // Set when voiding was refused because the invoice has linked OJ Projects items: the second
  // confirm step, which voids anyway and unbills them.
  const [forceVoidMessage, setForceVoidMessage] = useState<string | null>(null)
  const forceVoidConfirmedRef = useRef(false)
  
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

  function requestStatusChange(newStatus: InvoiceStatus) {
    if (newStatus === 'void') {
      if (!canEdit) {
        setError('You do not have permission to update invoices')
        return
      }
      setShowVoidConfirm(true)
      return
    }
    void handleStatusChange(newStatus)
  }

  async function handleStatusChange(newStatus: InvoiceStatus, options: { force?: boolean } = {}) {
    if (!invoice || actionLoading) return
    if (!canEdit) {
      setError('You do not have permission to update invoices')
      return
    }

    setActionLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      formData.append('status', newStatus)
      if (options.force) {
        formData.append('force', 'true')
      }

      const result: any = await updateInvoiceStatus(formData)

      if (newStatus === 'void' && !options.force && result?.error && result?.code === 'OJ_LINKED_ITEMS') {
        // Ask again before voiding and unbilling the linked items (the second ConfirmDialog).
        setForceVoidMessage(result.error)
        return
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

  const { totals: calculatedInvoiceTotals, lineTotals } = invoiceMath
  const invoiceTotals = useMemo(() => ({
    ...calculatedInvoiceTotals,
    subtotalBeforeInvoiceDiscount: Number(invoice.subtotal_amount ?? calculatedInvoiceTotals.subtotalBeforeInvoiceDiscount),
    invoiceDiscountAmount: Number(invoice.discount_amount ?? calculatedInvoiceTotals.invoiceDiscountAmount),
    vatAmount: Number(invoice.vat_amount ?? calculatedInvoiceTotals.vatAmount),
    totalAmount: Number(invoice.total_amount ?? calculatedInvoiceTotals.totalAmount),
  }), [calculatedInvoiceTotals, invoice])
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

  // Asking a customer for money only makes sense on an issued invoice that
  // still has something outstanding.
  const canShowPaymentLinkActions =
    canEdit &&
    invoice.vendor?.paypal_payments_enabled === true &&
    ['sent', 'overdue', 'partially_paid'].includes(invoice.status) &&
    invoiceBalanceDue(invoice) > 0

  // A due date is a payment term, not a figure, so it stays changeable after
  // the invoice is issued. Withdrawn and settled invoices are excluded: there
  // is no payment left to give more time for.
  const canChangeDueDate =
    canEdit && !['void', 'written_off', 'paid'].includes(invoice.status)

  function openDueDateModal() {
    setNewDueDate(invoice.due_date)
    setDueDateReason('')
    setShowDueDateModal(true)
  }

  async function handleSaveDueDate() {
    if (savingDueDate) return
    setSavingDueDate(true)
    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      formData.append('dueDate', newDueDate)
      formData.append('reason', dueDateReason)
      const result = await updateInvoiceDueDate(formData)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Due date updated')
      setShowDueDateModal(false)
      const refreshResult = await getInvoice(invoice.id)
      if (refreshResult.invoice) {
        setInvoice(refreshResult.invoice)
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the due date')
    } finally {
      setSavingDueDate(false)
    }
  }

  async function handleCopyPaymentLink() {
    if (copyingPayLink) return
    setCopyingPayLink(true)
    try {
      const result = await getInvoicePortalLink(invoice.id)
      if (result.error || !result.url) {
        toast.error(result.error || 'Could not build a payment link')
        return
      }
      await navigator.clipboard.writeText(result.url)
      toast.success('Payment link copied, ready to paste into WhatsApp or an email')
    } catch {
      toast.error('Could not copy the payment link')
    } finally {
      setCopyingPayLink(false)
    }
  }

  async function handleSendPaymentLink() {
    if (sendingPayLink) return
    setSendingPayLink(true)
    try {
      const result = await sendInvoicePaymentLink(invoice.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Payment link sent to ${result.sentTo}`)
      router.refresh()
    } catch {
      toast.error('Could not send the payment link')
    } finally {
      setSendingPayLink(false)
    }
  }

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

  const isPastDue = invoice.status === 'overdue' || (invoice.status === 'sent' && new Date(invoice.due_date) < new Date())

  // Page-level actions in priority order: the first ones show, the rest go in the "More" menu
  // (DetailHeaderActions). Edit and the next step come first, destructive actions after the
  // secondary ones, and the primary action last.
  const headerActions: DetailHeaderAction[] = [
    ...(invoice.status === 'draft' && canEdit
      ? [{ key: 'edit', label: 'Edit', icon: 'edit' as const, href: `/invoices/${invoice.id}/edit` }]
      : []),
    ...((invoice.status === 'sent' || invoice.status === 'overdue' || invoice.status === 'partially_paid') && canEdit
      ? [{
        key: 'record-payment',
        label: 'Record Payment',
        icon: 'checkCircle' as const,
        href: `/invoices/${invoice.id}/payment`,
        disabled: actionLoading,
      }]
      : []),
    ...(invoice.status === 'draft' && canDelete
      ? [{
        key: 'delete',
        label: 'Delete',
        icon: 'trash' as const,
        tone: 'danger' as const,
        onSelect: () => setShowDeleteConfirm(true),
        disabled: actionLoading,
      }]
      : []),
    ...(emailConfigured && canEdit
      ? [{
        key: 'email',
        label: 'Email Invoice',
        icon: 'mail' as const,
        onSelect: () => setShowEmailModal(true),
        disabled: actionLoading,
      }]
      : []),
    {
      key: 'download-pdf',
      label: 'Download PDF',
      icon: 'download',
      onSelect: () => void handleDownloadPdf(),
      disabled: actionLoading,
    },
    ...(invoice.status === 'draft' && canEdit
      ? [{
        key: 'mark-sent',
        label: 'Mark as Sent',
        icon: 'send' as const,
        onSelect: () => void handleStatusChange('sent'),
        disabled: actionLoading,
      }]
      : []),
    ...(emailConfigured && canEdit && isPastDue
      ? [{
        key: 'chase',
        label: 'Chase Payment',
        icon: 'clock' as const,
        onSelect: () => setShowChaseModal(true),
        disabled: actionLoading,
      }]
      : []),
    ...(canShowCreditNoteAction
      ? [{
        key: 'credit-note',
        label: 'Issue Credit Note',
        icon: 'fileMinus' as const,
        onSelect: openCreditNoteModal,
        disabled: actionLoading || creditNoteSubmitting,
      }]
      : []),
    // Voiding cannot be undone from the screen, so it is a danger action in the header (not a
    // button in the Actions card) and opens a danger confirm.
    ...(invoice.status !== 'void' && invoice.status !== 'written_off' && canEdit
      ? [{
        key: 'void',
        label: 'Void',
        icon: 'ban' as const,
        tone: 'danger' as const,
        onSelect: () => requestStatusChange('void'),
        disabled: actionLoading,
      }]
      : []),
    ...(showOjReissueAction
      ? [{
        key: 'reissue',
        label: 'Reissue OJ Invoice',
        icon: 'refresh' as const,
        tone: 'primary' as const,
        onSelect: () => void handleOpenReissuePreview(),
        disabled: actionLoading || reissueLoading || reissueSubmitting,
        loading: reissueLoading,
      }]
      : []),
  ]

  return (
    <PageLayout
      title={invoicePageTitle(invoice.invoice_number)}
      subtitle={invoice.vendor?.name}
      backButton={BACK_TO_INVOICES}
      headerActions={<DetailHeaderActions actions={headerActions} />}
    >
      {error && (
        <Alert tone="danger">{error}</Alert>
      )}
      {!error && readOnly && (
        <Alert tone="info">
          You have read-only access to invoices. Edit, delete, and payment actions are disabled for your role.
        </Alert>
      )}

      <StatGrid columns={3}>
        <Stat label="Total Amount" value={`£${invoice.total_amount.toFixed(2)}`} />
        <Stat label="Paid Amount" value={`£${invoice.paid_amount.toFixed(2)}`} tone="success" />
        {/* Red only once the invoice is overdue, the same rule as the invoice list. */}
        <Stat
          label="Outstanding"
          value={`£${(invoiceBalanceDue(invoice)).toFixed(2)}`}
          hint={invoice.status === 'overdue' ? 'Overdue' : undefined}
          tone={invoice.status === 'overdue' ? 'danger' : 'default'}
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Invoice Details"
              action={
                <Badge tone={invoiceStatusTone(invoice.status)} dot>
                  {invoiceStatusLabel(invoice.status)}
                </Badge>
              }
            />
            <CardBody className="space-y-6">
              <DescriptionList
                items={[
                  {
                    key: 'from',
                    label: 'From',
                    value: (
                      <>
                        <span className="block font-medium">Orange Jelly Limited</span>
                        <span className="block text-text-muted">The Anchor, Horton Road</span>
                        <span className="block text-text-muted">Stanwell Moor Village, Surrey</span>
                        <span className="block text-text-muted">TW19 6AQ</span>
                        <span className="block text-text-muted">VAT: GB315203647</span>
                      </>
                    ),
                  },
                  {
                    key: 'to',
                    label: 'To',
                    value: invoice.vendor ? (
                      <>
                        <span className="block font-medium">{invoice.vendor.name}</span>
                        {invoice.vendor.contact_name && (
                          <span className="block text-text-muted">{invoice.vendor.contact_name}</span>
                        )}
                        {invoice.vendor.email && (
                          <span className="block text-text-muted">{invoice.vendor.email}</span>
                        )}
                        {invoice.vendor.phone && (
                          <span className="block text-text-muted">{invoice.vendor.phone}</span>
                        )}
                        {invoice.vendor.address && (
                          <span className="block whitespace-pre-line text-text-muted">{invoice.vendor.address}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-text-muted">No vendor details</span>
                    ),
                  },
                ]}
              />

              <DescriptionList
                className="border-t border-border pt-6"
                items={[
                  {
                    key: 'invoice_date',
                    label: 'Invoice Date',
                    value: <span className="font-medium">{formatDateInLondon(invoice.invoice_date)}</span>,
                  },
                  {
                    key: 'due_date',
                    label: 'Due Date',
                    value: <span className="font-medium">{formatDateInLondon(invoice.due_date)}</span>,
                  },
                  ...(invoice.reference
                    ? [{ key: 'reference', label: 'Reference', value: invoice.reference }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Line Items" />
            <DataTable<InvoiceLineItem>
              data={invoice.line_items || []}
              getRowKey={(it) => it.id}
              bordered={false}
              columns={[
                { key: 'description', header: 'Description', cell: (it) => <span className="text-sm">{it.description}</span> },
                { key: 'quantity', header: 'Qty', align: 'right', cell: (it) => <span className="text-sm">{it.quantity}</span> },
                { key: 'unit_price', header: 'Unit Price', align: 'right', cell: (it) => <span className="text-sm">£{it.unit_price.toFixed(2)}</span> },
                { key: 'discount', header: 'Discount', align: 'right', cell: (it) => <span className="text-sm text-success-fg">{it.discount_percentage > 0 ? `-${it.discount_percentage}%` : ''}</span> },
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
                  <div className="border-b border-border p-pad-card">
                    <div className="font-medium text-sm mb-3">{it.description}</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-text-muted">Quantity:</span><span>{it.quantity}</span></div>
                      <div className="flex justify-between"><span className="text-text-muted">Unit Price:</span><span>£{it.unit_price.toFixed(2)}</span></div>
                      {it.discount_percentage > 0 && (
                        <div className="flex justify-between"><span className="text-text-muted">Discount:</span><span className="text-success-fg">-{it.discount_percentage}%</span></div>
                      )}
                      <div className="flex justify-between"><span className="text-text-muted">VAT:</span><span>{it.vat_rate}%</span></div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border flex justify-between font-medium">
                      <span>Total:</span>
                      <span>£{lineTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )
              }}
            />

            <CardBody className="space-y-2 border-t border-border">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>£{invoiceTotals.subtotalBeforeInvoiceDiscount.toFixed(2)}</span>
              </div>
              {invoiceTotals.invoiceDiscountAmount > 0 && (
                <div className="flex justify-between text-sm text-success-fg">
                  <span>Invoice Discount ({invoice.invoice_discount_percentage}%):</span>
                  <span>-£{invoiceTotals.invoiceDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span>VAT:</span>
                <span>£{invoiceTotals.vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-semibold pt-2 border-t border-border">
                <span>Total:</span>
                <span>£{invoiceTotals.totalAmount.toFixed(2)}</span>
              </div>
            </CardBody>
          </Card>

          {(invoice.notes || invoice.internal_notes) && (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <DescriptionList
                  columns={1}
                  items={[
                    ...(invoice.notes
                      ? [{
                        key: 'notes',
                        label: 'Invoice Notes',
                        value: <span className="whitespace-pre-wrap">{invoice.notes}</span>,
                      }]
                      : []),
                    ...(invoice.internal_notes
                      ? [{
                        key: 'internal_notes',
                        label: 'Internal Notes',
                        value: (
                          <Alert tone="warning" role="status">
                            <span className="whitespace-pre-wrap">{invoice.internal_notes}</span>
                          </Alert>
                        ),
                      }]
                      : []),
                  ]}
                />
              </CardBody>
            </Card>
          )}

          <InvoiceEmailsPanel
            invoiceId={invoice.id}
            reloadKey={`${invoice.updated_at}|${invoice.status}|${invoice.due_date}|${invoice.reminders_held_until ?? ''}`}
          />
        </div>

        <div className="space-y-6">
          {invoice.payments && invoice.payments.length > 0 && (
            <Card>
              <CardHeader title="Payment History" />
              <CardBody className="space-y-3">
                {invoice.payments.map((payment) => (
                  <div key={payment.id} className="border-b border-border pb-3 last:border-b-0">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                      <div className="flex-1">
                        <p className="font-medium">£{payment.amount.toFixed(2)}</p>
                        <p className="text-sm text-text-muted">
                          {formatDateInLondon(payment.payment_date)}
                        </p>
                        {payment.reference && (
                          <p className="text-sm text-text-muted truncate">{payment.reference}</p>
                        )}
                      </div>
                      <span className="text-sm text-text-muted self-start sm:self-auto">{payment.payment_method}</span>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <ReminderHoldControl
            invoiceId={invoice.id}
            status={invoice.status}
            heldUntil={invoice.reminders_held_until}
            canEdit={canEdit}
            onChanged={(heldUntil) => setInvoice((current) => ({ ...current, reminders_held_until: heldUntil }))}
          />

          <Card>
            <CardHeader title="Actions" />
            <CardBody className="space-y-2">
              {invoice.status !== 'paid' && invoice.status !== 'void' && (
                <Button variant="primary"
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

              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  toast.success('Link copied to clipboard!')
                }}
                leftIcon={<Icon name="copy" size={16} />}
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
                  leftIcon={<Icon name="refresh" size={16} />}
                >
                  Reissue OJ Invoice
                </Button>
              )}

              {canChangeDueDate && (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={openDueDateModal}
                  disabled={actionLoading || savingDueDate}
                  leftIcon={<Icon name="calendar" size={16} />}
                >
                  Change Due Date
                </Button>
              )}

              {canShowPaymentLinkActions && (
                <>
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={() => void handleSendPaymentLink()}
                    disabled={actionLoading || sendingPayLink || copyingPayLink}
                    loading={sendingPayLink}
                    leftIcon={<Icon name="creditCard" size={16} />}
                  >
                    Email Payment Link
                  </Button>
                  {/* Copies our own portal URL, never a raw PayPal one: PayPal
                      approval links die after a few hours and a stale link
                      pasted into WhatsApp just fails for the customer. */}
                  <Button
                    variant="secondary"
                    fullWidth
                    onClick={() => void handleCopyPaymentLink()}
                    disabled={actionLoading || sendingPayLink || copyingPayLink}
                    loading={copyingPayLink}
                    leftIcon={<Icon name="link" size={16} />}
                  >
                    Copy Payment Link
                  </Button>
                </>
              )}

              {canShowCreditNoteAction && (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={openCreditNoteModal}
                  disabled={actionLoading || creditNoteSubmitting}
                  leftIcon={<Icon name="fileMinus" size={16} />}
                >
                  Issue Credit Note
                </Button>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal
        open={showDueDateModal}
        onClose={() => {
          if (!savingDueDate) setShowDueDateModal(false)
        }}
        title="Change Due Date"
        width="md"
        footer={(
          <>
            <Button
              variant="secondary"
              onClick={() => setShowDueDateModal(false)}
              disabled={savingDueDate}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSaveDueDate()}
              disabled={savingDueDate || !newDueDate || newDueDate === invoice.due_date}
              loading={savingDueDate}
            >
              Save Due Date
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Currently due{' '}
            <span className="font-medium text-text">
              {formatDateInLondon(invoice.due_date)}
            </span>
            . Changing this does not email the customer, so tell them yourself
            or re-send the invoice.
          </p>
          <Input
            type="date"
            label="New due date"
            value={newDueDate}
            min={invoice.invoice_date}
            onChange={(e) => setNewDueDate(e.target.value)}
            disabled={savingDueDate}
          />
          <Input
            label="Reason (optional)"
            value={dueDateReason}
            onChange={(e) => setDueDateReason(e.target.value)}
            placeholder="Re-issued too close to the event"
            disabled={savingDueDate}
          />
          {invoice.status === 'overdue' && newDueDate >= getTodayIsoDate() && (
            <Alert tone="info" role="status">
              This invoice is marked overdue. Giving more time will also stop the
              overdue chasers.
            </Alert>
          )}
        </div>
      </Modal>

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
          <PageLoading inline label="Building OJ invoice reissue preview" />
        )}

        {!reissueLoading && reissuePreview && !reissuePreview.eligible && (
          <div className="space-y-4">
            <Alert tone="danger">{reissuePreview.error}</Alert>
            {reissuePreview.warnings && reissuePreview.warnings.length > 0 && (
              <Alert tone="warning">
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
            <StatGrid columns={2}>
              <Stat
                label="Source"
                value={reissuePreview.sourceInvoice.invoice_number}
                hint={formatStatus(reissuePreview.sourceInvoice.status)}
              />
              <Stat
                label="Client"
                value={reissuePreview.sourceInvoice.vendor_name || 'Unknown client'}
                hint={reissuePreview.period.label}
              />
              <Stat
                label="Paid"
                value={formatMoney(reissuePreview.sourceInvoice.paid_amount)}
                hint="No email will be sent"
              />
              <Stat
                label="Rebuilt Total"
                value={formatMoney(reissuePreview.totals.totalAmount)}
                hint={reissuePreview.actionLabel}
              />
            </StatGrid>

            {reissuePreview.warnings.length > 0 && (
              <Alert tone="warning">
                <ul className="list-disc space-y-1 pl-4">
                  {reissuePreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <Alert tone="info">Review this preview, then create the draft. The client is not emailed until you send the resulting draft invoice.</Alert>

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
              <CardFooter className="space-y-1 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-text-muted">Subtotal</span>
                  <span className="font-medium">{formatMoney(reissuePreview.totals.subtotalBeforeInvoiceDiscount)}</span>
                </div>
                {reissuePreview.totals.invoiceDiscountAmount > 0 && (
                  <div className="flex justify-between gap-4">
                    <span className="text-text-muted">Invoice discount</span>
                    <span className="font-medium">-{formatMoney(reissuePreview.totals.invoiceDiscountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-text-muted">VAT</span>
                  <span className="font-medium">{formatMoney(reissuePreview.totals.vatAmount)}</span>
                </div>
                <div className="mt-2 flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(reissuePreview.totals.totalAmount)}</span>
                </div>
              </CardFooter>
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
          <Alert tone="info">
            Use a credit note to record a refund or adjustment against a paid invoice.
          </Alert>

          <Card variant="secondary">
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-text-muted">Paid amount</span>
                <span className="font-medium text-text-strong">{formatMoney(invoice.paid_amount)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-text-muted">Maximum credit ex VAT</span>
                <span className="font-medium text-text-strong">{formatMoney(maxCreditNoteExVat)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-text-muted">Invoice VAT rate</span>
                <span className="font-medium text-text-strong">{invoiceVatRate}%</span>
              </div>
            </CardBody>
          </Card>

          <Input
            id="credit-note-amount"
            label="Amount ex VAT"
            type="number"
            min="0.01"
            max={maxCreditNoteExVat.toFixed(2)}
            step="0.01"
            value={creditNoteAmount}
            onChange={(event) => setCreditNoteAmount(event.target.value)}
            error={
              creditNoteAmount && !creditNoteAmountValid
                ? `Enter an amount between £0.01 and ${formatMoney(maxCreditNoteExVat)}.`
                : undefined
            }
            hint={
              creditNoteAmountValid
                ? `Estimated credit including VAT: ${formatMoney(estimatedCreditNoteIncVat)}`
                : undefined
            }
          />

          <Textarea
            id="credit-note-reason"
            label="Reason"
            value={creditNoteReason}
            onChange={(event) => setCreditNoteReason(event.target.value)}
            placeholder="Refund, discount, service adjustment..."
            rows={3}
          />
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
        confirmLabel="Delete"
        tone="danger"
      />

      {/* Voiding is two steps, as the browser confirms were: first "Void this invoice?", then,
          only if the invoice has linked OJ Projects items, a second confirm to void and unbill
          them. Cancelling the second leaves the invoice as it was and shows why. */}
      <ConfirmDialog
        open={showVoidConfirm}
        onClose={() => setShowVoidConfirm(false)}
        onConfirm={() => handleStatusChange('void')}
        title="Void Invoice"
        message="Void this invoice?"
        confirmLabel="Void"
        tone="danger"
      />
      <ConfirmDialog
        open={forceVoidMessage !== null}
        onClose={() => {
          if (!forceVoidConfirmedRef.current && forceVoidMessage) {
            setError(forceVoidMessage)
          }
          forceVoidConfirmedRef.current = false
          setForceVoidMessage(null)
        }}
        onConfirm={async () => {
          forceVoidConfirmedRef.current = true
          await handleStatusChange('void', { force: true })
        }}
        title="Void and Unbill OJ Projects Items"
        message={
          <>
            <span className="block">{forceVoidMessage}</span>
            <span className="mt-2 block">Void and unbill linked OJ Projects items?</span>
          </>
        }
        confirmLabel="Void and Unbill"
        tone="danger"
      />
    </PageLayout>
  )
}
