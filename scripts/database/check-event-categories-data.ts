#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function checkEventCategoriesData() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-event-categories-data is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('=== Checking Event Categories Data ===\n')

  const { data: eventsRows, error: eventsError } = await supabase
    .from('events')
    .select('id, name, category_id, event_categories(name)')
    .not('category_id', 'is', null)
    .limit(10)

  const eventsWithCategories = (assertScriptQuerySucceeded({
    operation: 'Load sample events with categories',
    error: eventsError,
    data: eventsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ name: string | null; category_id: string | null; event_categories?: { name?: string | null } | null }>

  console.log(`✅ Found ${eventsWithCategories.length} event(s) with categories (sample):`)
  eventsWithCategories.forEach((event) => {
    const categoryName = event.event_categories?.name || 'Unknown category'
    console.log(`  - ${event.name || 'unknown event'} → ${categoryName}`)
  })

  const { count: statsCount, error: statsCountError } = await supabase
    .from('customer_category_stats')
    .select('*', { count: 'exact', head: true })

  if (statsCountError) {
    markFailure('Failed counting customer_category_stats records.', statsCountError)
  } else {
    console.log(`\n✅ Customer category stats: ${statsCount || 0} record(s)`)
  }

  if (eventsWithCategories.length > 0) {
    const testCategoryId = eventsWithCategories[0]?.category_id
    if (testCategoryId) {
      const { data: categoryStatsRows, error: statsError } = await supabase
        .from('customer_category_stats')
        .select(
          `
          customer_id,
          times_attended,
          last_attended_date,
          customers!inner(
            first_name,
            last_name,
            sms_opt_in
          )
        `
        )
        .eq('category_id', testCategoryId)
        .eq('customers.sms_opt_in', true)
        .limit(5)

      const categoryStats = (assertScriptQuerySucceeded({
        operation: 'Load sample category stats',
        error: statsError,
        data: categoryStatsRows ?? [],
        allowMissing: true
      }) ?? []) as Array<{
        times_attended: number | null
        customers: { first_name: string | null; last_name: string | null } | null
      }>

      const categoryName = eventsWithCategories[0]?.event_categories?.name || 'unknown category'
      console.log(`\nSample stats for category "${categoryName}":`)
      categoryStats.forEach((stat) => {
        const customerName = stat.customers
          ? `${stat.customers.first_name || ''} ${stat.customers.last_name || ''}`.trim() || 'unknown'
          : 'unknown'
        console.log(`  - ${customerName}: ${stat.times_attended ?? 0} time(s)`)
      })
    } else {
      markFailure('Sample events returned category_id=null; unable to query category stats.')
    }
  }

  const { data: recentBookingsRows, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      `
        id,
        customer_id,
        event_id,
        status,
        events!inner(
          name,
          category_id
        )
      `
    )
    .eq('status', 'confirmed')
    .not('events.category_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)

  const recentBookings = (assertScriptQuerySucceeded({
    operation: 'Load recent bookings with categorized events',
    error: bookingsError,
    data: recentBookingsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    customer_id: string | null
    events: { name: string | null } | null
  }>

  console.log(`\n✅ Recent confirmed bookings with categories: ${recentBookings.length}`)
  recentBookings.forEach((booking) => {
    console.log(`  - Customer ${booking.customer_id || 'unknown'} → ${booking.events?.name || 'unknown event'}`)
  })

  if (process.exitCode === 1) {
    console.log('\n❌ Event categories data check completed with failures.')
  } else {
    console.log('\n✅ Event categories data check complete!')
  }
}

void checkEventCategoriesData().catch((error) => {
  markFailure('check-event-categories-data failed.', error)
})
