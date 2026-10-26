import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The same limits as the BOH booking edit and the public booking API, so every path stores the
 * same shape. The allergy list comes split already (parseAllergyList on the screen).
 */
const UpdateNotesSchema = z.object({
  notes: z.string().trim().max(2000).nullable(),
  allergies: z.array(z.string().trim().min(1).max(100)).max(20),
})

/**
 * Change a booking's notes and allergies from the FOH screen (BK-052).
 *
 * Front of house is where a guest says "I should have mentioned, I'm allergic to nuts", and until
 * now the only place to record it was the back-office booking page, which FOH-only staff cannot
 * open. The audit row says which fields changed, never what they say: this is health information.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) return auth.response

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateNotesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid notes' }, { status: 400 })
  }

  const notes = parsed.data.notes && parsed.data.notes.length > 0 ? parsed.data.notes : null
  const allergies = parsed.data.allergies

  const { data: updated, error } = await auth.supabase
    .from('table_bookings')
    .update({ special_requirements: notes, allergies, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, special_requirements, allergies')
    .maybeSingle()

  if (error) {
    logger.error('FOH notes and allergies update failed', {
      error: new Error(error.message),
      metadata: { tableBookingId: id },
    })
    return NextResponse.json({ error: 'The notes could not be saved. Please try again.' }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: {
      source: 'foh',
      fields: ['special_requirements', 'allergies'],
      allergy_count: allergies.length,
      has_notes: Boolean(notes),
    },
  }).catch(() => {})

  return NextResponse.json({ success: true, booking: updated })
}
