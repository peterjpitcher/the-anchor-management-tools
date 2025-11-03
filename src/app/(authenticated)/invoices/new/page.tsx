'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createInvoice, getLineItemCatalog } from '@/app/actions/invoices'
import { getVendors } from '@/app/actions/vendors'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { PlusCircle, Trash2 } from 'lucide-react'
import { getTodayIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import type { InvoiceVendor } from '@/types/invoices'
import type { LineItemCatalogItem, InvoiceLineItemInput } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import { Modal } from '@/components/ui-v2/overlay/Modal'

type CreateInvoiceActionResult = Awaited<ReturnType<typeof createInvoice>>

interface LineItem {
  id: string
  catalog_item_id?: string
  message: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
}

export default function NewInvoicePage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canCreate = hasPermission('invoices', 'create')
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([])
  const [vendorId, setVendorId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(getTodayIsoDate())
  const [dueDate, setDueDate] = useState('')
  const [reference, setReference] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [invoiceDiscountPercentage, setInvoiceDiscountPercentage] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false)

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    if (!canCreate) {
      router.replace('/unauthorized')
      return
    }

    loadData()
  }, [permissionsLoading, canCreate, router])

  useEffect(() => {
    if (!invoiceDate || !vendors.length || !vendorId) {
      return
    }

    const vendor = vendors.find((v) => v.id === vendorId)
    const paymentTerms = vendor?.payment_terms ?? 30

    const baseDate = new Date(invoiceDate)
    if (Number.isNaN(baseDate.getTime())) {
      return
    }

    const dueDateCandidate = new Date(baseDate)
    dueDateCandidate.setDate(dueDateCandidate.getDate() + paymentTerms)
    setDueDate(toLocalIsoDate(dueDateCandidate))
  }, [invoiceDate, vendorId, vendors])

  async function loadData() {
    if (!canCreate) {
      return
    }

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
      message: '',
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
      message: catalogItem.description,
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canCreate) {
      toast.error('You do not have permission to create invoices')
      return
    }
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
        description: item.message,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage,
        vat_rate: item.vat_rate
      }))
      
      formData.append('line_items', JSON.stringify(lineItemsData))

      const result = await createInvoice(formData) as CreateInvoiceActionResult

      if ('error' in result && result.error) {
        throw new Error(result.error)
      }

      if (!('success' in result) || !result.success || !('invoice' in result) || !result.invoice) {
        throw new Error('Failed to create invoice')
      }

      toast.success('Invoice created successfully')
      router.push(`/invoices/${result.invoice.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice')
      setLoading(false)
    }
  }

  const calculationInput = useMemo(
    () =>
      lineItems.map((item) => ({
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage,
        vat_rate: item.vat_rate,
      })),
    [lineItems]
  )

  const invoiceTotals = useMemo(
    () => calculateInvoiceTotals(calculationInput, invoiceDiscountPercentage),
    [calculationInput, invoiceDiscountPercentage]
  )

  if (permissionsLoading) {
    return (
      <PageLayout
        title="New Invoice"
        subtitle="Create a new invoice"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        loading
        loadingLabel="Checking permissions..."
      />
    )
  }

  if (!canCreate) {
    return null
  }

  return (
    <>
      <PageLayout
        title="New Invoice"
        subtitle="Create a new invoice"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
      >
        {error && (
          <Alert variant="error" description={error} className="mb-6" />
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6 overflow-visible">
          <h2 className="text-lg font-semibold mb-4">Invoice Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Vendor" required>
              <Select
                value={vendorId}
                onChange={(e) => {
                  const value = e.target.value
                  setVendorId(value)
                  if (!value) {
                    setDueDate('')
                  }
                }}
                required
              >
                <option value="">Select a vendor</option>
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="Reference">
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="PO number or reference"
              />
            </FormGroup>

            <FormGroup label="Invoice Date" required>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
              />
            </FormGroup>

            <FormGroup label="Due Date" required>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </FormGroup>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-4">
            <h2 className="text-lg font-semibold">Line Items</h2>
            <div className="flex flex-wrap gap-2">
              {catalogItems.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsCatalogModalOpen(true)}
                >
                  Add from Catalog
                </Button>
              )}
              <Button type="button" onClick={addLineItem} leftIcon={<PlusCircle className="h-4 w-4" />} size="sm">
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
              {lineItems.map((item, index) => {
                const breakdown = invoiceTotals.lineBreakdown[index]
                const lineTotal = breakdown ? breakdown.total : 0

                return (
                  <div key={item.id} className="border rounded-lg p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                    <div className="sm:col-span-2 lg:col-span-5">
                      <label className="block text-sm font-medium mb-1">
                        Description
                      </label>
                      <Input
                        type="text"
                        value={item.message}
                        onChange={(e) => updateLineItem(item.id, { message: e.target.value })}
                        placeholder="Item description"
                        required
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-2">
                      <label className="block text-sm font-medium mb-1">
                        Quantity
                      </label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                        min="0"
                        step="0.01"
                        required
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-2">
                      <label className="block text-sm font-medium mb-1">
                        Unit Price (£)
                      </label>
                      <Input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateLineItem(item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                        min="0"
                        step="0.01"
                        required
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-1">
                      <label className="block text-sm font-medium mb-1">
                        Disc %
                      </label>
                      <Input
                        type="number"
                        value={item.discount_percentage}
                        onChange={(e) => updateLineItem(item.id, { discount_percentage: parseFloat(e.target.value) || 0 })}
                        min="0"
                        max="100"
                        step="0.01"
                      />
                    </div>

                    <div className="sm:col-span-1 lg:col-span-1">
                      <label className="block text-sm font-medium mb-1">
                        VAT %
                      </label>
                      <Input
                        type="number"
                        value={item.vat_rate}
                        onChange={(e) => updateLineItem(item.id, { vat_rate: parseFloat(e.target.value) || 0 })}
                        min="0"
                        step="0.01"
                      />
                    </div>

                    <div className="sm:col-span-2 lg:col-span-1 flex items-end">
                      <Button
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        variant="danger"
                        iconOnly
                        aria-label="Remove line item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t flex justify-between items-center">
                    <span className="text-sm text-gray-600">Line Total:</span>
                    <span className="font-semibold">£{lineTotal.toFixed(2)}</span>
                  </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Invoice Summary</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <FormGroup label="Invoice Discount (%)">
                <Input
                  type="number"
                  value={invoiceDiscountPercentage}
                  onChange={(e) => setInvoiceDiscountPercentage(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.01"
                />
              </FormGroup>

              <FormGroup label="Notes (visible on invoice)">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Payment terms, special instructions, etc."
                />
              </FormGroup>

              <FormGroup label="Internal Notes">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                  placeholder="Private notes about this invoice"
                />
              </FormGroup>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-medium">
                    £{invoiceTotals.subtotalBeforeInvoiceDiscount.toFixed(2)}
                  </span>
                </div>
                {invoiceTotals.invoiceDiscountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Invoice Discount:</span>
                    <span>-£{invoiceTotals.invoiceDiscountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>VAT:</span>
                  <span className="font-medium">£{invoiceTotals.vatAmount.toFixed(2)}</span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Total:</span>
                    <span>£{invoiceTotals.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="sticky bottom-0 -mx-6 border-t bg-white px-6 py-4 sm:relative sm:mx-0 sm:border-0 sm:px-0 sm:py-0">
          <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push('/invoices')}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || lineItems.length === 0 || !canCreate}
              loading={loading}
              className="w-full sm:w-auto"
            >
              Create Invoice
            </Button>
          </div>
        </div>
      </form>
      </PageLayout>

      <Modal
        open={isCatalogModalOpen}
        onClose={() => setIsCatalogModalOpen(false)}
        title="Add from Catalog"
        size="lg"
      >
        <div className="space-y-3">
          {catalogItems.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {catalogItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    addFromCatalog(item)
                    setIsCatalogModalOpen(false)
                  }}
                  className="w-full text-left rounded-md border border-gray-200 p-3 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <div className="font-medium text-gray-900">{item.name}</div>
                  {item.description && (
                    <div className="text-sm text-gray-600 mt-0.5">{item.description}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-2">
                    £{item.default_price.toFixed(2)} • VAT {item.default_vat_rate}%
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-4">
              No catalog items available.
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
