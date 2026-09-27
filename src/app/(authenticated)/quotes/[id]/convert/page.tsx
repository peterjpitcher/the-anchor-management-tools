'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, convertQuoteToInvoice } from '@/app/actions/quotes'
import type { QuoteWithDetails } from '@/types/invoices'
import {
  PageLayout,
  Card,
  CardHeader,
  CardBody,
  Button,
  LinkButton,
  Alert,
  DescriptionList,
  FormFooter,
  toast,
} from '@/ds'

import { usePermissions } from '@/contexts/PermissionContext'
import { quotePageTitle } from '@/app/(authenticated)/invoices/_shared/nav'

function formatCurrency(value: number | null | undefined): string {
  const amount = Number(value ?? 0)
  return `£${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`
}

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

  const backHref = quoteId ? `/quotes/${quoteId}` : '/quotes'
  const layoutProps = {
    title: 'Convert to Invoice',
    subtitle: 'Review the quote details before converting',
    // Back to the quote page, named as that page is titled ("Quote Q-001").
    backButton: { label: `Back to ${quotePageTitle(quote?.quote_number)}`, href: backHref },
    containerSize: 'md' as const,
  }

  if (permissionsLoading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading quote" />
  }

  if (!canCreate) {
    return null
  }

  if (loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading quote" />
  }

  if (!quote) {
    return <PageLayout {...layoutProps} error={error || 'Quote not found'} />
  }

  return (
    <PageLayout {...layoutProps}>
      {error && (
        <Alert tone="danger" title="Error">{error}</Alert>
      )}

      <Card>
        <CardHeader title="Quote Details" />
        <CardBody>
          <DescriptionList
            items={[
              { key: 'number', label: 'Quote Number', value: <span className="font-medium">{quote.quote_number}</span> },
              { key: 'vendor', label: 'Vendor', value: <span className="font-medium">{quote.vendor?.name || '-'}</span> },
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
              {
                key: 'total',
                label: 'Total Amount',
                value: <span className="text-lg font-bold">{formatCurrency(quote.total_amount)}</span>,
              },
            ]}
          />
        </CardBody>
      </Card>

      <Alert tone="info" title="What happens next?" role="status">
        {"A new invoice will be created with the same details as this quote. The invoice will have status 'Draft' and can be edited if needed. The invoice date will be today's date with payment due in 30 days. This quote will be marked as converted."}
      </Alert>

      <FormFooter>
        <LinkButton href={backHref} variant="secondary" disabled={converting}>
          Cancel
        </LinkButton>
        <Button variant="primary"
          onClick={handleConvert}
          loading={converting}
          disabled={converting || !canCreate}
          title={!canCreate ? 'You need invoice create permission to convert quotes.' : undefined}
        >
          Convert to Invoice
        </Button>
      </FormFooter>
    </PageLayout>
  )
}
