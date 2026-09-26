'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { formatDateFull } from '@/lib/dateUtils'
import { 
  getPrivateBooking, 
  addBookingItem, 
  updateBookingItem, 
  deleteBookingItem,
  getVenueSpaces,
  getCateringPackages,
  getVendors,
  getVendorRate
} from '@/app/actions/privateBookingActions'
import type { VenueSpace, CateringPackage, Vendor, ItemType, PrivateBookingItem, PrivateBookingWithDetails } from '@/types/private-bookings'
import {
  Alert,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  Empty,
  Field,
  FormFooter,
  Icon,
  IconButton,
  Input,
  Modal,
  PageLayout,
  Segmented,
  Select,
  Textarea,
  toast,
} from '@/ds'

import { formatCurrency } from '@/lib/format'
import { computeBookingMoney } from '@/lib/private-bookings/vat'
import { PB_BACK_TO_LIST, PB_DETAIL_NAV } from '../../_shared/nav'

const ITEM_TYPE_OPTIONS: Array<{ id: ItemType; label: string }> = [
  { id: 'space', label: 'Space' },
  { id: 'catering', label: 'Catering' },
  { id: 'vendor', label: 'Vendor' },
  { id: 'other', label: 'Other' },
]
interface AddItemModalProps {
  isOpen: boolean
  onClose: () => void
  bookingId: string
  onItemAdded: () => void
}

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  if (value === null || value === undefined) {
    return fallback
  }
  return fallback
}

const formatMoney = (value: unknown): string => formatCurrency(toNumber(value))

const sanitizeMoneyString = (value: unknown): string => {
  if (value === null || value === undefined) return ''

  const raw = typeof value === 'number' ? value.toString() : String(value)
  const trimmed = raw.trim()
  if (!trimmed) return ''

  // Normalise thousands separators and capture the first numeric segment
  const normalised = trimmed.replace(/,/g, '')
  const match = normalised.match(/-?\d+(?:\.\d+)?/)

  return match ? match[0] : ''
}

const moneyStringToNumber = (value: unknown): number => {
  const sanitised = sanitizeMoneyString(value)
  if (!sanitised) return 0

  const parsed = Number.parseFloat(sanitised)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeItem = (item: any): PrivateBookingItem => ({
  ...item,
  description: item.description,
  quantity: toNumber(item.quantity),
  unit_price: toNumber(item.unit_price),
  discount_value: item.discount_value === null || item.discount_value === undefined
    ? undefined
    : toNumber(item.discount_value),
  line_total: toNumber(item.line_total),
  display_order: item.display_order === null || item.display_order === undefined
    ? undefined
    : toNumber(item.display_order),
})

const normalizeBooking = (booking: PrivateBookingWithDetails): PrivateBookingWithDetails => {
  const guestCount = booking.guest_count === null || booking.guest_count === undefined
    ? undefined
    : toNumber(booking.guest_count)

  const discountAmount = booking.discount_amount === null || booking.discount_amount === undefined
    ? undefined
    : toNumber(booking.discount_amount)

  const calculatedTotal = booking.calculated_total === null || booking.calculated_total === undefined
    ? undefined
    : toNumber(booking.calculated_total)

  return {
    ...booking,
    guest_count: guestCount,
    deposit_amount: toNumber(booking.deposit_amount),
    total_amount: toNumber(booking.total_amount),
    discount_amount: discountAmount,
    calculated_total: calculatedTotal,
    items: booking.items
      ?.map(normalizeItem)
      ?.sort((a, b) => {
        const orderA = a.display_order ?? 0
        const orderB = b.display_order ?? 0
        if (orderA === orderB) {
          return (a.created_at || '').localeCompare(b.created_at || '')
        }
        return orderA - orderB
      }),
  }
}

function AddItemModal({ isOpen, onClose, bookingId, onItemAdded }: AddItemModalProps) {
  const [itemType, setItemType] = useState<ItemType>('space')
  const [spaces, setSpaces] = useState<VenueSpace[]>([])
  const [packages, setPackages] = useState<CateringPackage[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [selectedItem, setSelectedItem] = useState<VenueSpace | CateringPackage | Vendor | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [customDescription, setCustomDescription] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setSelectedItem(null)
    setQuantity('1')
    setCustomDescription('')
    setCustomPrice('')
    setDiscountAmount('')
    setDiscountType('percent')
    setNotes('')
  }, [itemType])

  const loadOptions = useCallback(async () => {
    if (itemType === 'space') {
      const result = await getVenueSpaces()
      if (result.data) setSpaces(result.data)
    } else if (itemType === 'catering') {
      const result = await getCateringPackages()
      if (result.data) setPackages(result.data)
    } else if (itemType === 'vendor') {
      const result = await getVendors()
      if (result.data) setVendors(result.data)
    }
  }, [itemType])

  useEffect(() => {
    loadOptions()
  }, [loadOptions])

  useEffect(() => {
    if (itemType !== 'vendor') {
      return
    }

    if (!selectedItem || !('typical_rate' in selectedItem)) {
      return
    }

    // Only hydrate if customPrice is still empty — don't overwrite user input.
    // The onChange handler above sets customPrice synchronously from the vendor's
    // typical_rate. This effect is a fallback for cases where the inline rate
    // was empty but a remote lookup might find one.
    let cancelled = false

    const hydrateRate = async () => {
      const vendor = selectedItem as Vendor

      const normalized = vendor.typical_rate_normalized ?? sanitizeMoneyString(vendor.typical_rate)

      if (normalized) {
        setCustomPrice((current) => current !== '' ? current : normalized)
        return
      }

      const rateResult = await getVendorRate(vendor.id)
      if (cancelled) return
      const remoteRate = rateResult.data?.typical_rate_normalized ?? null
      setCustomPrice((current) => current !== '' ? current : (remoteRate ?? ''))
    }

    hydrateRate()

    return () => {
      cancelled = true
    }
  }, [itemType, selectedItem])

  // Set quantity to 1 for total_value items
  useEffect(() => {
    if (itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value') {
      setQuantity('1')
    }
  }, [selectedItem, itemType])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const hasCustomPrice = customPrice.trim() !== ''

    if (itemType !== 'other' && !selectedItem) {
      toast.error('Please select an item to add')
      setIsSubmitting(false)
      return
    }

    let description = customDescription
    let unitPrice = hasCustomPrice ? moneyStringToNumber(customPrice) : 0

    if (itemType !== 'other' && selectedItem) {
      if (itemType === 'space' && 'rate_per_hour' in selectedItem) {
        description = selectedItem.name
        unitPrice = toNumber(selectedItem.rate_per_hour)
      } else if (itemType === 'catering' && 'cost_per_head' in selectedItem) {
        description = selectedItem.name
        if ('pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value') {
          unitPrice = hasCustomPrice
            ? moneyStringToNumber(customPrice)
            : toNumber(selectedItem.cost_per_head)
        } else {
          unitPrice = toNumber(selectedItem.cost_per_head)
        }
      } else if (itemType === 'vendor' && 'service_type' in selectedItem) {
        description = `${selectedItem.name} (${selectedItem.service_type})`
        if (!hasCustomPrice) {
          const normalized = 'typical_rate_normalized' in selectedItem
            ? selectedItem.typical_rate_normalized
            : undefined
          unitPrice = moneyStringToNumber(normalized ?? selectedItem.typical_rate)
        }
      }
    }

    const parsedQuantity = Number.parseFloat(quantity)
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast.error('Quantity must be greater than 0')
      setIsSubmitting(false)
      return
    }

    // For total_value pricing model, quantity should be 1
    const finalQuantity = itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value' 
      ? 1 
      : parsedQuantity

    const data = {
      booking_id: bookingId,
      item_type: itemType,
      space_id: itemType === 'space' ? selectedItem?.id : null,
      package_id: itemType === 'catering' ? selectedItem?.id : null,
      vendor_id: itemType === 'vendor' ? selectedItem?.id : null,
      description,
      quantity: finalQuantity,
      unit_price: unitPrice,
      discount_value: discountAmount.trim() ? moneyStringToNumber(discountAmount) : undefined,
      discount_type: discountAmount.trim() ? discountType : undefined,
      notes: notes || null
    }

    const result = await addBookingItem(data)
    
    if (result.success) {
      toast.success('Item added successfully')
      onItemAdded()
      onClose()
      // Reset form
      setSelectedItem(null)
      setQuantity('1')
      setCustomDescription('')
      setCustomPrice('')
      setDiscountAmount('')
      setNotes('')
    } else {
      toast.error(result.error || 'Failed to add item')
    }
    
    setIsSubmitting(false)
  }

  const resolveBasePrice = () => {
    if (customPrice.trim()) {
      return moneyStringToNumber(customPrice)
    }

    if (!selectedItem) return 0

    if (itemType === 'space' && 'rate_per_hour' in selectedItem) {
      return toNumber(selectedItem.rate_per_hour)
    }

    if (itemType === 'catering' && 'cost_per_head' in selectedItem) {
      if ('pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value') {
        return toNumber(selectedItem.cost_per_head)
      }
      return toNumber(selectedItem.cost_per_head)
    }

    if (itemType === 'vendor' && 'typical_rate' in selectedItem) {
      return moneyStringToNumber(selectedItem.typical_rate)
    }

    return 0
  }

  const calculateTotal = () => {
    const basePrice = resolveBasePrice()
    const effectiveQuantity = itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value'
      ? 1
      : Number.parseFloat(quantity) || 0

    let total = basePrice * effectiveQuantity

    if (discountAmount.trim()) {
      const discount = moneyStringToNumber(discountAmount)
      if (discountType === 'percent') {
        total = total * (1 - discount / 100)
      } else {
        total = total - discount
      }
    }

    return Math.max(0, total)
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add Booking Item"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Item Type Selection */}
        <Field label="Item Type">
          <Segmented
            options={ITEM_TYPE_OPTIONS}
            value={itemType}
            onChange={(id) => setItemType(id as ItemType)}
            className="flex-wrap"
          />
        </Field>

        {/* Item Selection */}
        {itemType !== 'other' && (
          <Field
            label={`Select ${itemType === 'space' ? 'Space' : itemType === 'catering' ? 'Package' : 'Vendor'}`}
            required
          >
            <Select
              value={selectedItem?.id || ''}
              onChange={(e) => {
                const items = itemType === 'space' ? spaces : itemType === 'catering' ? packages : vendors
                const item = items.find(i => i.id === e.target.value)
                setSelectedItem(item || null)

                if (!item) {
                  setCustomPrice('')
                  return
                }

                if (itemType === 'space' && 'rate_per_hour' in item) {
                  setCustomPrice(sanitizeMoneyString(item.rate_per_hour))
                } else if (itemType === 'catering' && 'cost_per_head' in item) {
                  setCustomPrice(sanitizeMoneyString(item.cost_per_head))
                } else if (itemType === 'vendor' && 'typical_rate' in item) {
                  const rate = sanitizeMoneyString(item.typical_rate)
                  if (rate) setCustomPrice(rate)
                }
              }}
              options={[
                { value: '', label: 'Select...' },
                ...(itemType === 'space' ? spaces : itemType === 'catering' ? packages : vendors).map((item) => ({
                  value: item.id,
                  label: item.name + (
                    itemType === 'space' && 'rate_per_hour' in item ? ` (£${item.rate_per_hour}/hr)` :
                    itemType === 'catering' && 'cost_per_head' in item ? (
                      item.pricing_model === 'total_value' 
                        ? ` (£${item.cost_per_head} total)` 
                        : ` (£${item.cost_per_head}/person)`
                    ) :
                    itemType === 'vendor' && 'service_type' in item && item.service_type ? ` - ${item.service_type}` :
                    ''
                  )
                }))
              ]}
              required
            />
          </Field>
        )}

        {/* Custom Description (for 'other' items) */}
        {itemType === 'other' && (
          <Field label="Description" required>
            <Input
              type="text"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              required
            />
          </Field>
        )}

        {/* Quantity and Price - Different layouts based on pricing model */}
        {itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value' ? (
          <Field label="Total Price (£)" required>
            <Input
              type="number"
              value={customPrice || selectedItem.cost_per_head || ''}
              onChange={(e) => setCustomPrice(e.target.value)}
              step="0.01"
              min="0"
              required
              placeholder="Enter total price"
            />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field 
              label={itemType === 'catering' ? 'Number of Guests' : 'Quantity'}
              required
            >
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min={itemType === 'catering' ? '1' : '0.01'}
                step={itemType === 'catering' ? '1' : '0.01'}
                required
              />
            </Field>
            <Field label="Unit Price (£)" required>
              <Input
                type="number"
                value={customPrice !== '' ? customPrice : (
                  selectedItem ? (
                    itemType === 'space' && 'rate_per_hour' in selectedItem ? sanitizeMoneyString(selectedItem.rate_per_hour) :
                    itemType === 'catering' && 'cost_per_head' in selectedItem ? sanitizeMoneyString(selectedItem.cost_per_head) :
                    itemType === 'vendor' && 'typical_rate' in selectedItem ? (
                      'typical_rate_normalized' in selectedItem
                        ? (selectedItem.typical_rate_normalized ?? '')
                        : sanitizeMoneyString(selectedItem.typical_rate)
                    ) :
                    ''
                  ) : ''
                )}
                onChange={(e) => setCustomPrice(e.target.value)}
                step="0.01"
                min="0"
                required={itemType === 'other' || itemType === 'vendor'}
                readOnly={itemType !== 'other' && itemType !== 'vendor' && !!selectedItem}
              />
            </Field>
          </div>
        )}

        {/* Discount */}
        <Field label="Discount (optional)">
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="Amount"
              aria-label="Discount amount"
              min="0"
              step="0.01"
            />
            <Select
              value={discountType}
              aria-label="Discount type"
              onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
              options={[
                { value: 'percent', label: 'Percentage (%)' },
                { value: 'fixed', label: 'Fixed Amount (£)' }
              ]}
            />
          </div>
        </Field>

        {/* Notes */}
        <Field label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </Field>

        {/* Total Preview */}
        {(customPrice || selectedItem) && (
          <div className="bg-surface-2 p-4 rounded-default">
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-muted">Total:</span>
              <span className="text-lg font-semibold text-text">
                {formatMoney(calculateTotal())}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <FormFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            Add Item
          </Button>
        </FormFooter>
      </form>
    </Modal>
  )
}

// Edit Item Modal Component
interface EditItemModalProps {
  isOpen: boolean
  onClose: () => void
  item: PrivateBookingItem
  onItemUpdated: () => void
}

function EditItemModal({ isOpen, onClose, item, onItemUpdated }: EditItemModalProps) {
  const [quantity, setQuantity] = useState(item.quantity.toString())
  const [unitPrice, setUnitPrice] = useState(item.unit_price.toString())
  const [discountAmount, setDiscountAmount] = useState(item.discount_value?.toString() || '')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(item.discount_type || 'percent')
  const [notes, setNotes] = useState(item.notes || '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const parsedQuantity = Number.parseFloat(quantity)
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast.error('Quantity must be greater than 0')
      setIsSubmitting(false)
      return
    }

    const result = await updateBookingItem(item.id, {
      quantity: parsedQuantity,
      unit_price: parseFloat(unitPrice),
      discount_value: discountAmount ? parseFloat(discountAmount) : undefined,
      discount_type: discountAmount ? discountType : undefined,
      notes: notes || null
    })

    if (result.success) {
      toast.success('Item updated successfully')
      onItemUpdated()
      onClose()
    } else {
      toast.error(result.error || 'Failed to update item')
    }

    setIsSubmitting(false)
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Edit Item"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Item">
          <p className="text-sm text-text">{item.description}</p>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity" required>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min={item.item_type === 'catering' ? '1' : '0.01'}
              step={item.item_type === 'catering' ? '1' : '0.01'}
              required
            />
          </Field>
          <Field label="Unit Price (£)" required>
            <Input
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              step="0.01"
              min="0"
              required
            />
          </Field>
        </div>

        <Field label="Discount">
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="Amount"
              aria-label="Discount amount"
              min="0"
              step="0.01"
            />
            <Select
              value={discountType}
              aria-label="Discount type"
              onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
              options={[
                { value: 'percent', label: 'Percentage (%)' },
                { value: 'fixed', label: 'Fixed Amount (£)' }
              ]}
            />
          </div>
        </Field>

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </Field>

        <FormFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            Save Changes
          </Button>
        </FormFooter>
      </form>
    </Modal>
  )
}

// Main Component
export default function ItemsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const bookingId = Array.isArray(params?.id) ? params.id[0] : params?.id ?? '';
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(null)
  const [items, setItems] = useState<PrivateBookingItem[]>([])
  const [loading, setLoading] = useState(true)
  // A failed load shows the error, never an empty item list.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<PrivateBookingItem | null>(null)
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)

  const loadData = useCallback(async (id: string) => {
    setLoading(true)
    setLoadError(null)

    const bookingResult = await getPrivateBooking(id, 'items')

    if ('error' in bookingResult && bookingResult.error) {
      toast.error(bookingResult.error)
      setLoadError(bookingResult.error)
      setLoading(false)
      return
    }

    if (bookingResult.data) {
      const normalized = normalizeBooking(bookingResult.data)
      setBooking(normalized)
      setItems(normalized.items || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (!bookingId) {
      return
    }
    loadData(bookingId)
  }, [bookingId, loadData])

  const refreshData = useCallback(() => {
    if (!bookingId) {
      return
    }
    loadData(bookingId)
  }, [bookingId, loadData])

  const handleDeleteItem = async (itemId: string) => {
    const result = await deleteBookingItem(itemId)
    if (result.success) {
      toast.success('Item deleted successfully')
      refreshData()
    } else {
      toast.error(result.error || 'Failed to delete item')
    }
    setDeletingItemId(null)
  }

  const getItemIcon = (type: ItemType) => {
    switch (type) {
      case 'space': return <Icon name="mapPin" size={20} className="block" />
      case 'catering': return <Icon name="sparkles" size={20} className="block" />
      case 'vendor': return <Icon name="users" size={20} className="block" />
      default: return <Icon name="clipboardList" size={20} className="block" />
    }
  }

  const calculateSubtotal = () =>
    items.reduce((sum, item) => sum + toNumber(item.line_total), 0)

  // One header for every state. Every tab of the booking shows the customer's name.
  const customerLabel = booking
    ? booking.customer_full_name || booking.customer_name || `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || 'Unknown'
    : 'Private Booking'

  const layoutProps = {
    title: customerLabel,
    subtitle: booking
      ? `Items for ${booking.event_date ? formatDateFull(booking.event_date) : 'a date to be confirmed'}`
      : 'Booking items',
    backButton: PB_BACK_TO_LIST,
    navItems: PB_DETAIL_NAV(bookingId),
  }

  if (loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading items..." />
  }

  if (loadError) {
    return <PageLayout {...layoutProps} error={loadError} onRetry={refreshData} />
  }

  // Stored prices are net — show VAT and the VAT-inclusive total (SOP 2026-07)
  const bookingMoney = computeBookingMoney(items, booking?.discount_type, booking?.discount_amount)

  return (
    <PageLayout
      {...layoutProps}
      headerActions={
        <Button
          size="sm"
          variant="primary"
          onClick={() => setShowAddModal(true)}
          icon={<Icon name="plus" size={16} />}
        >
          Add Item
        </Button>
      }
    >
      {booking?.invoice_id && (
        <Alert tone="info" role="status">
          Original invoiced prices are locked. Included items with no charge can still be added here.{' '}
          <Link className="text-primary underline" href={`/private-bookings/${bookingId}#booking-billing`}>
            Add chargeable extras on a separate invoice
          </Link>
        </Alert>
      )}

      <Card>
        {items.length === 0 ? (
          <Empty
            size="sm"
            icon={<Icon name="clipboardList" size={48} />}
            title="No items added yet"
            description="Click 'Add Item' to get started."
            action={
              <Button
                variant="primary"
                onClick={() => setShowAddModal(true)}
                icon={<Icon name="plus" size={16} />}
              >
                Add Item
              </Button>
            }
          />
        ) : (
          <CardBody className="space-y-4">
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.id} className="py-4 first:pt-0">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 text-text-subtle">
                        {getItemIcon(item.item_type)}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text">
                          {item.description}
                        </p>
                        <div className="mt-1 flex items-center space-x-4 text-sm text-text-muted">
                          <span>Qty: {item.quantity}</span>
                          <span>{formatMoney(item.unit_price)} each</span>
                          {/* Compare against 0 explicitly: a bare `item.discount_value &&`
                              renders the number 0 for the many items stored with a zero
                              discount, printing a stray "0" beside the price. */}
                          {toNumber(item.discount_value) > 0 && (
                            <span className="text-success-fg">
                              -{item.discount_type === 'percent' ? `${item.discount_value}%` : formatMoney(item.discount_value)}
                            </span>
                          )}
                        </div>
                        {item.notes && (
                          <p className="mt-1 text-sm text-text-muted">{item.notes}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <span className="text-lg font-semibold text-text">
                        {formatMoney(item.line_total)}
                      </span>
                      <div className="flex items-center space-x-2">
                        <IconButton
                          type="button"
                          onClick={() => setEditingItem(item)}
                          label="Edit item"
                          icon={<Icon name="edit" size={20} />}
                          className="text-text-muted"
                        />
                        <IconButton
                          type="button"
                          onClick={() => setDeletingItemId(item.id)}
                          label="Delete item"
                          icon={<Icon name="trash" size={20} />}
                          className="text-danger hover:text-danger-fg"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-lg font-medium text-text">Total (ex VAT)</span>
                <span className="text-2xl font-bold text-text">
                  {formatMoney(calculateSubtotal())}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-muted">VAT</span>
                <span className="font-medium text-text">
                  {formatMoney(bookingMoney.vatAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-base font-medium text-text">Total inc. VAT</span>
                <span className="text-lg font-semibold text-text">
                  {formatMoney(bookingMoney.grossTotal)}
                </span>
              </div>
            </div>
          </CardBody>
        )}
      </Card>

      {/* Modals */}
      <AddItemModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        bookingId={bookingId}
        onItemAdded={refreshData}
      />

      {editingItem && (
        <EditItemModal
          isOpen={!!editingItem}
          onClose={() => setEditingItem(null)}
          item={editingItem}
          onItemUpdated={() => {
            refreshData()
            setEditingItem(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!deletingItemId}
        onClose={() => setDeletingItemId(null)}
        onConfirm={() => deletingItemId && handleDeleteItem(deletingItemId)}
        title="Delete Item?"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmLabel="Delete Item"
        tone="danger"
      />
    </PageLayout>
  )
}
