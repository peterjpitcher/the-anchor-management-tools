'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, convertQuoteToInvoice } from '@/app/actions/quotes'
import { AlertTriangle } from 'lucide-react'
import type { QuoteWithDetails } from '@/types/invoices'
// UI v2 components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'

import { usePermissions } from '@/contexts/PermissionContext'
export default function ConvertQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('invoices', 'view')
  const canCreate = hasPermission('invoices', 'create')
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
    const id = quoteId

    if (!id || permissionsLoading) {
      return
    }

    if (!canView) {
      router.replace('/unauthorized')
      return
    }

    async function loadQuote(currentId: string) {
      setLoading(true)
      try {
        const result = await getQuote(currentId)
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
    
    void loadQuote(id)
  }, [quoteId, permissionsLoading, canView, router])

  useEffect(() => {
    if (!permissionsLoading && canView && !canCreate) {
      router.replace('/unauthorized')
    }
  }, [permissionsLoading, canView, canCreate, router])


  async function handleConvert() {
    if (!quoteId) return

    if (!canCreate) {
      toast.error('You do not have permission to convert quotes')
      return
    }
    
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

  if (permissionsLoading) {
    return (
      <PageLayout
        title="Convert Quote"
        subtitle="Loading quote details..."
        backButton={{ label: 'Back to Quotes', href: '/quotes' }}
        loading
        loadingLabel="Loading quote..."
      />
    )
  }

  if (!canCreate) {
    return null
  }

  if (loading) {
    return (
      <PageLayout
        title="Convert Quote"
        subtitle="Loading quote details..."
        backButton={{ label: 'Back to Quotes', href: '/quotes' }}
        loading
        loadingLabel="Loading quote..."
      />
    )
  }

  if (!quote) {
    return (
      <PageLayout
        title="Convert Quote"
        subtitle="Quote not found"
        backButton={{ label: 'Back to Quotes', href: '/quotes' }}
        error={error || 'Quote not found'}
      />
    )
  }

  return (
    <PageLayout
      title="Convert Quote to Invoice"
      subtitle="Review the quote details before converting"
      backButton={{ label: 'Back to Quote', href: `/quotes/${quoteId}` }}
      navActions={
        <LinkButton href="/quotes" variant="secondary">
          All Quotes
        </LinkButton>
      }
    >
      <div className="space-y-6">
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
          disabled={converting || !canCreate}
          title={!canCreate ? 'You need invoice create permission to convert quotes.' : undefined}
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
      </div>
    </PageLayout>
  )
}
