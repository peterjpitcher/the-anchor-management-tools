'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  CalendarIcon, 
  // ClockIcon, 
  UserIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  CurrencyPoundIcon
} from '@heroicons/react/24/outline'
import { createPrivateBooking } from '@/app/actions/privateBookingActions'
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
import { toast } from '@/components/ui-v2/feedback/Toast'
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
          {/* Customer Information */}
          <Section 
            title="Customer Information"
            icon={<UserIcon className="h-5 w-5" />}
          >
            <div className="space-y-4">
              {/* Customer Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Search Existing Customer
                </label>
                <CustomerSearchInput
                  onCustomerSelect={setSelectedCustomer}
                  placeholder="Search by name or phone number..."
                />
                <p className="mt-1 text-sm text-gray-500">
                  Search for an existing customer or leave blank to create a new one
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
                <FormGroup
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
                </FormGroup>
                <FormGroup
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
                </FormGroup>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
                <FormGroup
                  label="Phone Number"
                >
                  <Input
                    type="tel"
                    id="contact_phone"
                    name="contact_phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="07700 900000"
                    autoComplete="tel"
                    inputMode="tel"
                  />
                </FormGroup>
              </div>
              
              <FormGroup
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
              </FormGroup>
            </div>
          </Section>

          {/* Event Details */}
          <Section
            title="Event Details"
            icon={<CalendarIcon className="h-5 w-5" />}
          >
            <div className="space-y-4">
              <div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    id="date_tbd"
                    name="date_tbd_toggle"
                    checked={dateTbd}
                    onChange={(e) => setDateTbd(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Event date/time to be confirmed</span>
                </label>
                <p className="mt-1 text-xs text-gray-500">
                  We’ll keep this booking in draft until you add the event details.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
              <FormGroup
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
              </FormGroup>
              <FormGroup
                label="Event Type"
              >
                <Input
                  type="text"
                  id="event_type"
                  name="event_type"
                  placeholder="Birthday Party, Wedding, Corporate Event..."
                />
              </FormGroup>
              <FormGroup
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
              </FormGroup>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-4 mt-6 sm:mt-4">
              <FormGroup
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
              </FormGroup>
              <FormGroup
                label="End Time"
              >
                <Input
                  type="time"
                  id="end_time"
                  name="end_time"
                  defaultValue="23:00"
                  disabled={dateTbd}
                />
              </FormGroup>
              <FormGroup
                label="Guest Count"
              >
                <Input
                  type="number"
                  id="guest_count"
                  name="guest_count"
                  min="1"
                  placeholder="50"
                />
              </FormGroup>
            </div>
            </div>
          </Section>

          {/* Setup Details */}
          <Section
            title="Setup Details"
            icon={<BuildingOfficeIcon className="h-5 w-5" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
              <FormGroup
                label="Setup Date"
                help="Leave blank if same as event date"
              >
                <Input
                  type="date"
                  id="setup_date"
                  name="setup_date"
                />
              </FormGroup>
              <FormGroup
                label="Setup Time"
                help="When vendors can start setup"
              >
                <Input
                  type="time"
                  id="setup_time"
                  name="setup_time"
                />
              </FormGroup>
            </div>
          </Section>

          {/* Financial Details */}
          <Section
            title="Financial Details (Optional)"
            icon={<CurrencyPoundIcon className="h-5 w-5" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
              <FormGroup
                label="Deposit Amount (£)"
                help="Default is £250"
              >
                <Input
                  type="number"
                  id="deposit_amount"
                  name="deposit_amount"
                  step="0.01"
                  min="0"
                  defaultValue="250"
                />
              </FormGroup>
              <FormGroup
                label="Balance Due Date"
                help="Leave blank to auto-calculate (7 days before event)"
              >
                <Input
                  type="date"
                  id="balance_due_date"
                  name="balance_due_date"
                />
              </FormGroup>
            </div>
          </Section>

          {/* Additional Information */}
          <Section
            title="Additional Information"
            icon={<DocumentTextIcon className="h-5 w-5" />}
          >
            <div className="space-y-4">
              <FormGroup
                label="Customer Requests"
              >
                <Textarea
                  id="customer_requests"
                  name="customer_requests"
                  rows={3}
                  placeholder="Special requests, dietary requirements, decorations..."
                />
              </FormGroup>
              
              <FormGroup
                label="Internal Notes"
              >
                <Textarea
                  id="internal_notes"
                  name="internal_notes"
                  rows={3}
                  placeholder="Staff notes, setup requirements, important reminders..."
                />
              </FormGroup>
              
              <FormGroup
                label="Special Requirements"
              >
                <Textarea
                  id="special_requirements"
                  name="special_requirements"
                  rows={2}
                  placeholder="Equipment needs, layout preferences, technical requirements..."
                />
              </FormGroup>
              
              <FormGroup
                label="Accessibility Needs"
              >
                <Textarea
                  id="accessibility_needs"
                  name="accessibility_needs"
                  rows={2}
                  placeholder="Wheelchair access, hearing loops, dietary restrictions..."
                />
              </FormGroup>
            </div>
          </Section>

          {/* Error Message */}
          {error && (
            <Alert variant="error">
              {error}
            </Alert>
          )}

          {/* Form Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-6 sm:pt-4 border-t">
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
