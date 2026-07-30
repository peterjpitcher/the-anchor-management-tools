import { NextRequest, NextResponse } from 'next/server'
import { requireFohVoucherPermission } from '@/lib/foh/api-auth'
import { validationError, buildCustomerName } from '../shared'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type BookerRow = {
  customer_id: string | null
  seats: number | null
  customers: { id: string; first_name: string | null; last_name: string | null } | null
}

// One-tap customer chips for hand-out (spec 5.1 F34): customers with confirmed,
// positive-seat bookings on the in-context event, deduped by customer.
// Status filter matches the active set used elsewhere (src/app/actions/events.ts:
// confirmed/pending_payment); null is included because legacy event bookings
// predate the status column.
export async function GET(request: NextRequest) {
  const auth = await requireFohVoucherPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const eventId = request.nextUrl.searchParams.get('eventId')?.trim() || ''
  if (!UUID_PATTERN.test(eventId)) {
    return validationError('A valid eventId is required')
  }

  const { data, error } = await auth.supabase
    .from('bookings')
    .select('customer_id, seats, customers(id, first_name, last_name)')
    .eq('event_id', eventId)
    .gt('seats', 0)
    .or('status.is.null,status.eq.confirmed,status.eq.pending_payment')

  if (error) {
    return NextResponse.json({ error: 'Failed to load event bookers' }, { status: 500 })
  }

  const byCustomer = new Map<string, { customerId: string; name: string; seats: number }>()

  for (const row of (data ?? []) as unknown as BookerRow[]) {
    if (!row.customer_id || !row.customers) {
      continue
    }
    const seats = row.seats ?? 0
    const existing = byCustomer.get(row.customer_id)
    if (existing) {
      existing.seats += seats
    } else {
      byCustomer.set(row.customer_id, {
        customerId: row.customer_id,
        name: buildCustomerName(row.customers.first_name, row.customers.last_name),
        seats
      })
    }
  }

  const bookers = Array.from(byCustomer.values()).sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ success: true, data: bookers })
}
