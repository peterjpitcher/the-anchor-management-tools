import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Check if a customer has ever clicked a review link across any booking type.
 * Used to prevent sending duplicate review requests to customers who have
 * already left a review via a different booking channel.
 */
export async function hasCustomerReviewed(customerIds: string[]): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set()

  const db = createAdminClient()
  const reviewed = new Set<string>()

  // Batch check across all three tables in parallel
  const [bookings, tableBookings, privateBookings] = await Promise.all([
    db.from('bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
    db.from('table_bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
    db.from('private_bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
  ])

  for (const row of bookings.data ?? []) reviewed.add(row.customer_id)
  for (const row of tableBookings.data ?? []) reviewed.add(row.customer_id)
  for (const row of privateBookings.data ?? []) reviewed.add(row.customer_id)

  return reviewed
}
