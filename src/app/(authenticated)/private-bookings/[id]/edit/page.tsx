'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { notFound } from 'next/navigation'
import { getPrivateBooking, updatePrivateBooking } from '@/app/actions/privateBookingActions'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { formatDateFull } from '@/lib/dateUtils'
type FormState = { error: string } | { success: boolean } | null

const DATE_TBD_NOTE = 'Event date/time to be confirmed'
const DEFAULT_TBD_TIME = '12:00'

interface Customer {
  id: string
  first_name: string
  last_name: string | null
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
  const [dateTbd, setDateTbd] = useState(false)
  const [eventDate, setEventDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [setupDate, setSetupDate] = useState('')
  const [setupTime, setSetupTime] = useState('')
  const [previousEventDate, setPreviousEventDate] = useState('')
  const [previousStartTime, setPreviousStartTime] = useState('')
  const [previousEndTime, setPreviousEndTime] = useState('')
  const [previousSetupDate, setPreviousSetupDate] = useState('')
  const [previousSetupTime, setPreviousSetupTime] = useState('')
  const [internalNotesField, setInternalNotesField] = useState('')

  useEffect(() => {
    async function loadBooking() {
      const result = await getPrivateBooking(id, 'edit')
      if ('error' in result) {
        setError(result.error || 'An error occurred')
      } else if (result.data) {
        setBooking(result.data)
        // Initialize form fields
        setCustomerFirstName(result.data.customer_first_name || result.data.customer_name?.split(' ')[0] || '')
        setCustomerLastName(result.data.customer_last_name || result.data.customer_name?.split(' ').slice(1).join(' ') || '')
        setContactPhone(result.data.contact_phone || '')
        setContactEmail(result.data.contact_email || '')
        const hasTbd = !!result.data.internal_notes?.includes(DATE_TBD_NOTE)
        setDateTbd(hasTbd)
        const cleanedNotes = result.data.internal_notes
          ? result.data.internal_notes
              .split('\n')
              .filter((line) => line.trim() !== DATE_TBD_NOTE)
              .join('\n')
              .trim()
          : ''
        setInternalNotesField(cleanedNotes)

        const initialEventDate = hasTbd ? '' : (result.data.event_date || '')
        const initialStartTime = hasTbd ? '' : (result.data.start_time || '')
        const initialEndTime = hasTbd ? '' : (result.data.end_time || '')
        const initialSetupDate = hasTbd ? '' : (result.data.setup_date || '')
        const initialSetupTime = hasTbd ? '' : (result.data.setup_time || '')

        setEventDate(initialEventDate)
        setStartTime(initialStartTime)
        setEndTime(initialEndTime)
        setSetupDate(initialSetupDate)
        setSetupTime(initialSetupTime)
        setPreviousEventDate(initialEventDate || '')
        setPreviousStartTime(initialStartTime || '')
        setPreviousEndTime(initialEndTime || '')
        setPreviousSetupDate(initialSetupDate || '')
        setPreviousSetupTime(initialSetupTime || '')
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
      setCustomerLastName(selectedCustomer.last_name ?? '')
      setContactPhone(selectedCustomer.mobile_number || '')
      setContactEmail(selectedCustomer.email || '')
    }
  }, [selectedCustomer])

  const handleToggleDateTbd = (checked: boolean) => {
    setDateTbd(checked)
    if (checked) {
      setPreviousEventDate(eventDate || previousEventDate)
      setPreviousStartTime(startTime || previousStartTime)
      setPreviousEndTime(endTime || previousEndTime)
      setPreviousSetupDate(setupDate || previousSetupDate)
      setPreviousSetupTime(setupTime || previousSetupTime)
      setEventDate('')
      setStartTime('')
      setEndTime('')
      setSetupDate('')
      setSetupTime('')
    } else {
      setEventDate(previousEventDate)
      setStartTime(previousStartTime || DEFAULT_TBD_TIME)
      setEndTime(previousEndTime)
      setSetupDate(previousSetupDate)
      setSetupTime(previousSetupTime)
    }
  }

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
      <PageLayout
        title="Edit Private Booking"
        subtitle="Loading booking details..."
        backButton={{ label: 'Back to Booking', href: `/private-bookings/${id}` }}
        loading
        loadingLabel="Loading booking..."
      />
    )
  }

  if (error || !booking) {
    return (
      <PageLayout
        title="Edit Private Booking"
        subtitle="Something went wrong"
        backButton={{ label: 'Back to Booking', href: `/private-bookings/${id}` }}
        error={error || 'Booking not found'}
      />
    )
  }
  const customerLabel = booking
    ? booking.customer_name || `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || 'Unknown'
    : 'Unknown'

  const subtitle = `${customerLabel} - ${booking && booking.event_date ? formatDateFull(booking.event_date) : 'Date TBD'}`

  const navActions = (
    <NavGroup>
      <NavLink href={`/private-bookings/${id}`}>
        View Booking
      </NavLink>
      <NavLink href={`/private-bookings/${id}/items`}>
        Manage Items
      </NavLink>
      <NavLink href={`/private-bookings/${id}/messages`}>
        View Messages
      </NavLink>
    </NavGroup>
  )


  return (
    <PageLayout
      title="Edit Private Booking"
      subtitle={subtitle}
      backButton={{ label: 'Back to Booking', href: `/private-bookings/${id}` }}
      navActions={navActions}
    >
      <div className="space-y-6">
        <Card>
          {state && 'error' in state && (
            <Alert variant="error" className="mb-6">
              {state.error}
            </Alert>
          )}

          <form action={formAction} className="space-y-6">
          {dateTbd && <input type="hidden" name="date_tbd" value="true" />}
          <input type="hidden" name="default_country_code" value="44" />
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
                    { value: 'whatsapp', label: 'WhatsApp' },
                    { value: 'social_media', label: 'Social Media' },
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
            {dateTbd && (
              <Alert
                variant="warning"
                className="mb-4"
                title="Lead without confirmed date"
              >
                Keep this booking in draft until the customer confirms the schedule.
              </Alert>
            )}

            <div className="space-y-4">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  id="date_tbd"
                  name="date_tbd_toggle"
                  checked={dateTbd}
                  onChange={(e) => handleToggleDateTbd(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Event date/time to be confirmed</span>
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormGroup label="Event Date" required={!dateTbd}>
                  <Input
                    type="date"
                    name="event_date"
                    id="event_date"
                    required={!dateTbd}
                    disabled={dateTbd}
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
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
                    disabled={dateTbd}
                    value={setupDate}
                    onChange={(e) => setSetupDate(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Setup Time">
                  <Input
                    type="time"
                    name="setup_time"
                    id="setup_time"
                    disabled={dateTbd}
                    value={setupTime}
                    onChange={(e) => setSetupTime(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Start Time" required={!dateTbd}>
                  <Input
                    type="time"
                    name="start_time"
                    id="start_time"
                    required={!dateTbd}
                    disabled={dateTbd}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="End Time">
                  <Input
                    type="time"
                    name="end_time"
                    id="end_time"
                    disabled={dateTbd}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </FormGroup>
              </div>
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
                  value={internalNotesField}
                  onChange={(e) => setInternalNotesField(e.target.value)}
                  placeholder="Staff notes (not visible to customer)"
                />
              </FormGroup>

              <FormGroup label="Contract Note" help="Shown on the contract exactly as entered">
                <Textarea
                  name="contract_note"
                  id="contract_note"
                  rows={3}
                  defaultValue={booking.contract_note || ''}
                  placeholder="Add a plain-text note to appear on the contract..."
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
      </div>
    </PageLayout>
  )
}
