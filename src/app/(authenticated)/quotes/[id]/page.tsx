'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, updateQuoteStatus, convertQuoteToInvoice, deleteQuote } from '@/app/actions/quotes'
import { getEmailConfigStatus } from '@/app/actions/email'
import { EmailQuoteModal } from '@/components/modals/EmailQuoteModal'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'
import {
  PageLayout,
  Icon,
  Card,
  CardHeader,
  CardBody,
  Button,
  LinkButton,
  Badge,
  Alert,
  DataTable,
  DescriptionList,
  ConfirmDialog,
  toast,
} from '@/ds'
import { BACK_TO_QUOTES } from '@/app/(authenticated)/invoices/_shared/nav'

import { usePermissions } from '@/contexts/PermissionContext'
import { quoteStatusLabel, quoteStatusTone } from '@/lib/invoices/status-ui'

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value ?? 0)
  return `£${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`
}

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('invoices', 'view')
  const canEdit = hasPermission('invoices', 'edit')
  const canDelete = hasPermission('invoices', 'delete')
  const canCreate = hasPermission('invoices', 'create')
  const [quote, setQuote] = useState<QuoteWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  useEffect(() => {
    async function getParams() {
      const { id } = await params
      setQuoteId(id)
    }
    getParams()
  }, [params])

  useEffect(() => {
    const id = quoteId

    if (!id || permissionsLoading) {
      return
    }

    if (!canView) {
      router.replace('/unauthorized')
      return
    }

    async function fetchAndSetQuote(currentId: string) {
      try {
        const result = await getQuote(currentId)
        if (result.error || !result.quote) {
          throw new Error(result.error || 'Failed to load quote')
        }
        setQuote(result.quote)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load quote')
      } finally {
        setLoading(false)
      }
    }

    void fetchAndSetQuote(id)
    if (canEdit) {
      void checkEmailConfig()
    }
  }, [quoteId, permissionsLoading, canView, canEdit, router])

  async function checkEmailConfig() {
    try {
      const result = await getEmailConfigStatus()
      if (!result.error && result.configured) {
        setEmailConfigured(true)
      }
    } catch (err) {
      console.error('Error checking email config:', err)
    }
  }

  async function loadQuote() {
    const id = quoteId

    if (!id || !canView) return
    
    try {
      const result = await getQuote(id)
      if (result.error || !result.quote) {
        throw new Error(result.error || 'Failed to load quote')
      }
      setQuote(result.quote)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quote')
    } finally {
      setLoading(false)
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

  // The quote number is only known once the quote has loaded, so it sits in the subtitle and
  // the title stays "Quote" in every state (loading, error and loaded).
  const layoutProps = {
    title: 'Quote',
    subtitle: quote
      ? [quote.quote_number, quote.reference ? `Reference: ${quote.reference}` : null].filter(Boolean).join(' · ')
      : undefined,
    backButton: BACK_TO_QUOTES,
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading quote" />
  }

  if (!canView) {
    return null
  }

  if (error && !quote) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Error loading quote">{error}</Alert>
      </PageLayout>
    )
  }

  if (!quote) {
    return <PageLayout {...layoutProps} error="Quote not found" />
  }

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

  // Page-level actions: secondary first, the destructive delete next, the primary action last.
  const headerActions = (
    <>
      {quote.status === 'draft' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleStatusChange('sent')}
          disabled={processing || !canEdit}
          title={!canEdit ? 'You need invoice edit permission to update quotes.' : undefined}
          leftIcon={<Icon name="mail" size={16} />}
        >
          <span className="hidden sm:inline">Mark as Sent</span>
          <span className="sm:hidden">Send</span>
        </Button>
      )}

      {quote.status === 'draft' && (
        <LinkButton
          href={`/quotes/${quote.id}/edit`}
          variant="secondary"
          size="sm"
          leftIcon={<Icon name="edit" size={16} />}
        >
          Edit
        </LinkButton>
      )}

      {quote.status === 'sent' && !isExpired && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleStatusChange('accepted')}
          disabled={processing || !canEdit}
          title={!canEdit ? 'You need invoice edit permission to update quotes.' : undefined}
          leftIcon={<Icon name="checkCircle" size={16} />}
        >
          <span className="hidden sm:inline">Mark as Accepted</span>
          <span className="sm:hidden">Accept</span>
        </Button>
      )}

      {quote.status === 'sent' && !isExpired && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleStatusChange('rejected')}
          disabled={processing || !canEdit}
          title={!canEdit ? 'You need invoice edit permission to update quotes.' : undefined}
          leftIcon={<Icon name="xCircle" size={16} />}
        >
          <span className="hidden sm:inline">Mark as Rejected</span>
          <span className="sm:hidden">Reject</span>
        </Button>
      )}

      {emailConfigured && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowEmailModal(true)}
          disabled={processing || !canEdit}
          title={!canEdit ? 'You need invoice edit permission to email quotes.' : undefined}
          leftIcon={<Icon name="mail" size={16} />}
        >
          <span className="hidden sm:inline">Send Email</span>
          <span className="sm:hidden">Email</span>
        </Button>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, '_blank')}
        disabled={processing}
        leftIcon={<Icon name="download" size={16} />}
      >
        <span className="hidden sm:inline">Download PDF</span>
        <span className="sm:hidden">PDF</span>
      </Button>

      {quote.status === 'draft' && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => setShowDeleteDialog(true)}
          disabled={processing || !canDelete}
          title={!canDelete ? 'You need invoice delete permission to delete quotes.' : undefined}
          leftIcon={<Icon name="trash" size={16} />}
        >
          Delete
        </Button>
      )}

      {quote.status === 'accepted' && !quote.converted_to_invoice_id && (
        <Button
          variant="primary"
          size="sm"
          onClick={handleConvertToInvoice}
          disabled={processing || !canCreate}
          title={!canCreate ? 'You need invoice create permission to convert quotes.' : undefined}
          leftIcon={<Icon name="fileText" size={16} />}
        >
          <span className="hidden sm:inline">Convert to Invoice</span>
          <span className="sm:hidden">Convert</span>
        </Button>
      )}
    </>
  )

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
    <PageLayout {...layoutProps} headerActions={headerActions}>
      <div>
        <Badge tone={quoteStatusTone(quote.status)} dot>
          {quoteStatusLabel(quote.status)}
        </Badge>
      </div>

      {error && (
        <Alert tone="danger" title="Error">{error}</Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Quote Details" />
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

      {quote && (
        <>
          <EmailQuoteModal
            quote={quote}
            isOpen={showEmailModal}
            onClose={() => setShowEmailModal(false)}
            onSuccess={async () => {
              // Reload quote to get updated status
              const result = await getQuote(quoteId!)
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
        </>
      )}
    </PageLayout>
  )
}
