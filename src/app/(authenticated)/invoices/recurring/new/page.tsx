'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createRecurringInvoice } from '@/app/actions/recurring-invoices'
import { getVendors } from '@/app/actions/vendors'
import { getLineItemCatalog } from '@/app/actions/invoices'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Plus, Trash2, Package } from 'lucide-react'
import { getTodayIsoDate } from '@/lib/dateUtils'
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
  const [startDate, setStartDate] = useState(getTodayIsoDate())
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
        toast.success('Recurring invoice created successfully')
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
      <PageWrapper>
        <PageHeader 
          title="Loading..."
          backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  const { subtotal, invoiceDiscountAmount, totalVat, total } = calculateTotals()

  return (
    <PageWrapper>
      <PageHeader
        title="New Recurring Invoice"
        subtitle="Set up automated invoice generation"
        breadcrumbs={[
          { label: 'Invoices', href: '/invoices' },
          { label: 'Recurring', href: '/invoices/recurring' }
        ]}
      />
      <PageContent>
        <div className="space-y-6">
          {error && (
            <Alert variant="error" description={error} />
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <h2 className="text-xl font-semibold mb-4">Recurring Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Vendor" required>
              <Select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
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

            <FormGroup label="Frequency" required>
              <Select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                required
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </Select>
            </FormGroup>

            <FormGroup label="Start Date" required>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </FormGroup>

            <FormGroup label="End Date (Optional)">
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
              />
            </FormGroup>

            <FormGroup label="Days Before Due" required help="Number of days after invoice date until payment is due">
              <Input
                type="number"
                value={daysBefore}
                onChange={(e) => setDaysBefore(parseInt(e.target.value) || 0)}
                min="0"
                max="365"
                required
              />
            </FormGroup>

            <FormGroup label="Reference">
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="PO number or reference"
              />
            </FormGroup>
          </div>
        </Card>

        {/* Line Items */}
        <Card>
          <h2 className="text-xl font-semibold mb-4">Line Items</h2>
          
          <div className="space-y-4">
            {lineItems.map((item, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  <div className="md:col-span-6">
                    <div className="flex gap-2 mb-2">
                      <Select
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
                        className="flex-1"
                      >
                        <option value="">Select from catalog or enter manually...</option>
                        {catalogItems.map(catalogItem => (
                          <option key={catalogItem.id} value={catalogItem.id}>
                            {catalogItem.name} - £{catalogItem.default_price.toFixed(2)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push('/invoices/catalog')}
                        title="Manage Catalog"
                        iconOnly
                      >
                        <Package className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormGroup label="Description" required>
                      <Input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                        required
                      />
                    </FormGroup>
                  </div>

                  <FormGroup label="Quantity">
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      step="0.001"
                      min="0"
                      required
                    />
                  </FormGroup>

                  <FormGroup label="Unit Price (ex VAT)">
                    <Input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      step="0.01"
                      min="0"
                      required
                    />
                  </FormGroup>

                  <FormGroup label="Discount %">
                    <Input
                      type="number"
                      value={item.discount_percentage}
                      onChange={(e) => updateLineItem(index, 'discount_percentage', parseFloat(e.target.value) || 0)}
                      step="0.01"
                      min="0"
                      max="100"
                    />
                  </FormGroup>

                  <FormGroup label="VAT Rate %">
                    <Select
                      value={item.vat_rate}
                      onChange={(e) => updateLineItem(index, 'vat_rate', parseFloat(e.target.value))}
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="20">20%</option>
                    </Select>
                  </FormGroup>

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
                        variant="danger"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                        iconOnly
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button type="button"
            variant="secondary"
            onClick={addLineItem}
            className="mt-4"
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Add Line Item
          </Button>
        </Card>

        {/* Invoice Settings */}
        <Card>
          <h2 className="text-xl font-semibold mb-4">Invoice Settings</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Invoice Discount %" help="Discount applied to entire invoice after line discounts">
              <Input
                type="number"
                value={invoiceDiscount}
                onChange={(e) => setInvoiceDiscount(parseFloat(e.target.value) || 0)}
                step="0.01"
                min="0"
                max="100"
              />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <FormGroup label="Notes (Visible on Invoice)">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </FormGroup>

            <FormGroup label="Internal Notes">
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={3}
              />
            </FormGroup>
          </div>
        </Card>

        {/* Summary */}
        <Card>
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
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/invoices/recurring')}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || !vendorId || lineItems.length === 0}
            loading={submitting}
          >
            {submitting ? 'Creating...' : 'Create Recurring Invoice'}
          </Button>
        </div>
      </form>
        </div>
      </PageContent>
    </PageWrapper>
  )
}
