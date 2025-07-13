'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createInvoice, getLineItemCatalog } from '@/app/actions/invoices'
import { getVendors } from '@/app/actions/vendors'
import { Button } from '@/components/ui/Button'
import { PlusCircle, Trash2, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { InvoiceVendor } from '@/types/invoices'
import type { LineItemCatalogItem, InvoiceLineItemInput } from '@/types/invoices'

interface LineItem {
  id: string
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
}

export default function NewInvoicePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([])
  const [vendorId, setVendorId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState('')
  const [reference, setReference] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [invoiceDiscountPercentage, setInvoiceDiscountPercentage] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    // Set default due date to 30 days from invoice date
    if (invoiceDate) {
      const date = new Date(invoiceDate)
      date.setDate(date.getDate() + 30)
      setDueDate(date.toISOString().split('T')[0])
    }
  }, [invoiceDate])

  async function loadData() {
    try {
      const [vendorsResult, catalogResult] = await Promise.all([
        getVendors(),
        getLineItemCatalog()
      ])

      if (vendorsResult.error || !vendorsResult.vendors) {
        throw new Error(vendorsResult.error || 'Failed to load vendors')
      }

      if (catalogResult.error || !catalogResult.items) {
        throw new Error(catalogResult.error || 'Failed to load catalog items')
      }

      setVendors(vendorsResult.vendors)
      setCatalogItems(catalogResult.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    }
  }

  function addLineItem() {
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      description: '',
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      vat_rate: 20
    }
    setLineItems([...lineItems, newItem])
  }

  function addFromCatalog(catalogItem: LineItemCatalogItem) {
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      catalog_item_id: catalogItem.id,
      description: catalogItem.description,
      quantity: 1,
      unit_price: catalogItem.default_price,
      discount_percentage: 0,
      vat_rate: catalogItem.default_vat_rate
    }
    setLineItems([...lineItems, newItem])
  }

  function updateLineItem(id: string, updates: Partial<LineItem>) {
    setLineItems(lineItems.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ))
  }

  function removeLineItem(id: string) {
    setLineItems(lineItems.filter(item => item.id !== id))
  }

  function calculateLineTotal(item: LineItem): number {
    const subtotal = item.quantity * item.unit_price
    const discount = subtotal * (item.discount_percentage / 100)
    const afterDiscount = subtotal - discount
    const vat = afterDiscount * (item.vat_rate / 100)
    return afterDiscount + vat
  }

  function calculateInvoiceTotal(): { subtotal: number; discount: number; vat: number; total: number } {
    const lineSubtotal = lineItems.reduce((acc, item) => {
      const itemSubtotal = item.quantity * item.unit_price
      const itemDiscount = itemSubtotal * (item.discount_percentage / 100)
      return acc + (itemSubtotal - itemDiscount)
    }, 0)

    const invoiceDiscount = lineSubtotal * (invoiceDiscountPercentage / 100)
    const afterDiscount = lineSubtotal - invoiceDiscount

    const vat = lineItems.reduce((acc, item) => {
      const itemSubtotal = item.quantity * item.unit_price
      const itemDiscount = itemSubtotal * (item.discount_percentage / 100)
      const itemAfterDiscount = itemSubtotal - itemDiscount
      const itemShare = itemAfterDiscount / lineSubtotal
      const itemAfterInvoiceDiscount = itemAfterDiscount - (invoiceDiscount * itemShare)
      return acc + (itemAfterInvoiceDiscount * (item.vat_rate / 100))
    }, 0)

    return {
      subtotal: lineSubtotal,
      discount: invoiceDiscount,
      vat,
      total: afterDiscount + vat
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!vendorId || lineItems.length === 0) {
      setError('Please select a vendor and add at least one line item')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('vendor_id', vendorId)
      formData.append('invoice_date', invoiceDate)
      formData.append('due_date', dueDate)
      formData.append('reference', reference)
      formData.append('invoice_discount_percentage', invoiceDiscountPercentage.toString())
      formData.append('notes', notes)
      formData.append('internal_notes', internalNotes)
      
      const lineItemsData: InvoiceLineItemInput[] = lineItems.map(item => ({
        catalog_item_id: item.catalog_item_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage,
        vat_rate: item.vat_rate
      }))
      
      formData.append('line_items', JSON.stringify(lineItemsData))

      const result = await createInvoice(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      router.push(`/invoices/${result.invoice?.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice')
      setLoading(false)
    }
  }

  const totals = calculateInvoiceTotal()

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <Link href="/invoices">
          <Button variant="ghost" className="mb-4">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Invoices
          </Button>
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">New Invoice</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Create a new invoice</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-lg font-semibold mb-4">Invoice Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Vendor <span className="text-red-500">*</span>
              </label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-h-[44px]"
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
                Reference
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                placeholder="PO number or reference"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Invoice Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Due Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                required
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-4">
            <h2 className="text-lg font-semibold">Line Items</h2>
            <div className="flex flex-wrap gap-2">
              {catalogItems.length > 0 && (
                <details className="relative">
                  <summary className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md cursor-pointer text-sm">
                    Add from Catalog
                  </summary>
                  <div className="absolute right-0 sm:right-0 left-0 sm:left-auto mt-2 w-full sm:w-96 bg-white rounded-lg shadow-lg border p-4 z-10 max-h-64 sm:max-h-96 overflow-y-auto">
                    {catalogItems.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addFromCatalog(item)}
                        className="w-full text-left p-3 hover:bg-gray-50 rounded-md border-b last:border-b-0"
                      >
                        <div className="font-medium">{item.name}</div>
                        <div className="text-sm text-gray-600">{item.description}</div>
                        <div className="text-sm mt-1">
                          £{item.default_price.toFixed(2)} • VAT {item.default_vat_rate}%
                        </div>
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <Button type="button" onClick={addLineItem} className="text-sm">
                <PlusCircle className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Add Line Item</span>
                <span className="sm:hidden">Add Item</span>
              </Button>
            </div>
          </div>

          {lineItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No line items added yet. Click &quot;Add Line Item&quot; to begin.
            </div>
          ) : (
            <div className="space-y-4">
              {lineItems.map((item) => (
                <div key={item.id} className="border rounded-lg p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                    <div className="sm:col-span-2 lg:col-span-5">
                      <label className="block text-sm font-medium mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateLineItem(item.id, { description: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                        placeholder="Item description"
                        required
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-2">
                      <label className="block text-sm font-medium mb-1">
                        Quantity
                      </label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                        min="0"
                        step="0.01"
                        required
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-2">
                      <label className="block text-sm font-medium mb-1">
                        Unit Price (£)
                      </label>
                      <input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateLineItem(item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                        min="0"
                        step="0.01"
                        required
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-1">
                      <label className="block text-sm font-medium mb-1">
                        Disc %
                      </label>
                      <input
                        type="number"
                        value={item.discount_percentage}
                        onChange={(e) => updateLineItem(item.id, { discount_percentage: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                        min="0"
                        max="100"
                        step="0.01"
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-1">
                      <label className="block text-sm font-medium mb-1">
                        VAT %
                      </label>
                      <input
                        type="number"
                        value={item.vat_rate}
                        onChange={(e) => updateLineItem(item.id, { vat_rate: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                        min="0"
                        step="0.01"
                      />
                    </div>

                    <div className="sm:col-span-2 lg:col-span-1 flex items-end">
                      <button
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        className="w-full p-2 text-red-600 hover:bg-red-50 rounded-md border border-red-200 min-h-[44px]"
                      >
                        <Trash2 className="h-4 w-4 mx-auto" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t flex justify-between items-center">
                    <span className="text-sm text-gray-600">Line Total:</span>
                    <span className="font-semibold">£{calculateLineTotal(item).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-lg font-semibold mb-4">Invoice Summary</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Invoice Discount (%)
                </label>
                <input
                  type="number"
                  value={invoiceDiscountPercentage}
                  onChange={(e) => setInvoiceDiscountPercentage(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  min="0"
                  max="100"
                  step="0.01"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Notes (visible on invoice)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                  rows={3}
                  placeholder="Payment terms, special instructions, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Internal Notes
                </label>
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                  rows={3}
                  placeholder="Private notes about this invoice"
                />
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-medium">£{totals.subtotal.toFixed(2)}</span>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Invoice Discount:</span>
                    <span>-£{totals.discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>VAT:</span>
                  <span className="font-medium">£{totals.vat.toFixed(2)}</span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Total:</span>
                    <span>£{totals.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t -mx-6 px-6 py-4 sm:relative sm:mx-0 sm:px-0 sm:py-0 sm:border-0">
          <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/invoices')}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || lineItems.length === 0}
              className="w-full sm:w-auto"
            >
              {loading ? 'Creating...' : 'Create Invoice'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}