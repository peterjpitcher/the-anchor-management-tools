'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, updateQuoteStatus, convertQuoteToInvoice, deleteQuote } from '@/app/actions/quotes'
import { EmailQuoteModal } from '@/components/modals/EmailQuoteModal'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'
import {
  PageLayout,
  Icon,
  Card,
  CardHeader,
  CardBody,
  Button,
  Badge,
  Alert,
  DataTable,
  DescriptionList,
  ConfirmDialog,
  toast,
} from '@/ds'
import { BACK_TO_QUOTES, quotePageTitle } from '@/app/(authenticated)/invoices/_shared/nav'
import {
  DetailHeaderActions,
  type DetailHeaderAction,
} from '@/app/(authenticated)/invoices/_components/DetailHeaderActions'

import { usePermissions } from '@/contexts/PermissionContext'
import { quoteStatusLabel, quoteStatusTone } from '@/lib/invoices/status-ui'

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value ?? 0)
  return `£${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`
}

interface QuoteDetailClientProps {
  initialQuote: QuoteWithDetails
  emailConfigured: boolean
}

export default function QuoteDetailClient({ initialQuote, emailConfigured }: QuoteDetailClientProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission('invoices', 'edit')
  const canDelete = hasPermission('invoices', 'delete')
  const canCreate = hasPermission('invoices', 'create')
  const [quote, setQuote] = useState<QuoteWithDetails>(initialQuote)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  async function loadQuote() {
    try {
      const result = await getQuote(quote.id)
      if (result.error || !result.quote) {
        throw new Error(result.error || 'Failed to load quote')
      }
      setQuote(result.quote)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quote')
    }
  }

  async function handleStatusChange(newStatus: QuoteStatus) {
    if (!quote) return
    if (!canEdit) {
      toast.error('You do not have permission to update quotes')
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('quoteId', quote.id)
      formData.append('status', newStatus)

      const result = await updateQuoteStatus(formData)
      if (result.error) {
        throw new Error(result.error)
      }

      // Reload quote
      await loadQuote()
      toast.success('Quote status updated successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
      toast.error('Failed to update quote status')
    } finally {
      setProcessing(false)
    }
  }

  async function handleConvertToInvoice() {
    if (!quote) return
    if (!canCreate) {
      toast.error('You do not have permission to convert quotes')
      return
    }

    if (quote.status !== 'accepted') {
      setError('Only accepted quotes can be converted to invoices')
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const result = await convertQuoteToInvoice(quote.id)
      if (result.error) {
        throw new Error(result.error)
      }

      if (result.invoice) {
        toast.success('Quote converted to invoice successfully')
        router.push(`/invoices/${result.invoice.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert to invoice')
      toast.error('Failed to convert quote to invoice')
    } finally {
      setProcessing(false)
    }
  }

  async function handleDelete() {
    if (!quote || processing) return
    if (!canDelete) {
      toast.error('You do not have permission to delete quotes')
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('quoteId', quote.id)

      const result = await deleteQuote(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Quote deleted successfully')
      router.push('/quotes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete quote')
      toast.error('Failed to delete quote')
      setProcessing(false)
    }
  }

  // calculateLineTotal was unused; removed to satisfy lint

  const isExpired = quote.status === 'expired' || 
    (quote.status === 'sent' && new Date(quote.valid_until) < new Date())

  // Calculate totals for display
  const subtotal = quote.line_items?.reduce((acc, item) => {
    const lineSubtotal = item.quantity * item.unit_price
    const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
    return acc + (lineSubtotal - lineDiscount)
  }, 0) || 0

  const quoteDiscount = subtotal * (quote.quote_discount_percentage / 100)

  const vat = quote.line_items?.reduce((acc, item) => {
    const itemSubtotal = item.quantity * item.unit_price
    const itemDiscount = itemSubtotal * (item.discount_percentage / 100)
    const itemAfterDiscount = itemSubtotal - itemDiscount
    const itemShare = subtotal > 0 ? itemAfterDiscount / subtotal : 0
    const itemAfterQuoteDiscount = itemAfterDiscount - (quoteDiscount * itemShare)
    return acc + (itemAfterQuoteDiscount * (item.vat_rate / 100))
  }, 0) || 0

  // Page-level actions in priority order: the first ones show, the rest go in the "More" menu
  // (DetailHeaderActions). Edit and the next step come first, the destructive delete after the
  // secondary actions, and Convert to Invoice, the primary action, last.
  const noEditTitle = !canEdit ? 'You need invoice edit permission to update quotes.' : undefined
  const headerActions: DetailHeaderAction[] = [
    ...(quote.status === 'draft'
      ? [{ key: 'edit', label: 'Edit', icon: 'edit' as const, href: `/quotes/${quote.id}/edit` }]
      : []),
    ...(quote.status === 'sent' && !isExpired
      ? [{
        key: 'accept',
        label: 'Mark as Accepted',
        icon: 'checkCircle' as const,
        onSelect: () => void handleStatusChange('accepted'),
        disabled: processing || !canEdit,
        title: noEditTitle,
      }]
      : []),
    ...(quote.status === 'draft'
      ? [{
        key: 'delete',
        label: 'Delete',
        icon: 'trash' as const,
        tone: 'danger' as const,
        onSelect: () => setShowDeleteDialog(true),
        disabled: processing || !canDelete,
        title: !canDelete ? 'You need invoice delete permission to delete quotes.' : undefined,
      }]
      : []),
    ...(emailConfigured && canEdit
      ? [{
        key: 'email',
        label: 'Email Quote',
        icon: 'mail' as const,
        onSelect: () => setShowEmailModal(true),
        disabled: processing,
      }]
      : []),
    {
      key: 'download-pdf',
      label: 'Download PDF',
      icon: 'download',
      onSelect: () => window.open(`/api/quotes/${quote.id}/pdf`, '_blank'),
      disabled: processing,
    },
    ...(quote.status === 'draft'
      ? [{
        key: 'mark-sent',
        label: 'Mark as Sent',
        icon: 'send' as const,
        onSelect: () => void handleStatusChange('sent'),
        disabled: processing || !canEdit,
        title: noEditTitle,
      }]
      : []),
    ...(quote.status === 'sent' && !isExpired
      ? [{
        key: 'reject',
        label: 'Mark as Rejected',
        icon: 'xCircle' as const,
        onSelect: () => void handleStatusChange('rejected'),
        disabled: processing || !canEdit,
        title: noEditTitle,
      }]
      : []),
    ...(quote.status === 'accepted' && !quote.converted_to_invoice_id
      ? [{
        key: 'convert',
        label: 'Convert to Invoice',
        icon: 'fileText' as const,
        tone: 'primary' as const,
        onSelect: () => void handleConvertToInvoice(),
        disabled: processing || !canCreate,
        title: !canCreate ? 'You need invoice create permission to convert quotes.' : undefined,
      }]
      : []),
  ]

  const lineTotal = (it: { quantity: number; unit_price: number; discount_percentage: number; vat_rate: number }) => {
    const lineSubtotal = it.quantity * it.unit_price
    const lineDiscount = lineSubtotal * (it.discount_percentage / 100)
    const lineAfterDiscount = lineSubtotal - lineDiscount
    const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
    const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscount * itemShare)
    const lineVat = lineAfterQuoteDiscount * (it.vat_rate / 100)
    return lineAfterQuoteDiscount + lineVat
  }

  return (
    <PageLayout
      title={quotePageTitle(quote.quote_number)}
      subtitle={quote.vendor?.name}
      backButton={BACK_TO_QUOTES}
      headerActions={<DetailHeaderActions actions={headerActions} />}
    >
      {error && (
        <Alert tone="danger" title="Error">{error}</Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Quote Details"
              action={
                <Badge tone={quoteStatusTone(quote.status)} dot>
                  {quoteStatusLabel(quote.status)}
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
                    value: quote.vendor ? (
                      <>
                        <span className="block font-medium">{quote.vendor.name}</span>
                        {quote.vendor.contact_name && (
                          <span className="block text-text-muted">{quote.vendor.contact_name}</span>
                        )}
                        {quote.vendor.email && (
                          <span className="block break-all text-text-muted">{quote.vendor.email}</span>
                        )}
                        {quote.vendor.phone && (
                          <span className="block text-text-muted">{quote.vendor.phone}</span>
                        )}
                        {quote.vendor.address && (
                          <span className="block whitespace-pre-line text-text-muted">{quote.vendor.address}</span>
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
                    key: 'quote_date',
                    label: 'Quote Date',
                    value: <span className="font-medium">{new Date(quote.quote_date).toLocaleDateString('en-GB')}</span>,
                  },
                  {
                    key: 'valid_until',
                    label: 'Valid Until',
                    value: <span className="font-medium">{new Date(quote.valid_until).toLocaleDateString('en-GB')}</span>,
                  },
                  ...(quote.reference
                    ? [{ key: 'reference', label: 'Reference', value: quote.reference }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Line Items" />
            <DataTable<any>
              data={quote.line_items || []}
              getRowKey={(it) => it.id}
              emptyMessage="No line items"
              bordered={false}
              columns={[
                { key: 'description', header: 'Description', cell: (it) => <span className="text-sm">{it.description}</span> },
                { key: 'quantity', header: 'Qty', align: 'right', cell: (it) => <span className="text-sm">{it.quantity}</span> },
                { key: 'unit_price', header: 'Unit Price', align: 'right', cell: (it) => <span className="text-sm">£{it.unit_price.toFixed(2)}</span> },
                { key: 'discount', header: 'Discount', align: 'right', cell: (it) => <span className="text-sm text-success-fg">{it.discount_percentage > 0 ? `-${it.discount_percentage}%` : ''}</span> },
                { key: 'vat', header: 'VAT', align: 'right', cell: (it) => <span className="text-sm">{it.vat_rate}%</span> },
                { key: 'total', header: 'Total', align: 'right', cell: (it) => (
                  <span className="text-sm font-medium">£{lineTotal(it).toFixed(2)}</span>
                ) },
              ]}
              renderMobileCard={(it) => (
                <div className="border-b border-border p-pad-card">
                  <p className="font-medium text-sm mb-2">{it.description}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-text-muted">Qty:</span> {it.quantity}</div>
                    <div><span className="text-text-muted">Unit Price:</span> £{it.unit_price.toFixed(2)}</div>
                    <div><span className="text-text-muted">Discount:</span> {it.discount_percentage > 0 ? (<span className="text-success-fg"> -{it.discount_percentage}%</span>) : (<span>-</span>)}</div>
                    <div><span className="text-text-muted">VAT:</span> {it.vat_rate}%</div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border flex justify-between">
                    <span className="text-sm font-medium">Total:</span>
                    <span className="text-sm font-medium">£{lineTotal(it).toFixed(2)}</span>
                  </div>
                </div>
              )}
            />

            <CardBody className="space-y-2 border-t border-border">
              <div className="flex justify-between text-xs sm:text-sm">
                <span>Subtotal:</span>
                <span>£{subtotal.toFixed(2)}</span>
              </div>
              {quote.quote_discount_percentage > 0 && (
                <div className="flex justify-between text-xs sm:text-sm text-success-fg">
                  <span>Quote Discount ({quote.quote_discount_percentage}%):</span>
                  <span>-£{quoteDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs sm:text-sm">
                <span>VAT:</span>
                <span>£{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base sm:text-lg font-semibold pt-2 border-t border-border">
                <span>Total:</span>
                <span>{formatCurrency(quote.total_amount)}</span>
              </div>
            </CardBody>
          </Card>

          {(quote.notes || quote.internal_notes) && (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <DescriptionList
                  columns={1}
                  items={[
                    ...(quote.notes
                      ? [{
                        key: 'notes',
                        label: 'Quote Notes',
                        value: <span className="whitespace-pre-wrap">{quote.notes}</span>,
                      }]
                      : []),
                    ...(quote.internal_notes
                      ? [{
                        key: 'internal_notes',
                        label: 'Internal Notes',
                        value: (
                          <Alert tone="warning" role="status">
                            <span className="whitespace-pre-wrap">{quote.internal_notes}</span>
                          </Alert>
                        ),
                      }]
                      : []),
                  ]}
                />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Quote Status" />
            <CardBody className="space-y-4">
              <DescriptionList
                columns={1}
                items={[
                  {
                    key: 'total',
                    label: 'Total Amount',
                    value: <span className="text-xl font-bold sm:text-2xl">{formatCurrency(quote.total_amount)}</span>,
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    value: (
                      <Badge tone={quoteStatusTone(quote.status)} dot>
                        {quoteStatusLabel(quote.status)}
                      </Badge>
                    ),
                  },
                  ...(quote.converted_to_invoice_id
                    ? [{
                      key: 'converted',
                      label: 'Converted to Invoice',
                      value: (
                        <span className="font-medium text-success-fg">
                          {quote.converted_invoice?.invoice_number}
                        </span>
                      ),
                    }]
                    : []),
                ]}
              />

              {isExpired && quote.status === 'sent' && (
                <Alert tone="warning">This quote has expired</Alert>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Actions" />
            <CardBody className="space-y-2">
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

              {quote.status === 'sent' && !isExpired && (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => handleStatusChange('expired')}
                  disabled={processing}
                >
                  Mark as Expired
                </Button>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <EmailQuoteModal
        quote={quote}
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onSuccess={async () => {
          // Reload quote to get updated status
          const result = await getQuote(quote.id)
          if (result.quote) {
            setQuote(result.quote)
          }
        }}
      />
      <ConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Delete Quote"
        message="Are you sure you want to delete this quote? This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  )
}
