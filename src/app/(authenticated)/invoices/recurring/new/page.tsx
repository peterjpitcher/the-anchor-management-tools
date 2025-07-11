'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createRecurringInvoice } from '@/app/actions/recurring-invoices'
import { getVendors } from '@/app/actions/vendors'
import { getLineItemCatalog } from '@/app/actions/invoices'
import { Button } from '@/components/ui/Button'
import { ArrowLeft, Plus, Trash2, Package } from 'lucide-react'
import type { InvoiceVendor, InvoiceLineItemInput, RecurringFrequency, LineItemCatalogItem } from '@/types/invoices'

export default function NewRecurringInvoicePage() {
  const router = useRouter()
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [vendorId, setVendorId] = useState('')
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly')
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState('')
  const [daysBefore, setDaysBefore] = useState(30)
  const [reference, setReference] = useState('')
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  
  // Line items state
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([
    {
      catalog_item_id: undefined,
      description: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      vat_rate: 20
    }
  ])

  useEffect(() => {
    async function loadData() {
      try {
        const [vendorResult, catalogResult] = await Promise.all([
          getVendors(),
          getLineItemCatalog()
        ])
        
        if (vendorResult.vendors) {
          setVendors(vendorResult.vendors)
        }
        if (catalogResult.items) {
          setCatalogItems(catalogResult.items)
        }
      } catch {
        setError('Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

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

  function updateLineItem(index: number, field: keyof InvoiceLineItemInput, value: string | number | undefined) {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], [field]: value }
    setLineItems(updated)
  }

  function updateLineItemMultiple(index: number, updates: Partial<InvoiceLineItemInput>) {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], ...updates }
    setLineItems(updated)
  }

  function calculateTotals() {
    let subtotal = 0
    let totalVat = 0

    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      subtotal += lineAfterDiscount
    })

    const invoiceDiscountAmount = subtotal * (invoiceDiscount / 100)
    const afterInvoiceDiscount = subtotal - invoiceDiscountAmount

    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
      const itemAfterInvoiceDiscount = lineAfterDiscount - (invoiceDiscountAmount * itemShare)
      const itemVat = itemAfterInvoiceDiscount * (item.vat_rate / 100)
      totalVat += itemVat
    })

    const total = afterInvoiceDiscount + totalVat

    return { subtotal, invoiceDiscountAmount, totalVat, total }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const formData = new FormData()
      formData.append('vendor_id', vendorId)
      formData.append('frequency', frequency)
      formData.append('start_date', startDate)
      if (endDate) formData.append('end_date', endDate)
      formData.append('days_before_due', daysBefore.toString())
      if (reference) formData.append('reference', reference)
      formData.append('invoice_discount_percentage', invoiceDiscount.toString())
      if (notes) formData.append('notes', notes)
      if (internalNotes) formData.append('internal_notes', internalNotes)
      formData.append('line_items', JSON.stringify(lineItems))

      const result = await createRecurringInvoice(formData)
      
      if (result.error) {
        setError(result.error)
      } else if (result.success) {
        router.push('/invoices/recurring')
      }
    } catch {
      setError('Failed to create recurring invoice')
    } finally {
      setSubmitting(false)
    }
  }

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

  const { subtotal, invoiceDiscountAmount, totalVat, total } = calculateTotals()

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => router.push('/invoices/recurring')}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Recurring Invoices
        </Button>
        
        <h1 className="text-3xl font-bold">New Recurring Invoice</h1>
        <p className="text-gray-600 mt-2">Set up automated invoice generation</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Recurring Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Vendor <span className="text-red-500">*</span>
              </label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select a vendor</option>
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Frequency <span className="text-red-500">*</span>
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                End Date (Optional)
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={startDate}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Days Before Due <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={daysBefore}
                onChange={(e) => setDaysBefore(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="0"
                max="365"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Number of days after invoice date until payment is due
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Reference
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="PO number or reference"
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Line Items</h2>
          
          <div className="space-y-4">
            {lineItems.map((item, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  <div className="md:col-span-6">
                    <div className="flex gap-2 mb-2">
                      <select
                        value={item.catalog_item_id || ''}
                        onChange={(e) => {
                          const catalogId = e.target.value
                          if (catalogId) {
                            const catalogItem = catalogItems.find(c => c.id === catalogId)
                            if (catalogItem) {
                              updateLineItemMultiple(index, {
                                catalog_item_id: catalogId,
                                description: catalogItem.description || catalogItem.name,
                                unit_price: catalogItem.default_price,
                                vat_rate: catalogItem.default_vat_rate
                              })
                            }
                          } else {
                            updateLineItem(index, 'catalog_item_id', undefined)
                          }
                        }}
                        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select from catalog or enter manually...</option>
                        {catalogItems.map(catalogItem => (
                          <option key={catalogItem.id} value={catalogItem.id}>
                            {catalogItem.name} - £{catalogItem.default_price.toFixed(2)}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => router.push('/invoices/catalog')}
                        title="Manage Catalog"
                      >
                        <Package className="h-4 w-4" />
                      </Button>
                    </div>
                    <label className="block text-sm font-medium mb-1">
                      Description <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Quantity</label>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      step="0.001"
                      min="0"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Unit Price (ex VAT)</label>
                    <input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Discount %</label>
                    <input
                      type="number"
                      value={item.discount_percentage}
                      onChange={(e) => updateLineItem(index, 'discount_percentage', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      step="0.01"
                      min="0"
                      max="100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">VAT Rate %</label>
                    <select
                      value={item.vat_rate}
                      onChange={(e) => updateLineItem(index, 'vat_rate', parseFloat(e.target.value))}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="20">20%</option>
                    </select>
                  </div>

                  <div className="md:col-span-2 flex items-end justify-between">
                    <div>
                      <label className="block text-sm font-medium mb-1">Line Total</label>
                      <p className="text-lg font-medium">
                        £{((item.quantity * item.unit_price) * (1 - item.discount_percentage / 100)).toFixed(2)}
                      </p>
                    </div>
                    {lineItems.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                        className="text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={addLineItem}
            className="mt-4"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Line Item
          </Button>
        </div>

        {/* Invoice Settings */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Invoice Settings</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Invoice Discount %
              </label>
              <input
                type="number"
                value={invoiceDiscount}
                onChange={(e) => setInvoiceDiscount(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                step="0.01"
                min="0"
                max="100"
              />
              <p className="text-xs text-gray-500 mt-1">
                Discount applied to entire invoice after line discounts
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Notes (Visible on Invoice)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Internal Notes
              </label>
              <textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-xl font-semibold mb-4">Summary (Per Invoice)</h2>
          
          <div className="max-w-xs ml-auto space-y-2">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-medium">£{subtotal.toFixed(2)}</span>
            </div>
            
            {invoiceDiscount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Invoice Discount ({invoiceDiscount}%):</span>
                <span>-£{invoiceDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            
            <div className="flex justify-between">
              <span>VAT:</span>
              <span className="font-medium">£{totalVat.toFixed(2)}</span>
            </div>
            
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total:</span>
              <span>£{total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/invoices/recurring')}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || !vendorId || lineItems.length === 0}
          >
            {submitting ? 'Creating...' : 'Create Recurring Invoice'}
          </Button>
        </div>
      </form>
    </div>
  )
}