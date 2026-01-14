import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function BookingConfirmationPage({ params }: PageProps) {
  const { token } = await params
  const brandFallbackUrl = 'https://www.the-anchor.pub/whats-on'

  if (!token) {
    redirect(brandFallbackUrl)
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('pending_bookings')
    .select(
      `
        event:events(
          slug,
          booking_url
        )
      `
    )
    .eq('token', token)
    .maybeSingle()

  if (error || !data) {
    redirect(brandFallbackUrl)
  }

  const eventRecord = Array.isArray(data.event) ? data.event[0] : data.event

  const bookingUrl =
    typeof eventRecord?.booking_url === 'string' && eventRecord.booking_url.trim().length > 0
      ? eventRecord.booking_url.trim()
      : null

  if (bookingUrl) {
    try {
      const parsed = new URL(bookingUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        redirect(bookingUrl)
      }
    } catch {
      // Fall back to the event page
    }
  }

  const slug =
    typeof eventRecord?.slug === 'string' && eventRecord.slug.trim().length > 0
      ? eventRecord.slug.trim()
      : null

  redirect(slug ? `https://www.the-anchor.pub/events/${slug}` : brandFallbackUrl)
}
