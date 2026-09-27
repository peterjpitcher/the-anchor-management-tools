'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getQuote, updateQuote } from '@/app/actions/quotes'
import { getVendors } from '@/app/actions/vendors'
import type { InvoiceVendor, InvoiceLineItemInput, QuoteWithDetails } from '@/types/invoices'
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
  FormFooter,
  toast,
} from '@/ds'

import { usePermissions } from '@/contexts/PermissionContext'
import { quotePageTitle } from '@/app/(authenticated)/invoices/_shared/nav'
export default function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('invoices', 'view')
  const canEdit = hasPermission('invoices', 'edit')
  const [quote, setQuote] = useState<QuoteWithDetails | null>(null)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quoteId, setQuoteId] = useState<string | null>(null)
  
  // Form state
  const [selectedVendor, setSelectedVendor] = useState('')
  const [quoteDate, setQuoteDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [reference, setReference] = useState('')
  const [quoteDiscount, setQuoteDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([])

  useEffect(() => {
    async function getParams() {
      const { id } = await params
      setQuoteId(id)
    }
    getParams()
  }, [params])

  useEffect(() => {
    const id = quoteId

    if (!id || permissionsLoading) {
      return
    }

    if (!canEdit) {
      router.replace('/unauthorized')
      return
    }

    async function loadData(currentId: string) {
      setLoading(true)
      try {
        const [vendorsResult, quoteResult] = await Promise.all([
          getVendors(),
          getQuote(currentId)
        ])

        if (vendorsResult.error || !vendorsResult.vendors) {
          throw new Error(vendorsResult.error || 'Failed to load vendors')
        }

        if (quoteResult.error || !quoteResult.quote) {
          throw new Error(quoteResult.error || 'Failed to load quote')
        }

        const quoteData = quoteResult.quote
        
        if (!['draft', 'sent', 'expired'].includes(quoteData.status) || quoteData.converted_to_invoice_id) {
          throw new Error('Only draft, sent, or expired unconverted quotes can be edited')
        }

        setVendors(vendorsResult.vendors)
        setQuote(quoteData)
        
        // Populate form fields
        setSelectedVendor(quoteData.vendor_id || '')
        setQuoteDate(quoteData.quote_date)
        setValidUntil(quoteData.valid_until)
        setReference(quoteData.reference || '')
        setQuoteDiscount(quoteData.quote_discount_percentage || 0)
        setNotes(quoteData.notes || '')
        setInternalNotes(quoteData.internal_notes || '')
        
        // Convert line items
        const items = (quoteData.line_items || []).map(item => ({
          catalog_item_id: item.catalog_item_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percentage: item.discount_percentage,
          vat_rate: item.vat_rate
        }))
        
        setLineItems(items.length > 0 ? items : [{
          catalog_item_id: undefined,
          description: '',
          quantity: 1,
          unit_price: 0,
          discount_percentage: 0,
          vat_rate: 20
        }])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    void loadData(id)
  }, [quoteId, permissionsLoading, canEdit, router])


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

  function updateLineItem(index: number, updates: Partial<InvoiceLineItemInput>) {
    const updatedItems = [...lineItems]
    updatedItems[index] = { ...updatedItems[index], ...updates }
    setLineItems(updatedItems)
  }

  // Calculate totals
  function calculateTotals() {
    let subtotal = 0
    let totalVat = 0

    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      subtotal += lineAfterDiscount
    })

    const quoteDiscountAmount = subtotal * (quoteDiscount / 100)
    const afterQuoteDiscount = subtotal - quoteDiscountAmount

    // Calculate VAT after all discounts
    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      const lineShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
      const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscountAmount * lineShare)
      const lineVat = lineAfterQuoteDiscount * (item.vat_rate / 100)
      totalVat += lineVat
    })

    const total = afterQuoteDiscount + totalVat

    return {
      subtotal,
      quoteDiscountAmount,
      totalVat,
      total
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!canEdit) {
      toast.error('You do not have permission to update quotes')
      return
    }
    
    if (!quote || !quoteId) return
    
    if (!selectedVendor) {
      setError('Please select a vendor')
      return
    }

    if (lineItems.length === 0) {
      setError('Please add at least one line item')
      return
    }

    const hasInvalidItems = lineItems.some(item => 
      !item.description || item.quantity <= 0 || item.unit_price < 0
    )

    if (hasInvalidItems) {
      setError('Please fill in all line items with valid values')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('quote_id', quoteId)
      formData.append('vendor_id', selectedVendor)
      formData.append('quote_date', quoteDate)
      formData.append('valid_until', validUntil)
      formData.append('reference', reference)
      formData.append('quote_discount_percentage', quoteDiscount.toString())
      formData.append('notes', notes)
      formData.append('internal_notes', internalNotes)
      formData.append('line_items', JSON.stringify(lineItems))

      const result = await updateQuote(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Quote updated successfully')
      router.push(`/quotes/${quoteId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quote')
      toast.error('Failed to update quote')
    } finally {
      setSubmitting(false)
    }
  }

  const { subtotal, quoteDiscountAmount, totalVat, total } = calculateTotals()

  const backHref = quoteId ? `/quotes/${quoteId}` : '/quotes'
  const layoutProps = {
    title: 'Edit Quote',
    subtitle: 'Update quote details',
    // Back to the quote page, named as that page is titled ("Quote Q-001").
    backButton: { label: `Back to ${quotePageTitle(quote?.quote_number)}`, href: backHref },
  }

  if (permissionsLoading) {
    return <PageLayout {...layoutProps} loading />
  }

  if (!canEdit) {
    return null
  }

  if (loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading quote details" />
  }

  if (!quote) {
    return <PageLayout {...layoutProps} error={error || 'Quote not found'} />
  }

  return (
    <PageLayout {...layoutProps}>
      {error && (
        <Alert tone="danger" title="Error">{error}</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Quote Details */}
        <Card>
          <CardHeader title="Quote Details" subtitle={quote.quote_number} />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vendor" required>
              <Select
                value={selectedVendor}
                onChange={(e) => setSelectedVendor(e.target.value)}
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

            <Field label="Reference/PO Number">
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Optional reference"
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

        {/* Line Items */}
        <Card>
          <CardHeader
            title="Line Items"
            action={
              <Button variant="secondary" type="button" onClick={addLineItem} size="sm" leftIcon={<Icon name="plus" size={16} />}>
                Add Line Item
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {lineItems.map((item, index) => (
              <Card key={index}>
                <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-6">
                  <div className="md:col-span-3">
                    <Field label="Description" required>
                      <Input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, { description: e.target.value })}
                        required
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label="Qty" required>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, { quantity: parseFloat(e.target.value) || 0 })}
                        min="0.001"
                        step="0.001"
                        required
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label="Unit Price" required>
                      <Input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateLineItem(index, { unit_price: parseFloat(e.target.value) || 0 })}
                        min="0"
                        step="0.01"
                        required
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label="Discount %">
                      <Input
                        type="number"
                        value={item.discount_percentage}
                        onChange={(e) => updateLineItem(index, { discount_percentage: parseFloat(e.target.value) || 0 })}
                        min="0"
                        max="100"
                        step="0.01"
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label="VAT %">
                      <Select
                        value={item.vat_rate}
                        onChange={(e) => updateLineItem(index, { vat_rate: parseFloat(e.target.value) })}
                      >
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="20">20%</option>
                      </Select>
                    </Field>
                  </div>

                  {lineItems.length > 1 && (
                    <div className="flex items-end">
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                        label="Remove line item"
                        icon={<Icon name="trash" size={16} className="text-danger" />}
                      />
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </CardBody>
        </Card>

        {/* Quote-level Discount and Notes */}
        <Card>
          <CardHeader title="Discount & Notes" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Quote Discount %"
                hint="Applied to subtotal after line item discounts"
              >
                <Input
                  type="number"
                  value={quoteDiscount}
                  onChange={(e) => setQuoteDiscount(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.01"
                />
              </Field>
            </div>

            <Field label="Notes (visible on quote)">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any notes to include on the quote..."
              />
            </Field>

            <Field label="Internal Notes (not visible on quote)">
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes for your reference..."
              />
            </Field>
          </CardBody>
        </Card>

        {/* Totals Summary */}
        <Card>
          <CardHeader title="Summary" />
          <CardBody className="space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Subtotal:</span>
              <span className="font-medium">£{subtotal.toFixed(2)}</span>
            </div>

            {quoteDiscountAmount > 0 && (
              <div className="flex justify-between text-danger-fg">
                <span>Quote Discount ({quoteDiscount}%):</span>
                <span>-£{quoteDiscountAmount.toFixed(2)}</span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-text-muted">VAT:</span>
              <span className="font-medium">£{totalVat.toFixed(2)}</span>
            </div>

            <div className="flex justify-between border-t border-border pt-2 text-lg font-bold">
              <span>Total:</span>
              <span>£{total.toFixed(2)}</span>
            </div>
          </CardBody>
        </Card>

        <FormFooter>
          <LinkButton href={backHref} variant="secondary" disabled={submitting}>
            Cancel
          </LinkButton>
          <Button variant="primary"
            type="submit"
            loading={submitting}
            disabled={submitting || !canEdit}
            title={!canEdit ? 'You need invoice edit permission to update quotes.' : undefined}
          >
            Save Changes
          </Button>
        </FormFooter>
      </form>
    </PageLayout>
  )
}
