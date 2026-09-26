'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createPrivateBooking } from '@/app/actions/privateBookingActions'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { EventDetailsRiskSection } from '@/components/private-bookings/EventDetailsRiskSection'
import { PageLayout, Icon } from '@/ds'
import { Card } from '@/ds'
import { Section } from '@/ds'
import { Button } from '@/ds'
import { Input } from '@/ds'
import { Select } from '@/ds'
import { Textarea } from '@/ds'
import { Checkbox } from '@/ds'
import { Field } from '@/ds'
import { Alert } from '@/ds'
import { LinkButton } from '@/ds'
import { toast } from '@/ds'
import { getTodayIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
interface Customer {
  id: string
  first_name: string
  last_name: string | null
  mobile_number: string | null
  email: string | null
}

export default function NewPrivateBookingPage() {
  const router = useRouter()
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerFirstName, setCustomerFirstName] = useState('')
  const [customerLastName, setCustomerLastName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [dateTbd, setDateTbd] = useState(false)
  // SOP §12: the £250 standard deposit may only be reduced with a recorded
  // GM reason; £0 requires an explicit GM waiver plus reason.
  const [depositAmountInput, setDepositAmountInput] = useState('250')
  const [depositWaived, setDepositWaived] = useState(false)

  const depositValue = Number(depositAmountInput)
  const showDepositReduction = Number.isFinite(depositValue) && depositValue > 0 && depositValue < 250
  const showDepositWaiver = depositAmountInput.trim() !== '' && depositValue === 0

  useEffect(() => {
    async function checkPermission() {
      const { checkUserPermission } = await import('@/app/actions/rbac')
      const canCreate = await checkUserPermission('private_bookings', 'create')
        || await checkUserPermission('private_bookings', 'manage')
      if (!canCreate) {
        router.replace('/private-bookings')
      }
    }
    void checkPermission()
  }, [router])

  // Update form when customer is selected
  useEffect(() => {
    if (selectedCustomer) {
      setCustomerFirstName(selectedCustomer.first_name)
      setCustomerLastName(selectedCustomer.last_name ?? '')
      setContactPhone(selectedCustomer.mobile_number || '')
      setContactEmail(selectedCustomer.email || '')
    }
  }, [selectedCustomer])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    const formData = new FormData(e.currentTarget)

    // Add customer_id if a customer was selected
    if (selectedCustomer) {
      formData.set('customer_id', selectedCustomer.id)
    }

    // A £0 deposit requires the GM waiver to be explicitly confirmed
    if (showDepositWaiver && !depositWaived) {
      setError('A £0 deposit requires a General Manager waiver — please confirm the waiver')
      setIsSubmitting(false)
      return
    }

    try {
      const result = await createPrivateBooking(formData)
      
      if (result.error) {
        setError(result.error)
        setIsSubmitting(false)
      } else if (result.success && result.data) {
        toast.success('Private booking created successfully')
        router.push(`/private-bookings/${result.data.id}`)
      }
    } catch {
      setError('An unexpected error occurred')
      setIsSubmitting(false)
    }
  }

  // Get tomorrow's date as default event date
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultDate = toLocalIsoDate(tomorrow)
  
  // Default deposit due date (14 days from today)
  const defaultDepositDate = new Date()
  defaultDepositDate.setDate(defaultDepositDate.getDate() + 14)
  const defaultDepositDateIso = toLocalIsoDate(defaultDepositDate)

  // Set min date to today and max to 1 year from now
  const today = getTodayIsoDate()
  const oneYearFromNow = new Date()
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
  const maxDate = toLocalIsoDate(oneYearFromNow)

  return (
    <PageLayout
      title="New Private Booking"
      subtitle="Create a new venue hire booking"
      backButton={{ label: 'Back to Private Bookings', onBack: () => router.push('/private-bookings') }}
    >
      <div className="space-y-6">
        <Card>
          <form onSubmit={handleSubmit} className="space-y-6">
          {dateTbd && <input type="hidden" name="date_tbd" value="true" />}
          <input type="hidden" name="default_country_code" value="44" />
          {/* Customer Information */}
          <Section 
            title="Customer Information"
            icon={<Icon name="user" size={20} />}
          >
            <div className="space-y-4">
              {/* Customer Search */}
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  Search Existing Customer
                </label>
                <CustomerSearchInput
                  onCustomerSelect={setSelectedCustomer}
                  placeholder="Search by name or phone number..."
                />
                <p className="mt-1 text-sm text-text-muted">
                  Select an existing customer, or enter a phone number below to create a new one
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
                <Field
                  label="First Name"
                  required
                >
                  <Input
                    type="text"
                    id="customer_first_name"
                    name="customer_first_name"
                    value={customerFirstName}
                    onChange={(e) => setCustomerFirstName(e.target.value)}
                    required
                    placeholder="John"
                  />
                </Field>
                <Field
                  label="Last Name"
                >
                  <Input
                    type="text"
                    id="customer_last_name"
                    name="customer_last_name"
                    value={customerLastName}
                    onChange={(e) => setCustomerLastName(e.target.value)}
                    placeholder="Smith"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
                <Field
                  label="Phone Number"
                  required={!selectedCustomer}
                >
                  <Input
                    type="tel"
                    id="contact_phone"
                    name="contact_phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    required={!selectedCustomer}
                    placeholder="+1 415 555 2671 or local format"
                    autoComplete="tel"
                    inputMode="tel"
                  />
                </Field>
              </div>
              
              <Field
                label="Email Address"
              >
                <Input
                  type="email"
                  id="contact_email"
                  name="contact_email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="john@example.com"
                  autoComplete="email"
                />
              </Field>
            </div>
          </Section>

          {/* Event Details */}
          <Section
            title="Event Details"
            icon={<Icon name="calendar" size={20} />}
          >
            <div className="space-y-4">
              <div>
                <label className="inline-flex min-h-touch md:min-h-0 items-center gap-2 text-sm font-medium text-text">
                  <input
                    type="checkbox"
                    id="date_tbd"
                    name="date_tbd_toggle"
                    checked={dateTbd}
                    onChange={(event) => setDateTbd(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>Event date/time to be confirmed</span>
                </label>
                <p className="mt-1 text-xs text-text-muted">
                  We’ll keep this booking in draft until you add the event details.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
              <Field
                label="Event Date"
                required={!dateTbd}
              >
                <Input
                  type="date"
                  id="event_date"
                  name="event_date"
                  required={!dateTbd}
                  defaultValue={defaultDate}
                  min={today}
                  max={maxDate}
                  disabled={dateTbd}
                />
              </Field>
              <Field
                label="Event Type"
              >
                <Input
                  type="text"
                  id="event_type"
                  name="event_type"
                  placeholder="Birthday Party, Wedding, Corporate Event..."
                />
              </Field>
              <Field
                label="Booking Source"
              >
                <Select
                  id="source"
                  name="source"
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
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-4 mt-6 sm:mt-4">
              <Field
                label="Start Time"
                required={!dateTbd}
              >
                <Input
                  type="time"
                  id="start_time"
                  name="start_time"
                  required={!dateTbd}
                  defaultValue="18:00"
                  disabled={dateTbd}
                />
              </Field>
              <Field
                label="End Time"
              >
                <Input
                  type="time"
                  id="end_time"
                  name="end_time"
                  defaultValue="23:00"
                  disabled={dateTbd}
                />
              </Field>
              <Field
                label="Guest Count"
              >
                <Input
                  type="number"
                  id="guest_count"
                  name="guest_count"
                  min="1"
                  placeholder="50"
                />
              </Field>
            </div>
            </div>
          </Section>

          {/* Event Details & Risk (SOP intake) */}
          <EventDetailsRiskSection />

          {/* Setup Details */}
          <Section
            title="Setup Details"
            icon={<Icon name="building" size={20} />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
              <Field
                label="Setup Date"
                help="Leave blank if same as event date"
              >
                <Input
                  type="date"
                  id="setup_date"
                  name="setup_date"
                />
              </Field>
              <Field
                label="Setup Time"
                help="When vendors can start setup"
              >
                <Input
                  type="time"
                  id="setup_time"
                  name="setup_time"
                />
              </Field>
            </div>
          </Section>

          {/* Financial Details */}
          <Section
            title="Financial Details (Optional)"
            icon={<Icon name="pound" size={20} />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-4">
              <Field
                label="Deposit Amount (£)"
                help="Default is £250"
              >
                <Input
                  type="number"
                  id="deposit_amount"
                  name="deposit_amount"
                  step="0.01"
                  min="0"
                  value={depositAmountInput}
                  onChange={(e) => setDepositAmountInput(e.target.value)}
                />
              </Field>
              <Field
                label="Deposit Due (Hold Expiry)"
                help="The provisional hold is released if the deposit hasn't arrived by this date"
              >
                <Input
                  type="date"
                  id="deposit_due_date"
                  name="deposit_due_date"
                  defaultValue={defaultDepositDateIso}
                />
              </Field>
              <Field
                label="Balance & Final Details Due"
                help="Balance and final details are due 14 days before the event — leave blank to auto-calculate"
              >
                <Input
                  type="date"
                  id="balance_due_date"
                  name="balance_due_date"
                />
              </Field>
            </div>
            {showDepositReduction && (
              <div className="mt-4">
                <Field
                  label="Reason for reduced deposit (GM discretion)"
                  help="The standard deposit is £250 — reducing it needs a recorded reason"
                >
                  <Input
                    type="text"
                    id="deposit_reduction_reason"
                    name="deposit_reduction_reason"
                    required
                    placeholder="e.g. Repeat corporate client"
                  />
                </Field>
              </div>
            )}
            {showDepositWaiver && (
              <div className="mt-4 space-y-4">
                <Checkbox
                  name="deposit_waived"
                  value="true"
                  checked={depositWaived}
                  onChange={(checked) => setDepositWaived(checked)}
                  label="Deposit waived (GM approved — venue-hosted/internal event)"
                />
                <Field label="Reason for waiving the deposit">
                  <Input
                    type="text"
                    id="deposit_waived_reason"
                    name="deposit_waived_reason"
                    required
                    placeholder="e.g. Venue-hosted event"
                  />
                </Field>
              </div>
            )}
          </Section>

          {/* Additional Information */}
          <Section
            title="Additional Information"
            icon={<Icon name="fileText" size={20} />}
          >
            <div className="space-y-4">
              <Field
                label="Customer Requests"
              >
                <Textarea
                  id="customer_requests"
                  name="customer_requests"
                  rows={3}
                  placeholder="Special requests, dietary requirements, decorations..."
                />
              </Field>
              
              <Field
                label="Internal Notes"
              >
                <Textarea
                  id="internal_notes"
                  name="internal_notes"
                  rows={3}
                  placeholder="Staff notes, setup requirements, important reminders..."
                />
              </Field>

              <Field
                label="Contract Note"
                help="Shown on the contract exactly as entered"
              >
                <Textarea
                  id="contract_note"
                  name="contract_note"
                  rows={3}
                  placeholder="Add a plain-text note to appear on the contract..."
                />
              </Field>
              
              <Field
                label="Special Requirements"
              >
                <Textarea
                  id="special_requirements"
                  name="special_requirements"
                  rows={2}
                  placeholder="Equipment needs, layout preferences, technical requirements..."
                />
              </Field>
              
              <Field
                label="Accessibility Needs"
              >
                <Textarea
                  id="accessibility_needs"
                  name="accessibility_needs"
                  rows={2}
                  placeholder="Wheelchair access, hearing loops, dietary restrictions..."
                />
              </Field>
            </div>
          </Section>

          {/* Error Message */}
          {error && (
            <Alert tone="danger">
              {error}
            </Alert>
          )}

          {/* Form Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-6 sm:pt-4 border-t border-border">
            <LinkButton
              variant="secondary"
              href="/private-bookings"
              className="w-full sm:w-auto"
            >
              Cancel
            </LinkButton>
            <Button
              type="submit"
              disabled={isSubmitting}
              loading={isSubmitting}
              fullWidth
              className="sm:w-auto"
            >
              Create Booking
            </Button>
          </div>
        </form>
      </Card>
      </div>
    </PageLayout>
  )
}
