import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireFohPermission('view')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid booking' }, { status: 400 })
  const { data, error } = await auth.supabase.from('table_bookings').select('*').eq('id', id).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Could not load course choices' }, { status: 404 })
  return NextResponse.json({ course_counts: data.christmas_course_counts ?? null })
}
