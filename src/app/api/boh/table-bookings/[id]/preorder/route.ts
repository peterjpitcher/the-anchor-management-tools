import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import {
  getSundayPreorderPageDataByBookingId,
  saveSundayPreorderByBookingId,
} from '@/lib/table-bookings/sunday-preorder'
import type { SundayPreorderSaveInputItem } from '@/lib/table-bookings/sunday-preorder'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireFohPermission('view')
  if (!auth.ok) return auth.response

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  const data = await getSundayPreorderPageDataByBookingId(auth.supabase, id)
  return NextResponse.json(data)
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) return auth.response

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as Record<string, unknown>).items)
  ) {
    return NextResponse.json({ error: 'Request body must contain an items array' }, { status: 400 })
  }

  const items = (body as { items: SundayPreorderSaveInputItem[] }).items

  const result = await saveSundayPreorderByBookingId(auth.supabase, { bookingId: id, items })

  if (result.state === 'blocked') {
    return NextResponse.json({ error: result.reason ?? 'Save blocked' }, { status: 422 })
  }

  return NextResponse.json({ success: true, item_count: result.item_count })
}
