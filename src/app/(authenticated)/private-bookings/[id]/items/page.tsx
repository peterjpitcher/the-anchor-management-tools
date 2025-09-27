'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { formatDateFull } from '@/lib/dateUtils'
import { 
  PlusIcon, 
  TrashIcon,
  PencilIcon,
  MapPinIcon,
  SparklesIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  // XMarkIcon
} from '@heroicons/react/24/outline'
import { 
  getPrivateBooking, 
  addBookingItem, 
  updateBookingItem, 
  deleteBookingItem,
  getVenueSpaces,
  getCateringPackages,
  getVendors
} from '@/app/actions/privateBookingActions'
import type { VenueSpace, CateringPackage, Vendor, ItemType, PrivateBookingItem, PrivateBookingWithDetails } from '@/types/private-bookings'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
// import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { toast } from '@/components/ui-v2/feedback/Toast'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { formatCurrency } from '@/components/ui-v2/utils/format'
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

const normalizeItem = (item: any): PrivateBookingItem => ({
  ...item,
  description: item.description,
  quantity: toNumber(item.quantity),
  unit_price: toNumber(item.unit_price),
  discount_value: item.discount_value === null || item.discount_value === undefined
    ? undefined
    : toNumber(item.discount_value),
  line_total: toNumber(item.line_total),
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
    items: booking.items?.map(normalizeItem),
  }
}

function AddItemModal({ isOpen, onClose, bookingId, onItemAdded }: AddItemModalProps) {
  const [itemType, setItemType] = useState<ItemType>('space')
  const [spaces, setSpaces] = useState<VenueSpace[]>([])
  const [packages, setPackages] = useState<CateringPackage[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [selectedItem, setSelectedItem] = useState<VenueSpace | CateringPackage | Vendor | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [customDescription, setCustomDescription] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  // Set quantity to 1 for total_value items
  useEffect(() => {
    if (itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value') {
      setQuantity(1)
    }
  }, [selectedItem, itemType])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    let description = customDescription
    let unitPrice = parseFloat(customPrice) || 0

    if (itemType !== 'other' && selectedItem) {
      if (itemType === 'space' && 'rate_per_hour' in selectedItem) {
        description = selectedItem.name
        unitPrice = selectedItem.rate_per_hour
      } else if (itemType === 'catering' && 'cost_per_head' in selectedItem) {
        description = selectedItem.name
        // For total_value items, use the custom price entered by the user
        if ('pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value') {
          unitPrice = parseFloat(customPrice) || selectedItem.cost_per_head
        } else {
          unitPrice = selectedItem.cost_per_head
        }
      } else if (itemType === 'vendor' && 'service_type' in selectedItem) {
        description = `${selectedItem.name} (${selectedItem.service_type})`
        unitPrice = parseFloat(selectedItem.typical_rate || '0') || 0
      }
    }

    // For total_value pricing model, quantity should be 1
    const finalQuantity = itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value' 
      ? 1 
      : quantity

    const data = {
      booking_id: bookingId,
      item_type: itemType,
      space_id: itemType === 'space' ? selectedItem?.id : null,
      package_id: itemType === 'catering' ? selectedItem?.id : null,
      vendor_id: itemType === 'vendor' ? selectedItem?.id : null,
      description,
      quantity: finalQuantity,
      unit_price: unitPrice,
      discount_value: discountAmount ? parseFloat(discountAmount) : undefined,
      discount_type: discountAmount ? discountType : undefined,
      notes: notes || null
    }

    const result = await addBookingItem(data)
    
    if (result.success) {
      toast.success('Item added successfully')
      onItemAdded()
      onClose()
      // Reset form
      setSelectedItem(null)
      setQuantity(1)
      setCustomDescription('')
      setCustomPrice('')
      setDiscountAmount('')
      setNotes('')
    } else {
      toast.error(result.error || 'Failed to add item')
    }
    
    setIsSubmitting(false)
  }

  const calculateTotal = () => {
    const price = parseFloat(customPrice) || (selectedItem && (
      itemType === 'space' && 'rate_per_hour' in selectedItem ? selectedItem.rate_per_hour :
      itemType === 'catering' && 'cost_per_head' in selectedItem ? selectedItem.cost_per_head :
      itemType === 'vendor' && 'typical_rate' in selectedItem ? parseFloat(selectedItem.typical_rate || '0') :
      0
    )) || 0

    let total = price * quantity
    
    if (discountAmount) {
      const discount = parseFloat(discountAmount)
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Item Type
          </label>
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => setItemType('space')}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === 'space' 
                  ? 'border-blue-500 bg-blue-50 text-blue-700' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <MapPinIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Space</span>
            </button>
            <button
              type="button"
              onClick={() => setItemType('catering')}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === 'catering' 
                  ? 'border-blue-500 bg-blue-50 text-blue-700' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <SparklesIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Catering</span>
            </button>
            <button
              type="button"
              onClick={() => setItemType('vendor')}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === 'vendor' 
                  ? 'border-blue-500 bg-blue-50 text-blue-700' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <UserGroupIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Vendor</span>
            </button>
            <button
              type="button"
              onClick={() => setItemType('other')}
              className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                itemType === 'other' 
                  ? 'border-blue-500 bg-blue-50 text-blue-700' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <ClipboardDocumentListIcon className="h-6 w-6 mb-1" />
              <span className="text-sm">Other</span>
            </button>
          </div>
        </div>

        {/* Item Selection */}
        {itemType !== 'other' && (
          <FormGroup
            label={`Select ${itemType === 'space' ? 'Space' : itemType === 'catering' ? 'Package' : 'Vendor'}`}
            required
          >
            <Select
              value={selectedItem?.id || ''}
              onChange={(e) => {
                const items = itemType === 'space' ? spaces : itemType === 'catering' ? packages : vendors
                const item = items.find(i => i.id === e.target.value)
                setSelectedItem(item || null)
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
          </FormGroup>
        )}

        {/* Custom Description (for 'other' items) */}
        {itemType === 'other' && (
          <FormGroup label="Description" required>
            <Input
              type="text"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              required
            />
          </FormGroup>
        )}

        {/* Quantity and Price - Different layouts based on pricing model */}
        {itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value' ? (
          <FormGroup label="Total Price (£)" required>
            <Input
              type="number"
              value={customPrice || selectedItem.cost_per_head || ''}
              onChange={(e) => setCustomPrice(e.target.value)}
              step="0.01"
              min="0"
              required
              placeholder="Enter total price"
            />
          </FormGroup>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <FormGroup 
              label={itemType === 'catering' ? 'Number of Guests' : 'Quantity'}
              required
            >
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                min="1"
                required
              />
            </FormGroup>
            <FormGroup label="Unit Price (£)" required>
              <Input
                type="number"
                value={customPrice || (selectedItem && (
                  itemType === 'space' && 'rate_per_hour' in selectedItem ? selectedItem.rate_per_hour :
                  itemType === 'catering' && 'cost_per_head' in selectedItem ? selectedItem.cost_per_head :
                  itemType === 'vendor' && 'typical_rate' in selectedItem ? (selectedItem.typical_rate ?? '') :
                  ''
                )) || ''}
                onChange={(e) => setCustomPrice(e.target.value)}
                step="0.01"
                min="0"
                required={itemType === 'other' || itemType === 'vendor'}
                readOnly={itemType !== 'other' && itemType !== 'vendor' && !!selectedItem}
              />
            </FormGroup>
          </div>
        )}

        {/* Discount */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Discount (optional)
          </label>
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="Amount"
              min="0"
              step="0.01"
            />
            <Select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
              options={[
                { value: 'percent', label: 'Percentage (%)' },
                { value: 'fixed', label: 'Fixed Amount (£)' }
              ]}
            />
          </div>
        </div>

        {/* Notes */}
        <FormGroup label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </FormGroup>

        {/* Total Preview */}
        {(customPrice || selectedItem) && (
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Total:</span>
              <span className="text-lg font-semibold text-gray-900">
                {formatMoney(calculateTotal())}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            Add Item
          </Button>
        </div>
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
  const [quantity, setQuantity] = useState(item.quantity)
  const [unitPrice, setUnitPrice] = useState(item.unit_price.toString())
  const [discountAmount, setDiscountAmount] = useState(item.discount_value?.toString() || '')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(item.discount_type || 'percent')
  const [notes, setNotes] = useState(item.notes || '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const result = await updateBookingItem(item.id, {
      quantity,
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Item
          </label>
          <p className="text-sm text-gray-900">{item.description}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormGroup label="Quantity" required>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              min="1"
              required
            />
          </FormGroup>
          <FormGroup label="Unit Price (£)" required>
            <Input
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              step="0.01"
              min="0"
              required
            />
          </FormGroup>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Discount
          </label>
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="Amount"
              min="0"
              step="0.01"
            />
            <Select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
              options={[
                { value: 'percent', label: 'Percentage (%)' },
                { value: 'fixed', label: 'Fixed Amount (£)' }
              ]}
            />
          </div>
        </div>

        <FormGroup label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </FormGroup>

        <div className="flex justify-end gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            Save Changes
          </Button>
        </div>
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<PrivateBookingItem | null>(null)
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)

  const loadData = useCallback(async (id: string) => {
    setLoading(true)

    const bookingResult = await getPrivateBooking(id)

    if ('error' in bookingResult && bookingResult.error) {
      toast.error(bookingResult.error)
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
      case 'space': return <MapPinIcon className="h-5 w-5" />
      case 'catering': return <SparklesIcon className="h-5 w-5" />
      case 'vendor': return <UserGroupIcon className="h-5 w-5" />
      default: return <ClipboardDocumentListIcon className="h-5 w-5" />
    }
  }

  const calculateSubtotal = () =>
    items.reduce((sum, item) => sum + toNumber(item.line_total), 0)

  if (loading) {
    return (
      <Page title="Booking Items"
      actions={<BackButton label="Back to Booking" onBack={() => router.back()} />}
    >
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="Booking Items"
      description={`${booking?.customer_name || `${booking?.customer_first_name || ''} ${booking?.customer_last_name || ''}`.trim() || 'Unknown'} - ${booking?.event_date ? formatDateFull(booking.event_date) : 'Date TBD'}`}
      actions={
        <>
          <LinkButton href={`/private-bookings/${bookingId}`} variant="secondary">
            Back
          </LinkButton>
          <Button
            onClick={() => setShowAddModal(true)}
            leftIcon={<PlusIcon className="h-5 w-5" />}
          >
            Add Item
          </Button>
        </>
      }
    >
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<ClipboardDocumentListIcon className="h-12 w-12" />}
            title="No items added yet"
            description="Click 'Add Item' to get started."
            action={
              <Button
                onClick={() => setShowAddModal(true)}
                leftIcon={<PlusIcon className="h-5 w-5" />}
              >
                Add Item
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 text-gray-400">
                      {getItemIcon(item.item_type)}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {item.description}
                      </p>
                      <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                        <span>Qty: {item.quantity}</span>
                        <span>{formatMoney(item.unit_price)} each</span>
                        {item.discount_value && (
                          <span className="text-green-600">
                            -{item.discount_type === 'percent' ? `${item.discount_value}%` : formatMoney(item.discount_value)}
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <p className="mt-1 text-sm text-gray-500">{item.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="text-lg font-semibold text-gray-900">
                      {formatMoney(item.line_total)}
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setEditingItem(item)}
                        className="text-gray-400 hover:text-gray-500"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setDeletingItemId(item.id)}
                        className="text-red-400 hover:text-red-500"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Total */}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center">
                <span className="text-lg font-medium text-gray-900">Total</span>
                <span className="text-2xl font-bold text-gray-900">
                  {formatMoney(calculateSubtotal())}
                </span>
              </div>
            </div>
          </div>
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
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="danger"
      />
    </Page>
  )
}
