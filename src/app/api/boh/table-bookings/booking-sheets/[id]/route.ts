import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { getAnchorLogoDataUri } from '@/lib/pdf/anchor-logo'
import { formatDateDdMmmmYyyy, formatTime12Hour, toLondonDateTimeLocalValue } from '@/lib/dateUtils'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadBookingSheetModel } from '@/lib/table-bookings/booking-sheet-load'
import { generateBookingOnePagerHTML } from '@/lib/table-booking-one-pager-template'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One booking's one-pager as a PDF, for the kitchen and managers (owner decision D14).
 *
 * The auth check is exactly the day booking-sheets route's: table_bookings view, and never the shared
 * front-of-house login, which may view the sheet on screen but not download or print it. The HTML is
 * the same template the screen view injects.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBohTableBookingPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return new NextResponse('Invalid booking id', { status: 400 })
  }

  try {
    // Service-role reads after the permission check above: the pre-order and refund tables are not
    // readable under RLS.
    const model = await loadBookingSheetModel(createAdminClient(), id)
    if (!model) {
      return new NextResponse('Booking not found', { status: 404 })
    }

    const now = new Date()
    const generatedAt = `${formatDateDdMmmmYyyy(now)} at ${formatTime12Hour(toLondonDateTimeLocalValue(now).slice(11))}`
    const html = generateBookingOnePagerHTML(model, { logoDataUrl: getAnchorLogoDataUri(), generatedAt })
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      displayHeaderFooter: false,
    })
    const pdfContent = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    ) as ArrayBuffer

    // Never log names or allergies: the booking id is enough to find it.
    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'export',
      resource_type: 'table_booking_sheet',
      resource_id: id,
      operation_status: 'success',
      additional_info: { seats: model.preorder?.seats.length ?? 0 },
    })

    const reference = model.header.reference === 'No reference' ? id : model.header.reference
    const filename = `booking-${reference.replace(/[^A-Za-z0-9-]/g, '')}.pdf`
    return new NextResponse(pdfContent, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, private, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Failed to generate the booking one-pager:', error instanceof Error ? error.message : error)
    return new NextResponse('Failed to generate the booking sheet', { status: 500 })
  }
}
