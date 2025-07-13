'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuotes, getQuoteSummary } from '@/app/actions/quotes'
import { Button } from '@/components/ui/Button'
import { Plus, FileText, TrendingUp, Clock, AlertCircle, FileEdit, ChevronLeft, Download, Package, ArrowRight } from 'lucide-react'
import type { QuoteWithDetails, QuoteStatus } from '@/types/invoices'

export default function QuotesPage() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<QuoteWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [summary, setSummary] = useState({
    total_pending: 0,
    total_expired: 0,
    total_accepted: 0,
    draft_count: 0
  })

  useEffect(() => {
    loadData()
  }, [statusFilter])

  async function loadData() {
    try {
      const [quotesResult, summaryResult] = await Promise.all([
        getQuotes(statusFilter === 'all' ? undefined : statusFilter),
        getQuoteSummary()
      ])

      if (quotesResult.error || !quotesResult.quotes) {
        throw new Error(quotesResult.error || 'Failed to load quotes')
      }

      setQuotes(quotesResult.quotes)
      
      if (summaryResult.summary) {
        setSummary(summaryResult.summary)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
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
    <div className="space-y-6">
      <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Quotes</h1>
              <p className="text-sm sm:text-base text-gray-600 mt-1">Manage quotes and estimates for your vendors</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="outline"
                onClick={() => router.push('/invoices')}
                className="text-sm sm:text-base"
              >
                <FileText className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Invoices</span>
                <span className="sm:hidden">Inv</span>
              </Button>
              <Button onClick={() => router.push('/quotes/new')} className="text-sm sm:text-base">
                <Plus className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">New Quote</span>
                <span className="sm:hidden">New</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border p-3 sm:p-4 lg:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-gray-600">Pending</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-semibold mt-0.5 sm:mt-1 truncate">£{summary.total_pending.toFixed(2)}</p>
              </div>
              <TrendingUp className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-blue-500 flex-shrink-0 ml-2" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-3 sm:p-4 lg:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-gray-600">Expired</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-semibold mt-0.5 sm:mt-1 truncate">£{summary.total_expired.toFixed(2)}</p>
              </div>
              <Clock className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-yellow-500 flex-shrink-0 ml-2" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-3 sm:p-4 lg:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-gray-600">Accepted</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-semibold mt-0.5 sm:mt-1 truncate">£{summary.total_accepted.toFixed(2)}</p>
              </div>
              <TrendingUp className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-green-500 flex-shrink-0 ml-2" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-3 sm:p-4 lg:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-gray-600">Drafts</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-semibold mt-0.5 sm:mt-1">{summary.draft_count}</p>
              </div>
              <FileEdit className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-gray-500 flex-shrink-0 ml-2" />
            </div>
          </div>
        </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-3 sm:p-4 border-b">
          <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 justify-between items-stretch lg:items-center">
            <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | 'all')}
              className="px-3 py-2 text-sm sm:text-base border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px] sm:min-h-[44px]"
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
              className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
            />
          </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" className="text-sm">
                <Download className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Export</span>
                <span className="sm:hidden">Exp</span>
              </Button>
            </div>
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
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
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
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(quote.status)}`}>
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
            
            {/* Mobile Card View */}
            <div className="lg:hidden">
              <div className="space-y-3 p-3 sm:p-4">
                {filteredQuotes.map((quote) => {
                  const isExpired = quote.status === 'expired'
                  const isAccepted = quote.status === 'accepted'
                  const isDraft = quote.status === 'draft'
                  
                  return (
                    <div 
                      key={quote.id}
                      onClick={() => router.push(`/quotes/${quote.id}`)}
                      className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900">{quote.quote_number}</p>
                          {quote.reference && (
                            <p className="text-sm text-gray-500 truncate">{quote.reference}</p>
                          )}
                          <p className="text-sm text-gray-600 mt-1">{quote.vendor?.name || '-'}</p>
                        </div>
                        <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(quote.status)}`}>
                          {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                        <div>
                          <p className="text-gray-500">Date</p>
                          <p className="font-medium">{new Date(quote.quote_date).toLocaleDateString('en-GB')}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Valid Until</p>
                          <p className="font-medium">{new Date(quote.valid_until).toLocaleDateString('en-GB')}</p>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center pt-3 border-t">
                        <p className="text-lg font-semibold">£{quote.total_amount.toFixed(2)}</p>
                        <div onClick={(e) => e.stopPropagation()}>
                          {quote.status === 'accepted' && !quote.converted_to_invoice_id && (
                            <Button
                              size="sm"
                              onClick={() => router.push(`/quotes/${quote.id}/convert`)}
                              className="text-sm"
                            >
                              <ArrowRight className="h-3 w-3 mr-1" />
                              Convert
                            </Button>
                          )}
                          {quote.converted_to_invoice_id && (
                            <span className="text-sm text-green-600 font-medium">Converted</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Quick Actions */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <Button
          variant="outline"
          className="h-20 sm:h-24 flex flex-col items-center justify-center gap-1 sm:gap-2 p-3 sm:p-4"
          onClick={() => router.push('/invoices/vendors')}
        >
          <FileText className="h-6 w-6 sm:h-8 sm:w-8" />
          <span className="text-xs sm:text-sm">Vendors</span>
        </Button>
        
        <Button
          variant="outline"
          className="h-20 sm:h-24 flex flex-col items-center justify-center gap-1 sm:gap-2 p-3 sm:p-4"
          onClick={() => router.push('/invoices/catalog')}
        >
          <Package className="h-6 w-6 sm:h-8 sm:w-8" />
          <span className="text-xs sm:text-sm text-center">Line Item Catalog</span>
        </Button>
        
        <Button
          variant="outline"
          className="h-20 sm:h-24 flex flex-col items-center justify-center gap-1 sm:gap-2 p-3 sm:p-4 sm:col-span-2 lg:col-span-1"
        >
          <Download className="h-6 w-6 sm:h-8 sm:w-8" />
          <span className="text-xs sm:text-sm">Export Quotes</span>
        </Button>
      </div>
    </div>
  )
}