import { createAdminClient } from '@/lib/supabase/admin'
import { GdprService, type ErasureSubject } from '@/services/gdpr'

/**
 * The one path that erases a guest record, shared by 'Delete customer' and the GDPR erasure
 * request (BK-161, customer bookings review of 24 October 2026).
 *
 * 'Delete customer' used to try a hard delete first, which cascaded away the guest's free event
 * bookings, messages and consent history, and fell back to swapping in a made-up phone number only
 * when a foreign key refused. Either way the record's opt-outs were lost, so a guest who had said
 * STOP came back as a new, SMS-active customer the next time they booked. Both entry points now:
 *
 *   1. write the record's opt-outs to the suppression list, keyed on a hash of the phone and email
 *      (record_customer_contact_suppression). This runs first and fails closed: if it cannot be
 *      written, nothing has been changed yet and the erasure stops.
 *   2. cancel pending voucher reminders and unlink vouchers, while the customer ids still resolve.
 *   3. run GdprService.deleteUserData, which anonymises the customer and scrubs the personal data
 *      from every table that holds it, keeping the rows themselves (bookings, consent history).
 *
 * Server only: callers authorise first (customers manage for delete, super admin for erasure).
 */

export type ContactSuppressionSource = 'customer_deleted' | 'gdpr_erasure' | 'customer_merged'

export async function recordContactSuppression(
  customerIds: string[],
  source: ContactSuppressionSource,
): Promise<number> {
  if (customerIds.length === 0) return 0

  const { data, error } = await createAdminClient().rpc('record_customer_contact_suppression', {
    p_customer_ids: customerIds,
    p_source: source,
  })

  if (error) {
    throw new Error(
      `Could not keep the customer's opt-outs before erasing them (${error.code ?? 'unknown'}: ${error.message}). Nothing has been changed.`,
    )
  }

  return Number(data ?? 0)
}

/**
 * Cancel pending voucher reminders and unlink vouchers from the subject's customer records. Runs
 * BEFORE the main erasure so a retry can still resolve the customer ids. Voucher rows and events
 * are retained as business records; voucher_events.detail holds customer ids only, never names or
 * phone numbers, so it needs no scrubbing.
 */
export async function scrubVoucherLinksForCustomers(
  customerIds: string[],
): Promise<{ vouchersUnlinked: number; remindersCancelled: number }> {
  if (customerIds.length === 0) {
    return { vouchersUnlinked: 0, remindersCancelled: 0 }
  }

  const adminClient = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: cancelledReminders, error: reminderError } = await adminClient
    .from('voucher_reminders')
    .update({ status: 'cancelled', updated_at: nowIso })
    .in('customer_id', customerIds)
    .eq('status', 'pending')
    .select('id')

  if (reminderError) {
    throw new Error(`Failed to cancel voucher reminders for erasure: ${reminderError.message}`)
  }

  const { data: unlinkedVouchers, error: voucherError } = await adminClient
    .from('vouchers')
    .update({ customer_id: null, updated_at: nowIso })
    .in('customer_id', customerIds)
    .select('id')

  if (voucherError) {
    throw new Error(`Failed to unlink vouchers for erasure: ${voucherError.message}`)
  }

  return {
    vouchersUnlinked: unlinkedVouchers?.length ?? 0,
    remindersCancelled: cancelledReminders?.length ?? 0,
  }
}

export async function eraseCustomers(
  subject: ErasureSubject,
  source: Extract<ContactSuppressionSource, 'customer_deleted' | 'gdpr_erasure'>,
) {
  const suppressedContacts = await recordContactSuppression(subject.customerIds, source)
  const voucherCleanup = await scrubVoucherLinksForCustomers(subject.customerIds)
  const result = await GdprService.deleteUserData(subject)
  return { result, voucherCleanup, suppressedContacts }
}
