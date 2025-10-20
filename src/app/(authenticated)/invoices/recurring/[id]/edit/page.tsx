'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getRecurringInvoice, updateRecurringInvoice } from '@/app/actions/recurring-invoices'
import { getVendors } from '@/app/actions/vendors'
import { getLineItemCatalog } from '@/app/actions/invoices'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Plus, Trash2 } from 'lucide-react'
import type { InvoiceVendor, InvoiceLineItemInput, RecurringFrequency, LineItemCatalogItem, RecurringInvoiceWithDetails } from '@/types/invoices'

export default function EditRecurringInvoicePage() {
  const router = useRouter()
  const params = useParams()
  const rawId = params?.id
  const recurringInvoiceId = Array.isArray(rawId) ? rawId[0] : rawId ?? null
  
  const [recurringInvoice, setRecurringInvoice] = useState<RecurringInvoiceWithDetails | null>(null)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [vendorId, setVendorId] = useState('')
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [daysBefore, setDaysBefore] = useState(30)
  const [reference, setReference] = useState('')
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [isActive, setIsActive] = useState(true)
  
  // Line items state
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([])

  useEffect(() => {
    if (!recurringInvoiceId) {
      setError('Recurring invoice not found')
      setLoading(false)
      return
    }

    const currentId = recurringInvoiceId

    async function loadData() {
      try {
        const [recurringResult, vendorResult, catalogResult] = await Promise.all([
          getRecurringInvoice(currentId),
          getVendors(),
          getLineItemCatalog()
        ])
        
        if (recurringResult.error || !recurringResult.recurringInvoice) {
          throw new Error(recurringResult.error || 'Failed to load recurring invoice')
        }
        
        const recurring = recurringResult.recurringInvoice
        setRecurringInvoice(recurring)
        
        // Populate form with existing data
        setVendorId(recurring.vendor_id)
        setFrequency(recurring.frequency)
        setStartDate(recurring.start_date)
        setEndDate(recurring.end_date || '')
        setDaysBefore(recurring.days_before_due)
        setReference(recurring.reference || '')
        setInvoiceDiscount(recurring.invoice_discount_percentage)
        setNotes(recurring.notes || '')
        setInternalNotes(recurring.internal_notes || '')
        setIsActive(recurring.is_active)
        
        // Convert line items to input format
        if (recurring.line_items) {
          setLineItems(recurring.line_items.map(item => ({
            catalog_item_id: item.catalog_item_id || undefined,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_percentage: item.discount_percentage,
            vat_rate: item.vat_rate
          })))
        }
        
        if (vendorResult.vendors) {
          setVendors(vendorResult.vendors)
        }
        if (catalogResult.items) {
          setCatalogItems(catalogResult.items)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [recurringInvoiceId])

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
      if (!recurringInvoiceId) {
        throw new Error('Recurring invoice not found')
      }

      const formData = new FormData()
      formData.append('id', recurringInvoiceId) // Add the ID to the FormData
      formData.append('vendor_id', vendorId)
      formData.append('frequency', frequency)
      formData.append('start_date', startDate)
      if (endDate) formData.append('end_date', endDate)
      formData.append('days_before_due', daysBefore.toString())
      if (reference) formData.append('reference', reference)
      formData.append('invoice_discount_percentage', invoiceDiscount.toString())
      if (notes) formData.append('notes', notes)
      if (internalNotes) formData.append('internal_notes', internalNotes)
      formData.append('is_active', isActive.toString())
      formData.append('line_items', JSON.stringify(lineItems))

      const result = await updateRecurringInvoice(formData)
      
      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Recurring invoice updated successfully')
      router.push('/invoices/recurring')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update recurring invoice')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <PageLayout
        title="Edit Recurring Invoice"
        subtitle="Update recurring invoice template"
        backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
        loading
        loadingLabel="Loading recurring invoice..."
      />
    )
  }

  if (error && !recurringInvoice) {
    return (
      <PageLayout
        title="Edit Recurring Invoice"
        subtitle="Update recurring invoice template"
        backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
        error={error}
      />
    )
  }

  const totals = calculateTotals()

  return (
    <PageLayout
      title="Edit Recurring Invoice"
      subtitle="Update recurring invoice template"
      backButton={{ label: 'Back to Recurring Invoices', href: '/invoices/recurring' }}
    >
      <div className="space-y-6">
        {error && <Alert variant="error" description={error} />}

        <form onSubmit={handleSubmit} className="space-y-6">

          <Card title="Template Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup label="Vendor" required>
                <Select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  required
                >
                  <option value="">Select a vendor...</option>
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

              <FormGroup label="End Date" help="Leave blank for ongoing">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                />
              </FormGroup>

              <FormGroup label="Days Before Due" required>
                <Input
                  type="number"
                  value={daysBefore}
                  onChange={(e) => setDaysBefore(parseInt(e.target.value) || 30)}
                  min="0"
                  required
                />
              </FormGroup>

              <FormGroup label="Reference">
                <Input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Optional reference"
                />
              </FormGroup>

              <FormGroup label="Invoice Discount (%)" className="md:col-span-1">
                <Input
                  type="number"
                  value={invoiceDiscount}
                  onChange={(e) => setInvoiceDiscount(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.01"
                />
              </FormGroup>

              <FormGroup label="Status" className="md:col-span-1">
                <Select
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(e) => setIsActive(e.target.value === 'active')}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </FormGroup>
            </div>
          </Card>

          <Card title="Line Items">
            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-6 gap-4">
                      <FormGroup label="Catalog Item" className="md:col-span-2">
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
                        >
                          <option value="">Custom item...</option>
                          {catalogItems.map(cat => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name} - £{cat.default_price.toFixed(2)}
                            </option>
                          ))}
                        </Select>
                      </FormGroup>

                      <FormGroup label="Description" required className="md:col-span-4">
                        <Input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                          required
                        />
                      </FormGroup>

                      <FormGroup label="Quantity" required>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 1)}
                          min="0.001"
                          step="0.001"
                          required
                        />
                      </FormGroup>

                      <FormGroup label="Unit Price" required>
                        <Input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          required
                        />
                      </FormGroup>

                      <FormGroup label="Discount (%)">
                        <Input
                          type="number"
                          value={item.discount_percentage}
                          onChange={(e) => updateLineItem(index, 'discount_percentage', parseFloat(e.target.value) || 0)}
                          min="0"
                          max="100"
                          step="0.01"
                        />
                      </FormGroup>

                      <FormGroup label="VAT Rate (%)">
                        <Input
                          type="number"
                          value={item.vat_rate}
                          onChange={(e) => updateLineItem(index, 'vat_rate', parseFloat(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                        />
                      </FormGroup>

                      <div className="md:col-span-2 text-right pt-6">
                        <div className="text-sm text-gray-600">
                          Subtotal: £{((item.quantity * item.unit_price) * (1 - item.discount_percentage / 100)).toFixed(2)}
                        </div>
                      </div>
                    </div>
                    {lineItems.length > 1 && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                        className="mt-6"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              
              <Button
                type="button"
                variant="secondary"
                onClick={addLineItem}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Add Line Item
              </Button>
            </div>
          </Card>

          <Card title="Additional Information">
            <div className="space-y-4">
              <FormGroup label="Notes" help="Will appear on invoices">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </FormGroup>

              <FormGroup label="Internal Notes" help="For internal use only">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                />
              </FormGroup>
            </div>
          </Card>

          <Card title="Summary">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>£{totals.subtotal.toFixed(2)}</span>
              </div>
              {invoiceDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Invoice Discount ({invoiceDiscount}%):</span>
                  <span>-£{totals.invoiceDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>VAT:</span>
                <span>£{totals.totalVat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total:</span>
                <span>£{totals.total.toFixed(2)}</span>
              </div>
            </div>
          </Card>

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
              loading={submitting}
              disabled={!vendorId || lineItems.length === 0}
            >
              Update Recurring Invoice
            </Button>
          </div>
        </form>
      </div>
    </PageLayout>
  )
}
