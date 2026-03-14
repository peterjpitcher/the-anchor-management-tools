import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PermissionService } from '@/services/permission'

export type SearchResult = {
  type: 'customer' | 'booking' | 'event' | 'invoice'
  id: string
  title: string
  subtitle: string
  href: string
  meta?: string
}

// GET /api/search?q=<query>&types=customers,bookings,events,invoices
export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const q = searchParams.get('q')?.trim() ?? ''
  const typesParam = searchParams.get('types')

  if (q.length < 2) {
    return NextResponse.json({ results: [], total: 0 })
  }

  // Determine which entity types to search
  const requestedTypes = typesParam
    ? typesParam.split(',').map((t) => t.trim())
    : ['customers', 'bookings', 'events', 'invoices']

  // Fetch all user permissions once; derive per-entity access from that list
  const permissions = await PermissionService.getUserPermissions(user.id)
  const hasModule = (module: string) =>
    permissions.some((p) => p.module_name === module && p.action === 'view')

  const canAccessCustomers  = requestedTypes.includes('customers') && hasModule('customers')
  const canAccessBookings   = requestedTypes.includes('bookings')  && hasModule('private_bookings')
  const canAccessEvents     = requestedTypes.includes('events')    && hasModule('events')
  const canAccessInvoices   = requestedTypes.includes('invoices')  && hasModule('invoices')

  // Run all permitted searches in parallel
  const [customersResult, bookingsResult, eventsResult, invoicesResult] =
    await Promise.allSettled([
      canAccessCustomers  ? searchCustomers(supabase, q)  : Promise.resolve([]),
      canAccessBookings   ? searchBookings(supabase, q)   : Promise.resolve([]),
      canAccessEvents     ? searchEvents(supabase, q)     : Promise.resolve([]),
      canAccessInvoices   ? searchInvoices(supabase, q)   : Promise.resolve([]),
    ])

  const results: SearchResult[] = [
    ...(customersResult.status === 'fulfilled' ? customersResult.value : []),
    ...(bookingsResult.status  === 'fulfilled' ? bookingsResult.value  : []),
    ...(eventsResult.status    === 'fulfilled' ? eventsResult.value    : []),
    ...(invoicesResult.status  === 'fulfilled' ? invoicesResult.value  : []),
  ]

  return NextResponse.json({ results, total: results.length })
}

// ─── per-entity search helpers ───────────────────────────────────────────────

// Supabase client is typed by the generated schema; using ReturnType keeps
// helpers concise without repeating the full generic signature.
type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function searchCustomers(supabase: SupabaseClient, q: string): Promise<SearchResult[]> {
  const like = `%${q}%`
  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email, mobile_number')
    .or(
      `first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},mobile_number.ilike.${like}`
    )
    .limit(5)

  if (error || !data) return []

  return data.map((c: { id: string; first_name: string; last_name: string; email: string | null; mobile_number: string }) => ({
    type: 'customer' as const,
    id: c.id,
    title: `${c.first_name} ${c.last_name}`.trim(),
    subtitle: c.email ?? c.mobile_number ?? '',
    href: `/customers?search=${encodeURIComponent(`${c.first_name} ${c.last_name}`.trim())}`,
  }))
}

async function searchBookings(supabase: SupabaseClient, q: string): Promise<SearchResult[]> {
  const like = `%${q}%`
  const { data, error } = await supabase
    .from('private_bookings')
    .select('id, customer_name, customer_first_name, customer_last_name, event_type, event_date, status')
    .or(
      `customer_name.ilike.${like},customer_first_name.ilike.${like},customer_last_name.ilike.${like},event_type.ilike.${like}`
    )
    .limit(5)

  if (error || !data) return []

  return data.map((b: {
    id: string
    customer_name: string
    customer_first_name: string | null
    customer_last_name: string | null
    event_type: string | null
    event_date: string
    status: string | null
  }) => {
    const name =
      b.customer_first_name && b.customer_last_name
        ? `${b.customer_first_name} ${b.customer_last_name}`
        : b.customer_name
    return {
      type: 'booking' as const,
      id: b.id,
      title: name,
      subtitle: b.event_type ?? 'Private Booking',
      href: `/private-bookings/${b.id}`,
      meta: b.event_date,
    }
  })
}

async function searchEvents(supabase: SupabaseClient, q: string): Promise<SearchResult[]> {
  const like = `%${q}%`
  const { data, error } = await supabase
    .from('events')
    .select('id, name, short_description, date, event_status')
    .or(`name.ilike.${like},short_description.ilike.${like}`)
    .limit(5)

  if (error || !data) return []

  return data.map((e: {
    id: string
    name: string
    short_description: string | null
    date: string
    event_status: string | null
  }) => ({
    type: 'event' as const,
    id: e.id,
    title: e.name,
    subtitle: e.short_description ?? 'Event',
    href: `/events/${e.id}`,
    meta: e.date,
  }))
}

async function searchInvoices(supabase: SupabaseClient, q: string): Promise<SearchResult[]> {
  const like = `%${q}%`
  // Search by invoice_number (cast) or via vendor name join
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_amount, invoice_date, invoice_vendors(name)')
    .or(`invoice_number.ilike.${like}`)
    .limit(5)

  if (error || !data) return []

  // Also search by vendor name — run a separate query then merge + deduplicate
  const { data: vendorData } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_amount, invoice_date, invoice_vendors!inner(name)')
    .ilike('invoice_vendors.name', like)
    .limit(5)

  const combined: typeof data = [
    ...data,
    ...(vendorData ?? []).filter(
      (v: { id: string }) => !data.some((d: { id: string }) => d.id === v.id)
    ),
  ].slice(0, 5)

  return combined.map((inv: {
    id: string
    invoice_number: string
    status: string | null
    total_amount: number | null
    invoice_date: string
    // Supabase returns the join as an array; take the first element if present
    invoice_vendors: { name: string }[] | { name: string } | null
  }) => {
    const vendor = Array.isArray(inv.invoice_vendors)
      ? inv.invoice_vendors[0]
      : inv.invoice_vendors
    const vendorName = vendor?.name ?? 'Invoice'
    const amount = inv.total_amount != null
      ? `£${inv.total_amount.toFixed(2)}`
      : undefined
    return {
      type: 'invoice' as const,
      id: inv.id,
      title: `Invoice ${inv.invoice_number}`,
      subtitle: vendorName,
      href: `/invoices/${inv.id}`,
      meta: amount,
    }
  })
}
