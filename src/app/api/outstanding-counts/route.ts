import { NextResponse } from 'next/server'
import { getOutstandingCounts } from '@/actions/get-outstanding-counts'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const counts = await getOutstandingCounts()
    return NextResponse.json({ success: true, data: counts })
  } catch (error) {
    console.error('Error fetching outstanding counts:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch outstanding counts' }, { status: 500 })
  }
}
