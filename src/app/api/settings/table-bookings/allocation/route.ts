import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'
import { logger } from '@/lib/logger'

/**
 * Table-booking allocation settings.
 *
 * Every value that decides how tables are handed out lives here, so the seating order, the turn
 * times, the holds and the customer wording can all be changed without a developer.
 *
 * Validation is NOT done in this route. It lives in the database, in
 * `validate_table_booking_settings`, because a manager saving a decimal into an integer setting
 * once took every booking in the pub down until the row was repaired by hand. A rule that only
 * exists in a form is a rule anyone can walk around.
 *
 * Concurrency is per section, using a revision counter rather than per-key timestamps: a section is
 * several rows, and one stale tab must not be able to overwrite half of someone else's change.
 */

const SectionSchema = z.enum([
  'tables', 'turn_times', 'kitchen_pacing', 'outside',
  'drinks', 'party_limits', 'holds', 'messages',
])

const SaveSchema = z.object({
  section: SectionSchema,
  // Shape is checked in the database, which is the only place that can be authoritative.
  payload: z.record(z.unknown()),
  expected_revision: z.coerce.number().int().nonnegative(),
})

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  try {
    const { data, error } = await auth.supabase.rpc('get_table_booking_settings')
    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (error) {
    logger.error('Failed to load table-booking allocation settings', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Failed to load allocation settings' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SaveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  try {
    // The actor is passed from here, after the permission check above, rather than being
    // taken from the request. The audit row is written inside the same transaction as the
    // settings change, so a change can never end up unattributed.
    const { data, error } = await auth.supabase.rpc('set_table_booking_settings', {
      p_section: parsed.data.section,
      p_payload: parsed.data.payload,
      p_expected_revision: parsed.data.expected_revision,
      p_actor_id: auth.userId,
    })

    if (error) throw error

    const result = (data ?? {}) as { ok?: boolean; error?: string; revision?: number; current_revision?: number }

    if (!result.ok) {
      // A stale revision is a conflict, not a validation failure: the caller should reload
      // and try again rather than correct their input.
      const isConflict = typeof result.current_revision === 'number'
      return NextResponse.json(
        { error: result.error || 'Could not save settings', current_revision: result.current_revision },
        { status: isConflict ? 409 : 400 }
      )
    }

    return NextResponse.json({ success: true, revision: result.revision })
  } catch (error) {
    logger.error('Failed to save table-booking allocation settings', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { section: parsed.data.section },
    })
    return NextResponse.json({ error: 'Failed to save allocation settings' }, { status: 500 })
  }
}
