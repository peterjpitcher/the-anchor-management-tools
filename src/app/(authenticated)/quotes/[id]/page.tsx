'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, updateQuoteStatus, convertQuoteToInvoice, deleteQuote } from '@/app/actions/quotes'
import { getEmailConfigStatus } from '@/app/actions/email'
import { Button } from '@/components/ui/Button'
import { ChevronLeft, FileText, Download, Mail, CheckCircle, XCircle, Edit, Copy, Trash2, Clock } from 'lucide-react'
import { EmailQuoteModal } from '@/components/EmailQuoteModal'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [quote, setQuote] = useState<QuoteWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)

  useEffect(() => {
    async function getParams() {
      const { id } = await params
      setQuoteId(id)
    }
    getParams()
  }, [params])

  useEffect(() => {
    async function loadQuote() {
      if (!quoteId) return
      
      try {
        const result = await getQuote(quoteId)
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
    
    if (quoteId) {
      loadQuote()
      checkEmailConfig()
    }
  }, [quoteId])

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
    if (!quoteId) return
    
    try {
      const result = await getQuote(quoteId)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setProcessing(false)
    }
  }

  async function handleConvertToInvoice() {
    if (!quote) return
    
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
        router.push(`/invoices/${result.invoice.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert to invoice')
    } finally {
      setProcessing(false)
    }
  }

  async function handleDelete() {
    if (!quote || processing) return

    if (!confirm('Are you sure you want to delete this quote? This action cannot be undone.')) {
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

      router.push('/quotes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete quote')
      setProcessing(false)
    }
  }

  function getStatusColor(status: QuoteStatus): string {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800'
      case 'sent': return 'bg-blue-100 text-blue-800'
      case 'accepted': return 'bg-green-100 text-green-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      case 'expired': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
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

  function calculateLineTotal(item: { quantity: number; unit_price: number; discount_percentage: number }) {
    const subtotal = item.quantity * item.unit_price
    const discount = subtotal * (item.discount_percentage / 100)
    return subtotal - discount
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading quote...</p>
        </div>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <p className="text-red-600">Quote not found</p>
          <Button
            variant="outline"
            onClick={() => router.push('/quotes')}
            className="mt-4"
          >
            Back to Quotes
          </Button>
        </div>
      </div>
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

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.push('/quotes')}
          className="mb-4"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Quotes
        </Button>

        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold mb-2">Quote {quote.quote_number}</h1>
            <div className="flex items-center gap-4">
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(quote.status)}`}>
                {getStatusIcon(quote.status)}
                {quote.status.charAt(0).toUpperCase() + quote.status.slice(1).replace('_', ' ')}
              </span>
              {quote.reference && (
                <span className="text-gray-600">
                  Reference: {quote.reference}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex gap-2">
            {quote.status === 'draft' && (
              <>
                <Button
                  onClick={() => handleStatusChange('sent')}
                  disabled={processing}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Mark as Sent
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/quotes/${quote.id}/edit`)}
                  disabled={processing}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              </>
            )}
            
            {quote.status === 'sent' && !isExpired && (
              <>
                <Button
                  onClick={() => handleStatusChange('accepted')}
                  disabled={processing}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark as Accepted
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleStatusChange('rejected')}
                  disabled={processing}
                  className="text-red-600 hover:bg-red-50"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Mark as Rejected
                </Button>
              </>
            )}
            
            {quote.status === 'accepted' && !quote.converted_to_invoice_id && (
              <Button
                onClick={handleConvertToInvoice}
                disabled={processing}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <FileText className="h-4 w-4 mr-2" />
                Convert to Invoice
              </Button>
            )}

            {emailConfigured && (
              <Button
                variant="outline"
                onClick={() => setShowEmailModal(true)}
                disabled={processing}
              >
                <Mail className="h-4 w-4 mr-2" />
                Send Email
              </Button>
            )}
            
            <Button
              variant="outline"
              onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, '_blank')}
              disabled={processing}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>

            {quote.status === 'draft' && (
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={processing}
                className="text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Quote Details</h2>
            
            <div className="grid grid-cols-2 gap-6">
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
                {quote.vendor ? (
                  <>
                    <p className="font-medium">{quote.vendor.name}</p>
                    {quote.vendor.contact_name && (
                      <p className="text-sm text-gray-600">{quote.vendor.contact_name}</p>
                    )}
                    {quote.vendor.email && (
                      <p className="text-sm text-gray-600">{quote.vendor.email}</p>
                    )}
                    {quote.vendor.phone && (
                      <p className="text-sm text-gray-600">{quote.vendor.phone}</p>
                    )}
                    {quote.vendor.address && (
                      <p className="text-sm text-gray-600 whitespace-pre-line">{quote.vendor.address}</p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500">No vendor details</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mt-6 pt-6 border-t">
              <div>
                <p className="text-sm text-gray-600">Quote Date</p>
                <p className="font-medium">
                  {new Date(quote.quote_date).toLocaleDateString('en-GB')}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Valid Until</p>
                <p className="font-medium">
                  {new Date(quote.valid_until).toLocaleDateString('en-GB')}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Line Items</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-sm font-medium text-gray-600">Description</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Qty</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Unit Price</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Discount</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">VAT</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.line_items?.map((item) => {
                    const lineSubtotal = item.quantity * item.unit_price
                    const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
                    const lineAfterDiscount = lineSubtotal - lineDiscount
                    const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
                    const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscount * itemShare)
                    const lineVat = lineAfterQuoteDiscount * (item.vat_rate / 100)
                    const lineTotal = lineAfterQuoteDiscount + lineVat

                    return (
                      <tr key={item.id} className="border-b">
                        <td className="py-3 text-sm">{item.description}</td>
                        <td className="py-3 text-sm text-right">{item.quantity}</td>
                        <td className="py-3 text-sm text-right">£{item.unit_price.toFixed(2)}</td>
                        <td className="py-3 text-sm text-right">
                          {item.discount_percentage > 0 && (
                            <span className="text-green-600">-{item.discount_percentage}%</span>
                          )}
                        </td>
                        <td className="py-3 text-sm text-right">{item.vat_rate}%</td>
                        <td className="py-3 text-sm text-right font-medium">£{lineTotal.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-6 pt-6 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>£{subtotal.toFixed(2)}</span>
              </div>
              {quote.quote_discount_percentage > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Quote Discount ({quote.quote_discount_percentage}%):</span>
                  <span>-£{quoteDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span>VAT:</span>
                <span>£{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                <span>Total:</span>
                <span>£{quote.total_amount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {(quote.notes || quote.internal_notes) && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-semibold mb-4">Notes</h2>
              
              {quote.notes && (
                <div className="mb-4">
                  <h3 className="font-medium text-sm text-gray-600 mb-1">Quote Notes</h3>
                  <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
                </div>
              )}
              
              {quote.internal_notes && (
                <div>
                  <h3 className="font-medium text-sm text-gray-600 mb-1">Internal Notes</h3>
                  <p className="text-sm whitespace-pre-wrap bg-yellow-50 p-3 rounded-md">
                    {quote.internal_notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Quote Status</h2>
            
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Total Amount</p>
                <p className="text-2xl font-bold">£{quote.total_amount.toFixed(2)}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-600">Status</p>
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(quote.status)}`}>
                  {getStatusIcon(quote.status)}
                  {quote.status.charAt(0).toUpperCase() + quote.status.slice(1).replace('_', ' ')}
                </span>
              </div>
              
              {quote.converted_to_invoice_id && (
                <div>
                  <p className="text-sm text-gray-600">Converted to Invoice</p>
                  <p className="text-sm font-medium text-green-600">
                    {quote.converted_invoice?.invoice_number}
                  </p>
                </div>
              )}

              {isExpired && quote.status === 'sent' && (
                <div className="p-3 bg-yellow-50 rounded-md">
                  <p className="text-sm text-yellow-800">
                    This quote has expired
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  alert('Link copied to clipboard!')
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Link
              </Button>
              
              {quote.status === 'sent' && !isExpired && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleStatusChange('expired')}
                  disabled={processing}
                >
                  Mark as Expired
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {quote && (
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
      )}
    </div>
  )
}