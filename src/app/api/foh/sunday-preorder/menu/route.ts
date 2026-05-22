import { NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'

export async function GET() {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Sunday lunch pre-orders are no longer required',
      code: 'SUNDAY_PREORDERS_RETIRED',
    },
    { status: 410 }
  )
}
