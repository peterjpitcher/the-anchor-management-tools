'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, convertQuoteToInvoice } from '@/app/actions/quotes'
import { Button } from '@/components/ui/Button'
import { ArrowLeft, FileText, AlertTriangle } from 'lucide-react'
import type { QuoteWithDetails } from '@/types/invoices'

export default function ConvertQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [quote, setQuote] = useState<QuoteWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [quoteId, setQuoteId] = useState<string | null>(null)

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
        
        if (result.quote.status !== 'accepted') {
          throw new Error('Only accepted quotes can be converted to invoices')
        }
        
        if (result.quote.converted_to_invoice_id) {
          throw new Error('This quote has already been converted to an invoice')
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
    }
  }, [quoteId])


  async function handleConvert() {
    if (!quoteId) return
    
    setConverting(true)
    setError(null)

    try {
      const result = await convertQuoteToInvoice(quoteId)
      if (result.error) {
        throw new Error(result.error)
      }

      if (result.invoice) {
        router.push(`/invoices/${result.invoice.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert quote')
      setConverting(false)
    }
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
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 mb-4">{error || 'Quote not found'}</p>
          <Button
            variant="outline"
            onClick={() => router.push('/quotes')}
          >
            Back to Quotes
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => router.push(`/quotes/${quoteId}`)}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Quote
        </Button>
        
        <h1 className="text-3xl font-bold mb-2">Convert Quote to Invoice</h1>
        <p className="text-muted-foreground">Review the quote details before converting</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Quote Details</h2>
        
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">Quote Number:</span>
            <span className="font-medium">{quote.quote_number}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-600">Vendor:</span>
            <span className="font-medium">{quote.vendor?.name || '-'}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-600">Quote Date:</span>
            <span className="font-medium">
              {new Date(quote.quote_date).toLocaleDateString('en-GB')}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-600">Valid Until:</span>
            <span className="font-medium">
              {new Date(quote.valid_until).toLocaleDateString('en-GB')}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-gray-600">Total Amount:</span>
            <span className="font-bold text-lg">£{quote.total_amount.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
        <div className="flex items-start gap-3">
          <FileText className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 mb-1">What happens next?</h3>
            <ul className="space-y-1 text-sm text-blue-800">
              <li>• A new invoice will be created with the same details as this quote</li>
              <li>• The invoice will have status &quot;Draft&quot; and can be edited if needed</li>
              <li>• The invoice date will be today&apos;s date</li>
              <li>• Payment will be due in 30 days from today</li>
              <li>• This quote will be marked as converted and cannot be converted again</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <Button
          onClick={handleConvert}
          disabled={converting}
          className="flex-1"
        >
          {converting ? 'Converting...' : 'Convert to Invoice'}
        </Button>
        
        <Button
          variant="outline"
          onClick={() => router.push(`/quotes/${quoteId}`)}
          disabled={converting}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}