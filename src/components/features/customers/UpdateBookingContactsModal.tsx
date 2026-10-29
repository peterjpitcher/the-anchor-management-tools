'use client'

import { useState } from 'react'
import { Button, Modal, toast } from '@/ds'
import { updateUpcomingPrivateBookingContacts } from '@/app/actions/customers'
import type { BookingContactOffer } from '@/services/private-bookings/contact-sync'

export interface UpdateBookingContactsModalProps {
  customerId: string | null
  /** What updateCustomer handed back: the upcoming hires still on the old details. Empty closes it. */
  offers: BookingContactOffer[]
  onClose: () => void
}

/**
 * After staff change a customer's phone or email, offer to bring the upcoming private hires that
 * still carry the old ones up to date (BK-163). Used wherever a customer can be edited, so the
 * offer is made where the change was saved. Only the fields that matched the old details change.
 */
export function UpdateBookingContactsModal({ customerId, offers, onClose }: UpdateBookingContactsModalProps): React.JSX.Element {
  const [updating, setUpdating] = useState(false)
  const count = offers.length

  const update = async (): Promise<void> => {
    if (!customerId) return
    setUpdating(true)
    try {
      const result = await updateUpcomingPrivateBookingContacts(customerId, offers)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(result.updated === 1 ? '1 private booking updated' : `${result.updated ?? 0} private bookings updated`)
      onClose()
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Modal
      open={count > 0 && Boolean(customerId)}
      onClose={() => {
        if (!updating) onClose()
      }}
      title="Update Upcoming Private Bookings?"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={updating}>
            Leave Them
          </Button>
          <Button variant="primary" type="button" loading={updating} onClick={() => void update()}>
            Update Bookings
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">
        {count === 1
          ? 'One upcoming private booking still has the old phone number or email address, so its texts and emails would keep going there.'
          : `${count} upcoming private bookings still have the old phone number or email address, so their texts and emails would keep going there.`}{' '}
        Update them to the new details?
      </p>
    </Modal>
  )
}
