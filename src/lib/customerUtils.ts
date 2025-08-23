import { Customer } from '@/types/database'
import { SupabaseClient } from '@supabase/supabase-js'

export type CustomerWithLoyalty = Customer & {
  isLoyal?: boolean
}

type BookingWithEvent = {
  customer_id: string
  event: {
    date: string
  }
}

export async function getLoyalCustomers(supabase: SupabaseClient): Promise<string[]> {
  const now = new Date()
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
  const oneMonthAhead = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('customer_id, event:events(date)')
    .gt('seats', 0) // Only consider bookings with actual seats reserved
    .gte('event.date', oneMonthAgo.toISOString().split('T')[0])
    .lte('event.date', oneMonthAhead.toISOString().split('T')[0])

  if (error) {
    console.error('Error fetching loyal customers:', error)
    return []
  }

  // Get unique customer IDs who have bookings in the date range
  const loyalCustomerIds = Array.from(new Set((bookings as unknown as BookingWithEvent[])?.map(booking => booking.customer_id) || []))
  return loyalCustomerIds
}

export function sortCustomersByLoyalty(customers: CustomerWithLoyalty[]): CustomerWithLoyalty[] {
  return [...customers].sort((a, b) => {
    if (a.isLoyal && !b.isLoyal) return -1
    if (!a.isLoyal && b.isLoyal) return 1
    return (a.first_name + ' ' + a.last_name).localeCompare(b.first_name + ' ' + b.last_name)
  })
} 