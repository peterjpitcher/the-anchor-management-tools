import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateEventSheetHTML, type EventSheetData } from '@/lib/private-bookings/event-sheet'
import { logger } from '@/lib/logger'

/**
 * Staff event sheet (SOP §29): renders the internal run sheet for a booking.
 * Mirrors the contract route's auth pattern; requires private_bookings:view.
 * First generation moves event_sheet_status from not_generated → generated
 * and the generation is recorded in the booking's audit trail.
 */

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

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

  // Check permissions using the application-standard helper
  const hasPermission = await checkUserPermission('private_bookings', 'view')
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  try {
    const admin = createAdminClient()

    const [bookingResult, suppliersResult] = await Promise.all([
      admin
        .from('private_bookings')
        .select(`
          *,
          items:private_booking_items(
            *,
            space:venue_spaces(*),
            package:catering_packages(*),
            vendor:vendors(*)
          )
        `)
        .eq('id', bookingId)
        .single(),
      admin
        .from('private_booking_suppliers')
        .select('*')
        .eq('booking_id', bookingId)
        .order('arrival_time', { ascending: true, nullsFirst: false }),
    ])

    if (bookingResult.error || !bookingResult.data) {
      return new NextResponse('Booking not found', { status: 404 })
    }
    if (suppliersResult.error) {
      throw new Error(suppliersResult.error.message)
    }

    const booking = bookingResult.data
    const suppliers = suppliersResult.data ?? []
    const items = (booking.items ?? []) as Array<Record<string, any>>

    const hostName =
      (booking.customer_full_name as string | null) ||
      (booking.customer_name as string | null) ||
      [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ') ||
      null

    // §29: allergy/dietary and special requirements are the only sensitive
    // notes staff need — combined here, marked need-to-know on the sheet.
    const dietaryNotes =
      [booking.special_requirements, booking.customer_requests]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
        .join('\n') || null

    const data: EventSheetData = {
      bookingId: booking.id as string,
      bookingStatus: (booking.status as string) ?? 'draft',
      hostName,
      contactPhone: (booking.contact_phone as string | null) ?? null,
      eventType: (booking.event_type as string | null) ?? null,
      eventDate: booking.event_date as string,
      startTime: (booking.start_time as string | null) ?? null,
      endTime: (booking.end_time as string | null) ?? null,
      endTimeNextDay: Boolean(booking.end_time_next_day),
      setupDate: (booking.setup_date as string | null) ?? null,
      setupTime: (booking.setup_time as string | null) ?? null,
      cleardownTime: (booking.cleardown_time as string | null) ?? null,
      guestCount: toNumberOrNull(booking.guest_count),
      guestCountAdults: toNumberOrNull(booking.guest_count_adults),
      guestCountUnder18: toNumberOrNull(booking.guest_count_under_18),
      layout: (booking.layout as string | null) ?? null,
      items: items.map((item) => ({
        itemType: (item.item_type as string) ?? 'other',
        description: (item.description as string) ?? '',
        quantity: toNumberOrNull(item.quantity) ?? 1,
        spaceName: (item.space?.name as string | null) ?? null,
        packageName: (item.package?.name as string | null) ?? null,
        vendorName: (item.vendor?.name as string | null) ?? null,
      })),
      barTabRequired: Boolean(booking.bar_tab_required),
      barTabLimit: toNumberOrNull(booking.bar_tab_limit),
      barTabPrepaidAmount: toNumberOrNull(booking.bar_tab_prepaid_amount),
      barTabPreauthReference: (booking.bar_tab_preauth_reference as string | null) ?? null,
      accessibilityNotes: (booking.accessibility_needs as string | null) ?? null,
      dietaryNotes,
      outsideFood: Boolean(booking.outside_food),
      waiverStatus: (booking.waiver_status as string) ?? 'not_required',
      supplierStatus: (booking.supplier_status as string) ?? 'not_applicable',
      suppliers: suppliers.map((supplier: Record<string, any>) => ({
        name: (supplier.name as string) ?? '',
        supplierType: (supplier.supplier_type as string | null) ?? null,
        contactDetails: (supplier.contact_details as string | null) ?? null,
        arrivalTime: (supplier.arrival_time as string | null) ?? null,
        departureTime: (supplier.departure_time as string | null) ?? null,
        vehicleNotes: (supplier.vehicle_notes as string | null) ?? null,
        powerRequirements: (supplier.power_requirements as string | null) ?? null,
        documentsRequired: (supplier.documents_required as string[]) ?? [],
        documentsReceived: (supplier.documents_received as string[]) ?? [],
        status: (supplier.status as string) ?? 'requested',
      })),
      highPowerEquipment: Boolean(booking.high_power_equipment),
      highPowerEquipmentApprovedAt: (booking.high_power_equipment_approved_at as string | null) ?? null,
      decorationsPlan: (booking.decorations_plan as string | null) ?? null,
      dogsExpected: Boolean(booking.dogs_expected),
      riskStatus: (booking.risk_status as string) ?? 'normal',
      specialRiskNotes: (booking.special_risk_notes as string | null) ?? null,
    }

    const html = generateEventSheetHTML(data)

    // First generation only: not_generated → generated (later states such as
    // sent_to_staff / locked are managed elsewhere and never regress here).
    const { error: statusError } = await admin
      .from('private_bookings')
      .update({ event_sheet_status: 'generated' })
      .eq('id', bookingId)
      .eq('event_sheet_status', 'not_generated')
    if (statusError) {
      logger.error('Failed to update event sheet status', {
        error: new Error(statusError.message),
        metadata: { bookingId },
      })
    }

    const { error: auditError } = await admin.from('private_booking_audit').insert({
      booking_id: bookingId,
      action: 'event_sheet_generated',
      performed_by: user.id,
      metadata: {
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      },
    })
    if (auditError) {
      logger.error('Failed to audit event sheet generation', {
        error: new Error(auditError.message),
        metadata: { bookingId },
      })
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="event-sheet-${bookingId.slice(0, 8)}.html"`,
      },
    })
  } catch (generationError) {
    logger.error('Event sheet generation failed', {
      error: generationError instanceof Error ? generationError : new Error(String(generationError)),
      metadata: { bookingId },
    })
    const message = generationError instanceof Error ? generationError.message : 'Failed to generate event sheet'
    return new NextResponse(message, { status: 500 })
  }
}
