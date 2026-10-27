import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireBohTableBookingPermission, requireFohPermission } from '@/lib/foh/api-auth'
import { runStaffDepositAction, StaffDepositActionSchema } from '@/lib/table-bookings/staff-deposit-actions'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The FOH iPad (api/foh/bookings/[id]/deposit) and the booking page
 * (api/boh/table-bookings/[id]/deposit) both run this, as the party-size change does, so the two
 * screens cannot drift. Waiving, recording a deposit taken at the bar and giving the guest longer
 * all need table_bookings manage (owner decision D18, BK-045): the same permission release 9 put on
 * the deposit waiver at booking time.
 */
export async function handleStaffDepositAction(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  surface: 'foh' | 'boh'
): Promise<NextResponse> {
  const auth = surface === 'foh'
    ? await requireFohPermission('manage')
    : await requireBohTableBookingPermission('manage')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = StaffDepositActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid deposit action', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const result = await runStaffDepositAction(auth.supabase, {
    bookingId: id,
    userId: auth.userId,
    request: parsed.data,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  revalidatePath(`/table-bookings/${id}`)
  return NextResponse.json({ success: true, message: result.message, warning: result.warning ?? null })
}
