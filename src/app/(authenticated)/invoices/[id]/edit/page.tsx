'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getInvoice, updateInvoice, getLineItemCatalog } from '@/app/actions/invoices'
import { getVendors } from '@/app/actions/vendors'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Plus, Trash2, Save, Package } from 'lucide-react'
import type { InvoiceVendor, InvoiceWithDetails, LineItemCatalogItem, InvoiceLineItemInput } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'

export default function EditInvoicePage() {
  const params = useParams()
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canEditInvoice = hasPermission('invoices', 'edit')
  const rawInvoiceId = params?.id
  const invoiceId = Array.isArray(rawInvoiceId) ? rawInvoiceId[0] : rawInvoiceId ?? null

  useEffect(() => {
    if (!invoiceId) {
      router.replace('/invoices')
    }
  }, [invoiceId, router])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<InvoiceWithDetails | null>(null)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([])
  
  // Form state
  const [vendorId, setVendorId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reference, setReference] = useState('')
  const [invoiceDiscountPercentage, setInvoiceDiscountPercentage] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([])

  const loadData = useCallback(async () => {
    if (!invoiceId || !canEditInvoice) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [invoiceResult, vendorsResult, catalogResult] = await Promise.all([
        getInvoice(invoiceId),
        getVendors(),
        getLineItemCatalog()
      ])

      if (invoiceResult.error || !invoiceResult.invoice) {
        throw new Error(invoiceResult.error || 'Invoice not found')
      }

      if (invoiceResult.invoice.status !== 'draft') {
        throw new Error('Only draft invoices can be edited')
      }

      if (vendorsResult.vendors) {
        setVendors(vendorsResult.vendors)
      }

      if (catalogResult.items) {
        setCatalogItems(catalogResult.items)
      }

      // Set form data from invoice
      const inv = invoiceResult.invoice
      setInvoice(inv)
      setVendorId(inv.vendor_id)
      setInvoiceDate(inv.invoice_date)
      setDueDate(inv.due_date)
      setReference(inv.reference || '')
      setInvoiceDiscountPercentage(inv.invoice_discount_percentage || 0)
      setNotes(inv.notes || '')
      setInternalNotes(inv.internal_notes || '')
      
      // Convert existing line items
      setLineItems((inv.line_items || []).map(item => ({
        catalog_item_id: item.catalog_item_id || undefined,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage || 0,
        vat_rate: item.vat_rate
      })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }, [invoiceId, canEditInvoice])

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    if (!canEditInvoice) {
      router.replace('/unauthorized')
      return
    }

    loadData()
  }, [permissionsLoading, canEditInvoice, loadData, router])

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
    setLineItems(lineItems.filter((_, i) => i !== index))
  }

  function updateLineItem(index: number, field: keyof InvoiceLineItemInput, value: InvoiceLineItemInput[keyof InvoiceLineItemInput]) {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], [field]: value }
    setLineItems(updated)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canEditInvoice) {
      toast.error('You do not have permission to edit invoices')
      return
    }

    if (lineItems.length === 0) {
      setError('Please add at least one line item')
      return
    }

    if (!invoiceId) {
      setError('Invoice not found')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoiceId)
      formData.append('vendor_id', vendorId)
      formData.append('invoice_date', invoiceDate)
      formData.append('due_date', dueDate)
      formData.append('reference', reference)
      formData.append('invoice_discount_percentage', invoiceDiscountPercentage.toString())
      formData.append('notes', notes)
      formData.append('internal_notes', internalNotes)
      formData.append('line_items', JSON.stringify(lineItems))

      const result = await updateInvoice(formData)
      
      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Invoice updated successfully')
      router.push(`/invoices/${invoiceId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update invoice')
      setSubmitting(false)
    }
  }

  if (permissionsLoading || loading) {
    return (
      <PageLayout
        title="Edit Invoice"
        subtitle="Update invoice details"
        backButton={{ label: 'Back to Invoices', href: invoiceId ? `/invoices/${invoiceId}` : '/invoices' }}
        loading
        loadingLabel="Loading invoice..."
      />
    )
  }

  if (!permissionsLoading && !canEditInvoice) {
    return null
  }

  if (error && !invoice) {
    return (
      <PageLayout
        title="Edit Invoice"
        subtitle="Update invoice details"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        error={error}
      />
    )
  }

  const pageTitle = invoice?.invoice_number ? `Edit Invoice ${invoice.invoice_number}` : 'Edit Invoice'
  const backHref = invoiceId ? `/invoices/${invoiceId}` : '/invoices'

  return (
    <PageLayout
      title={pageTitle}
      subtitle="Update invoice details"
      backButton={{ label: 'Back to Invoice', href: backHref }}
    >
      <div className="space-y-6">
        {error && <Alert variant="error" description={error} />}

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Invoice Details</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormGroup label="Vendor" required>
                <Select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  required
                >
                  <option value="">Select a vendor</option>
                  {vendors.map((vendor) => (
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
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Line Items</h2>
              <Button
                type="button"
                variant="secondary"
                onClick={addLineItem}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Add Item
              </Button>
            </div>

            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex gap-2">
                    <Select
                      value={item.catalog_item_id || ''}
                      onChange={(e) => {
                        const catalogId = e.target.value
                        if (catalogId) {
                          const catalogItem = catalogItems.find((c) => c.id === catalogId)
                          if (catalogItem) {
                            updateLineItem(index, 'catalog_item_id', catalogId)
                            updateLineItem(index, 'description', catalogItem.description || catalogItem.name)
                            updateLineItem(index, 'unit_price', catalogItem.default_price)
                            updateLineItem(index, 'vat_rate', catalogItem.default_vat_rate)
                          }
                        } else {
                          updateLineItem(index, 'catalog_item_id', undefined)
                        }
                      }}
                      className="flex-1"
                    >
                      <option value="">Select from catalog or enter manually...</option>
                      {catalogItems.map((catalogItem) => (
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
                  <div className="grid grid-cols-12 items-start gap-2">
                    <div className="col-span-4">
                      <Input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                        placeholder="Description"
                        required
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                        placeholder="Qty"
                        step="0.001"
                        required
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                        placeholder="Unit Price"
                        step="0.01"
                        required
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        value={item.discount_percentage}
                        onChange={(e) => updateLineItem(index, 'discount_percentage', parseFloat(e.target.value) || 0)}
                        placeholder="Disc %"
                        step="0.01"
                        min="0"
                        max="100"
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        value={item.vat_rate}
                        onChange={(e) => updateLineItem(index, 'vat_rate', parseFloat(e.target.value) || 0)}
                        placeholder="VAT %"
                        step="0.01"
                        required
                      />
                    </div>
                    <div className="col-span-2 pt-2 text-right">
                      £{(invoiceTotals.lineBreakdown[index]?.total ?? 0).toFixed(2)}
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => removeLineItem(index)}
                        size="sm"
                        iconOnly
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Additional Details</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormGroup label="Invoice Discount (%)">
                <Input
                  type="number"
                  value={invoiceDiscountPercentage}
                  onChange={(e) => setInvoiceDiscountPercentage(parseFloat(e.target.value) || 0)}
                  step="0.01"
                  min="0"
                  max="100"
                />
              </FormGroup>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormGroup label="Notes (visible on invoice)">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Any notes for the customer..."
                />
              </FormGroup>

              <FormGroup label="Internal Notes">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                  placeholder="Internal notes (not shown on invoice)..."
                />
              </FormGroup>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Summary</h2>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>£{invoiceTotals.subtotalBeforeInvoiceDiscount.toFixed(2)}</span>
              </div>
              {invoiceTotals.invoiceDiscountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Invoice Discount ({invoiceDiscountPercentage}%)</span>
                  <span>-£{invoiceTotals.invoiceDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>VAT</span>
                <span>£{invoiceTotals.vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-lg font-semibold">
                <span>Total</span>
                <span>£{invoiceTotals.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          <div className="flex flex-col justify-end gap-3 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(backHref)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !canEditInvoice}
              loading={submitting}
              leftIcon={!submitting && <Save className="h-4 w-4" />}
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </PageLayout>
  )
}
