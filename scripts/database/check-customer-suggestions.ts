#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import path from 'path'

const SCRIPT_NAME = 'check-customer-suggestions'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ❌ ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ❌ ${message}`)
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const supabase = createAdminClient()

  console.log('=== Checking Customer Suggestions Data ===\n')

  // 1. Check if events have categories
  const { data: events, error: eventsError } = await (supabase.from('events') as any)
    .select('id, title, event_category_id')
    .not('event_category_id', 'is', null)
    .limit(5)

  console.log('1. Events with categories:')
  if (eventsError) {
    markFailure('Error querying events with categories.', eventsError)
  } else {
    console.log(`Found ${events?.length || 0} events with categories`)
    events?.forEach((e: any) => console.log(`  - ${e.title} (category: ${e.event_category_id})`))
  }

  // 2. Check event categories
  const { data: categories, error: catError } = await (supabase.from('event_categories') as any)
    .select('id, name')
    .limit(5)

  console.log('\n2. Event categories:')
  if (catError) {
    markFailure('Error querying event_categories.', catError)
  } else {
    console.log(`Found ${categories?.length || 0} categories`)
    categories?.forEach((c: any) => console.log(`  - ${c.name} (${c.id})`))
  }

  // 3. Check customer_category_stats table
  const { data: stats, error: statsError } = await (supabase.from('customer_category_stats') as any)
    .select('*')
    .limit(5)

  console.log('\n3. Customer category stats:')
  if (statsError) {
    markFailure('Error querying customer_category_stats.', statsError)
  } else {
    console.log(`Found ${stats?.length || 0} stats records`)
    if (stats && stats.length > 0) {
      console.log('Sample record:', JSON.stringify(stats[0], null, 2))
    }
  }

  // 4. Test the RPC function directly (best-effort)
  if (categories && categories.length > 0) {
    const categoryId = categories[0].id
    console.log(`\n4. Testing get_category_regulars RPC for category ${categoryId}:`)

    const { data: regulars, error: regularsError } = await supabase.rpc('get_category_regulars', {
      p_category_id: categoryId,
      p_days_back: 90,
    })

    if (regularsError) {
      markFailure('Error calling get_category_regulars RPC.', regularsError)
    } else {
      console.log(`Found ${regulars?.length || 0} regular customers`)
      regulars?.slice(0, 3).forEach((r: any) =>
        console.log(`  - ${r.first_name} ${r.last_name} (attended ${r.times_attended} times)`)
      )
    }
  }

  // 5. Check bookings table
  const { data: bookings, error: bookingsError } = await (supabase.from('bookings') as any)
    .select('id, event_id, customer_id')
    .limit(10)

  console.log('\n5. Bookings data:')
  if (bookingsError) {
    markFailure('Error querying bookings.', bookingsError)
  } else {
    console.log(`Found ${bookings?.length || 0} bookings`)
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Customer suggestions check completed with failures.')
  } else {
    console.log('\n✅ Customer suggestions check complete!')
  }
}

void main().catch((error) => {
  markFailure('check-customer-suggestions failed.', error)
})

