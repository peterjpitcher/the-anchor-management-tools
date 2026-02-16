import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateContractHTML } from '@/lib/contract-template'

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

  // Check permissions
  const { data: hasPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'generate_contracts'
  })

  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  // Fetch booking with all details
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
      )
    `)
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return new NextResponse('Booking not found', { status: 404 })
  }

  // Generate HTML contract with company details
  const html = generateContractHTML({
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
  
  // Log contract generation
  const { error: auditError } = await supabase.from('private_booking_audit').insert({
    booking_id: bookingId,
    action: 'contract_generated',
    performed_by: user.id,
    metadata: { 
      contract_version: booking.contract_version + 1,
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
    }
  })

  if (auditError) {
    console.error('Failed to persist contract generation audit event', auditError)
    return new NextResponse('Failed to generate contract', { status: 500 })
  }

  // Update contract version
  const { data: updatedBooking, error: updateError } = await supabase
    .from('private_bookings')
    .update({ contract_version: booking.contract_version + 1 })
    .eq('id', bookingId)
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('Failed to persist contract version update', updateError)
    return new NextResponse('Failed to generate contract', { status: 500 })
  }

  if (!updatedBooking) {
    return new NextResponse('Booking not found', { status: 404 })
  }

  // Return HTML with print-friendly headers
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Disposition': `inline; filename="contract-${booking.id.slice(0,8)}.html"`,
    },
  })
}
