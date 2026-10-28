'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { describeMergeBlock, type MergeCustomersOutcome } from '@/lib/customers/merge-summary'

/**
 * Merge a duplicate customer into the record being kept (BK-164, customer bookings review of 24
 * October 2026).
 *
 * Everything that points at the duplicate moves to the kept record in one database transaction
 * (merge_customers), consent keeps the most restrictive state, and the duplicate is anonymised,
 * never deleted. Managers and super admins only: it needs customers delete, because the duplicate
 * stops existing as a person. The function itself is service-role only, so this action is the one
 * way in.
 */

const mergeInputSchema = z.object({
  mergeId: z.string().uuid(),
  keepId: z.string().uuid(),
})

type MergeActionResult = {
  success?: boolean
  error?: string
  data?: Extract<MergeCustomersOutcome, { state: 'merged' }>
}

async function authorise(): Promise<{ userId: string; email?: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized' }

  const canMerge = await checkUserPermission('customers', 'delete', user.id)
  if (!canMerge) return { error: 'Insufficient permissions' }

  return { userId: user.id, email: user.email ?? undefined }
}

async function runMerge(input: { mergeId: string; keepId: string }, dryRun: boolean): Promise<MergeActionResult> {
  const parsed = mergeInputSchema.safeParse(input)
  if (!parsed.success) return { error: 'Choose a customer to merge into.' }
  const { mergeId, keepId } = parsed.data

  const caller = await authorise()
  if ('error' in caller) return { error: caller.error }

  const { data, error } = await createAdminClient().rpc('merge_customers', {
    p_keep_id: keepId,
    p_merge_id: mergeId,
    p_dry_run: dryRun,
  })

  if (error) {
    console.error('Customer merge failed:', { code: error.code ?? null, message: error.message, dryRun })
    return { error: dryRun ? 'Could not work out what the merge would move. Try again.' : 'The merge did not go through, and nothing was changed. Try again.' }
  }

  const outcome = data as unknown as MergeCustomersOutcome | null
  if (!outcome || typeof outcome !== 'object') {
    return { error: 'The merge did not go through, and nothing was changed. Try again.' }
  }
  if (outcome.state === 'blocked') {
    return { error: describeMergeBlock(outcome.reason) }
  }

  if (!dryRun) {
    await logAuditEvent({
      user_id: caller.userId,
      user_email: caller.email,
      operation_type: 'merge',
      resource_type: 'customer',
      resource_id: keepId,
      operation_status: 'success',
      // Ids and counts only: no name, phone or email goes into the log.
      additional_info: {
        merged_customer_id: mergeId,
        kept_customer_id: keepId,
        moved: outcome.moved,
        duplicates_dropped: outcome.duplicates_dropped,
        left_behind: outcome.left_behind,
        email_moved: outcome.email_moved,
      },
    })

    revalidatePath('/customers')
    revalidatePath(`/customers/${keepId}`)
    revalidatePath(`/customers/${mergeId}`)
    revalidateTag('dashboard')
  }

  return { success: true, data: outcome }
}

/** What a merge would move, worked out by running it and rolling it back. Changes nothing. */
export async function previewCustomerMerge(mergeId: string, keepId: string): Promise<MergeActionResult> {
  return runMerge({ mergeId, keepId }, true)
}

/** Merge `mergeId` into `keepId`. The kept record keeps its name and phone. */
export async function mergeCustomers(mergeId: string, keepId: string): Promise<MergeActionResult> {
  return runMerge({ mergeId, keepId }, false)
}
