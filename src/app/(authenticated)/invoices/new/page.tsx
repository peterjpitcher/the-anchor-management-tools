'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createInvoice, getLineItemCatalog } from '@/app/actions/invoices'
import { getVendors } from '@/app/actions/vendors'
import {
  PageLayout,
  Icon,
  Button,
  IconButton,
  Field,
  Input,
  Select,
  Textarea,
  Card,
  CardHeader,
  CardBody,
  Alert,
  FormFooter,
  Modal,
  Empty,
  toast,
} from '@/ds'
import { getTodayIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import type { InvoiceVendor } from '@/types/invoices'
import type { LineItemCatalogItem, InvoiceLineItemInput } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import { DEFAULT_PAYMENT_TERMS_DAYS } from '@/lib/vendors/paymentTerms'
import { BACK_TO_INVOICES } from '../_shared/nav'

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
    // Net-7 is the house default; a customer given longer carries their own terms.
    const paymentTerms = vendor?.payment_terms ?? DEFAULT_PAYMENT_TERMS_DAYS

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

  const layoutProps = {
    title: 'New Invoice',
    subtitle: 'Create a new invoice',
    backButton: BACK_TO_INVOICES,
  }

  if (permissionsLoading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Checking permissions" />
  }

  if (!canCreate) {
    return null
  }

  return (
    <PageLayout {...layoutProps}>
      {error && (
        <Alert tone="danger">{error}</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="overflow-visible">
          <CardHeader title="Invoice Details" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vendor" required>
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
                <Button variant="secondary" type="button" onClick={addLineItem} leftIcon={<Icon name="plusCircle" size={16} />} size="sm">
                  <span className="hidden sm:inline">Add Line Item</span>
                  <span className="sm:hidden">Add Item</span>
                </Button>
              </div>
            }
          />
          <CardBody>
            {lineItems.length === 0 ? (
              <Empty
                size="sm"
                title="No line items yet"
                description='Click "Add Line Item" to begin.'
              />
            ) : (
              <div className="space-y-4">
                {lineItems.map((item, index) => {
                  const breakdown = invoiceTotals.lineBreakdown[index]
                  const lineTotal = breakdown ? breakdown.total : 0

                  return (
                    <Card key={item.id}>
                      <CardBody>
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                          <div className="lg:col-span-5">
                            <Input
                              label="Description"
                              type="text"
                              value={item.message}
                              onChange={(e) => updateLineItem(item.id, { message: e.target.value })}
                              placeholder="Item description"
                              required
                            />
                          </div>

                          <div className="lg:col-span-2">
                            <Input
                              label="Quantity"
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                              min="0"
                              step="0.01"
                              required
                            />
                          </div>

                          <div className="lg:col-span-2">
                            <Input
                              label="Unit Price (£)"
                              type="number"
                              value={item.unit_price}
                              onChange={(e) => updateLineItem(item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                              min="0"
                              step="0.01"
                              required
                            />
                          </div>

                          <div className="lg:col-span-1">
                            <Input
                              label="Disc %"
                              type="number"
                              value={item.discount_percentage}
                              onChange={(e) => updateLineItem(item.id, { discount_percentage: parseFloat(e.target.value) || 0 })}
                              min="0"
                              max="100"
                              step="0.01"
                            />
                          </div>

                          <div className="lg:col-span-1">
                            <Input
                              label="VAT %"
                              type="number"
                              value={item.vat_rate}
                              onChange={(e) => updateLineItem(item.id, { vat_rate: parseFloat(e.target.value) || 0 })}
                              min="0"
                              step="0.01"
                            />
                          </div>

                          <div className="flex items-end lg:col-span-1">
                            <IconButton
                              type="button"
                              onClick={() => removeLineItem(item.id)}
                              variant="danger"
                              label="Remove line item"
                              icon={<Icon name="trash" size={16} />}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                          <span className="text-sm text-text-muted">Line Total:</span>
                          <span className="font-semibold">£{lineTotal.toFixed(2)}</span>
                        </div>
                      </CardBody>
                    </Card>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Invoice Summary" />
          <CardBody className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <Field label="Invoice Discount (%)">
                <Input
                  type="number"
                  value={invoiceDiscountPercentage}
                  onChange={(e) => setInvoiceDiscountPercentage(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.01"
                />
              </Field>

              <Field label="Notes (visible on invoice)">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Payment terms, special instructions, etc."
                />
              </Field>

              <Field label="Internal Notes">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                  placeholder="Private notes about this invoice"
                />
              </Field>
            </div>

            <Card variant="secondary">
              <CardHeader title="Summary" />
              <CardBody className="space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-medium">
                    £{invoiceTotals.subtotalBeforeInvoiceDiscount.toFixed(2)}
                  </span>
                </div>
                {invoiceTotals.invoiceDiscountAmount > 0 && (
                  <div className="flex justify-between text-success-fg">
                    <span>Discount:</span>
                    <span>-£{invoiceTotals.invoiceDiscountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>VAT:</span>
                  <span className="font-medium">£{invoiceTotals.vatAmount.toFixed(2)}</span>
                </div>
                <div className="border-t border-border pt-2">
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Total:</span>
                    <span>£{invoiceTotals.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </CardBody>
            </Card>
          </CardBody>
        </Card>

        <FormFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/invoices')}
          >
            Cancel
          </Button>
          <Button variant="primary"
            type="submit"
            disabled={loading || lineItems.length === 0 || !canCreate}
            loading={loading}
          >
            Create Invoice
          </Button>
        </FormFooter>
      </form>

      <Modal
        open={isCatalogModalOpen}
        onClose={() => setIsCatalogModalOpen(false)}
        title="Add from Catalog"
        size="lg"
      >
        {catalogItems.length > 0 ? (
          <Card padding="none">
            <div className="max-h-96 divide-y divide-border overflow-y-auto">
              {catalogItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="font-medium text-text">{item.name}</div>
                    {item.description && (
                      <div className="mt-0.5 text-sm text-text-muted">{item.description}</div>
                    )}
                    <div className="mt-2 text-xs text-text-muted">
                      £{item.default_price.toFixed(2)} • VAT {item.default_vat_rate}%
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Add ${item.name}`}
                    onClick={() => {
                      addFromCatalog(item)
                      setIsCatalogModalOpen(false)
                    }}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Empty size="sm" title="No catalog items available" />
        )}
      </Modal>
    </PageLayout>
  )
}
