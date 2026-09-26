'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getInvoice, updateInvoice, getLineItemCatalog } from '@/app/actions/invoices'
import { getVendors } from '@/app/actions/vendors'
import {
  PageLayout,
  Icon,
  Card,
  CardHeader,
  CardBody,
  Button,
  IconButton,
  Input,
  Select,
  Textarea,
  Field,
  Alert,
  FormFooter,
  toast,
} from '@/ds'
import type { InvoiceVendor, InvoiceWithDetails, LineItemCatalogItem, InvoiceLineItemInput } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import { invoicePageTitle } from '../../_shared/nav'

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

  const backHref = invoiceId ? `/invoices/${invoiceId}` : '/invoices'
  const layoutProps = {
    title: 'Edit Invoice',
    subtitle: 'Update invoice details',
    // Back to the invoice page, named as that page is titled ("Invoice INV-001").
    backButton: { label: `Back to ${invoicePageTitle(invoice?.invoice_number)}`, href: backHref },
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading invoice" />
  }

  if (!permissionsLoading && !canEditInvoice) {
    return null
  }

  if (error && !invoice) {
    return <PageLayout {...layoutProps} error={error} />
  }

  return (
    <PageLayout {...layoutProps}>
      {error && <Alert tone="danger">{error}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader title="Invoice Details" subtitle={invoice?.invoice_number} />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vendor" required>
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
            </Field>

            <Field label="Reference">
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="PO number or reference"
              />
            </Field>

            <Field label="Invoice Date" required>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                required
              />
            </Field>

            <Field label="Due Date" required>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Line Items"
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addLineItem}
                leftIcon={<Icon name="plus" size={16} />}
              >
                Add Item
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {lineItems.map((item, index) => (
              <div key={index} className="space-y-2">
                <div className="flex gap-2">
                  <Select
                    aria-label="Catalog item"
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
                  <IconButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => router.push('/invoices/catalog')}
                    title="Manage Catalog"
                    label="Manage Catalog"
                    icon={<Icon name="package" size={16} />}
                  />
                </div>
                <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-12 lg:gap-2">
                  <div className="lg:col-span-4">
                    <Input
                      label="Description"
                      type="text"
                      value={item.description}
                      onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      placeholder="Description"
                      required
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <Input
                      label="Quantity"
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      placeholder="Qty"
                      step="0.001"
                      required
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <Input
                      label="Unit Price (£)"
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      placeholder="Unit Price"
                      step="0.01"
                      required
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <Input
                      label="Disc %"
                      type="number"
                      value={item.discount_percentage}
                      onChange={(e) => updateLineItem(index, 'discount_percentage', parseFloat(e.target.value) || 0)}
                      placeholder="Disc %"
                      step="0.01"
                      min="0"
                      max="100"
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <Input
                      label="VAT %"
                      type="number"
                      value={item.vat_rate}
                      onChange={(e) => updateLineItem(index, 'vat_rate', parseFloat(e.target.value) || 0)}
                      placeholder="VAT %"
                      step="0.01"
                      required
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-3 lg:col-span-2 lg:block lg:border-0 lg:pt-6 lg:text-right">
                    <span className="text-sm font-medium lg:hidden">Line Total</span>
                    <span>£{(invoiceTotals.lineBreakdown[index]?.total ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex lg:col-span-1 lg:items-start lg:pt-5">
                    <IconButton
                      type="button"
                      variant="danger"
                      onClick={() => removeLineItem(index)}
                      size="sm"
                      label="Remove line item"
                      icon={<Icon name="trash" size={16} />}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Additional Details" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Invoice Discount (%)">
                <Input
                  type="number"
                  value={invoiceDiscountPercentage}
                  onChange={(e) => setInvoiceDiscountPercentage(parseFloat(e.target.value) || 0)}
                  step="0.01"
                  min="0"
                  max="100"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Notes (visible on invoice)">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Any notes for the customer..."
                />
              </Field>

              <Field label="Internal Notes">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                  placeholder="Internal notes (not shown on invoice)..."
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Summary" />
          <CardBody className="space-y-2">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>£{invoiceTotals.subtotalBeforeInvoiceDiscount.toFixed(2)}</span>
            </div>
            {invoiceTotals.invoiceDiscountAmount > 0 && (
              <div className="flex justify-between text-danger-fg">
                <span>Invoice Discount ({invoiceDiscountPercentage}%)</span>
                <span>-£{invoiceTotals.invoiceDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>VAT</span>
              <span>£{invoiceTotals.vatAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold">
              <span>Total</span>
              <span>£{invoiceTotals.totalAmount.toFixed(2)}</span>
            </div>
          </CardBody>
        </Card>

        <FormFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(backHref)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="primary"
            type="submit"
            disabled={submitting || !canEditInvoice}
            loading={submitting}
            leftIcon={!submitting && <Icon name="save" size={16} />}
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </FormFooter>
      </form>
    </PageLayout>
  )
}
