'use server'

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from './audit'
import { GdprService } from '@/services/gdpr'
import { eraseCustomers } from '@/services/customer-erasure'
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
 * Answer a guest's request for their data (BK-081, customer bookings review of 24 October 2026).
 *
 * `subjectIdentifier` is what the guest gave us: an email address, a phone number, or a customer
 * or profile record id. It resolves exactly as an erasure does and exports the same tables, so
 * the pub can answer within the month the law allows without hand-written SQL. Super admins
 * only, like erasure, because the file holds a guest's whole history.
 */
export async function exportGuestData(subjectIdentifier: string): Promise<{
  success?: boolean
  error?: string
  data?: string
  fileName?: string
  mimeType?: string
}> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'User not authenticated' }
    }

    if (!(await callerIsSuperAdmin(user.id))) {
      return { error: 'Insufficient permissions' }
    }

    const subject = await GdprService.resolveErasureSubject(subjectIdentifier)
    if (!subject) {
      return { error: 'No customer or user found with that email address, phone number or record id' }
    }

    const result = await GdprService.exportSubjectData(subject, user.id)
    const exportJson = await appendVoucherDataToExport(result.data)

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'export',
      resource_type: 'user_data',
      resource_id: subject.profileId ?? subject.customerIds[0] ?? undefined,
      operation_status: 'success',
      additional_info: {
        exported_by: user.id,
        // Ids and counts only: the request's email or phone must not be copied into the log.
        profile_id: subject.profileId,
        customer_ids: subject.customerIds,
        record_counts: result.counts,
      },
    })

    return { success: true, data: exportJson, fileName: result.fileName, mimeType: result.mimeType }
  } catch (error: unknown) {
    console.error('Error exporting guest data:', error)
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

    // The shared erasure path (BK-161): the record's opt-outs go on the suppression list first, so
    // a guest who books again starts opted out; then vouchers are unlinked while the ids still
    // resolve (voucher spec 7.5, F37); then the service anonymises everything. Execute deletion
    // first, then write audit log on success (H6 fix).
    const { result, voucherCleanup } = await eraseCustomers(subject, 'gdpr_erasure')

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
