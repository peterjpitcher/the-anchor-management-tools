'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, updateQuote } from '@/app/actions/quotes'
import { getVendors } from '@/app/actions/vendors'
import { Button } from '@/components/ui/Button'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import type { InvoiceVendor, InvoiceLineItemInput, QuoteWithDetails } from '@/types/invoices'

export default function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [quote, setQuote] = useState<QuoteWithDetails | null>(null)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quoteId, setQuoteId] = useState<string | null>(null)
  
  // Form state
  const [selectedVendor, setSelectedVendor] = useState('')
  const [quoteDate, setQuoteDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [reference, setReference] = useState('')
  const [quoteDiscount, setQuoteDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([])

  useEffect(() => {
    async function getParams() {
      const { id } = await params
      setQuoteId(id)
    }
    getParams()
  }, [params])

  useEffect(() => {
    async function loadData() {
      if (!quoteId) return
      
      try {
        const [vendorsResult, quoteResult] = await Promise.all([
          getVendors(),
          getQuote(quoteId)
        ])

        if (vendorsResult.error || !vendorsResult.vendors) {
          throw new Error(vendorsResult.error || 'Failed to load vendors')
        }

        if (quoteResult.error || !quoteResult.quote) {
          throw new Error(quoteResult.error || 'Failed to load quote')
        }

        const quoteData = quoteResult.quote
        
        // Only allow editing draft quotes
        if (quoteData.status !== 'draft') {
          throw new Error('Only draft quotes can be edited')
        }

        setVendors(vendorsResult.vendors)
        setQuote(quoteData)
        
        // Populate form fields
        setSelectedVendor(quoteData.vendor_id || '')
        setQuoteDate(quoteData.quote_date)
        setValidUntil(quoteData.valid_until)
        setReference(quoteData.reference || '')
        setQuoteDiscount(quoteData.quote_discount_percentage || 0)
        setNotes(quoteData.notes || '')
        setInternalNotes(quoteData.internal_notes || '')
        
        // Convert line items
        const items = (quoteData.line_items || []).map(item => ({
          catalog_item_id: item.catalog_item_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percentage: item.discount_percentage,
          vat_rate: item.vat_rate
        }))
        
        setLineItems(items.length > 0 ? items : [{
          catalog_item_id: undefined,
          description: '',
          quantity: 1,
          unit_price: 0,
          discount_percentage: 0,
          vat_rate: 20
        }])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    
    if (quoteId) {
      loadData()
    }
  }, [quoteId])


  function addLineItem() {
    setLineItems([...lineItems, {
      catalog_item_id: undefined,
      description: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      vat_rate: 20
    }])
  }

  function removeLineItem(index: number) {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index))
    }
  }

  function updateLineItem(index: number, updates: Partial<InvoiceLineItemInput>) {
    const updatedItems = [...lineItems]
    updatedItems[index] = { ...updatedItems[index], ...updates }
    setLineItems(updatedItems)
  }

  // Calculate totals
  function calculateTotals() {
    let subtotal = 0
    let totalVat = 0

    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      subtotal += lineAfterDiscount
    })

    const quoteDiscountAmount = subtotal * (quoteDiscount / 100)
    const afterQuoteDiscount = subtotal - quoteDiscountAmount

    // Calculate VAT after all discounts
    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      const lineShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
      const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscountAmount * lineShare)
      const lineVat = lineAfterQuoteDiscount * (item.vat_rate / 100)
      totalVat += lineVat
    })

    const total = afterQuoteDiscount + totalVat

    return {
      subtotal,
      quoteDiscountAmount,
      totalVat,
      total
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!quote || !quoteId) return
    
    if (!selectedVendor) {
      setError('Please select a vendor')
      return
    }

    if (lineItems.length === 0) {
      setError('Please add at least one line item')
      return
    }

    const hasInvalidItems = lineItems.some(item => 
      !item.description || item.quantity <= 0 || item.unit_price < 0
    )

    if (hasInvalidItems) {
      setError('Please fill in all line items with valid values')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('quote_id', quoteId)
      formData.append('vendor_id', selectedVendor)
      formData.append('quote_date', quoteDate)
      formData.append('valid_until', validUntil)
      formData.append('reference', reference)
      formData.append('quote_discount_percentage', quoteDiscount.toString())
      formData.append('notes', notes)
      formData.append('internal_notes', internalNotes)
      formData.append('line_items', JSON.stringify(lineItems))

      const result = await updateQuote(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      router.push(`/quotes/${quoteId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quote')
    } finally {
      setSubmitting(false)
    }
  }

  const { subtotal, quoteDiscountAmount, totalVat, total } = calculateTotals()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="text-center">
          <p className="text-red-600">{error || 'Quote not found'}</p>
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

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => router.push(`/quotes/${quoteId}`)}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Quote
        </Button>
        
        <h1 className="text-3xl font-bold mb-2">Edit Quote {quote.quote_number}</h1>
        <p className="text-muted-foreground">Update quote details</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Quote Details */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Quote Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Vendor *
              </label>
              <select
                value={selectedVendor}
                onChange={(e) => setSelectedVendor(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select a vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reference/PO Number
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional reference"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quote Date *
              </label>
              <input
                type="date"
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Valid Until *
              </label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Line Items</h2>
            <Button type="button" onClick={addLineItem} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>

          <div className="space-y-4">
            {lineItems.map((item, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  <div className="md:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description *
                    </label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateLineItem(index, { description: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Qty *
                    </label>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, { quantity: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="0.001"
                      step="0.001"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Unit Price *
                    </label>
                    <input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(index, { unit_price: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="0"
                      step="0.01"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Discount %
                    </label>
                    <input
                      type="number"
                      value={item.discount_percentage}
                      onChange={(e) => updateLineItem(index, { discount_percentage: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="0"
                      max="100"
                      step="0.01"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      VAT %
                    </label>
                    <select
                      value={item.vat_rate}
                      onChange={(e) => updateLineItem(index, { vat_rate: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="20">20%</option>
                    </select>
                  </div>

                  {lineItems.length > 1 && (
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quote-level Discount and Notes */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Discount & Notes</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quote Discount %
              </label>
              <input
                type="number"
                value={quoteDiscount}
                onChange={(e) => setQuoteDiscount(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="0"
                max="100"
                step="0.01"
              />
              <p className="text-sm text-gray-500 mt-1">
                Applied to subtotal after line item discounts
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (visible on quote)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Any notes to include on the quote..."
            />
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Internal Notes (not visible on quote)
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Internal notes for your reference..."
            />
          </div>
        </div>

        {/* Totals Summary */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Summary</h2>
          
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal:</span>
              <span className="font-medium">£{subtotal.toFixed(2)}</span>
            </div>
            
            {quoteDiscountAmount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Quote Discount ({quoteDiscount}%):</span>
                <span>-£{quoteDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            
            <div className="flex justify-between">
              <span className="text-gray-600">VAT:</span>
              <span className="font-medium">£{totalVat.toFixed(2)}</span>
            </div>
            
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total:</span>
              <span>£{total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={submitting}
            className="flex-1"
          >
            {submitting ? 'Updating...' : 'Update Quote'}
          </Button>
          
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/quotes/${quoteId}`)}
            disabled={submitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}