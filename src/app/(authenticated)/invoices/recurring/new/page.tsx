'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createRecurringInvoice } from '@/app/actions/recurring-invoices'
import { getVendors } from '@/app/actions/vendors'
import { getLineItemCatalog } from '@/app/actions/invoices'
import {
  PageLayout,
  Icon,
  Card,
  CardHeader,
  CardBody,
  Button,
  IconButton,
  LinkButton,
  Input,
  Select,
  Textarea,
  Field,
  Alert,
  DescriptionList,
  FormFooter,
  toast,
} from '@/ds'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { InvoiceVendor, InvoiceLineItemInput, RecurringFrequency, LineItemCatalogItem } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { BACK_TO_RECURRING } from '../../_shared/nav'

export default function NewRecurringInvoicePage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canCreate = hasPermission('invoices', 'create')
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [vendorId, setVendorId] = useState('')
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly')
  const [startDate, setStartDate] = useState(getTodayIsoDate())
  const [nextInvoiceDate, setNextInvoiceDate] = useState(getTodayIsoDate())
  const [hasEditedNextInvoiceDate, setHasEditedNextInvoiceDate] = useState(false)
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
    if (permissionsLoading) {
      return
    }

    if (!canCreate) {
      router.replace('/unauthorized')
      return
    }

    async function loadData() {
      setLoading(true)
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
  }, [permissionsLoading, canCreate, router])

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
    if (!canCreate) {
      toast.error('You do not have permission to create recurring invoices')
      return
    }
    setSubmitting(true)

    try {
      const formData = new FormData()
      formData.append('vendor_id', vendorId)
      formData.append('frequency', frequency)
      formData.append('start_date', startDate)
      formData.append('next_invoice_date', nextInvoiceDate)
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

  const layoutProps = {
    title: 'New Recurring Invoice',
    subtitle: 'Set up automated invoice generation',
    backButton: BACK_TO_RECURRING,
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading recurring setup" />
  }

  if (!canCreate) {
    return null
  }

  const { subtotal, invoiceDiscountAmount, totalVat, total } = calculateTotals()

  return (
    <PageLayout {...layoutProps}>
      {error && (
        <Alert tone="danger">{error}</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader title="Recurring Details" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vendor" required>
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
            </Field>

            <Field label="Frequency" required>
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
            </Field>

            <Field label="Start Date" required>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  const value = e.target.value
                  setStartDate(value)
                  if (!hasEditedNextInvoiceDate) {
                    setNextInvoiceDate(value)
                  }
                }}
                required
              />
            </Field>

            <Field
              label="Next Invoice Date"
              required
              hint="Controls when the next invoice will be generated. This can be adjusted without changing the start date."
            >
              <Input
                type="date"
                value={nextInvoiceDate}
                onChange={(e) => {
                  setHasEditedNextInvoiceDate(true)
                  setNextInvoiceDate(e.target.value)
                }}
                min={startDate}
                required
              />
            </Field>

            <Field label="End Date (Optional)">
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
              />
            </Field>

            <Field label="Days Before Due" required hint="Number of days after invoice date until payment is due">
              <Input
                type="number"
                value={daysBefore}
                onChange={(e) => setDaysBefore(parseInt(e.target.value) || 0)}
                min="0"
                max="365"
                required
              />
            </Field>

            <Field label="Reference">
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="PO number or reference"
              />
            </Field>
          </CardBody>
        </Card>

        {/* Line Items */}
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
                Add Line Item
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {lineItems.map((item, index) => (
              <Card key={index}>
                <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-6">
                  <div className="space-y-2 md:col-span-6">
                    <div className="flex gap-2">
                      <Select
                        aria-label="Catalog item"
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
                      <IconButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push('/invoices/catalog')}
                        title="Manage catalog"
                        label="Manage catalog"
                        icon={<Icon name="package" size={16} />}
                      />
                    </div>
                    <Field label="Description" required>
                      <Input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                        required
                      />
                    </Field>
                  </div>

                  <Field label="Quantity">
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      step="0.001"
                      min="0"
                      required
                    />
                  </Field>

                  <Field label="Unit Price (ex VAT)">
                    <Input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      step="0.01"
                      min="0"
                      required
                    />
                  </Field>

                  <Field label="Discount %">
                    <Input
                      type="number"
                      value={item.discount_percentage}
                      onChange={(e) => updateLineItem(index, 'discount_percentage', parseFloat(e.target.value) || 0)}
                      step="0.01"
                      min="0"
                      max="100"
                    />
                  </Field>

                  <Field label="VAT Rate %">
                    <Select
                      value={item.vat_rate}
                      onChange={(e) => updateLineItem(index, 'vat_rate', parseFloat(e.target.value))}
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="20">20%</option>
                    </Select>
                  </Field>

                  <div className="flex items-end justify-between md:col-span-2">
                    <DescriptionList
                      columns={1}
                      items={[{
                        key: 'line_total',
                        label: 'Line Total',
                        value: (
                          <span className="text-lg font-medium">
                            £{((item.quantity * item.unit_price) * (1 - item.discount_percentage / 100)).toFixed(2)}
                          </span>
                        ),
                      }]}
                    />
                    {lineItems.length > 1 && (
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                        label="Remove line item"
                        icon={<Icon name="trash" size={16} className="text-danger" />}
                      />
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </CardBody>
        </Card>

        {/* Invoice Settings */}
        <Card>
          <CardHeader title="Invoice Settings" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Invoice Discount %" hint="Discount applied to entire invoice after line discounts">
                <Input
                  type="number"
                  value={invoiceDiscount}
                  onChange={(e) => setInvoiceDiscount(parseFloat(e.target.value) || 0)}
                  step="0.01"
                  min="0"
                  max="100"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Notes (Visible on Invoice)">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </Field>

              <Field label="Internal Notes">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader title="Summary (Per Invoice)" />
          <CardBody>
            <div className="ml-auto max-w-xs space-y-2">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span className="font-medium">£{subtotal.toFixed(2)}</span>
              </div>

              {invoiceDiscount > 0 && (
                <div className="flex justify-between text-danger-fg">
                  <span>Invoice Discount ({invoiceDiscount}%):</span>
                  <span>-£{invoiceDiscountAmount.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between">
                <span>VAT:</span>
                <span className="font-medium">£{totalVat.toFixed(2)}</span>
              </div>

              <div className="flex justify-between border-t border-border pt-2 text-lg font-bold">
                <span>Total:</span>
                <span>£{total.toFixed(2)}</span>
              </div>
            </div>
          </CardBody>
        </Card>

        <FormFooter>
          <LinkButton href={BACK_TO_RECURRING.href} variant="secondary">
            Cancel
          </LinkButton>
          <Button variant="primary"
            type="submit"
            disabled={submitting || !vendorId || lineItems.length === 0 || !canCreate}
            loading={submitting}
          >
            Create Recurring Invoice
          </Button>
        </FormFooter>
      </form>
    </PageLayout>
  )
}
