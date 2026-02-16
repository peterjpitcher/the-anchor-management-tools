import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logger } from '@/lib/logger'

export async function GET() {
  try {
    const canViewMessages = await checkUserPermission('messages', 'view')
    if (!canViewMessages) {
      return NextResponse.json({ badge: 0 })
    }

    const supabase = await createClient()
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('direction', 'inbound')
      .is('read_at', null)

    if (error) {
      logger.error('Error fetching unread message count', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return NextResponse.json({ badge: 0 }, { status: 500 })
    }

    return NextResponse.json({ badge: count ?? 0 })
  } catch (error) {
    logger.error('Unexpected error fetching unread message count', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ badge: 0 }, { status: 500 })
  }
}
