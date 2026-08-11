'use server'

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from './audit'
import { GdprService } from '@/services/gdpr'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/errors';

/**
 * True when the caller holds the super_admin role.
 *
 * Both GDPR entry points used to authorise on profiles.system_role. That column
 * does not exist in the database, so the query returned an error, system_role
 * was always undefined, and export-for-another-user and erasure were refused for
 * everyone including actual super admins. This is the same get_user_roles
 * mechanism the checklists actions use, and it is the only way to restrict a
 * path to super_admin, since super_admin bypasses permission rows.
 */
async function callerIsSuperAdmin(userId: string): Promise<boolean> {
  const adminClient = createAdminClient()
  const { data, error } = await (adminClient.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Array<{ role_name?: string }> | null; error: unknown }>)('get_user_roles', {
    p_user_id: userId,
  })

  if (error) {
    console.error('[GDPR] Failed to verify caller roles', error)
    return false
  }

  return (data ?? []).some((row) => row.role_name === 'super_admin')
}

/**
 * Export all user data for GDPR compliance
 */
export async function exportUserData(userId?: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user && !userId) {
      return { error: 'User not authenticated' }
    }
    
    const targetUserId = userId || user!.id
    
    // Check permission if exporting another user's data
    if (userId && userId !== user?.id) {
      if (!(await callerIsSuperAdmin(user!.id))) {
        return { error: 'Insufficient permissions' }
      }
    }
    
    const { data, fileName, mimeType } = await GdprService.exportUserData(targetUserId, user?.id);

    // Vouchers hang off customer records rather than the auth user, so enrich
    // the service payload with voucher and reminder rows for every customer
    // identity the export matched (voucher spec 7.5, F37).
    const exportJson = await appendVoucherDataToExport(data)

    // Log the export (moved here from service, as audit logging is typically controller's responsibility)
    await logAuditEvent({
      user_id: user?.id || targetUserId,
      user_email: user?.email || undefined,
      operation_type: 'export',
      resource_type: 'user_data',
      resource_id: targetUserId,
      operation_status: 'success',
      additional_info: {
        exported_by: user?.id,
        record_counts: {
          profile: data ? 1 : 0, // Simplified, actual count can be derived from data
          // Actual counts would be passed back from service
        }
      }
    })
    
    return {
      success: true,
      data: exportJson,
      fileName,
      mimeType
    }
  } catch (error: unknown) {
    console.error('Error exporting user data:', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Erase a data subject's personal data (right to be forgotten).
 *
 * `subjectIdentifier` is whatever the requester gave us: an email address, a
 * phone number, or the id of a customer or profile record. It used to be
 * matched only against profiles.email, which meant a request could never reach
 * a pub guest, only one of the twenty staff logins. See
 * GdprService.resolveErasureSubject.
 *
 * Note: this is destructive and cannot be undone.
 */
export async function deleteUserData(subjectIdentifier: string) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'User not authenticated' }
    }

    // Only super admins can delete user data
    if (!(await callerIsSuperAdmin(user.id))) {
      return { error: 'Insufficient permissions' }
    }

    // Resolve the request to real records before touching anything (C17 fix:
    // the target comes from a looked-up identifier, never a caller-supplied id).
    const subject = await GdprService.resolveErasureSubject(subjectIdentifier)

    if (!subject) {
      return { error: 'No customer or user found with that email address, phone number or record id' }
    }

    // Vouchers link to customer records. Scrub the voucher side FIRST: once the
    // service has anonymised the customer, a retry could no longer resolve
    // these rows by email or phone. Voucher rows and events themselves are
    // retained as business records (voucher_events.detail stores customer ids
    // only, never names or phone numbers), so erasure only unlinks the customer
    // and cancels pending reminders (voucher spec 7.5, F37).
    const voucherCleanup = await scrubVoucherLinksForCustomers(subject.customerIds)

    // Execute deletion first, then write audit log on success (H6 fix)
    const result = await GdprService.deleteUserData(subject)

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'delete',
      resource_type: 'user_data',
      resource_id: subject.profileId ?? subject.customerIds[0] ?? undefined,
      operation_status: 'success',
      additional_info: {
        deleted_by: user.id,
        // Record the ids, never the email or phone the request came in with:
        // the audit log must not become the last surviving copy of the data it
        // was written to prove we destroyed.
        profile_id: subject.profileId,
        customer_ids: subject.customerIds,
        status: 'completed',
        rows_scrubbed: result.counts,
        rows_left_unscrubbed: result.unscrubbedRows,
        vouchers_unlinked: voucherCleanup.vouchersUnlinked,
        voucher_reminders_cancelled: voucherCleanup.remindersCancelled
      }
    })

    return {
      success: true,
      message: result.message
    }

  } catch (error: unknown) {
    console.error('Error deleting user data:', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Merge voucher and voucher reminder rows for the export's matched customers
 * into the GDPR export payload (voucher spec 7.5, F37).
 */
async function appendVoucherDataToExport(exportJson: string): Promise<string> {
  const parsed = JSON.parse(exportJson) as Record<string, unknown> & {
    customers?: Array<{ id?: string | null }>
  }

  const customerIds = (parsed.customers ?? [])
    .map((customer) => customer?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (customerIds.length === 0) {
    parsed.vouchers = []
    parsed.voucherReminders = []
    return JSON.stringify(parsed, null, 2)
  }

  const adminClient = createAdminClient()

  const { data: voucherRows, error: voucherError } = await adminClient
    .from('vouchers')
    .select('voucher_number, type_id, status, issued_at, expiry_date, won_at_label, redeemed_at')
    .in('customer_id', customerIds)

  if (voucherError) {
    throw new Error(`Failed to export voucher data: ${voucherError.message}`)
  }

  const typeIds = [...new Set((voucherRows ?? []).map((row) => row.type_id).filter(Boolean))]
  const typeTitles = new Map<string, string>()
  if (typeIds.length > 0) {
    const { data: typeRows, error: typeError } = await adminClient
      .from('voucher_types')
      .select('id, display_title')
      .in('id', typeIds)

    if (typeError) {
      throw new Error(`Failed to export voucher type data: ${typeError.message}`)
    }

    for (const typeRow of typeRows ?? []) {
      typeTitles.set(typeRow.id, typeRow.display_title)
    }
  }

  const { data: reminderRows, error: reminderError } = await adminClient
    .from('voucher_reminders')
    .select('reminder_kind, status, scheduled_for, sent_at')
    .in('customer_id', customerIds)

  if (reminderError) {
    throw new Error(`Failed to export voucher reminder data: ${reminderError.message}`)
  }

  parsed.vouchers = (voucherRows ?? []).map((row) => ({
    voucher_number: row.voucher_number,
    type: typeTitles.get(row.type_id) ?? row.type_id,
    status: row.status,
    issued_at: row.issued_at,
    expiry_date: row.expiry_date,
    won_at_label: row.won_at_label,
    redeemed_at: row.redeemed_at
  }))

  parsed.voucherReminders = (reminderRows ?? []).map((row) => ({
    kind: row.reminder_kind,
    status: row.status,
    scheduled_for: row.scheduled_for,
    sent_at: row.sent_at
  }))

  return JSON.stringify(parsed, null, 2)
}

/**
 * Erasure support: cancel pending voucher reminders and unlink vouchers from
 * the erasure subject's customer records. Runs BEFORE the main erasure so a
 * retry can still resolve the customer ids. Voucher rows and events are
 * retained as business records; voucher_events.detail holds customer ids only,
 * never names or phone numbers, so it needs no scrubbing.
 *
 * Takes the already-resolved ids rather than re-deriving them from an email,
 * which never matched a customer.
 */
async function scrubVoucherLinksForCustomers(
  customerIds: string[]
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
    remindersCancelled: cancelledReminders?.length ?? 0
  }
}