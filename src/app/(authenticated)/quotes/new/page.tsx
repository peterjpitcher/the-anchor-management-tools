'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createQuote } from '@/app/actions/quotes'
import { getVendors } from '@/app/actions/vendors'
import { getLineItemCatalog } from '@/app/actions/invoices'
import type { InvoiceVendor, InvoiceLineItemInput, LineItemCatalogItem } from '@/types/invoices'
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
  Empty,
  Dropdown,
  FormFooter,
  toast,
} from '@/ds'
import { BACK_TO_QUOTES } from '@/app/(authenticated)/invoices/_shared/nav'

import { getTodayIsoDate, getLocalIsoDateDaysAhead } from '@/lib/dateUtils'
import { usePermissions } from '@/contexts/PermissionContext'
interface LineItem {
  id: string
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
}

export default function NewQuotePage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canCreate = hasPermission('invoices', 'create')
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [catalogItems, setCatalogItems] = useState<LineItemCatalogItem[]>([])
  const [vendorId, setVendorId] = useState('')
  const [quoteDate, setQuoteDate] = useState(getTodayIsoDate())
  const [validUntil, setValidUntil] = useState(getLocalIsoDateDaysAhead(30))
  const [reference, setReference] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [quoteDiscountPercentage, setQuoteDiscountPercentage] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (permissionsLoading) {
      return
    }

    if (!canCreate) {
      router.replace('/unauthorized')
      return
    }

    void loadData()
  }, [permissionsLoading, canCreate, router])

  async function loadData() {
    if (!canCreate) {
      return
    }

    setLoading(true)
    try {
      const [vendorResult, catalogResult] = await Promise.all([
        getVendors(),
        getLineItemCatalog()
      ])

      if (vendorResult.error || !vendorResult.vendors) {
        throw new Error(vendorResult.error || 'Failed to load vendors')
      }
      setVendors(vendorResult.vendors)

      if (catalogResult.error || !catalogResult.items) {
        throw new Error(catalogResult.error || 'Failed to load catalog items')
      }

      setCatalogItems(catalogResult.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const layoutProps = {
    title: 'New Quote',
    subtitle: 'Create a new quote',
    backButton: BACK_TO_QUOTES,
  }

  if (permissionsLoading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading" />
  }

  if (!canCreate) {
    return null
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

  function calculateQuoteTotal(): { subtotal: number; discount: number; vat: number; total: number } {
    const lineSubtotal = lineItems.reduce((acc, item) => {
      const itemSubtotal = item.quantity * item.unit_price
      const itemDiscount = itemSubtotal * (item.discount_percentage / 100)
      return acc + (itemSubtotal - itemDiscount)
    }, 0)

    const quoteDiscount = lineSubtotal * (quoteDiscountPercentage / 100)
    const afterDiscount = lineSubtotal - quoteDiscount

    const vat = lineItems.reduce((acc, item) => {
      const itemSubtotal = item.quantity * item.unit_price
      const itemDiscount = itemSubtotal * (item.discount_percentage / 100)
      const itemAfterDiscount = itemSubtotal - itemDiscount
      const itemShare = lineSubtotal > 0 ? itemAfterDiscount / lineSubtotal : 0
      const itemAfterQuoteDiscount = itemAfterDiscount - (quoteDiscount * itemShare)
      return acc + (itemAfterQuoteDiscount * (item.vat_rate / 100))
    }, 0)

    return {
      subtotal: lineSubtotal,
      discount: quoteDiscount,
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
      formData.append('quote_date', quoteDate)
      formData.append('valid_until', validUntil)
      formData.append('reference', reference)
      formData.append('quote_discount_percentage', quoteDiscountPercentage.toString())
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

      const result = await createQuote(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Quote created successfully')
      router.push(`/quotes/${result.quote?.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quote')
      toast.error('Failed to create quote')
      setLoading(false)
    }
  }

  if (!canCreate) {
    return null
  }

  if (loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Preparing quote" />
  }

  const totals = calculateQuoteTotal()

  return (
    <PageLayout {...layoutProps}>
      {error && (
        <Alert tone="danger" title="Error">{error}</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader title="Quote Details" />
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

            <Field label="Reference">
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="PO number or reference"
              />
            </Field>

            <Field label="Quote Date" required>
              <Input
                type="date"
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
                required
              />
            </Field>

            <Field label="Valid Until" required>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                required
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Line Items"
            action={
              <div className="flex gap-2">
                {catalogItems.length > 0 && (
                  <Dropdown
                    trigger={
                      <Button type="button" variant="secondary" size="sm">
                        Add from Catalog
                      </Button>
                    }
                    items={catalogItems.map(item => ({
                      key: item.id,
                      label: (
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-sm text-text-muted">{item.description}</div>
                          <div className="text-sm mt-1">
                            £{item.default_price.toFixed(2)} • VAT {item.default_vat_rate}%
                          </div>
                        </div>
                      ),
                      onClick: () => addFromCatalog(item)
                    }))}
                  />
                )}
                <Button variant="secondary" type="button" onClick={addLineItem} leftIcon={<Icon name="plusCircle" size={16} />} size="sm">
                  Add Line Item
                </Button>
              </div>
            }
          />
          <CardBody>
            {lineItems.length === 0 ? (
              <Empty size="sm" title="No line items added yet" />
            ) : (
              <div className="space-y-4">
                {lineItems.map((item) => (
                  <Card key={item.id}>
                    <CardBody>
                      <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-5">
                          <Field label="Description">
                            <Input
                              type="text"
                              value={item.description}
                              onChange={(e) => updateLineItem(item.id, { description: e.target.value })}
                              placeholder="Item description"
                              required
                            />
                          </Field>
                        </div>

                        <div className="col-span-12 md:col-span-2">
                          <Field label="Quantity">
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                              min="0"
                              step="0.01"
                              required
                            />
                          </Field>
                        </div>

                        <div className="col-span-12 md:col-span-2">
                          <Field label="Unit Price (£)">
                            <Input
                              type="number"
                              value={item.unit_price}
                              onChange={(e) => updateLineItem(item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                              min="0"
                              step="0.01"
                              required
                            />
                          </Field>
                        </div>

                        <div className="col-span-12 md:col-span-1">
                          <Field label="Disc %">
                            <Input
                              type="number"
                              value={item.discount_percentage}
                              onChange={(e) => updateLineItem(item.id, { discount_percentage: parseFloat(e.target.value) || 0 })}
                              min="0"
                              max="100"
                              step="0.01"
                            />
                          </Field>
                        </div>

                        <div className="col-span-12 md:col-span-1">
                          <Field label="VAT %">
                            <Input
                              type="number"
                              value={item.vat_rate}
                              onChange={(e) => updateLineItem(item.id, { vat_rate: parseFloat(e.target.value) || 0 })}
                              min="0"
                              step="0.01"
                            />
                          </Field>
                        </div>

                        <div className="col-span-12 flex items-end md:col-span-1">
                          <IconButton
                            type="button"
                            onClick={() => removeLineItem(item.id)}
                            variant="danger"
                            size="sm"
                            label="Remove line item"
                            icon={<Icon name="trash" size={16} />}
                          />
                        </div>
                      </div>

                      <div className="mt-2 text-right text-sm text-text-muted">
                        Line Total: £{calculateLineTotal(item).toFixed(2)}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Quote Summary" />
          <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="Quote Discount (%)">
                <Input
                  type="number"
                  value={quoteDiscountPercentage}
                  onChange={(e) => setQuoteDiscountPercentage(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.01"
                />
              </Field>

              <Field label="Notes (visible on quote)">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Terms, conditions, special instructions, etc."
                />
              </Field>

              <Field label="Internal Notes">
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                  placeholder="Private notes about this quote"
                />
              </Field>
            </div>

            <Card variant="secondary">
              <CardHeader title="Summary" />
              <CardBody className="space-y-2 text-sm sm:text-base">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-medium">£{totals.subtotal.toFixed(2)}</span>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-success-fg">
                    <span>Quote Discount: </span>
                    <span>-£{totals.discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>VAT:</span>
                  <span className="font-medium">£{totals.vat.toFixed(2)}</span>
                </div>
                <div className="border-t border-border pt-2">
                  <div className="flex justify-between text-base font-semibold sm:text-lg">
                    <span>Total:</span>
                    <span>£{totals.total.toFixed(2)}</span>
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
            onClick={() => router.push('/quotes')}
          >
            Cancel
          </Button>
          <Button variant="primary"
            type="submit"
            disabled={lineItems.length === 0}
            loading={loading}
          >
            Create Quote
          </Button>
        </FormFooter>
      </form>
    </PageLayout>
  )
}
