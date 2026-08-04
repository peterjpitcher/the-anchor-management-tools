'use server'

/**
 * Staff writes to a seasonal pre-order, from the booking detail page.
 *
 * Everything real happens in src/lib/table-bookings/preorder.ts, which is shared with the booker's
 * manage page so there is one completeness rule and one snapshotting rule. This file is the staff
 * gate around it: who is asking, whether they may, and whether the order is still open.
 *
 * The three pre-order tables are service-role only under RLS, so the reads and writes go through
 * the admin client. Permission is proven first, on the cookie client, before that client is made.
 *
 * It sits beside the screen rather than in src/app/actions/ so the import path does not have to
 * cross the `[id]` route segment, which no other import in this codebase does.
 */

import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  isPreorderEnabled,
  loadPreorderOrder,
  savePreorderCover,
  syncPreorderCovers,
  type PreorderCoverSyncResult,
  type PreorderSelectionInput,
} from '@/lib/table-bookings/preorder'
import { getPreorderCutoff } from './cutoff'

/** `message` carries something the screen should say out loud, such as which seats were dropped. */
type ActionResult = { success?: boolean; error?: string; message?: string }

export type StaffPreorderCoverInput = {
  coverId: string
  guestName?: string | null
  dietaryNote?: string | null
  selections?: PreorderSelectionInput[]
}

const CLOSED_MESSAGE =
  'Pre-orders for this booking have closed. The kitchen has already ordered to these numbers, so ring the pub to change anything now.'

/**
 * Prove the caller may edit this booking's pre-order, and hand back everything the write needs.
 *
 * Returns a plain `{ error }` rather than throwing, because every caller turns it straight into
 * the action's return value.
 */
async function openEditableOrder(tableBookingId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' } as const

  const canEdit = await checkUserPermission('table_bookings', 'edit', user.id)
  if (!canEdit) return { error: 'You do not have permission to edit table bookings.' } as const

  const admin = createAdminClient()

  const order = await loadPreorderOrder(admin, tableBookingId)
  if (!order) return { error: 'That booking no longer exists.' } as const
  if (!order.requiresPreorder) {
    return { error: 'This booking is not on a seasonal menu, so there is nothing to pre-order.' } as const
  }

  if (!(await isPreorderEnabled(admin))) {
    return { error: 'Pre-orders are switched off at the moment. Take the order on paper.' } as const
  }

  const cutoff = getPreorderCutoff({
    bookingDate: order.bookingDate,
    preorderCutoffDays: order.preorderCutoffDays,
  })
  if (cutoff.closed) return { error: CLOSED_MESSAGE } as const

  return { user, admin, order } as const
}

/**
 * Save one or more seats in a single go.
 *
 * Staff take a whole table's order in one telephone call, so the screen sends every seat it has
 * changed together: one gate, one audit entry, one refresh.
 */
export async function saveSeasonalPreorderCovers(
  tableBookingId: string,
  covers: StaffPreorderCoverInput[],
): Promise<ActionResult> {
  try {
    const gate = await openEditableOrder(tableBookingId)
    if ('error' in gate) return { error: gate.error }
    if (covers.length === 0) return { success: true }

    // A cover id is a client-supplied uuid, and the pre-order tables are keyed on the cover, not
    // the booking. Without this check a staff member with access to one booking could write a seat
    // belonging to another.
    const ordinalByCoverId = new Map(gate.order.covers.map((cover) => [cover.id, cover.ordinal]))
    if (covers.some((cover) => !ordinalByCoverId.has(cover.coverId))) {
      return { error: 'That seat is not on this booking. Refresh the page and try again.' }
    }

    for (const cover of covers) {
      await savePreorderCover(gate.admin, cover)
    }

    await logAuditEvent({
      user_id: gate.user.id,
      user_email: gate.user.email ?? undefined,
      operation_type: 'update',
      resource_type: 'table_booking_preorder',
      resource_id: tableBookingId,
      operation_status: 'success',
      // Seat numbers only. A dietary note can amount to health information and must never reach
      // the audit log, an email or a manager digest (spec section 8).
      additional_info: {
        booking_reference: gate.order.bookingReference,
        seats_saved: covers.map((cover) => ordinalByCoverId.get(cover.coverId)).filter(Boolean),
      },
    })

    revalidatePath(`/table-bookings/${tableBookingId}`)
    return { success: true }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not save the pre-order.',
    }
  }
}

/**
 * Bring the seat rows in line with the party size.
 *
 * Used to start a pre-order that has no seats yet, and to repair a booking whose party size moved
 * before every amendment path learned to call the sync. Removing drops the highest seat numbers,
 * so the caller is told which choices went with them.
 */
export async function syncSeasonalPreorderCovers(tableBookingId: string): Promise<ActionResult> {
  try {
    const gate = await openEditableOrder(tableBookingId)
    if ('error' in gate) return { error: gate.error }

    const result = await syncPreorderCovers(gate.admin, tableBookingId)

    await logAuditEvent({
      user_id: gate.user.id,
      user_email: gate.user.email ?? undefined,
      operation_type: 'update',
      resource_type: 'table_booking_preorder',
      resource_id: tableBookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: gate.order.bookingReference,
        party_size: result.partySize,
        cover_count: result.coverCount,
        seats_added: result.added,
        seats_removed: result.removed.map((cover) => cover.ordinal),
      },
    })

    revalidatePath(`/table-bookings/${tableBookingId}`)
    return { success: true, message: describeSyncResult(result) }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not set up the pre-order seats.',
    }
  }
}

/**
 * What just happened, in a sentence staff can read out. Dropped choices are named because the
 * guest paid attention to them and will ask.
 */
function describeSyncResult(result: PreorderCoverSyncResult): string {
  const parts: string[] = []
  if (result.added > 0) parts.push(`${result.added} seat${result.added === 1 ? '' : 's'} added`)

  for (const cover of result.removed) {
    const dishes = cover.courses.map((entry) => entry.itemName).join(', ')
    parts.push(`seat ${cover.ordinal} removed${dishes ? ` (was having ${dishes})` : ''}`)
  }

  if (parts.length === 0) return 'The seats already matched the party size.'
  return `${parts.join(', ')}.`
}
