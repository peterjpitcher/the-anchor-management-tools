import { notFound, redirect } from 'next/navigation'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { PageLayout } from '@/ds'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import BookingDetailClient, { type Booking } from './BookingDetailClient'

interface Props {
  params: Promise<{ id: string }>
}

export default async function BookingDetailPage({ params }: Props) {
  const { id } = await params

  const [canView, canEdit, canManage, canRefund, permissionsResult] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('table_bookings', 'manage'),
    checkUserPermission('table_bookings', 'refund'),
    getUserPermissions(),
  ])

  if (!canView) redirect('/unauthorized')
  if (permissionsResult.success && permissionsResult.data && isFohOnlyUser(permissionsResult.data)) {
    redirect('/table-bookings/foh')
  }

  const supabase = await createClient()
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select(`
      id, booking_reference, booking_date, booking_time, party_size,
      created_at, updated_at, committed_party_size, source, internal_notes,
      booking_type, booking_purpose, status, special_requirements,
      dietary_requirements, allergies, celebration_type,
      seated_at, left_at, no_show_at, no_show_marked_at, confirmed_at, cancelled_at, completed_at,
      start_datetime, end_datetime, duration_minutes,
      deposit_waived, hold_expires_at, reminder_sent, review_sms_sent_at, review_clicked_at,
      sunday_preorder_completed_at, sunday_preorder_cutoff_at, cancellation_reason,
      payment_status, payment_method, paypal_deposit_capture_id, deposit_amount, deposit_amount_locked, card_capture_completed_at,
      customer:customers!table_bookings_customer_id_fkey(
        id, first_name, last_name, mobile_number
      ),
      table_booking_tables:booking_table_assignments(
        id, start_datetime, end_datetime,
        table:tables!booking_table_assignments_table_id_fkey(
          id, name, table_number, capacity
        )
      ),
      audit_trail:booking_audit(
        id, event, old_status, new_status, meta, created_at, created_by
      )
    `)
    .order('created_at', { ascending: false, foreignTable: 'booking_audit' })
    .eq('id', id)
    .single()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error loading booking:', error)
    }
    notFound()
  }
  if (!booking) notFound()

  const rawBooking = booking as any

  // Supabase infers nested joins as arrays; normalise to scalar before passing to the client component
  const customer = Array.isArray(rawBooking.customer) ? (rawBooking.customer[0] ?? null) : rawBooking.customer
  const tableAssignments = Array.isArray(rawBooking.table_booking_tables)
    ? rawBooking.table_booking_tables.map((assignment: any) => {
        const table = Array.isArray(assignment.table) ? (assignment.table[0] ?? null) : assignment.table
        return {
          ...assignment,
          table: table ?? null,
        }
      })
    : []
  const auditTrail = Array.isArray(rawBooking.audit_trail)
    ? rawBooking.audit_trail.slice().sort((a: { created_at?: string }, b: { created_at?: string }) =>
        new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime()
      )
    : []
  const normalizedBooking: Booking = {
    ...rawBooking,
    customer: customer ?? null,
    table_booking_tables: tableAssignments,
    audit_trail: auditTrail,
  } as unknown as Booking

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
        booking={normalizedBooking}
        canEdit={canEdit}
        canManage={canManage}
        canRefund={canRefund || canManage}
      />
    </PageLayout>
  )
}
