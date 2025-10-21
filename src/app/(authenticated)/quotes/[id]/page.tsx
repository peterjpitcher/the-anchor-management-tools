'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, updateQuoteStatus, convertQuoteToInvoice, deleteQuote } from '@/app/actions/quotes'
import { getEmailConfigStatus } from '@/app/actions/email'
import { FileText, Download, Mail, CheckCircle, XCircle, Edit, Copy, Trash2, Clock } from 'lucide-react'
import { EmailQuoteModal } from '@/components/EmailQuoteModal'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'
// UI v2 components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { DataTable } from '@/components/ui-v2/display/DataTable'

import { usePermissions } from '@/contexts/PermissionContext'
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

    async function loadQuote(currentId: string) {
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

    void loadQuote(id)
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

  function getStatusVariant(status: QuoteStatus): 'default' | 'info' | 'success' | 'error' | 'warning' {
    switch (status) {
      case 'draft': return 'default'
      case 'sent': return 'info'
      case 'accepted': return 'success'
      case 'rejected': return 'error'
      case 'expired': return 'warning'
      default: return 'default'
    }
  }

  function getStatusIcon(status: QuoteStatus) {
    switch (status) {
      case 'accepted': return <CheckCircle className="h-4 w-4" />
      case 'rejected': return <XCircle className="h-4 w-4" />
      case 'expired': return <Clock className="h-4 w-4" />
      default: return null
    }
  }

  // calculateLineTotal was unused; removed to satisfy lint

  const layoutProps = {
    title: quote ? `Quote ${quote.quote_number}` : 'Quote',
    subtitle: quote?.reference ? `Reference: ${quote.reference}` : undefined,
    backButton: { label: 'Back to Quotes', href: '/quotes' },
  }

  if (permissionsLoading || loading) {
    return (
      <PageLayout {...layoutProps} loading loadingLabel="Loading quote...">
        {null}
      </PageLayout>
    )
  }

  if (!canView) {
    return null
  }

  if (error && !quote) {
    return (
      <PageLayout {...layoutProps}>
        <Alert variant="error" title="Error loading quote" description={error} />
      </PageLayout>
    )
  }

  if (!quote) {
    return (
      <PageLayout {...layoutProps}>
        <Card>
          <div className="py-8 text-center">
            <p className="mb-4 text-red-600">Quote not found</p>
            <Button variant="secondary" onClick={() => router.push('/quotes')}>
              Back to Quotes
            </Button>
          </div>
        </Card>
      </PageLayout>
    )
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

  const navActions = (
    <div className="flex flex-wrap gap-2">
      {quote.status === 'draft' && (
        <>
          <Button
            onClick={() => handleStatusChange('sent')}
            disabled={processing || !canEdit}
            leftIcon={<Mail className="h-4 w-4" />}
            className="text-sm sm:text-base"
            title={!canEdit ? 'You need invoice edit permission to update quotes.' : undefined}
          >
            <span className="hidden sm:inline">Mark as Sent</span>
            <span className="sm:hidden">Send</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => router.push(`/quotes/${quote.id}/edit`)}
            disabled={processing || !canEdit}
            leftIcon={<Edit className="h-4 w-4" />}
            className="text-sm sm:text-base"
            title={!canEdit ? 'You need invoice edit permission to edit quotes.' : undefined}
          >
            <span>Edit</span>
          </Button>
        </>
      )}
      
      {quote.status === 'sent' && !isExpired && (
        <>
          <Button
            onClick={() => handleStatusChange('accepted')}
            disabled={processing || !canEdit}
            variant="success"
            leftIcon={<CheckCircle className="h-4 w-4" />}
            className="text-sm sm:text-base"
            title={!canEdit ? 'You need invoice edit permission to update quotes.' : undefined}
          >
            <span className="hidden sm:inline">Mark as Accepted</span>
            <span className="sm:hidden">Accept</span>
          </Button>
          <Button
            variant="danger"
            onClick={() => handleStatusChange('rejected')}
            disabled={processing || !canEdit}
            leftIcon={<XCircle className="h-4 w-4" />}
            className="text-sm sm:text-base"
            title={!canEdit ? 'You need invoice edit permission to update quotes.' : undefined}
          >
            <span className="hidden sm:inline">Mark as Rejected</span>
            <span className="sm:hidden">Reject</span>
          </Button>
        </>
      )}
      
      {quote.status === 'accepted' && !quote.converted_to_invoice_id && (
        <Button onClick={handleConvertToInvoice}
          disabled={processing || !canCreate}
          leftIcon={<FileText className="h-4 w-4" />}
          className="text-sm sm:text-base"
          title={!canCreate ? 'You need invoice create permission to convert quotes.' : undefined}
        >
          <span className="hidden sm:inline">Convert to Invoice</span>
          <span className="sm:hidden">Convert</span>
        </Button>
      )}

      {emailConfigured && (
        <Button
          variant="secondary"
          onClick={() => setShowEmailModal(true)}
          disabled={processing || !canEdit}
          leftIcon={<Mail className="h-4 w-4" />}
          className="text-sm sm:text-base"
          title={!canEdit ? 'You need invoice edit permission to email quotes.' : undefined}
        >
          <span className="hidden sm:inline">Send Email</span>
          <span className="sm:hidden">Email</span>
        </Button>
      )}
      
      <Button
        variant="secondary"
        onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, '_blank')}
        disabled={processing}
        leftIcon={<Download className="h-4 w-4" />}
        className="text-sm sm:text-base"
      >
        <span className="hidden sm:inline">Download PDF</span>
        <span className="sm:hidden">PDF</span>
      </Button>

      {quote.status === 'draft' && (
        <Button
          variant="danger"
          onClick={() => setShowDeleteDialog(true)}
          disabled={processing || !canDelete}
          leftIcon={<Trash2 className="h-4 w-4" />}
          className="text-sm sm:text-base"
          title={!canDelete ? 'You need invoice delete permission to delete quotes.' : undefined}
        >
          <span>Delete</span>
        </Button>
      )}
    </div>
  )

  return (
    <PageLayout {...layoutProps} navActions={navActions}>
      <div className="mb-2">
        <Badge variant={getStatusVariant(quote.status)}>
          {getStatusIcon(quote.status)}
          {quote.status.charAt(0).toUpperCase() + quote.status.slice(1).replace('_', ' ')}
        </Badge>
      </div>

      {error && (
        <Alert variant="error" title="Error" description={error} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section title="Quote Details">
            <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <h3 className="font-medium text-xs sm:text-sm text-gray-600 mb-1">From</h3>
                <p className="font-medium text-sm sm:text-base">Orange Jelly Limited</p>
                <p className="text-xs sm:text-sm text-gray-600">The Anchor, Horton Road</p>
                <p className="text-xs sm:text-sm text-gray-600">Stanwell Moor Village, Surrey</p>
                <p className="text-xs sm:text-sm text-gray-600">TW19 6AQ</p>
                <p className="text-xs sm:text-sm text-gray-600">VAT: GB315203647</p>
              </div>

              <div>
                <h3 className="font-medium text-xs sm:text-sm text-gray-600 mb-1">To</h3>
                {quote.vendor ? (
                  <>
                    <p className="font-medium text-sm sm:text-base">{quote.vendor.name}</p>
                    {quote.vendor.contact_name && (
                      <p className="text-xs sm:text-sm text-gray-600">{quote.vendor.contact_name}</p>
                    )}
                    {quote.vendor.email && (
                      <p className="text-xs sm:text-sm text-gray-600 break-all">{quote.vendor.email}</p>
                    )}
                    {quote.vendor.phone && (
                      <p className="text-xs sm:text-sm text-gray-600">{quote.vendor.phone}</p>
                    )}
                    {quote.vendor.address && (
                      <p className="text-xs sm:text-sm text-gray-600 whitespace-pre-line">{quote.vendor.address}</p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500">No vendor details</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6 pt-4 sm:pt-6 border-t">
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Quote Date</p>
                <p className="font-medium text-sm sm:text-base">
                  {new Date(quote.quote_date).toLocaleDateString('en-GB')}
                </p>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Valid Until</p>
                <p className="font-medium text-sm sm:text-base">
                  {new Date(quote.valid_until).toLocaleDateString('en-GB')}
                </p>
              </div>
            </div>
            </Card>
          </Section>

          <Section title="Line Items">
            <Card>
            <DataTable<any>
              data={quote.line_items || []}
              getRowKey={(it) => it.id}
              emptyMessage="No line items"
              columns={[
                { key: 'description', header: 'Description', cell: (it) => <span className="text-sm">{it.description}</span> },
                { key: 'quantity', header: 'Qty', align: 'right', cell: (it) => <span className="text-sm">{it.quantity}</span> },
                { key: 'unit_price', header: 'Unit Price', align: 'right', cell: (it) => <span className="text-sm">£{it.unit_price.toFixed(2)}</span> },
                { key: 'discount', header: 'Discount', align: 'right', cell: (it) => <span className="text-sm text-green-600">{it.discount_percentage > 0 ? `-${it.discount_percentage}%` : ''}</span> },
                { key: 'vat', header: 'VAT', align: 'right', cell: (it) => <span className="text-sm">{it.vat_rate}%</span> },
                { key: 'total', header: 'Total', align: 'right', cell: (it) => {
                  const lineSubtotal = it.quantity * it.unit_price
                  const lineDiscount = lineSubtotal * (it.discount_percentage / 100)
                  const lineAfterDiscount = lineSubtotal - lineDiscount
                  const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
                  const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscount * itemShare)
                  const lineVat = lineAfterQuoteDiscount * (it.vat_rate / 100)
                  const lineTotal = lineAfterQuoteDiscount + lineVat
                  return <span className="text-sm font-medium">£{lineTotal.toFixed(2)}</span>
                } },
              ]}
              renderMobileCard={(it) => {
                const lineSubtotal = it.quantity * it.unit_price
                const lineDiscount = lineSubtotal * (it.discount_percentage / 100)
                const lineAfterDiscount = lineSubtotal - lineDiscount
                const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
                const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscount * itemShare)
                const lineVat = lineAfterQuoteDiscount * (it.vat_rate / 100)
                const lineTotal = lineAfterQuoteDiscount + lineVat
                return (
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm mb-2">{it.description}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-500">Qty:</span> {it.quantity}</div>
                      <div><span className="text-gray-500">Unit Price:</span> £{it.unit_price.toFixed(2)}</div>
                      <div><span className="text-gray-500">Discount:</span> {it.discount_percentage > 0 ? (<span className="text-green-600"> -{it.discount_percentage}%</span>) : (<span>-</span>)}</div>
                      <div><span className="text-gray-500">VAT:</span> {it.vat_rate}%</div>
                    </div>
                    <div className="mt-2 pt-2 border-t flex justify-between">
                      <span className="text-sm font-medium">Total:</span>
                      <span className="text-sm font-medium">£{lineTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )
              }}
            />

            <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t space-y-2">
              <div className="flex justify-between text-xs sm:text-sm">
                <span>Subtotal:</span>
                <span>£{subtotal.toFixed(2)}</span>
              </div>
              {quote.quote_discount_percentage > 0 && (
                <div className="flex justify-between text-xs sm:text-sm text-green-600">
                  <span>Quote Discount ({quote.quote_discount_percentage}%):</span>
                  <span>-£{quoteDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs sm:text-sm">
                <span>VAT:</span>
                <span>£{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base sm:text-lg font-semibold pt-2 border-t">
                <span>Total:</span>
                <span>£{quote.total_amount.toFixed(2)}</span>
              </div>
            </div>
            </Card>
          </Section>

          {(quote.notes || quote.internal_notes) && (
            <Section title="Notes">
              <Card>
              {quote.notes && (
                <div className="mb-4">
                  <h3 className="font-medium text-xs sm:text-sm text-gray-600 mb-1">Quote Notes</h3>
                  <p className="text-xs sm:text-sm whitespace-pre-wrap">{quote.notes}</p>
                </div>
              )}
              
              {quote.internal_notes && (
                <div>
                  <h3 className="font-medium text-xs sm:text-sm text-gray-600 mb-1">Internal Notes</h3>
                  <p className="text-xs sm:text-sm whitespace-pre-wrap bg-yellow-50 p-2 sm:p-3 rounded-md">
                    {quote.internal_notes}
                  </p>
                </div>
              )}
              </Card>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Quote Status">
            <Card>
            <div className="space-y-4">
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Total Amount</p>
                <p className="text-xl sm:text-2xl font-bold">£{quote.total_amount.toFixed(2)}</p>
              </div>
              
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Status</p>
                <Badge variant={getStatusVariant(quote.status)}>
                  {getStatusIcon(quote.status)}
                  {quote.status.charAt(0).toUpperCase() + quote.status.slice(1).replace('_', ' ')}
                </Badge>
              </div>
              
              {quote.converted_to_invoice_id && (
                <div>
                  <p className="text-xs sm:text-sm text-gray-600">Converted to Invoice</p>
                  <p className="text-xs sm:text-sm font-medium text-green-600">
                    {quote.converted_invoice?.invoice_number}
                  </p>
                </div>
              )}

              {isExpired && quote.status === 'sent' && (
                <Alert variant="warning" description="This quote has expired" />
              )}
            </div>
            </Card>
          </Section>

          <Section title="Actions">
            <Card>
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
            </div>
            </Card>
          </Section>
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
            confirmText="Delete"
          />
        </>
      )}
    </PageLayout>
  )
}
