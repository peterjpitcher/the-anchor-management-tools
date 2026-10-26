'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, toast } from '@/ds'
import { updateCustomerEmailFromBooking } from '@/app/actions/booking-contact-email'

type Props = {
  bookingType: 'table' | 'event'
  bookingId: string
  /** Named when the notice sits in a list of bookings; omitted on a single booking's page. */
  guestName?: string | null
  /** The email typed for this booking (table_bookings or bookings contact_email). */
  contactEmail: string
  /** The address on the customer record, or null when it has none. */
  customerEmail: string | null
  /** customers manage: only then is the one-click copy offered. */
  canUpdateCustomer: boolean
}

/**
 * Tells staff the guest gave a different email for this booking than the one on their record, and
 * lets someone who can edit customers make it the record's address in one click (owner decision
 * D31, BK-078). This booking's messages already go to the typed address either way.
 */
export function BookingContactEmailNotice({ bookingType, bookingId, guestName, contactEmail, customerEmail, canUpdateCustomer }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function handleUpdate() {
    setSaving(true)
    try {
      const result = await updateCustomerEmailFromBooking({ bookingType, bookingId })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Customer email updated')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Alert
      tone="info"
      title={guestName ? `Email for ${guestName}'s booking` : 'Email for this booking'}
      actions={canUpdateCustomer ? (
        <Button size="sm" variant="secondary" onClick={() => void handleUpdate()} disabled={saving}>
          {saving ? 'Updating...' : 'Update customer email'}
        </Button>
      ) : undefined}
    >
      The guest gave {contactEmail} for this booking, and its messages go there.{' '}
      {customerEmail
        ? `The customer record still has ${customerEmail}.`
        : 'The customer record has no email.'}
    </Alert>
  )
}
