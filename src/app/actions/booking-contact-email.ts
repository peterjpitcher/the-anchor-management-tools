'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normaliseContactEmail } from '@/lib/bookings/contact-email'
import { CustomerService } from '@/services/customers'

const InputSchema = z.object({
  bookingType: z.enum(['table', 'event']),
  bookingId: z.string().uuid(),
})

/**
 * Copies the email a guest typed for one booking onto their customer record (owner decision D31,
 * BK-078). A booking keeps the typed address when the record holds a different one; staff who have
 * checked with the guest can make it the customer's address in one click. The booking's own copy
 * is then cleared, because the record holds it.
 *
 * Needs customers manage, the permission that edits a customer. Goes through
 * CustomerService.updateCustomer, so the new address starts with a clean delivery history and an
 * address already on another customer is refused rather than moved.
 */
export async function updateCustomerEmailFromBooking(
  input: z.infer<typeof InputSchema>
): Promise<{ success?: boolean; error?: string }> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Invalid booking.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Unauthorized' }
  }

  const canManageCustomers = await checkUserPermission('customers', 'manage', user.id)
  if (!canManageCustomers) {
    return { error: 'Insufficient permissions' }
  }

  const { bookingType, bookingId } = parsed.data
  const admin = createAdminClient()
  const { data: booking, error: bookingError } = bookingType === 'table'
    ? await admin.from('table_bookings').select('id, customer_id, contact_email').eq('id', bookingId).maybeSingle()
    : await admin.from('bookings').select('id, customer_id, contact_email').eq('id', bookingId).maybeSingle()

  if (bookingError) {
    return { error: 'Could not load the booking. Please try again.' }
  }
  if (!booking?.customer_id) {
    return { error: 'Booking not found.' }
  }

  const contactEmail = normaliseContactEmail(booking.contact_email)
  if (!contactEmail) {
    return { error: 'This booking has no separate email to copy.' }
  }

  try {
    await CustomerService.updateCustomer(booking.customer_id, { email: contactEmail })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update the customer email.' }
  }

  // The record holds it now, so the booking's copy is no longer needed.
  const { error: clearError } = bookingType === 'table'
    ? await admin.from('table_bookings').update({ contact_email: null }).eq('id', bookingId)
    : await admin.from('bookings').update({ contact_email: null }).eq('id', bookingId)
  if (clearError) {
    console.error('Customer email updated but the booking copy was not cleared', JSON.stringify({
      bookingType,
      bookingId,
      code: clearError.code ?? null,
    }))
  }

  await logAuditEvent({
    user_id: user.id,
    user_email: user.email,
    operation_type: 'update',
    resource_type: 'customer',
    resource_id: booking.customer_id,
    operation_status: 'success',
    additional_info: {
      action: 'email_copied_from_booking',
      booking_type: bookingType,
      booking_id: bookingId,
    },
  })

  revalidatePath(bookingType === 'table' ? `/table-bookings/${bookingId}` : '/events')
  revalidatePath(`/customers/${booking.customer_id}`)
  return { success: true }
}
