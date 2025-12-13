'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createQuote } from '@/app/actions/quotes'
import { getVendors } from '@/app/actions/vendors'
import { getLineItemCatalog } from '@/app/actions/invoices'
import { PlusCircle, Trash2 } from 'lucide-react'
import type { InvoiceVendor, InvoiceLineItemInput, LineItemCatalogItem } from '@/types/invoices'
// UI v2 components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Dropdown } from '@/components/ui-v2/navigation/Dropdown'
import { toast } from '@/components/ui-v2/feedback/Toast'

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

  if (permissionsLoading) {
    return (
      <PageLayout
        title="New Quote"
        subtitle="Loading quote resources..."
        backButton={{ label: 'Back to Quotes', href: '/quotes' }}
        loading
        loadingLabel="Loading..."
      />
    )
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

  const layoutProps = {
    title: 'New Quote',
    subtitle: 'Create a new quote',
    backButton: { label: 'Back to Quotes', href: '/quotes' },
  }

  if (loading) {
    return (
      <PageLayout {...layoutProps} loading loadingLabel="Preparing quote...">
        {null}
      </PageLayout>
    )
  }

  const totals = calculateQuoteTotal()

  return (
    <PageLayout {...layoutProps}>
      {error && (
        <Alert variant="error" title="Error" description={error} />
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Section title="Quote Details">
          <Card>
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

              <FormGroup label="Reference">
                <Input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="PO number or reference"
                />
              </FormGroup>

              <FormGroup label="Quote Date" required>
                <Input
                  type="date"
                  value={quoteDate}
                  onChange={(e) => setQuoteDate(e.target.value)}
                  required
                />
              </FormGroup>

              <FormGroup label="Valid Until" required>
                <Input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  required
                />
              </FormGroup>
            </div>
          </Card>
        </Section>

        <Section
          title="Line Items"
          actions={
            <div className="flex gap-2">
              {catalogItems.length > 0 && (
                <Dropdown
                  label="Add from Catalog"
                  variant="secondary"
                  size="sm"
                  items={catalogItems.map(item => ({
                    key: item.id,
                    label: (
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-sm text-gray-600">{item.description}</div>
                        <div className="text-sm mt-1">
                          £{item.default_price.toFixed(2)} • VAT {item.default_vat_rate}%
                        </div>
                      </div>
                    ),
                    onClick: () => addFromCatalog(item)
                  }))}
                />
              )}
              <Button type="button" onClick={addLineItem} leftIcon={<PlusCircle className="h-4 w-4" />} size="sm">
                Add Line Item
              </Button>
            </div>
          }
        >
          <Card>
            {lineItems.length === 0 ? (
              <EmptyState title="No line items added yet"
                action={
                  <Button type="button"
                    onClick={addLineItem}
                    leftIcon={<PlusCircle className="h-4 w-4" />}
                  >
                    Add Line Item
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {lineItems.map((item) => (
                  <div key={item.id} className="border rounded-lg p-4">
                    <div className="grid grid-cols-12 gap-4">
                      <div className="col-span-12 md:col-span-5">
                        <FormGroup label="Description">
                          <Input
                            type="text"
                            value={item.description}
                            onChange={(e) => updateLineItem(item.id, { description: e.target.value })}
                            placeholder="Item description"
                            required
                          />
                        </FormGroup>
                      </div>

                      <div className="col-span-4 md:col-span-2">
                        <FormGroup label="Quantity">
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                            min="0"
                            step="0.01"
                            required
                          />
                        </FormGroup>
                      </div>

                      <div className="col-span-4 md:col-span-2">
                        <FormGroup label="Unit Price (£)">
                          <Input
                            type="number"
                            value={item.unit_price}
                            onChange={(e) => updateLineItem(item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                            min="0"
                            step="0.01"
                            required
                          />
                        </FormGroup>
                      </div>

                      <div className="col-span-2 md:col-span-1">
                        <FormGroup label="Disc %">
                          <Input
                            type="number"
                            value={item.discount_percentage}
                            onChange={(e) => updateLineItem(item.id, { discount_percentage: parseFloat(e.target.value) || 0 })}
                            min="0"
                            max="100"
                            step="0.01"
                          />
                        </FormGroup>
                      </div>

                      <div className="col-span-2 md:col-span-1">
                        <FormGroup label="VAT %">
                          <Input
                            type="number"
                            value={item.vat_rate}
                            onChange={(e) => updateLineItem(item.id, { vat_rate: parseFloat(e.target.value) || 0 })}
                            min="0"
                            step="0.01"
                          />
                        </FormGroup>
                      </div>

                      <div className="col-span-12 md:col-span-1 flex items-end">
                        <Button
                          type="button"
                          onClick={() => removeLineItem(item.id)}
                          variant="danger"
                          size="sm"
                          iconOnly
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2 text-right text-sm text-gray-600">
                      Line Total: £{calculateLineTotal(item).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Section>

        <Section title="Quote Summary">
          <Card>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-4">
                <FormGroup label="Quote Discount (%)">
                  <Input
                    type="number"
                    value={quoteDiscountPercentage}
                    onChange={(e) => setQuoteDiscountPercentage(parseFloat(e.target.value) || 0)}
                    min="0"
                    max="100"
                    step="0.01"
                  />
                </FormGroup>

                <FormGroup label="Notes (visible on quote)">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Terms, conditions, special instructions, etc."
                  />
                </FormGroup>

                <FormGroup label="Internal Notes">
                  <Textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={3}
                    placeholder="Private notes about this quote"
                  />
                </FormGroup>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
                <h3 className="font-semibold text-sm sm:text-base mb-2 sm:mb-3">Summary</h3>
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex justify-between text-sm sm:text-base">
                    <span>Subtotal:</span>
                    <span className="font-medium">£{totals.subtotal.toFixed(2)}</span>
                  </div>
                  {totals.discount > 0 && (
                    <div className="flex justify-between text-green-600 text-sm sm:text-base">
                      <span>Quote Discount: </span>
                      <span>-£{totals.discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm sm:text-base">
                    <span>VAT:</span>
                    <span className="font-medium">£{totals.vat.toFixed(2)}</span>
                  </div>
                  <div className="border-t pt-2">
                    <div className="flex justify-between text-base sm:text-lg font-semibold">
                      <span>Total:</span>
                      <span>£{totals.total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </Section>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 sm:gap-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/quotes')}
            fullWidth={false}
            className="sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={lineItems.length === 0}
            loading={loading}
            fullWidth={false}
            className="sm:w-auto"
          >
            Create Quote
          </Button>
        </div>
      </form>
    </PageLayout>
  )
}
