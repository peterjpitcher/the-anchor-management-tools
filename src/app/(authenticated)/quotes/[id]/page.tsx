'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, updateQuoteStatus, convertQuoteToInvoice } from '@/app/actions/quotes'
import { getEmailConfigStatus } from '@/app/actions/email'
import { Button } from '@/components/ui/Button'
import { ArrowLeft, FileText, Download, Mail, CheckCircle, XCircle, Edit } from 'lucide-react'
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

  function getStatusColor(status: QuoteStatus): string {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800'
      case 'sent': return 'bg-blue-100 text-blue-800'
      case 'accepted': return 'bg-green-100 text-green-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      case 'expired': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
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
      <div className="container mx-auto p-6 max-w-4xl">
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

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => router.push('/quotes')}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Quotes
        </Button>
        
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold mb-2">Quote {quote.quote_number}</h1>
            <div className="flex items-center gap-4 text-gray-600">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(quote.status)}`}>
                {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
              </span>
              {quote.converted_to_invoice_id && (
                <span className="text-sm text-green-600">
                  Converted to Invoice: {quote.converted_invoice?.invoice_number}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex gap-2">
            {quote.status === 'draft' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/quotes/${quote.id}/edit`)}
                  disabled={processing}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button
                  onClick={() => handleStatusChange('sent')}
                  disabled={processing}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Mark as Sent
                </Button>
              </>
            )}
            
            {quote.status === 'sent' && !isExpired && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleStatusChange('accepted')}
                  disabled={processing}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark Accepted
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleStatusChange('rejected')}
                  disabled={processing}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Mark Rejected
                </Button>
              </>
            )}
            
            {quote.status === 'accepted' && !quote.converted_to_invoice_id && (
              <Button
                onClick={handleConvertToInvoice}
                disabled={processing}
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
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Quote Information */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Quote Information</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Quote Date</p>
              <p className="font-medium">
                {new Date(quote.quote_date).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric'
                })}
              </p>
            </div>
            
            <div>
              <p className="text-sm text-gray-600">Valid Until</p>
              <p className="font-medium">
                {new Date(quote.valid_until).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric'
                })}
                {isExpired && (
                  <span className="text-red-600 text-sm ml-2">(Expired)</span>
                )}
              </p>
            </div>
            
            {quote.reference && (
              <div>
                <p className="text-sm text-gray-600">Reference</p>
                <p className="font-medium">{quote.reference}</p>
              </div>
            )}
          </div>
        </div>

        {/* Vendor Information */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Vendor Information</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Company Name</p>
              <p className="font-medium">{quote.vendor?.name || '-'}</p>
            </div>
            
            {quote.vendor?.contact_name && (
              <div>
                <p className="text-sm text-gray-600">Contact Name</p>
                <p className="font-medium">{quote.vendor.contact_name}</p>
              </div>
            )}
            
            {quote.vendor?.email && (
              <div>
                <p className="text-sm text-gray-600">Email</p>
                <p className="font-medium">{quote.vendor.email}</p>
              </div>
            )}
            
            {quote.vendor?.phone && (
              <div>
                <p className="text-sm text-gray-600">Phone</p>
                <p className="font-medium">{quote.vendor.phone}</p>
              </div>
            )}
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Line Items</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-medium text-gray-700">Description</th>
                  <th className="text-right p-2 font-medium text-gray-700">Qty</th>
                  <th className="text-right p-2 font-medium text-gray-700">Unit Price</th>
                  <th className="text-right p-2 font-medium text-gray-700">Discount</th>
                  <th className="text-right p-2 font-medium text-gray-700">Subtotal</th>
                  <th className="text-right p-2 font-medium text-gray-700">VAT</th>
                </tr>
              </thead>
              <tbody>
                {quote.line_items?.map((item, index) => {
                  const lineTotal = calculateLineTotal(item)
                  return (
                    <tr key={index} className="border-b">
                      <td className="p-2">{item.description}</td>
                      <td className="text-right p-2">{item.quantity}</td>
                      <td className="text-right p-2">£{item.unit_price.toFixed(2)}</td>
                      <td className="text-right p-2">
                        {item.discount_percentage > 0 && `${item.discount_percentage}%`}
                      </td>
                      <td className="text-right p-2">£{lineTotal.toFixed(2)}</td>
                      <td className="text-right p-2">{item.vat_rate}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Summary</h2>
          
          <div className="max-w-xs ml-auto space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal:</span>
              <span className="font-medium">£{quote.subtotal_amount.toFixed(2)}</span>
            </div>
            
            {quote.discount_amount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Discount ({quote.quote_discount_percentage}%):</span>
                <span>-£{quote.discount_amount.toFixed(2)}</span>
              </div>
            )}
            
            <div className="flex justify-between">
              <span className="text-gray-600">VAT:</span>
              <span className="font-medium">£{quote.vat_amount.toFixed(2)}</span>
            </div>
            
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total:</span>
              <span>£{quote.total_amount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {(quote.notes || quote.internal_notes) && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-xl font-semibold mb-4">Notes</h2>
            
            {quote.notes && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-1">Quote Notes</p>
                <p className="whitespace-pre-wrap">{quote.notes}</p>
              </div>
            )}
            
            {quote.internal_notes && (
              <div>
                <p className="text-sm text-gray-600 mb-1">Internal Notes</p>
                <p className="whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded">
                  {quote.internal_notes}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {quote && (
        <EmailQuoteModal
          quote={quote}
          isOpen={showEmailModal}
          onClose={() => setShowEmailModal(false)}
          onSuccess={async () => {
            // Reload quote to get updated status
            if (quoteId) {
              const result = await getQuote(quoteId)
              if (result.quote) {
                setQuote(result.quote)
              }
            }
          }}
        />
      )}
    </div>
  )
}