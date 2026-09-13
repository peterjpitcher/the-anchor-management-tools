'use server'

/**
 * Read and clear the block on one customer's email address.
 *
 * WHY A STAFF ROUTE EXISTS AT ALL. Nothing in the app has ever cleared a suppression. Once an
 * address reached `email_suppressions` it was blocked for ever, `sendEmail` refused it before
 * any other logic, and `email_deactivated_at` on the customer kept `isEmailUsable` saying no.
 * Temporary bounces no longer create a suppression (`bounce-classification.ts`), but the rows
 * created before that change are still there, and a genuinely dead address can be corrected
 * and come back. Somebody has to be able to say "that address is fine now".
 *
 * TWO TABLES, ONE ACTION. A suppression row and a deactivation stamp block different code
 * paths, and clearing one without the other leaves the guest still unreachable while the
 * screen says the block is gone. They are cleared together or not at all.
 *
 * Reading needs `customers.view_contact_preferences`, clearing needs
 * `customers.manage_contact_preferences`: the same pair that gates every other contact
 * preference, and both are audited.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { emailAddressResetFields } from '@/lib/email/address-reset'

export type CustomerEmailBlock = {
  email: string | null
  /** True when the address is on `email_suppressions`, which stops every email to it. */
  suppressed: boolean
  /** 'bounce', 'complaint' or 'suppression' when suppressed. */
  suppressionReason: string | null
  /** 'valid', 'unknown', 'bounced', 'complained' or 'invalid'. */
  emailStatus: string | null
  /** Set means `isEmailUsable` refuses this address whatever the suppression list says. */
  deactivatedAt: string | null
  deliveryFailures: number
  lastFailureReason: string | null
  marketingOptIn: boolean
  marketingOptedOutAt: string | null
}

type ActionResult = { success?: boolean; error?: string }

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const }
  return { user }
}

/**
 * Everything staff need to see before writing to a guest by email.
 *
 * `email_suppressions` is service-role only with RLS on, so this cannot be read from the
 * page's own client and has to come through a server action.
 */
export async function getCustomerEmailBlock(
  customerId: string
): Promise<{ block?: CustomerEmailBlock; error?: string }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  const [canView, canViewPreferences] = await Promise.all([
    checkUserPermission('customers', 'view', auth.user.id),
    checkUserPermission('customers', 'view_contact_preferences', auth.user.id),
  ])
  if (!canView || !canViewPreferences) {
    return { error: 'Insufficient permissions to view contact preferences' }
  }

  const admin = createAdminClient()
  const { data: customer, error } = await admin
    .from('customers')
    .select(
      'email, email_status, email_deactivated_at, email_delivery_failures, last_email_failure_reason, marketing_email_opt_in, marketing_email_opted_out_at'
    )
    .eq('id', customerId)
    .maybeSingle()

  if (error) {
    logger.warn('Failed to load a customer email block', {
      metadata: { customerId, error: error.message },
    })
    return { error: 'Could not read this customer email state' }
  }
  if (!customer) return { error: 'Customer not found' }

  const address = (customer.email ?? '').trim().toLowerCase()
  let suppressed = false
  let suppressionReason: string | null = null

  if (address) {
    const { data: suppression, error: suppressionError } = await (admin.from('email_suppressions') as any)
      .select('reason')
      .eq('email', address)
      .maybeSingle()

    if (suppressionError) {
      logger.warn('Failed to read the email suppression list for a customer', {
        metadata: { customerId, error: suppressionError.message },
      })
      return { error: 'Could not read the email suppression list' }
    }

    suppressed = Boolean(suppression)
    suppressionReason = (suppression?.reason as string | null) ?? null
  }

  return {
    block: {
      email: customer.email ?? null,
      suppressed,
      suppressionReason,
      emailStatus: customer.email_status ?? null,
      deactivatedAt: customer.email_deactivated_at ?? null,
      deliveryFailures: Number(customer.email_delivery_failures ?? 0),
      lastFailureReason: customer.last_email_failure_reason ?? null,
      marketingOptIn: customer.marketing_email_opt_in === true,
      marketingOptedOutAt: customer.marketing_email_opted_out_at ?? null,
    },
  }
}

/**
 * Let email reach this address again.
 *
 * Deliberately does NOT touch marketing consent. An address that bounced and was corrected is
 * a delivery fact; whether the guest wants marketing is their decision and is recorded
 * separately. Clearing the block on a guest who has unsubscribed makes their booking
 * confirmations work again and leaves the unsubscribe standing, which is exactly right.
 */
export async function clearCustomerEmailBlock(customerId: string): Promise<ActionResult> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  const canManage = await checkUserPermission('customers', 'manage_contact_preferences', auth.user.id)

  const auditBase = {
    user_id: auth.user.id,
    ...(auth.user.email && { user_email: auth.user.email }),
    resource_type: 'customer_email_block',
    resource_id: customerId,
  } as const

  if (!canManage) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Insufficient permissions',
    })
    return { error: 'Insufficient permissions to update contact preferences' }
  }

  const admin = createAdminClient()
  const { data: customer, error: loadError } = await admin
    .from('customers')
    .select('email, email_status, email_deactivated_at')
    .eq('id', customerId)
    .maybeSingle()

  if (loadError || !customer) {
    return { error: loadError ? 'Could not read this customer' : 'Customer not found' }
  }

  const address = (customer.email ?? '').trim().toLowerCase()
  if (address) {
    const { error: deleteError } = await (admin.from('email_suppressions') as any)
      .delete()
      .eq('email', address)

    if (deleteError) {
      await logAuditEvent({
        ...auditBase,
        operation_type: 'update',
        operation_status: 'failure',
        error_message: deleteError.message,
      })
      return { error: 'Could not clear the suppression' }
    }
  }

  const { error: updateError } = await admin
    .from('customers')
    .update(emailAddressResetFields())
    .eq('id', customerId)

  if (updateError) {
    // The suppression row is already gone, so say so rather than implying nothing happened.
    // Leaving a half-cleared block unreported is how the two-table split bites.
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: updateError.message,
    })
    return { error: 'The suppression was cleared but the customer record could not be updated' }
  }

  await logAuditEvent({
    ...auditBase,
    operation_type: 'update',
    operation_status: 'success',
    old_values: {
      email_status: customer.email_status ?? null,
      email_deactivated_at: customer.email_deactivated_at ?? null,
    },
    new_values: emailAddressResetFields(),
  })

  revalidatePath(`/customers/${customerId}`)
  return { success: true }
}
