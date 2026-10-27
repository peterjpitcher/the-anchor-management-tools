import { NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import type { DepositRefundTerms } from './refunds'
import { parseStaffCancellation, STAFF_CANCELLATION_REASON, type StaffCancellationChoice } from './staff-cancellation'

/**
 * Reads who is cancelling from a staff cancel request, and checks that only a manager chooses the
 * refund amount (BK-046, owner decision D7). Refund authority follows the deposit waiver's rule
 * from release 9: checkUserPermission('table_bookings', 'manage'), never a role name.
 *
 * Shared by the FOH cancel route, the BOH status route and the BOH soft delete.
 */
export async function resolveStaffCancellation(
  body: unknown,
  userId: string
): Promise<
  | {
      ok: true
      choice: StaffCancellationChoice
      terms: DepositRefundTerms
      cancellationReason: string
    }
  | { ok: false; response: NextResponse }
> {
  const parsed = parseStaffCancellation(body)
  if (!parsed.ok) {
    return { ok: false, response: NextResponse.json({ error: parsed.error }, { status: 400 }) }
  }

  const { choice } = parsed
  if (choice.refundAmountGbp !== null) {
    const canChoose = await checkUserPermission('table_bookings', 'manage', userId)
    if (!canChoose) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Only a manager can choose the refund amount.' }, { status: 403 }),
      }
    }
  }

  return {
    ok: true,
    choice,
    terms: { cancelledBy: choice.cancelledBy, managerAmountGbp: choice.refundAmountGbp },
    cancellationReason: STAFF_CANCELLATION_REASON[choice.cancelledBy],
  }
}

/** What the audit row records about the choice. */
export function staffCancellationAuditInfo(choice: StaffCancellationChoice): Record<string, unknown> {
  return {
    cancelled_by: choice.cancelledBy,
    cancelled_by_given: choice.choiceGiven,
    manager_refund_gbp: choice.refundAmountGbp,
  }
}
