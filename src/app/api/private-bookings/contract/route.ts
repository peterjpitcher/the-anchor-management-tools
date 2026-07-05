import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateContractDocument } from '@/lib/private-bookings/contract-lifecycle'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bookingId = searchParams.get('bookingId')

  if (!bookingId) {
    return new NextResponse('Booking ID required', { status: 400 })
  }

  const supabase = await createClient()

  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Check permissions using the application-standard helper (not direct RPC)
  const hasPermission = await checkUserPermission('private_bookings', 'generate_contracts')
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  // Shared generation path: mints an atomic version, audits, renders, and
  // stores an immutable snapshot (SOP §28 document generation).
  try {
    const { html } = await generateContractDocument(bookingId, {
      performedBy: user.id,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
    })

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="contract-${bookingId.slice(0, 8)}.html"`,
      },
    })
  } catch (generationError) {
    logger.error('Contract generation failed', {
      error: generationError instanceof Error ? generationError : new Error(String(generationError)),
      metadata: { bookingId },
    })
    const message = generationError instanceof Error ? generationError.message : 'Failed to generate contract'
    const status = message === 'Booking not found' ? 404 : 500
    return new NextResponse(message, { status })
  }
}
