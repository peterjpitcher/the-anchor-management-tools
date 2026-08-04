import { notFound, redirect } from 'next/navigation'
import { checkUserPermission, getUserPermissions } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageLayout } from '@/ds'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import {
  isPreorderEnabled,
  isPreorderSelectionCourse,
  loadPreorderOrder,
} from '@/lib/table-bookings/preorder'
import { getPreorderCutoff } from '@/components/features/table-bookings/preorder/cutoff'
import SeasonalPreorderSection, {
  type PreorderMenuOption,
} from '@/components/features/table-bookings/preorder/SeasonalPreorderSection'
import { PREORDER_SELECTION_COURSES } from '@/types/preorders'
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
      high_chair_count, is_outside_seating, requires_accessible_table, table_pinned,
      booking_period_id, booking_period_name, booking_period_answer, booking_period_requires_preorder,
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

  const { data: itemRows, error: itemsError } = await supabase
    .from('table_booking_items')
    .select(`
      id, custom_item_name, quantity, item_type, price_at_booking, special_requests,
      guest_name, menu_dish_id,
      menu_dish:menu_dishes!table_booking_items_menu_dish_id_fkey(id, name)
    `)
    .eq('booking_id', id)
    .order('created_at', { ascending: true })

  if (itemsError) {
    console.error('Error loading booking items:', itemsError)
  }

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
  const tableBookingItems = Array.isArray(itemRows)
    ? itemRows.map((item: any) => ({
        ...item,
        menu_dish: Array.isArray(item.menu_dish) ? (item.menu_dish[0] ?? null) : (item.menu_dish ?? null),
      }))
    : []
  const normalizedBooking: Booking = {
    ...rawBooking,
    customer: customer ?? null,
    table_booking_tables: tableAssignments,
    table_booking_items: tableBookingItems,
    audit_trail: auditTrail,
  } as unknown as Booking

  const guestName = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(' ')
  const title = guestName || booking.booking_reference || 'Booking'

  const seasonalPreorder = await loadSeasonalPreorder(rawBooking, canEdit)

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
        seasonalPreorder={seasonalPreorder}
      />
    </PageLayout>
  )
}

/**
 * The seasonal pre-order block, or null when this booking has nothing to do with one.
 *
 * The pre-order tables are service-role only under RLS, so the read goes through the admin client.
 * Permission was proven at the top of the page before we got here.
 */
async function loadSeasonalPreorder(rawBooking: any, canEdit: boolean) {
  // The booking's own snapshot answers this, not the live period row: a guest who said "no, this
  // is not a Christmas dinner" gets the normal menu and owes nobody a choice.
  if (rawBooking.booking_period_requires_preorder !== true || rawBooking.booking_period_answer !== true) {
    return null
  }

  const admin = createAdminClient()
  const [order, preorderEnabled] = await Promise.all([
    loadPreorderOrder(admin, rawBooking.id),
    isPreorderEnabled(admin),
  ])
  if (!order || !order.requiresPreorder) return null

  // Switched off and never started means there is nothing to show. Switched off with orders
  // already taken still shows them, because hiding what staff typed in would be worse.
  if (!preorderEnabled && order.covers.length === 0) return null

  const menu = order.periodId ? await loadPeriodMenu(admin, order.periodId) : []
  const cutoff = getPreorderCutoff({
    bookingDate: order.bookingDate,
    preorderCutoffDays: order.preorderCutoffDays,
  })

  return (
    <SeasonalPreorderSection
      order={order}
      menu={menu}
      canEdit={canEdit}
      preorderEnabled={preorderEnabled}
      closed={cutoff.closed}
      closesAtIso={cutoff.closesAt?.toISOString() ?? null}
    />
  )
}

/**
 * The dishes this booking may choose from: the three pre-order courses AND the add-ons.
 *
 * Filtered on `PREORDER_SELECTION_COURSES`, not `PREORDER_COURSES`. The narrower list left add-ons
 * out of this query entirely, so the tick-boxes had nothing to render and a seat's existing add-on
 * read as a dish that had been withdrawn. The table also carries sides, drinks and other, which are
 * nothing to do with a pre-order and stay excluded.
 */
async function loadPeriodMenu(
  admin: ReturnType<typeof createAdminClient>,
  periodId: string,
): Promise<PreorderMenuOption[]> {
  const { data, error } = await admin
    .from('booking_period_menu_items')
    .select('id, course, name, price_gbp, sort_order')
    .eq('period_id', periodId)
    .eq('is_active', true)
    .in('course', PREORDER_SELECTION_COURSES as unknown as string[])
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('Error loading seasonal menu for pre-order:', error)
    return []
  }

  const options: PreorderMenuOption[] = []
  for (const row of (data ?? []) as Array<{
    id: string
    course: string
    name: string
    price_gbp: number | string | null
  }>) {
    // The query already restricts the course, so this only fires if a value the app does not know
    // reaches the column. Dropping it beats casting: a dish nobody can classify must not end up
    // offered as somebody's main.
    if (!isPreorderSelectionCourse(row.course)) continue

    const price = row.price_gbp === null ? Number.NaN : Number(row.price_gbp)
    options.push({
      id: row.id,
      course: row.course,
      name: row.name,
      priceGbp: Number.isFinite(price) ? price : null,
    })
  }
  return options
}
