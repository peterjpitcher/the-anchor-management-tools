import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'

const SendBookingSmsSchema = z.object({
  message: z.string().trim().min(1).max(640)
})

function normalizeCustomer(customer: any): {
  id: string | null
  first_name: string | null
  mobile_number: string | null
  sms_status: string | null
} | null {
  if (!customer) return null

  const source = Array.isArray(customer) && customer.length > 0 ? customer[0] : customer
  if (!source || typeof source !== 'object') return null

  return {
    id: typeof source.id === 'string' ? source.id : null,
    first_name: typeof source.first_name === 'string' ? source.first_name : null,
    mobile_number: typeof source.mobile_number === 'string' ? source.mobile_number : null,
    sms_status: typeof source.sms_status === 'string' ? source.sms_status : null
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SendBookingSmsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid SMS payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const { data: booking, error: bookingError } = await (auth.supabase.from('table_bookings') as any)
    .select(
      'id, booking_reference, customer:customers!table_bookings_customer_id_fkey(id, first_name, mobile_number, sms_status)'
    )
    .eq('id', id)
    .maybeSingle()

  if (bookingError) {
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const customer = normalizeCustomer(booking.customer)

  if (!customer?.id || !customer.mobile_number) {
    return NextResponse.json({ error: 'Booking guest has no mobile number' }, { status: 409 })
  }

  if (customer.sms_status && customer.sms_status !== 'active') {
    return NextResponse.json(
      { error: `Guest SMS status is ${customer.sms_status}; message not sent` },
      { status: 409 }
    )
  }

  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const smsBody = ensureReplyInstruction(parsed.data.message, supportPhone)

  const smsResult = await sendSMS(customer.mobile_number, smsBody, {
    customerId: customer.id,
    metadata: {
      table_booking_id: booking.id,
      booking_reference: booking.booking_reference || null,
      source: 'boh_manual_booking_sms'
    }
  })

  if (!smsResult.success) {
    return NextResponse.json(
      { error: smsResult.error || 'Failed to send SMS' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      customer_id: customer.id,
      to: customer.mobile_number,
      sid: smsResult.sid || null,
      scheduled_for: smsResult.scheduledFor || null,
      status: smsResult.status || null
    }
  })
}
