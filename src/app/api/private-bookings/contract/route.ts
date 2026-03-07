import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateContractHTML } from '@/lib/contract-template'
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

  // Fetch booking with all details needed for the contract
  const { data: booking, error } = await supabase
    .from('private_bookings')
    .select(`
      *,
      customer:customers(*),
      items:private_booking_items(
        *,
        space:venue_spaces(*),
        package:catering_packages(*),
        vendor:vendors(*)
      ),
      payments:private_booking_payments(*)
    `)
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return new NextResponse('Booking not found', { status: 404 })
  }

  // Generate HTML — wrapped in try-catch so null/unexpected fields don't cause unhandled 500
  let html: string
  try {
    html = generateContractHTML({
      booking,
      logoUrl: '/logo-black.png',
      companyDetails: {
        name: 'Orange Jelly Limited, trading as The Anchor',
        registrationNumber: '10537179',
        vatNumber: 'GB315203647',
        address: 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ',
        phone: '01753 682 707',
        email: 'manager@the-anchor.pub'
      }
    })
  } catch (templateError) {
    logger.error('Contract template generation failed', {
      error: templateError instanceof Error ? templateError : new Error(String(templateError)),
      metadata: { bookingId }
    })
    return new NextResponse('Failed to generate contract', { status: 500 })
  }

  // Audit log + version increment — best-effort: failure does NOT block HTML delivery
  const newVersion = (booking.contract_version ?? 0) + 1
  try {
    const { error: auditError } = await supabase.from('private_booking_audit').insert({
      booking_id: bookingId,
      action: 'contract_generated',
      performed_by: user.id,
      metadata: {
        contract_version: newVersion,
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
      }
    })
    if (auditError) {
      logger.error('Contract audit log failed (non-blocking)', {
        error: auditError,
        metadata: { bookingId, newVersion }
      })
    }

    const { error: versionError } = await supabase
      .from('private_bookings')
      .update({ contract_version: newVersion })
      .eq('id', bookingId)
    if (versionError) {
      logger.error('Contract version update failed (non-blocking)', {
        error: versionError,
        metadata: { bookingId, newVersion }
      })
    }
  } catch (sideEffectError) {
    logger.error('Contract side-effects failed (non-blocking)', {
      error: sideEffectError instanceof Error ? sideEffectError : new Error(String(sideEffectError)),
      metadata: { bookingId }
    })
  }

  // Return HTML regardless of audit/version update outcome
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Disposition': `inline; filename="contract-${booking.id.slice(0, 8)}.html"`,
    },
  })
}
