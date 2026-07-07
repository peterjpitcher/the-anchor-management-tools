import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateContractDocument } from '@/lib/private-bookings/contract-lifecycle'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bookingId = searchParams.get('bookingId')
  // `format=pdf` returns a server-rendered PDF instead of HTML. This is immune to
  // the viewer's browser print settings (e.g. a minimum font size, which inflates
  // the contract's fine print and makes content overflow the footer). Staff should
  // download the PDF rather than use the browser's Print button.
  const wantsPdf = searchParams.get('format') === 'pdf'

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

    if (wantsPdf) {
      // Same settings as the emailed contract PDF (contract CSS owns the A4 page
      // via @page{ size:A4; margin:0 }). Rendered server-side with no minimum
      // font size, so the layout is exactly as designed regardless of the viewer.
      const { generatePDFFromHTML } = await import('@/lib/pdf-generator')
      const pdf = await generatePDFFromHTML(html, {
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      })
      return new NextResponse(pdf as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="The-Anchor-contract-${bookingId.slice(0, 8)}.pdf"`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }

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
