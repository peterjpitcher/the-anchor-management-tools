import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logger } from '@/lib/logger'

// This endpoint only drives a UI notification badge. The awaited auth + count
// calls have no client-side timeout, so a transient upstream (GoTrue/Postgres)
// stall would otherwise hang to the platform's 15s wall and 504. Cap the work
// and degrade to a 0 badge instead of failing the request.
export const maxDuration = 10

const TIMEOUT_MS = 6000

async function buildResponse(): Promise<Response> {
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
}

export async function GET() {
  try {
    return await Promise.race([
      buildResponse(),
      new Promise<Response>((resolve) =>
        setTimeout(() => {
          logger.warn('Unread message count timed out; returning 0 badge')
          resolve(NextResponse.json({ badge: 0 }))
        }, TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    logger.error('Unexpected error fetching unread message count', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ badge: 0 }, { status: 500 })
  }
}
