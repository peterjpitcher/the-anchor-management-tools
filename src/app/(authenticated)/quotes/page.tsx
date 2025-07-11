'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuotes } from '@/app/actions/quotes'
import { Button } from '@/components/ui/Button'
import { Plus, FileText, CheckCircle, XCircle, Clock, ArrowRight } from 'lucide-react'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'

export default function QuotesPage() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<QuoteWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    async function loadQuotes() {
      try {
        const result = await getQuotes(statusFilter === 'all' ? undefined : statusFilter)

        if (result.error || !result.quotes) {
          throw new Error(result.error || 'Failed to load quotes')
        }

        setQuotes(result.quotes)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    
    loadQuotes()
  }, [statusFilter])


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

  function getStatusIcon(status: QuoteStatus) {
    switch (status) {
      case 'accepted': return <CheckCircle className="h-4 w-4" />
      case 'rejected': return <XCircle className="h-4 w-4" />
      case 'expired': return <Clock className="h-4 w-4" />
      default: return null
    }
  }

  const filteredQuotes = quotes.filter(quote => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      quote.quote_number.toLowerCase().includes(search) ||
      quote.vendor?.name.toLowerCase().includes(search) ||
      quote.reference?.toLowerCase().includes(search)
    )
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading quotes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Quotes</h1>
          <p className="text-muted-foreground">Manage quotes and estimates</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => router.push('/invoices')}
          >
            <FileText className="h-4 w-4 mr-2" />
            Invoices
          </Button>
          <Button onClick={() => router.push('/quotes/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New Quote
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-4 border-b flex flex-col md:flex-row gap-4 justify-between">
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | 'all')}
              className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Quotes</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
            </select>
            
            <input
              type="text"
              placeholder="Search quotes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {filteredQuotes.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 mb-4">
              {searchTerm ? 'No quotes match your search.' : 'No quotes found.'}
            </p>
            {!searchTerm && (
              <Button onClick={() => router.push('/quotes/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Quote
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-4 font-medium text-gray-700">Quote #</th>
                  <th className="text-left p-4 font-medium text-gray-700">Vendor</th>
                  <th className="text-left p-4 font-medium text-gray-700">Date</th>
                  <th className="text-left p-4 font-medium text-gray-700">Valid Until</th>
                  <th className="text-left p-4 font-medium text-gray-700">Status</th>
                  <th className="text-right p-4 font-medium text-gray-700">Amount</th>
                  <th className="text-center p-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr 
                    key={quote.id} 
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/quotes/${quote.id}`)}
                  >
                    <td className="p-4">
                      <div className="font-medium">{quote.quote_number}</div>
                      {quote.reference && (
                        <div className="text-sm text-gray-500">{quote.reference}</div>
                      )}
                    </td>
                    <td className="p-4">{quote.vendor?.name || '-'}</td>
                    <td className="p-4 text-sm">
                      {new Date(quote.quote_date).toLocaleDateString('en-GB')}
                    </td>
                    <td className="p-4 text-sm">
                      {new Date(quote.valid_until).toLocaleDateString('en-GB')}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(quote.status)}`}>
                        {getStatusIcon(quote.status)}
                        {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
                      </span>
                    </td>
                    <td className="p-4 text-right font-medium">
                      £{quote.total_amount.toFixed(2)}
                    </td>
                    <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                      {quote.status === 'accepted' && !quote.converted_to_invoice_id && (
                        <Button
                          size="sm"
                          onClick={() => router.push(`/quotes/${quote.id}/convert`)}
                        >
                          <ArrowRight className="h-4 w-4 mr-1" />
                          Convert
                        </Button>
                      )}
                      {quote.converted_to_invoice_id && (
                        <span className="text-sm text-green-600">Converted</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}