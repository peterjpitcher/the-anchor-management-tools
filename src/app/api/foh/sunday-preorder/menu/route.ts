import { NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getSundayLunchMenuItems } from '@/lib/table-bookings/sunday-preorder'

export async function GET() {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  try {
    const items = await getSundayLunchMenuItems(auth.supabase)
    return NextResponse.json({
      success: true,
      data: items
    })
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load Sunday lunch menu'
      },
      { status: 500 }
    )
  }
}
