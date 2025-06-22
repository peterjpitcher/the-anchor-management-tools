'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { 
  ArrowLeftIcon, 
  PlusIcon, 
  TrashIcon,
  PencilIcon,
  MapPinIcon,
  SparklesIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { 
  getPrivateBooking, 
  getBookingItems, 
  addBookingItem, 
  updateBookingItem, 
  deleteBookingItem,
  getVenueSpaces,
  getCateringPackages,
  getVendors
} from '@/app/actions/privateBookingActions'

// Type definitions
type ItemType = 'space' | 'catering' | 'vendor' | 'other'

interface VenueSpace {
  id: string;
  name: string;
  capacity: number;
  description?: string;
  is_active: boolean;
  hire_cost: number;
}

interface CateringPackage {
  id: string;
  name: string;
  description?: string;
  per_head_cost: number;
  is_active: boolean;
}

interface Vendor {
  id: string;
  name: string;
  vendor_type: string;
  contact_email?: string;
  contact_phone?: string;
  is_active: boolean;
  typical_rate?: number;
}

interface BookingItem {
  id: string
  booking_id: string
  item_type: ItemType
  space_id?: string | null
  package_id?: string | null
  vendor_id?: string | null
  description: string
  quantity: number
  unit_price: number
  discount_value?: number
  discount_type?: 'percent' | 'fixed'
  line_total: number
  notes?: string | null
  space?: VenueSpace
  package?: CateringPackage
  vendor?: Vendor
}

interface PrivateBooking {
  id: string;
  customer_id?: string;
  event_date: string;
  event_type?: string;
  status: string;
  notes?: string;
  customer?: {
    id: string;
    first_name: string;
    last_name: string;
    mobile_number?: string;
  };
  customer_first_name?: string;
  customer_last_name?: string;
  customer_name?: string;
  [key: string]: any;
}

interface AddItemModalProps {
  isOpen: boolean
  onClose: () => void
  bookingId: string
  onItemAdded: () => void
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    let description = customDescription
    let unitPrice = parseFloat(customPrice) || 0

    if (itemType !== 'other' && selectedItem) {
      if (itemType === 'space' && 'hire_cost' in selectedItem) {
        description = selectedItem.name
        unitPrice = selectedItem.hire_cost
      } else if (itemType === 'catering' && 'per_head_cost' in selectedItem) {
        description = selectedItem.name
        unitPrice = selectedItem.per_head_cost
      } else if (itemType === 'vendor' && 'vendor_type' in selectedItem) {
        description = `${selectedItem.name} (${selectedItem.vendor_type})`
        unitPrice = selectedItem.typical_rate || 0
      }
    }

    const data = {
      booking_id: bookingId,
      item_type: itemType,
      space_id: itemType === 'space' ? selectedItem?.id : null,
      package_id: itemType === 'catering' ? selectedItem?.id : null,
      vendor_id: itemType === 'vendor' ? selectedItem?.id : null,
      description,
      quantity,
      unit_price: unitPrice,
      discount_value: discountAmount ? parseFloat(discountAmount) : undefined,
      discount_type: discountAmount ? discountType : undefined,
      notes: notes || null
    }

    const result = await addBookingItem(data)
    
    if (result.success) {
      onItemAdded()
      onClose()
      // Reset form
      setSelectedItem(null)
      setQuantity(1)
      setCustomDescription('')
      setCustomPrice('')
      setDiscountAmount('')
      setNotes('')
    }
    
    setIsSubmitting(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Add Booking Item</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select {itemType === 'space' ? 'Space' : itemType === 'catering' ? 'Package' : 'Vendor'}
              </label>
              <select
                value={selectedItem?.id || ''}
                onChange={(e) => {
                  const items = itemType === 'space' ? spaces : itemType === 'catering' ? packages : vendors
                  const item = items.find(i => i.id === e.target.value)
                  setSelectedItem(item || null)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">Select...</option>
                {(itemType === 'space' ? spaces : itemType === 'catering' ? packages : vendors).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {itemType === 'space' && 'hire_cost' in item && ` (£${item.hire_cost}/hr)`}
                    {itemType === 'catering' && 'per_head_cost' in item && ` (£${item.per_head_cost}/person)`}
                    {itemType === 'vendor' && 'vendor_type' in item && item.vendor_type && ` - ${item.vendor_type}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom Description (for 'other' items) */}
          {itemType === 'other' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          )}

          {/* Quantity and Price */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit Price (£)
              </label>
              <input
                type="number"
                value={customPrice || (selectedItem && (
                  itemType === 'space' && 'hire_cost' in selectedItem ? selectedItem.hire_cost :
                  itemType === 'catering' && 'per_head_cost' in selectedItem ? selectedItem.per_head_cost :
                  itemType === 'vendor' && 'typical_rate' in selectedItem ? (selectedItem.typical_rate ?? '') :
                  ''
                )) || ''}
                onChange={(e) => setCustomPrice(e.target.value)}
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required={itemType === 'other'}
                readOnly={itemType !== 'other' && !!selectedItem}
              />
            </div>
          </div>

          {/* Discount */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Discount (optional)
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <input
                  type="number"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  placeholder="Amount"
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Fixed Amount (£)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Total Preview */}
          {(customPrice || selectedItem) && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total:</span>
                <span className="text-lg font-semibold text-gray-900">
                  £{calculateTotal().toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  function calculateTotal() {
    const price = parseFloat(customPrice) || (selectedItem && (
      itemType === 'space' && 'hire_cost' in selectedItem ? selectedItem.hire_cost :
      itemType === 'catering' && 'per_head_cost' in selectedItem ? selectedItem.per_head_cost :
      itemType === 'vendor' && 'typical_rate' in selectedItem ? (selectedItem.typical_rate || 0) :
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
}

// Edit Item Modal Component
interface EditItemModalProps {
  isOpen: boolean
  onClose: () => void
  item: BookingItem
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
      onItemUpdated()
      onClose()
    }

    setIsSubmitting(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Edit Item</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Item
            </label>
            <p className="text-sm text-gray-900">{item.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit Price (£)
              </label>
              <input
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Discount
            </label>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="number"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="Amount"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed Amount (£)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Main Component
export default function ItemsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [bookingId, setBookingId] = useState<string>('')
  const [booking, setBooking] = useState<PrivateBooking | null>(null)
  const [items, setItems] = useState<BookingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<BookingItem | null>(null)

  useEffect(() => {
    params.then(p => {
      setBookingId(p.id)
      loadData(p.id)
    })
  }, [params])

  const loadData = async (id: string) => {
    setLoading(true)
    
    // Load booking details
    const bookingResult = await getPrivateBooking(id)
    if (bookingResult.data) {
      setBooking(bookingResult.data)
    }
    
    // Load items
    const itemsResult = await getBookingItems(id)
    if (itemsResult.data) {
      setItems(itemsResult.data)
    }
    
    setLoading(false)
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return
    
    const result = await deleteBookingItem(itemId)
    if (result.success) {
      loadData(bookingId)
    }
  }

  const getItemIcon = (type: ItemType) => {
    switch (type) {
      case 'space': return <MapPinIcon className="h-5 w-5" />
      case 'catering': return <SparklesIcon className="h-5 w-5" />
      case 'vendor': return <UserGroupIcon className="h-5 w-5" />
      default: return <ClipboardDocumentListIcon className="h-5 w-5" />
    }
  }

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + item.line_total, 0)
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <Link
          href={`/private-bookings/${bookingId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" />
          Back to booking
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Booking Items</h2>
              <p className="text-sm text-gray-500 mt-1">
                {booking?.customer_name || `${booking?.customer_first_name || ''} ${booking?.customer_last_name || ''}`.trim() || 'Unknown'} - {booking?.event_date ? new Date(booking.event_date).toLocaleDateString('en-GB') : 'Date TBD'}
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <PlusIcon className="h-5 w-5 mr-1" />
              Add Item
            </button>
          </div>
        </div>

        <div className="p-6">
          {items.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardDocumentListIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-sm text-gray-500">
                No items added yet. Click &ldquo;Add Item&rdquo; to get started.
              </p>
            </div>
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
                          <span>£{item.unit_price.toFixed(2)} each</span>
                          {item.discount_value && (
                            <span className="text-green-600">
                              -{item.discount_type === 'percent' ? `${item.discount_value}%` : `£${item.discount_value.toFixed(2)}`}
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
                        £{item.line_total.toFixed(2)}
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setEditingItem(item)}
                          className="text-gray-400 hover:text-gray-500"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
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
                    £{calculateSubtotal().toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AddItemModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        bookingId={bookingId}
        onItemAdded={() => loadData(bookingId)}
      />

      {editingItem && (
        <EditItemModal
          isOpen={!!editingItem}
          onClose={() => setEditingItem(null)}
          item={editingItem}
          onItemUpdated={() => {
            loadData(bookingId)
            setEditingItem(null)
          }}
        />
      )}
    </div>
  )
}