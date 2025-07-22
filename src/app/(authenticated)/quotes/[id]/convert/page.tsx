'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, convertQuoteToInvoice } from '@/app/actions/quotes'
import { ArrowLeft, FileText, AlertTriangle } from 'lucide-react'
import type { QuoteWithDetails } from '@/types/invoices'
// UI v2 components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'

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
        toast.success('Quote converted to invoice successfully')
        router.push(`/invoices/${result.invoice.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert quote')
      toast.error('Failed to convert quote to invoice')
      setConverting(false)
    }
  }

  if (loading) {
    return (
      <Page title="Loading...">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-600">Loading quote...</p>
          </div>
        </div>
      </Page>
    )
  }

  if (!quote) {
    return (
      <Page title="Convert Quote">
        <Card>
          <div className="text-center py-8">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-600 mb-4">{error || 'Quote not found'}</p>
            <Button
              variant="secondary"
              onClick={() => router.push('/quotes')}
            >
              Back to Quotes
            </Button>
          </div>
        </Card>
      </Page>
    )
  }

  return (
    <Page
      title="Convert Quote to Invoice"
      description="Review the quote details before converting"
    >
      {error && (
        <Alert variant="error" title="Error" description={error} />
      )}

      <Section title="Quote Details">
        <Card>
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
        </Card>
      </Section>

      <Alert variant="info"
        title="What happens next?"
        description="A new invoice will be created with the same details as this quote. The invoice will have status 'Draft' and can be edited if needed. The invoice date will be today's date with payment due in 30 days. This quote will be marked as converted."
      />

      <div className="flex gap-4">
        <Button
          onClick={handleConvert}
          loading={converting}
          className="flex-1"
        >
          Convert to Invoice
        </Button>
        
        <Button
          variant="secondary"
          onClick={() => router.push(`/quotes/${quoteId}`)}
          disabled={converting}
        >
          Cancel
        </Button>
      </div>
    </Page>
  )
}