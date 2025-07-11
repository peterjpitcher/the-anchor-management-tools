'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPrivateBooking, updatePrivateBooking } from '@/app/actions/privateBookingActions'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'
import CustomerSearchInput from '@/components/CustomerSearchInput'
type FormState = { error: string } | { success: boolean } | null

interface Customer {
  id: string
  first_name: string
  last_name: string
  mobile_number: string | null
  email: string | null
}

export default function EditPrivateBookingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerFirstName, setCustomerFirstName] = useState('')
  const [customerLastName, setCustomerLastName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  useEffect(() => {
    async function loadBooking() {
      const result = await getPrivateBooking(id)
      if ('error' in result) {
        setError(result.error || 'An error occurred')
      } else if (result.data) {
        setBooking(result.data)
        // Initialize form fields
        setCustomerFirstName(result.data.customer_first_name || result.data.customer_name?.split(' ')[0] || '')
        setCustomerLastName(result.data.customer_last_name || result.data.customer_name?.split(' ').slice(1).join(' ') || '')
        setContactPhone(result.data.contact_phone || '')
        setContactEmail(result.data.contact_email || '')
        // Set selected customer if exists
        if (result.data.customer) {
          setSelectedCustomer({
            id: result.data.customer.id,
            first_name: result.data.customer.first_name,
            last_name: result.data.customer.last_name,
            mobile_number: result.data.customer.phone || null,
            email: result.data.customer.email || null
          })
        }
      } else {
        notFound()
      }
      setLoading(false)
    }
    loadBooking()
  }, [id])

  // Update form when customer is selected
  useEffect(() => {
    if (selectedCustomer) {
      setCustomerFirstName(selectedCustomer.first_name)
      setCustomerLastName(selectedCustomer.last_name)
      setContactPhone(selectedCustomer.mobile_number || '')
      setContactEmail(selectedCustomer.email || '')
    }
  }, [selectedCustomer])

  const [state, formAction, isPending] = useActionState(
    async (prevState: FormState, formData: FormData) => {
      const result = await updatePrivateBooking(id, formData)
      if (result.success) {
        router.push(`/private-bookings/${id}`)
      }
      return result
    },
    null
  )

  if (loading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="bg-white shadow sm:rounded-lg p-6">
            <div className="space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/3"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !booking) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error || 'Booking not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <Link
          href={`/private-bookings/${id}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" />
          Back to booking
        </Link>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Private Booking</h1>

          {state && 'error' in state && (
            <div className="rounded-md bg-red-50 p-4 mb-6">
              <p className="text-sm text-red-800">{state.error}</p>
            </div>
          )}

          <form action={formAction} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {/* Customer Information */}
              <div className="col-span-2">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Customer Information</h2>
              </div>

              {/* Customer Search */}
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Change Customer
                </label>
                <CustomerSearchInput
                  onCustomerSelect={setSelectedCustomer}
                  placeholder="Search to change customer..."
                  selectedCustomerId={selectedCustomer?.id || booking.customer_id}
                />
                <input type="hidden" name="customer_id" value={selectedCustomer?.id || booking.customer_id || ''} />
              </div>

              <div>
                <label htmlFor="customer_first_name" className="block text-sm font-medium text-gray-700">
                  First Name *
                </label>
                <input
                  type="text"
                  name="customer_first_name"
                  id="customer_first_name"
                  required
                  value={customerFirstName}
                  onChange={(e) => setCustomerFirstName(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="customer_last_name" className="block text-sm font-medium text-gray-700">
                  Last Name
                </label>
                <input
                  type="text"
                  name="customer_last_name"
                  id="customer_last_name"
                  value={customerLastName}
                  onChange={(e) => setCustomerLastName(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="contact_phone" className="block text-sm font-medium text-gray-700">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  name="contact_phone"
                  id="contact_phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="contact_email" className="block text-sm font-medium text-gray-700">
                  Contact Email
                </label>
                <input
                  type="email"
                  name="contact_email"
                  id="contact_email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="event_type" className="block text-sm font-medium text-gray-700">
                  Event Type
                </label>
                <input
                  type="text"
                  name="event_type"
                  id="event_type"
                  defaultValue={booking.event_type || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                  placeholder="Birthday Party, Wedding, Corporate Event..."
                />
              </div>

              <div>
                <label htmlFor="source" className="block text-sm font-medium text-gray-700">
                  Booking Source
                </label>
                <select
                  name="source"
                  id="source"
                  defaultValue={booking.source || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                >
                  <option value="">Select source...</option>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="walk-in">Walk-in</option>
                  <option value="website">Website</option>
                  <option value="referral">Referral</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                  Booking Status
                </label>
                <select
                  name="status"
                  id="status"
                  defaultValue={booking.status || 'draft'}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                >
                  <option value="draft">Draft</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Changing to Confirmed will queue a confirmation SMS
                </p>
              </div>

              {/* Event Details */}
              <div className="col-span-2 mt-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Event Details</h2>
              </div>

              <div>
                <label htmlFor="event_date" className="block text-sm font-medium text-gray-700">
                  Event Date *
                </label>
                <input
                  type="date"
                  name="event_date"
                  id="event_date"
                  required
                  defaultValue={booking.event_date}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="guest_count" className="block text-sm font-medium text-gray-700">
                  Expected Guests
                </label>
                <input
                  type="number"
                  name="guest_count"
                  id="guest_count"
                  min="1"
                  defaultValue={booking.guest_count || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="setup_date" className="block text-sm font-medium text-gray-700">
                  Setup Date
                </label>
                <input
                  type="date"
                  name="setup_date"
                  id="setup_date"
                  defaultValue={booking.setup_date || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="setup_time" className="block text-sm font-medium text-gray-700">
                  Setup Time
                </label>
                <input
                  type="time"
                  name="setup_time"
                  id="setup_time"
                  defaultValue={booking.setup_time || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="start_time" className="block text-sm font-medium text-gray-700">
                  Start Time *
                </label>
                <input
                  type="time"
                  name="start_time"
                  id="start_time"
                  required
                  defaultValue={booking.start_time}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="end_time" className="block text-sm font-medium text-gray-700">
                  End Time
                </label>
                <input
                  type="time"
                  name="end_time"
                  id="end_time"
                  defaultValue={booking.end_time || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>

              {/* Notes */}
              <div className="col-span-2 mt-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Additional Information</h2>
              </div>

              <div className="col-span-2">
                <label htmlFor="customer_requests" className="block text-sm font-medium text-gray-700">
                  Customer Requests
                </label>
                <textarea
                  name="customer_requests"
                  id="customer_requests"
                  rows={3}
                  defaultValue={booking.customer_requests || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                  placeholder="Special requests, dietary requirements, etc."
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="internal_notes" className="block text-sm font-medium text-gray-700">
                  Internal Notes
                </label>
                <textarea
                  name="internal_notes"
                  id="internal_notes"
                  rows={3}
                  defaultValue={booking.internal_notes || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                  placeholder="Staff notes (not visible to customer)"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="special_requirements" className="block text-sm font-medium text-gray-700">
                  Special Requirements
                </label>
                <textarea
                  name="special_requirements"
                  id="special_requirements"
                  rows={2}
                  defaultValue={booking.special_requirements || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                  placeholder="Equipment needs, layout preferences, technical requirements..."
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="accessibility_needs" className="block text-sm font-medium text-gray-700">
                  Accessibility Needs
                </label>
                <textarea
                  name="accessibility_needs"
                  id="accessibility_needs"
                  rows={2}
                  defaultValue={booking.accessibility_needs || ''}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                  placeholder="Wheelchair access, hearing loops, dietary restrictions..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <Link
                href={`/private-bookings/${id}`}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex justify-center rounded-md border border-transparent bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50"
              >
                {isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}