'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { 
  ArrowLeftIcon, 
  PencilIcon, 
  UserGroupIcon,
  CurrencyPoundIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  PhoneIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  BanknotesIcon,
  CreditCardIcon,
  XMarkIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  MapPinIcon,
  SparklesIcon,
  ClipboardDocumentListIcon,
  PercentBadgeIcon,
  ChatBubbleLeftRightIcon,
  DocumentIcon,
  CalendarDaysIcon,
  BuildingOfficeIcon,
  BoltIcon
} from '@heroicons/react/24/outline'
import { 
  getPrivateBooking, 
  updateBookingStatus,
  recordDepositPayment,
  recordFinalPayment,
  getBookingItems,
  addBookingItem,
  updateBookingItem,
  deleteBookingItem,
  getVenueSpaces,
  getCateringPackages,
  getVendors,
  applyBookingDiscount
} from '@/app/actions/privateBookingActions'
import type { PrivateBookingWithDetails, BookingStatus, CateringPackage, VenueSpace, Vendor, PrivateBookingItem } from '@/types/private-bookings'

// Using types from private-bookings.ts

// Status configuration
const statusConfig: Record<BookingStatus, { 
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: React.ComponentType<{ className?: string }>
}> = {
  draft: { 
    label: 'Draft', 
    color: 'text-gray-700', 
    bgColor: 'bg-gray-50', 
    borderColor: 'border-gray-200',
    icon: PencilIcon 
  },
  confirmed: { 
    label: 'Confirmed', 
    color: 'text-green-700', 
    bgColor: 'bg-green-50', 
    borderColor: 'border-green-200',
    icon: CheckCircleIcon 
  },
  completed: { 
    label: 'Completed', 
    color: 'text-blue-700', 
    bgColor: 'bg-blue-50', 
    borderColor: 'border-blue-200',
    icon: CheckCircleIcon 
  },
  cancelled: { 
    label: 'Cancelled', 
    color: 'text-red-700', 
    bgColor: 'bg-red-50', 
    borderColor: 'border-red-200',
    icon: XMarkIcon 
  }
}

// Payment Modal Component
interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  bookingId: string
  type: 'deposit' | 'final'
  amount: number
  onSuccess: () => void
}

function PaymentModal({ isOpen, onClose, bookingId, type, amount, onSuccess }: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'invoice'>('card')
  const [customAmount, setCustomAmount] = useState(amount.toString())
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const formData = new FormData()
    formData.set('payment_method', paymentMethod)
    formData.set('amount', customAmount)

    const result = type === 'deposit' 
      ? await recordDepositPayment(bookingId, formData)
      : await recordFinalPayment(bookingId, formData)

    if (result.success) {
      onSuccess()
      onClose()
    }
    setIsSubmitting(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-lg sm:rounded-lg shadow-xl max-w-md w-full max-h-[90vh] sm:max-h-[80vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Record {type === 'deposit' ? 'Deposit' : 'Final'} Payment
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Amount (£)
            </label>
            <input
              type="number"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              step="0.01"
              min="0"
              className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Method
            </label>
            <div className="space-y-2">
              {[
                { value: 'card', label: 'Card', icon: CreditCardIcon },
                { value: 'cash', label: 'Cash', icon: BanknotesIcon },
                { value: 'invoice', label: 'Invoice', icon: DocumentTextIcon }
              ].map((method) => (
                <label key={method.value} className="flex items-center">
                  <input
                    type="radio"
                    value={method.value}
                    checked={paymentMethod === method.value}
                    onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'card' | 'invoice')}
                    className="mr-3 h-5 w-5"
                  />
                  <method.icon className="h-5 w-5 mr-2 text-gray-400" />
                  <span className="text-sm text-gray-900">{method.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 min-h-[44px] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 min-h-[44px] transition-colors"
            >
              {isSubmitting ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Status Change Modal Component
interface StatusModalProps {
  isOpen: boolean
  onClose: () => void
  bookingId: string
  currentStatus: BookingStatus
  onSuccess: () => void
}

function StatusModal({ isOpen, onClose, bookingId, currentStatus, onSuccess }: StatusModalProps) {
  const [newStatus, setNewStatus] = useState<BookingStatus>(currentStatus)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    const result = await updateBookingStatus(bookingId, newStatus)
    if (result.success) {
      onSuccess()
      onClose()
    }
    setIsSubmitting(false)
  }

  if (!isOpen) return null

  const statusFlow: Record<BookingStatus, BookingStatus[]> = {
    draft: ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    completed: [],
    cancelled: ['draft']
  }

  const availableStatuses = statusFlow[currentStatus] || []

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-lg sm:rounded-lg shadow-xl max-w-md w-full max-h-[90vh] sm:max-h-[80vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Change Booking Status</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <p className="text-sm text-gray-600">Current status:</p>
            <div className="flex items-center mt-1">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusConfig[currentStatus].color} ${statusConfig[currentStatus].bgColor}`}>
                {statusConfig[currentStatus].label}
              </span>
            </div>
          </div>

          {availableStatuses.length > 0 ? (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Change to:</p>
                {availableStatuses.map((status) => {
                  const StatusIcon = statusConfig[status].icon
                  return (
                    <label key={status} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        value={status}
                        checked={newStatus === status}
                        onChange={(e) => setNewStatus(e.target.value as BookingStatus)}
                        className="mr-3 h-5 w-5"
                      />
                      <StatusIcon className="h-5 w-5 mr-2 text-gray-400" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{statusConfig[status].label}</p>
                        {status === 'confirmed' && (
                          <p className="text-xs text-gray-500">Customer will receive confirmation SMS</p>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-3 sm:py-2 text-base sm:text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 min-h-[44px] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || newStatus === currentStatus}
                  className="px-4 py-3 sm:py-2 text-base sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 min-h-[44px] transition-colors"
                >
                  {isSubmitting ? 'Updating...' : 'Update Status'}
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500">No status changes available for completed bookings.</p>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Add Item Modal Component
interface AddItemModalProps {
  isOpen: boolean
  onClose: () => void
  bookingId: string
  onItemAdded: () => void
}

function AddItemModal({ isOpen, onClose, bookingId, onItemAdded }: AddItemModalProps) {
  const [itemType, setItemType] = useState<'space' | 'catering' | 'vendor' | 'electricity' | 'other'>('space')
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

  useEffect(() => {
    // Reset form when item type changes
    setSelectedItem(null)
    setCustomDescription('')
    setCustomPrice('')
    setDiscountAmount('')
    setNotes('')
    
    // Reset quantity for all except electricity (which is always 1)
    if (itemType !== 'electricity') {
      setQuantity(1)
    }
    
    loadOptions()
  }, [itemType])

  // Set quantity to 1 for total_value items
  useEffect(() => {
    if (itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value') {
      setQuantity(1)
    }
  }, [selectedItem, itemType])

  const loadOptions = async () => {
    if (itemType === 'space') {
      const result = await getVenueSpaces()
      if (result.data) setSpaces(result.data)
    } else if (itemType === 'catering') {
      const result = await getCateringPackages()
      if (result.data) setPackages(result.data)
    } else if (itemType === 'vendor') {
      const result = await getVendors()
      if (result.data) setVendors(result.data)
    } else if (itemType === 'electricity') {
      // Electricity is a fixed charge, no options to load
      setCustomDescription('Additional Electricity Supply')
      setCustomPrice('25')
      setQuantity(1)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    let description = customDescription
    let unitPrice = parseFloat(customPrice) || 0

    if (itemType === 'electricity') {
      // Electricity has fixed values
      description = 'Additional Electricity Supply'
      unitPrice = 25
    } else if (itemType !== 'other' && selectedItem) {
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
        unitPrice = 0 // Vendors don&apos;t have a fixed price in the schema
      }
    }

    // For total_value pricing model, quantity should be 1
    const finalQuantity = itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value' 
      ? 1 
      : quantity

    const data = {
      booking_id: bookingId,
      item_type: itemType === 'electricity' ? 'other' : itemType, // Store electricity as 'other' type
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
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-lg sm:rounded-lg shadow-xl max-w-full sm:max-w-2xl w-full max-h-[90vh] sm:max-h-[80vh] overflow-y-auto">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                onClick={() => setItemType('electricity')}
                className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors ${
                  itemType === 'electricity' 
                    ? 'border-blue-500 bg-blue-50 text-blue-700' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <BoltIcon className="h-6 w-6 mb-1" />
                <span className="text-sm">Electricity</span>
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
          {itemType !== 'other' && itemType !== 'electricity' && (
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
                className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
                required
              >
                <option value="">Select...</option>
                {(itemType === 'space' ? spaces : itemType === 'catering' ? packages : vendors).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {itemType === 'space' && 'rate_per_hour' in item && ` (£${item.rate_per_hour}/hr)`}
                    {itemType === 'catering' && 'cost_per_head' in item && (
                      item.pricing_model === 'total_value' 
                        ? ` (£${item.cost_per_head} total)` 
                        : ` (£${item.cost_per_head}/person)`
                    )}
                    {itemType === 'vendor' && 'service_type' in item && item.service_type && ` - ${item.service_type}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom Description (for 'other' and 'electricity' items) */}
          {(itemType === 'other' || itemType === 'electricity') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
                required
                readOnly={itemType === 'electricity'}
              />
            </div>
          )}

          {/* Quantity and Price - Different layouts based on pricing model */}
          {itemType === 'catering' && selectedItem && 'pricing_model' in selectedItem && selectedItem.pricing_model === 'total_value' ? (
            // Total Value Layout - Single price field
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Price (£)
              </label>
              <input
                type="number"
                value={customPrice || selectedItem.cost_per_head || ''}
                onChange={(e) => setCustomPrice(e.target.value)}
                step="0.01"
                min="0"
                className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
                required
                placeholder="Enter total price"
              />
            </div>
          ) : (
            // Standard Layout - Quantity and Unit Price
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {itemType === 'catering' ? 'Number of Guests' : 'Quantity'}
                </label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  min="1"
                  className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
                  required
                  readOnly={itemType === 'electricity'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit Price (£)
                </label>
                <input
                  type="number"
                  value={customPrice || (selectedItem && (
                    itemType === 'space' && 'rate_per_hour' in selectedItem ? selectedItem.rate_per_hour :
                    itemType === 'catering' && 'cost_per_head' in selectedItem ? selectedItem.cost_per_head :
                    ''
                  )) || ''}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
                  required={itemType === 'other' || itemType === 'vendor' || itemType === 'electricity'}
                  readOnly={(itemType !== 'other' && itemType !== 'vendor' && !!selectedItem) || itemType === 'electricity'}
                />
              </div>
            </div>
          )}

          {/* Discount */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Discount (optional)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <input
                  type="number"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  placeholder="Amount"
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
                />
              </div>
              <div>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                  className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
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
              className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 min-h-[44px] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 min-h-[44px] transition-colors"
            >
              {isSubmitting ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Discount Modal Component
interface DiscountModalProps {
  isOpen: boolean
  onClose: () => void
  bookingId: string
  currentTotal: number
  onSuccess: () => void
}

function DiscountModal({ isOpen, onClose, bookingId, currentTotal, onSuccess }: DiscountModalProps) {
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent')
  const [discountAmount, setDiscountAmount] = useState('')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const result = await applyBookingDiscount(bookingId, {
      discount_type: discountType,
      discount_amount: parseFloat(discountAmount),
      discount_reason: reason
    })

    if (result.success) {
      onSuccess()
      onClose()
    }
    setIsSubmitting(false)
  }

  const calculateDiscount = () => {
    if (!discountAmount) return 0
    const amount = parseFloat(discountAmount)
    return discountType === 'percent' 
      ? (currentTotal * amount / 100)
      : amount
  }

  const calculateNewTotal = () => {
    return Math.max(0, currentTotal - calculateDiscount())
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-lg sm:rounded-lg shadow-xl max-w-md w-full max-h-[90vh] sm:max-h-[80vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Apply Booking Discount</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Discount Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDiscountType('percent')}
                className={`p-3 rounded-lg border-2 transition-colors ${
                  discountType === 'percent' 
                    ? 'border-blue-500 bg-blue-50 text-blue-700' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <PercentBadgeIcon className="h-6 w-6 mx-auto mb-1" />
                <span className="text-sm">Percentage</span>
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('fixed')}
                className={`p-3 rounded-lg border-2 transition-colors ${
                  discountType === 'fixed' 
                    ? 'border-blue-500 bg-blue-50 text-blue-700' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <CurrencyPoundIcon className="h-6 w-6 mx-auto mb-1" />
                <span className="text-sm">Fixed Amount</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {discountType === 'percent' ? 'Percentage (%)' : 'Amount (£)'}
            </label>
            <input
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              step="0.01"
              min="0"
              max={discountType === 'percent' ? '100' : undefined}
              className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for Discount
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
              required
              placeholder="e.g., Early bird discount, loyalty customer, etc."
            />
          </div>

          {/* Preview */}
          {discountAmount && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Current Total:</span>
                  <span className="font-medium">£{currentTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>Discount:</span>
                  <span className="font-medium">-£{calculateDiscount().toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold">
                  <span>New Total:</span>
                  <span>£{calculateNewTotal().toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 min-h-[44px] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !discountAmount}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 min-h-[44px] transition-colors"
            >
              {isSubmitting ? 'Applying...' : 'Apply Discount'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Edit Item Modal
interface EditItemModalProps {
  isOpen: boolean
  onClose: () => void
  item: PrivateBookingItem
  onSuccess: () => void
}

function EditItemModal({ isOpen, onClose, item, onSuccess }: EditItemModalProps) {
  const [quantity, setQuantity] = useState(item.quantity)
  const [unitPrice, setUnitPrice] = useState(item.unit_price.toString())
  const [discountValue, setDiscountValue] = useState(item.discount_value?.toString() || '')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(item.discount_type || 'percent')
  const [notes, setNotes] = useState(item.notes || '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    // Reset form when item changes
    setQuantity(item.quantity)
    setUnitPrice(item.unit_price.toString())
    setDiscountValue(item.discount_value?.toString() || '')
    setDiscountType(item.discount_type || 'percent')
    setNotes(item.notes || '')
  }, [item])

  if (!isOpen) return null

  const calculateLineTotal = () => {
    const qty = quantity || 0
    const price = parseFloat(unitPrice) || 0
    const discount = parseFloat(discountValue) || 0
    
    let subtotal = qty * price
    
    if (discount > 0) {
      if (discountType === 'percent') {
        subtotal = subtotal * (1 - discount / 100)
      } else {
        subtotal = Math.max(0, subtotal - discount)
      }
    }
    
    return subtotal
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const result = await updateBookingItem(item.id, {
      quantity,
      unit_price: parseFloat(unitPrice),
      discount_value: discountValue ? parseFloat(discountValue) : undefined,
      discount_type: discountValue ? discountType : undefined,
      notes: notes || null
    })

    setIsSubmitting(false)

    if (result.error) {
      alert(`Error: ${result.error}`)
    } else {
      onSuccess()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Edit Item</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded">
              {item.description}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                min="1"
                className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
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
                min="0"
                step="0.01"
                className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Discount (optional)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                min="0"
                step={discountType === 'percent' ? '1' : '0.01'}
                max={discountType === 'percent' ? '100' : undefined}
                placeholder="0"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="percent">%</option>
                <option value="fixed">£</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 min-h-[44px]"
              placeholder="e.g., Special pricing agreement, discount reason, etc."
            />
          </div>

          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Line Total:</span>
              <span className="font-semibold text-gray-900">
                £{calculateLineTotal().toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 min-h-[44px] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-3 sm:py-2 text-base sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 min-h-[44px] transition-colors"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function PrivateBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const [bookingId, setBookingId] = useState<string>('')
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(null)
  const [items, setItems] = useState<PrivateBookingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showDepositModal, setShowDepositModal] = useState(false)
  const [showFinalModal, setShowFinalModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [showAddItemModal, setShowAddItemModal] = useState(false)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [showEditItemModal, setShowEditItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState<PrivateBookingItem | null>(null)

  useEffect(() => {
    params.then(p => {
      setBookingId(p.id)
      loadBooking(p.id)
    })
  }, [params])

  const loadBooking = async (id: string) => {
    setLoading(true)
    const result = await getPrivateBooking(id)
    if (result.data) {
      setBooking(result.data)
      // Load items
      const itemsResult = await getBookingItems(id)
      if (itemsResult.data) {
        setItems(itemsResult.data)
      }
    } else if (result.error) {
      router.push('/private-bookings')
    }
    setLoading(false)
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return
    
    const result = await deleteBookingItem(itemId)
    if (result.success) {
      loadBooking(bookingId)
    }
  }

  const getItemIcon = (type: string) => {
    switch (type) {
      case 'space': return <MapPinIcon className="h-5 w-5" />
      case 'catering': return <SparklesIcon className="h-5 w-5" />
      case 'vendor': return <UserGroupIcon className="h-5 w-5" />
      default: return <ClipboardDocumentListIcon className="h-5 w-5" />
    }
  }

  const calculateSubtotal = () => {
    const total = items.reduce((sum, item) => {
      // Convert line_total to number in case it's a string
      const lineTotal = typeof item.line_total === 'string' ? parseFloat(item.line_total) : item.line_total
      
      // If line_total is missing (null/undefined), calculate it manually
      if (lineTotal === null || lineTotal === undefined) {
        const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity
        const price = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : item.unit_price
        let calculatedTotal = qty * price
        
        if (item.discount_value) {
          const discount = typeof item.discount_value === 'string' ? parseFloat(item.discount_value) : item.discount_value
          if (item.discount_type === 'percent') {
            calculatedTotal = calculatedTotal * (1 - discount / 100)
          } else {
            calculatedTotal = calculatedTotal - discount
          }
        }
        return sum + calculatedTotal
      }
      // lineTotal could be 0 (valid for 100% discounted items)
      return sum + lineTotal
    }, 0)
    
    return total
  }

  // Calculate the original price before any item-level discounts
  const calculateOriginalTotal = () => {
    return items.reduce((sum, item) => {
      const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity
      const price = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : item.unit_price
      return sum + (qty * price)
    }, 0)
  }

  // Calculate total item-level discounts
  const calculateItemDiscounts = () => {
    return items.reduce((sum, item) => {
      if (item.discount_value && item.discount_value > 0) {
        const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity
        const price = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : item.unit_price
        const originalPrice = qty * price
        
        if (item.discount_type === 'percent') {
          return sum + (originalPrice * (item.discount_value / 100))
        } else {
          return sum + item.discount_value
        }
      }
      return sum
    }, 0)
  }

  const calculateTotal = () => {
    const subtotal = calculateSubtotal()
    if (booking?.discount_type === 'percent') {
      return subtotal * (1 - (booking.discount_amount || 0) / 100)
    } else if (booking?.discount_type === 'fixed') {
      return subtotal - (booking.discount_amount || 0)
    }
    return subtotal
  }

  if (loading || !booking) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="bg-white shadow rounded-lg p-6">
              <div className="space-y-4">
                <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const StatusIcon = statusConfig[booking.status].icon

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link
                href="/private-bookings"
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
              >
                <ArrowLeftIcon className="mr-1 h-4 w-4" />
                Back to bookings
              </Link>
              <div className="h-4 w-px bg-gray-300"></div>
              <h1 className="text-2xl font-bold text-gray-900">{booking.customer_full_name || booking.customer_name}</h1>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowStatusModal(true)}
                className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium ${statusConfig[booking.status].color} ${statusConfig[booking.status].bgColor} ${statusConfig[booking.status].borderColor} border hover:opacity-80 transition-opacity`}
              >
                <StatusIcon className="h-5 w-5 mr-2" />
                {statusConfig[booking.status].label}
                <ChevronRightIcon className="h-4 w-4 ml-1" />
              </button>
              <Link
                href={`/private-bookings/${bookingId}/edit`}
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <PencilIcon className="-ml-0.5 mr-1.5 h-4 w-4" />
                Edit Details
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content - Left 2/3 */}
          <div className="lg:col-span-2 space-y-6">
            {/* Event Details Card */}
            <div className="bg-white shadow-sm rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Event Details</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Event Date</label>
                    <div className="mt-1 flex items-center text-sm text-gray-900">
                      <CalendarDaysIcon className="h-5 w-5 text-gray-400 mr-2" />
                      {formatDateFull(booking.event_date)}
                    </div>
                    {booking.setup_date && (
                      <p className="mt-1 text-sm text-gray-500">
                        Setup: {formatDateFull(booking.setup_date)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500">Time</label>
                    <div className="mt-1 flex items-center text-sm text-gray-900">
                      <ClockIcon className="h-5 w-5 text-gray-400 mr-2" />
                      {formatTime12Hour(booking.start_time)} - {formatTime12Hour(booking.end_time || null)}
                    </div>
                    {booking.setup_time && (
                      <p className="mt-1 text-sm text-gray-500">
                        Setup: {formatTime12Hour(booking.setup_time || null)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500">Guest Count</label>
                    <div className="mt-1 flex items-center text-sm text-gray-900">
                      <UserGroupIcon className="h-5 w-5 text-gray-400 mr-2" />
                      {booking.guest_count || 'TBC'} guests
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500">Event Type</label>
                    <div className="mt-1 flex items-center text-sm text-gray-900">
                      <SparklesIcon className="h-5 w-5 text-gray-400 mr-2" />
                      {booking.event_type || 'Private Event'}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500">Contact Phone</label>
                    <div className="mt-1 flex items-center text-sm">
                      <PhoneIcon className="h-5 w-5 text-gray-400 mr-2" />
                      {booking.contact_phone ? (
                        <a href={`tel:${booking.contact_phone}`} className="text-blue-600 hover:underline">
                          {booking.contact_phone}
                        </a>
                      ) : (
                        <span className="text-gray-500">Not provided</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500">Contact Email</label>
                    <div className="mt-1 flex items-center text-sm">
                      <EnvelopeIcon className="h-5 w-5 text-gray-400 mr-2" />
                      {booking.contact_email ? (
                        <a href={`mailto:${booking.contact_email}`} className="text-blue-600 hover:underline">
                          {booking.contact_email}
                        </a>
                      ) : (
                        <span className="text-gray-500">Not provided</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500">Booking Source</label>
                    <div className="mt-1 flex items-center text-sm text-gray-900">
                      <BuildingOfficeIcon className="h-5 w-5 text-gray-400 mr-2" />
                      {booking.source || 'Direct'}
                    </div>
                  </div>
                </div>

                {booking.balance_due_date && (
                  <div className="mt-6 p-4 bg-amber-50 rounded-lg">
                    <div className="flex items-center">
                      <ExclamationCircleIcon className="h-5 w-5 text-amber-600 mr-2" />
                      <p className="text-sm text-amber-800">
                        Balance due by {formatDateFull(booking.balance_due_date)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Booking Items Card */}
            <div className="bg-white shadow-sm rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Booking Items</h2>
                  <button
                    onClick={() => setShowAddItemModal(true)}
                    className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                  >
                    <PlusIcon className="h-4 w-4 mr-1" />
                    Add Item
                  </button>
                </div>
              </div>

              <div className="p-6">
                {items.length === 0 ? (
                  <div className="text-center py-8">
                    <ClipboardDocumentListIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="mt-4 text-sm text-gray-500">
                      No items added yet. Click &ldquo;Add Item&rdquo; to build this booking.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-start justify-between border-b pb-4 last:border-0">
                        <div className="flex items-start space-x-3 flex-1">
                          <div className="text-gray-400">
                            {getItemIcon(item.item_type)}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {item.description}
                            </p>
                            <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                              <span>Qty: {item.quantity}</span>
                              <span>£{item.unit_price.toFixed(2)} each</span>
                              {!!item.discount_value && item.discount_value > 0 && (
                                <>
                                  <span className="text-green-600">
                                    -{item.discount_type === 'percent' ? `${item.discount_value}%` : `£${item.discount_value.toFixed(2)}`}
                                  </span>
                                  {item.discount_value === 100 && item.discount_type === 'percent' && (
                                    <span className="text-gray-400 line-through">
                                      (was £{(item.quantity * item.unit_price).toFixed(2)})
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            {item.notes && (
                              <p className="mt-1 text-sm text-gray-500">{item.notes}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-base font-semibold text-gray-900">
                            £{item.line_total.toFixed(2)}
                          </span>
                          <button
                            onClick={() => {
                              setEditingItem(item)
                              setShowEditItemModal(true)
                            }}
                            className="text-gray-400 hover:text-gray-500"
                            title="Edit item"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="text-red-400 hover:text-red-500"
                            title="Delete item"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Notes Section */}
            {(booking.customer_requests || booking.internal_notes || booking.special_requirements || booking.accessibility_needs) && (
              <div className="bg-white shadow-sm rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">Notes & Requirements</h2>
                </div>
                <div className="p-6 space-y-4">
                  {booking.customer_requests && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">Customer Requests</h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{booking.customer_requests}</p>
                    </div>
                  )}
                  {booking.special_requirements && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">Special Requirements</h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{booking.special_requirements}</p>
                    </div>
                  )}
                  {booking.accessibility_needs && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">Accessibility Needs</h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{booking.accessibility_needs}</p>
                    </div>
                  )}
                  {booking.internal_notes && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-1">Internal Notes</h3>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{booking.internal_notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar - Right 1/3 */}
          <div className="space-y-6">
            {/* Financial Summary Card */}
            <div className="bg-white shadow-sm rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Financial Summary</h2>
                  <button
                    onClick={() => setShowDiscountModal(true)}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    Apply Discount
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  {/* Always show original price and discounts */}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Original Price (before discounts)</span>
                    <span className="font-medium text-gray-900">
                      £{items.length > 0 ? calculateOriginalTotal().toFixed(2) : '0.00'}
                    </span>
                  </div>

                  {/* Show item-level discounts if any */}
                  {calculateItemDiscounts() > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-green-600">Item Discounts</span>
                      <span className="font-medium text-green-600">
                        -£{calculateItemDiscounts().toFixed(2)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="font-medium text-gray-900">
                      £{items.length > 0 ? calculateSubtotal().toFixed(2) : '0.00'}
                    </span>
                  </div>

                  {/* Show booking-level discount if any */}
                  {!!booking.discount_amount && booking.discount_amount > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-green-600">
                          Booking Discount ({booking.discount_type === 'percent' ? `${booking.discount_amount}%` : `£${booking.discount_amount}`})
                          {booking.discount_reason && (
                            <span className="block text-xs text-gray-500 font-normal mt-1">{booking.discount_reason}</span>
                          )}
                        </span>
                        <span className="font-medium text-green-600">
                          -£{(calculateSubtotal() - calculateTotal()).toFixed(2)}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Show total savings if any discounts */}
                  {(calculateItemDiscounts() > 0 || (booking.discount_amount && booking.discount_amount > 0)) && (
                    <div className="bg-green-50 p-2 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-green-800">Total Savings</span>
                        <span className="font-bold text-green-800">
                          £{(calculateOriginalTotal() - calculateTotal()).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t">
                    <div className="flex justify-between">
                      <span className="text-base font-medium text-gray-900">Total Event Cost</span>
                      <span className="text-xl font-bold text-gray-900">
                        £{calculateTotal().toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 pt-3 border-t">
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <p className="text-xs font-medium text-blue-900 mb-2">Refundable Deposit</p>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700">Security Deposit</p>
                        <p className="text-xs text-gray-500">
                          {booking.deposit_paid_date 
                            ? `Paid ${formatDateFull(booking.deposit_paid_date)}`
                            : 'Not paid'
                          }
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">
                          £{(booking.deposit_amount || 250).toFixed(2)}
                        </p>
                        {!booking.deposit_paid_date && booking.status !== 'draft' && (
                          <button
                            onClick={() => setShowDepositModal(true)}
                            className="mt-1 text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Record Payment
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      Returned after event (subject to terms)
                    </p>
                  </div>

                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">Balance Due</p>
                      <p className="text-xs text-gray-500">
                        For booking items only
                      </p>
                      {booking.balance_due_date && (
                        <p className="text-xs text-gray-500">
                          Due by {formatDateFull(booking.balance_due_date)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">
                        £{calculateTotal().toFixed(2)}
                      </p>
                      {!booking.final_payment_date && calculateTotal() > 0 && (
                        <button
                          onClick={() => setShowFinalModal(true)}
                          className="mt-1 text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Record Payment
                        </button>
                      )}
                    </div>
                  </div>

                  {booking.final_payment_date && (
                    <div className="pt-3 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-green-600 font-medium">✓ Fully Paid</span>
                        <span className="text-xs text-gray-500">
                          {formatDateFull(booking.final_payment_date)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="bg-white shadow-sm rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
              </div>
              <div className="p-6 space-y-3">
                <Link
                  href={`/private-bookings/${bookingId}/messages`}
                  className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100"
                >
                  <div className="flex items-center">
                    <ChatBubbleLeftRightIcon className="h-5 w-5 mr-3 text-purple-600" />
                    Send SMS Message
                  </div>
                  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                </Link>
                
                <Link
                  href={`/private-bookings/${bookingId}/contract`}
                  className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100"
                >
                  <div className="flex items-center">
                    <DocumentIcon className="h-5 w-5 mr-3 text-blue-600" />
                    Generate Contract
                  </div>
                  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                </Link>

                <button
                  disabled
                  className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-400 bg-gray-50 rounded-lg cursor-not-allowed opacity-50"
                >
                  <div className="flex items-center">
                    <DocumentTextIcon className="h-5 w-5 mr-3 text-gray-400" />
                    Upload Document
                  </div>
                  <span className="text-xs text-gray-400">Coming Soon</span>
                </button>
              </div>
            </div>

            {/* Booking Info Card */}
            <div className="bg-white shadow-sm rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Booking Information</h2>
              </div>
              <div className="p-6 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500">Booking ID</label>
                  <p className="mt-1 text-sm text-gray-900 font-mono">{booking.id.slice(0, 8)}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">Created</label>
                  <p className="mt-1 text-sm text-gray-900">
                    {formatDateFull(booking.created_at)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">Last Updated</label>
                  <p className="mt-1 text-sm text-gray-900">
                    {formatDateFull(booking.updated_at)}
                  </p>
                </div>
                {booking.contract_version > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500">Contract Version</label>
                    <p className="mt-1 text-sm text-gray-900">v{booking.contract_version}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <PaymentModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        bookingId={bookingId}
        type="deposit"
        amount={booking.deposit_amount || 250}
        onSuccess={() => loadBooking(bookingId)}
      />

      <PaymentModal
        isOpen={showFinalModal}
        onClose={() => setShowFinalModal(false)}
        bookingId={bookingId}
        type="final"
        amount={calculateTotal()}
        onSuccess={() => loadBooking(bookingId)}
      />

      <StatusModal
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        bookingId={bookingId}
        currentStatus={booking.status}
        onSuccess={() => loadBooking(bookingId)}
      />

      <AddItemModal
        isOpen={showAddItemModal}
        onClose={() => setShowAddItemModal(false)}
        bookingId={bookingId}
        onItemAdded={() => loadBooking(bookingId)}
      />

      <DiscountModal
        isOpen={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        bookingId={bookingId}
        currentTotal={calculateSubtotal()}
        onSuccess={() => loadBooking(bookingId)}
      />

      {editingItem && (
        <EditItemModal
          isOpen={showEditItemModal}
          onClose={() => {
            setShowEditItemModal(false)
            setEditingItem(null)
          }}
          item={editingItem}
          onSuccess={() => loadBooking(bookingId)}
        />
      )}
    </div>
  )
}