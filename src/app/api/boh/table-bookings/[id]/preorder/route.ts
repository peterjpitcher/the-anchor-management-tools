import { NextRequest, NextResponse } from 'next/server'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'

const RETIRED_PREORDER_PAYLOAD = {
  success: false,
  error: 'Sunday lunch pre-orders are no longer required',
  code: 'SUNDAY_PREORDERS_RETIRED',
}

export async function GET(
  _req: NextRequest,
  _context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireBohTableBookingPermission('view')
  if (!auth.ok) return auth.response

  return NextResponse.json(RETIRED_PREORDER_PAYLOAD, { status: 410 })
}

export async function POST(
  _req: NextRequest,
  _context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireBohTableBookingPermission('manage')
  if (!auth.ok) return auth.response

  return NextResponse.json(RETIRED_PREORDER_PAYLOAD, { status: 410 })
}
