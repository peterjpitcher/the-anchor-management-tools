import BookingConfirmationClient, {
  PendingBookingWithEvent,
} from './BookingConfirmationClient'
import { createAdminClient } from '@/lib/supabase/admin'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function BookingConfirmationPage({ params }: PageProps) {
  const { token } = await params
  const supabase = createAdminClient()

  let error: string | null = null
  let pending: PendingBookingWithEvent | null = null

  if (!token) {
    error = 'Invalid or expired booking link'
  } else {
    const { data, error: fetchError } = await supabase
      .from('pending_bookings')
      .select(
        `
          id,
          token,
          event_id,
          mobile_number,
          customer_id,
          expires_at,
          confirmed_at,
          booking_id,
          metadata,
          event:events(
            id,
            name,
            date,
            time,
            capacity,
            hero_image_url,
            thumbnail_image_url
          ),
          customer:customers(
            id,
            first_name,
            last_name
          )
        `
      )
      .eq('token', token)
      .maybeSingle()

    if (fetchError) {
      console.error('Failed to load pending booking:', fetchError)
      error = 'Failed to load booking details'
    } else if (!data) {
      error = 'Invalid or expired booking link'
    } else if (data.confirmed_at) {
      error = 'This booking has already been confirmed'
    } else if (new Date(data.expires_at) < new Date()) {
      error = 'This booking link has expired'
    } else {
      const eventRecord = Array.isArray(data.event) ? data.event[0] : data.event
      const customerRecord = Array.isArray(data.customer) ? data.customer[0] : data.customer

      if (!eventRecord) {
        error = 'Event details unavailable for this booking'
      } else {
        pending = {
          id: data.id,
          token: data.token,
          event_id: data.event_id,
          mobile_number: data.mobile_number,
          customer_id: data.customer_id,
          expires_at: data.expires_at,
          confirmed_at: data.confirmed_at,
          event: {
            id: eventRecord.id,
            name: eventRecord.name,
            date: eventRecord.date,
            time: eventRecord.time,
            capacity: eventRecord.capacity,
            hero_image_url: eventRecord.hero_image_url ?? null,
            thumbnail_image_url: eventRecord.thumbnail_image_url ?? null,
          },
          customer: customerRecord
            ? {
                id: customerRecord.id,
                first_name: customerRecord.first_name,
                last_name: customerRecord.last_name,
              }
            : null,
        }
      }
    }
  }

  return (
    <BookingConfirmationClient
      token={token}
      initialPendingBooking={pending}
      initialError={error}
    />
  )
}
