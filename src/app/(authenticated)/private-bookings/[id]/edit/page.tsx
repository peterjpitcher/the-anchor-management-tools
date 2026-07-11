'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { getPrivateBooking, updatePrivateBooking } from '@/app/actions/privateBookingActions'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { EventDetailsRiskSection } from '@/components/private-bookings/EventDetailsRiskSection'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Section } from '@/ds'
import { Button } from '@/ds'
import { Input } from '@/ds'
import { Select } from '@/ds'
import { Textarea } from '@/ds'
import { Checkbox } from '@/ds'
import { FormGroup } from '@/ds'
import { Alert } from '@/ds'
import { LinkButton } from '@/ds'
import { Spinner } from '@/ds'
import { toast } from '@/ds'
import { formatDateFull } from '@/lib/dateUtils'
type FormState = { error: string } | { success: boolean } | null

const DATE_TBD_NOTE = 'Event date/time to be confirmed'
const DEFAULT_TBD_TIME = '12:00'

const STATUS_OPTIONS: Record<string, { value: string; label: string }[]> = {
  draft: [
    { value: 'draft', label: 'Draft' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  confirmed: [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  completed: [{ value: 'completed', label: 'Completed' }],
  cancelled: [
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'draft', label: 'Draft' },
  ],
}

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
  // SOP §12: changing the deposit below the £250 standard needs a recorded
  // GM reason; £0 needs an explicit GM waiver plus reason.
  const [depositAmountDraft, setDepositAmountDraft] = useState<string | null>(null)

  useEffect(() => {
    async function loadBooking() {
      const result = await getPrivateBooking(id, 'edit')
      if ('error' in result) {
        setError(result.error || 'An error occurred')
      } else if (result.data) {
        if (result.data.status === 'completed') {
          router.push(`/private-bookings/${id}`)
          return
        }
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
        router.push('/private-bookings')
        return
      }
      setLoading(false)
    }
    loadBooking()
  }, [id])

  const handleCustomerSelect = (customer: Customer | null) => {
    setSelectedCustomer(customer)
    if (customer) {
      setCustomerFirstName(customer.first_name)
      setCustomerLastName(customer.last_name ?? '')
      setContactPhone(customer.mobile_number || '')
      setContactEmail(customer.email || '')
    }
  }

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

  return (
    <PageLayout
      title="Edit Private Booking"
      subtitle={subtitle}
      backButton={{ label: 'Back to Booking', href: `/private-bookings/${id}` }}
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
                  onCustomerSelect={handleCustomerSelect}
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
                    options={STATUS_OPTIONS[booking.status] || []}
                  />
                </FormGroup>
              </div>
            </div>
          </Section>

          {/* Financial Details */}
          <Section title="Financial Details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Deposit Amount">
                <Input
                  type="number"
                  name="deposit_amount"
                  id="deposit_amount"
                  min="0"
                  step="0.01"
                  defaultValue={booking.deposit_amount ?? 0}
                  disabled={!!booking.deposit_paid_date}
                  onChange={(e) => setDepositAmountDraft(e.target.value)}
                />
              </FormGroup>

              <FormGroup
                label="Balance & Final Details Due"
                help="Clear to auto-recalculate (14 days before the event). The customer is texted when this date changes."
              >
                <Input
                  type="date"
                  name="balance_due_date"
                  id="balance_due_date"
                  disabled={dateTbd}
                  defaultValue={booking.balance_due_date || ''}
                />
              </FormGroup>
            </div>

            {/* SOP §12: reduced/waived deposits need a recorded GM reason */}
            {(() => {
              if (booking.deposit_paid_date || depositAmountDraft === null) return null
              const draftValue = Number(depositAmountDraft)
              const originalDeposit = Number(booking.deposit_amount ?? 0)
              if (!Number.isFinite(draftValue) || draftValue === originalDeposit) return null
              if (draftValue > 0 && draftValue < 250) {
                return (
                  <div className="mt-4">
                    <FormGroup
                      label="Reason for reduced deposit (GM discretion)"
                      help="The standard deposit is £250 — reducing it needs a recorded reason"
                    >
                      <Input
                        type="text"
                        name="deposit_reduction_reason"
                        id="deposit_reduction_reason"
                        required
                        placeholder="e.g. Repeat corporate client"
                      />
                    </FormGroup>
                  </div>
                )
              }
              if (draftValue === 0) {
                return (
                  <div className="mt-4 space-y-4">
                    <Checkbox
                      name="deposit_waived"
                      value="true"
                      label="Deposit waived (GM approved — venue-hosted/internal event)"
                    />
                    <FormGroup label="Reason for waiving the deposit">
                      <Input
                        type="text"
                        name="deposit_waived_reason"
                        id="deposit_waived_reason"
                        required
                        placeholder="e.g. Venue-hosted event"
                      />
                    </FormGroup>
                  </div>
                )
              }
              return null
            })()}

            <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
              <input type="hidden" name="has_open_dispute" value="false" />
              <Checkbox
                name="has_open_dispute"
                value="true"
                defaultChecked={booking.has_open_dispute === true}
                label="Open payment dispute or chargeback"
                description="Cancellation and refund decisions will require manual review while this is selected."
              />
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
              <label className="inline-flex min-h-[44px] md:min-h-0 items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  id="date_tbd"
                  name="date_tbd_toggle"
                  checked={dateTbd}
                  onChange={(event) => handleToggleDateTbd(event.target.checked)}
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

          {/* Event Details & Risk (SOP intake) */}
          <EventDetailsRiskSection
            defaults={{
              layout: booking.layout ?? null,
              guestCountAdults: booking.guest_count_adults ?? null,
              guestCountUnder18: booking.guest_count_under_18 ?? null,
              barTabRequired: booking.bar_tab_required ?? null,
              barTabLimit: booking.bar_tab_limit ?? null,
              barTabPrepaidAmount: booking.bar_tab_prepaid_amount ?? null,
              barTabPreauthReference: booking.bar_tab_preauth_reference ?? null,
              outsideFood: booking.outside_food ?? null,
              highPowerEquipment: booking.high_power_equipment ?? null,
              decorationsPlan: booking.decorations_plan ?? null,
              dogsExpected: booking.dogs_expected ?? null,
              specialRiskNotes: booking.special_risk_notes ?? null,
              communicationPreference: booking.communication_preference ?? null,
              cleardownTime: booking.cleardown_time ?? null,
            }}
          />

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

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-6 sm:pt-4 border-t">
            <LinkButton
              variant="secondary"
              href={`/private-bookings/${id}`}
              className="w-full sm:w-auto"
            >
              Cancel
            </LinkButton>
            <Button
              type="submit"
              disabled={isPending}
              loading={isPending}
              fullWidth
              className="sm:w-auto"
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
