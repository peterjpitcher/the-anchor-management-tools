import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import BookingDetailClient from './BookingDetailClient'

interface Props {
  params: Promise<{ id: string }>
}

export default async function BookingDetailPage({ params }: Props) {
  const { id } = await params

  const [canView, canEdit, canManage] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('table_bookings', 'manage'),
  ])

  if (!canView) redirect('/unauthorized')

  const supabase = await createClient()
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select(`
      id, booking_reference, booking_date, booking_time, party_size,
      booking_type, booking_purpose, status, special_requirements,
      dietary_requirements, allergies, celebration_type,
      seated_at, left_at, no_show_at, confirmed_at, cancelled_at,
      start_datetime, end_datetime, duration_minutes,
      sunday_preorder_cutoff_at, sunday_preorder_completed_at,
      deposit_waived,
      customer:customers!table_bookings_customer_id_fkey(
        id, first_name, last_name, mobile_number
      ),
      table_booking_tables(
        table:venue_tables(id, name, table_number, capacity)
      )
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error loading booking:', error)
    }
    notFound()
  }
  if (!booking) notFound()

  // Supabase returns joins as arrays; normalise to a single object
  const customer = Array.isArray(booking.customer) ? booking.customer[0] : booking.customer
  const guestName = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(' ')
  const title = guestName || booking.booking_reference || 'Booking'

  return (
    <PageLayout
      title={title}
      subtitle={`${booking.booking_reference ?? ''} · ${booking.booking_date} · ${booking.booking_time ?? ''}`}
      backButton={{ label: 'Back to BOH', href: '/table-bookings/boh' }}
    >
      <BookingDetailClient
        booking={booking}
        canEdit={canEdit}
        canManage={canManage}
      />
    </PageLayout>
  )
}
