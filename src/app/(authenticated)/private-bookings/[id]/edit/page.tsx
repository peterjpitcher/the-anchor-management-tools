'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { notFound } from 'next/navigation'
import { getPrivateBooking, updatePrivateBooking } from '@/app/actions/privateBookingActions'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'
import CustomerSearchInput from '@/components/CustomerSearchInput'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'

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
        toast.success('Private booking updated successfully')
        router.push(`/private-bookings/${id}`)
      }
      return result
    },
    null
  )

  if (loading) {
    return (
      <Page title="Edit Private Booking">
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
        </div>
      </Page>
    )
  }

  if (error || !booking) {
    return (
      <Page title="Edit Private Booking">
        <Alert variant="error">
          {error || 'Booking not found'}
        </Alert>
      </Page>
    )
  }

  return (
    <Page
      title="Edit Private Booking"
      actions={
        <LinkButton href={`/private-bookings/${id}`} variant="secondary">
          Back
        </LinkButton>
      }
    >
      <Card>
        {state && 'error' in state && (
          <Alert variant="error" className="mb-6">
            {state.error}
          </Alert>
        )}

        <form action={formAction} className="space-y-6">
          {/* Customer Information */}
          <Section title="Customer Information">
            <div className="space-y-4">
              {/* Customer Search */}
              <div>
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormGroup label="First Name" required>
                  <Input
                    type="text"
                    name="customer_first_name"
                    id="customer_first_name"
                    required
                    value={customerFirstName}
                    onChange={(e) => setCustomerFirstName(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Last Name">
                  <Input
                    type="text"
                    name="customer_last_name"
                    id="customer_last_name"
                    value={customerLastName}
                    onChange={(e) => setCustomerLastName(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Contact Phone">
                  <Input
                    type="tel"
                    name="contact_phone"
                    id="contact_phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Contact Email">
                  <Input
                    type="email"
                    name="contact_email"
                    id="contact_email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Event Type">
                  <Input
                    type="text"
                    name="event_type"
                    id="event_type"
                    defaultValue={booking.event_type || ''}
                    placeholder="Birthday Party, Wedding, Corporate Event..."
                  />
                </FormGroup>

                <FormGroup label="Booking Source">
                  <Select
                    name="source"
                    id="source"
                    defaultValue={booking.source || ''}
                    options={[
                      { value: '', label: 'Select source...' },
                      { value: 'phone', label: 'Phone' },
                      { value: 'email', label: 'Email' },
                      { value: 'walk-in', label: 'Walk-in' },
                      { value: 'website', label: 'Website' },
                      { value: 'referral', label: 'Referral' },
                      { value: 'other', label: 'Other' }
                    ]}
                  />
                </FormGroup>

                <FormGroup 
                  label="Booking Status"
                  help="Changing to Confirmed will queue a confirmation SMS"
                >
                  <Select
                    name="status"
                    id="status"
                    defaultValue={booking.status || 'draft'}
                    options={[
                      { value: 'draft', label: 'Draft' },
                      { value: 'confirmed', label: 'Confirmed' },
                      { value: 'completed', label: 'Completed' },
                      { value: 'cancelled', label: 'Cancelled' }
                    ]}
                  />
                </FormGroup>
              </div>
            </div>
          </Section>

          {/* Event Details */}
          <Section title="Event Details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Event Date" required>
                <Input
                  type="date"
                  name="event_date"
                  id="event_date"
                  required
                  defaultValue={booking.event_date}
                />
              </FormGroup>

              <FormGroup label="Expected Guests">
                <Input
                  type="number"
                  name="guest_count"
                  id="guest_count"
                  min="1"
                  defaultValue={booking.guest_count || ''}
                />
              </FormGroup>

              <FormGroup label="Setup Date">
                <Input
                  type="date"
                  name="setup_date"
                  id="setup_date"
                  defaultValue={booking.setup_date || ''}
                />
              </FormGroup>

              <FormGroup label="Setup Time">
                <Input
                  type="time"
                  name="setup_time"
                  id="setup_time"
                  defaultValue={booking.setup_time || ''}
                />
              </FormGroup>

              <FormGroup label="Start Time" required>
                <Input
                  type="time"
                  name="start_time"
                  id="start_time"
                  required
                  defaultValue={booking.start_time}
                />
              </FormGroup>

              <FormGroup label="End Time">
                <Input
                  type="time"
                  name="end_time"
                  id="end_time"
                  defaultValue={booking.end_time || ''}
                />
              </FormGroup>
            </div>
          </Section>

          {/* Additional Information */}
          <Section title="Additional Information">
            <div className="space-y-4">
              <FormGroup label="Customer Requests">
                <Textarea
                  name="customer_requests"
                  id="customer_requests"
                  rows={3}
                  defaultValue={booking.customer_requests || ''}
                  placeholder="Special requests, dietary requirements, etc."
                />
              </FormGroup>

              <FormGroup label="Internal Notes">
                <Textarea
                  name="internal_notes"
                  id="internal_notes"
                  rows={3}
                  defaultValue={booking.internal_notes || ''}
                  placeholder="Staff notes (not visible to customer)"
                />
              </FormGroup>

              <FormGroup label="Special Requirements">
                <Textarea
                  name="special_requirements"
                  id="special_requirements"
                  rows={2}
                  defaultValue={booking.special_requirements || ''}
                  placeholder="Equipment needs, layout preferences, technical requirements..."
                />
              </FormGroup>

              <FormGroup label="Accessibility Needs">
                <Textarea
                  name="accessibility_needs"
                  id="accessibility_needs"
                  rows={2}
                  defaultValue={booking.accessibility_needs || ''}
                  placeholder="Wheelchair access, hearing loops, dietary restrictions..."
                />
              </FormGroup>
            </div>
          </Section>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <LinkButton
              variant="secondary"
              href={`/private-bookings/${id}`}
            >
              Cancel
            </LinkButton>
            <Button
              type="submit"
              disabled={isPending}
              loading={isPending}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  )
}