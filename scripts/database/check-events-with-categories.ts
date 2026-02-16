#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import path from 'path'

const SCRIPT_NAME = 'check-events-with-categories'

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

  console.log('=== Checking Events with Categories ===\n')

  // Check all category fields in events table (best-effort: schemas vary)
  const { data: allEvents, error: allError } = await (supabase.from('events') as any)
    .select('id, name, category_id, event_category_id')
    .limit(10)

  console.log('1. All events (checking category fields):')
  if (allError) {
    markFailure('Error querying events with category fields.', allError)
  } else {
    console.log(`Found ${allEvents?.length || 0} events`)
    allEvents?.forEach((e: any) => {
      console.log(`  - ${e.name}`)
      console.log(`    category_id: ${e.category_id}`)
      console.log(`    event_category_id: ${e.event_category_id ?? 'undefined field'}`)
    })
  }

  // Check events with non-null category_id
  const { data: eventsWithCat, error: catError } = await (supabase.from('events') as any)
    .select('id, name, category_id')
    .not('category_id', 'is', null)
    .limit(5)

  console.log('\n2. Events with category_id not null:')
  if (catError) {
    markFailure('Error querying events with category_id not null.', catError)
  } else {
    console.log(`Found ${eventsWithCat?.length || 0} events with categories`)
    eventsWithCat?.forEach((e: any) => console.log(`  - ${e.name} (category: ${e.category_id})`))
  }

  // Test the RPC function with a known category (best-effort)
  const { data: categories, error: categoriesError } = await (supabase.from('event_categories') as any)
    .select('id, name')
    .limit(1)

  if (categoriesError) {
    markFailure('Error querying event_categories.', categoriesError)
  }

  if (categories && categories.length > 0) {
    const categoryId = categories[0].id
    console.log(`\n3. Testing get_category_regulars for ${categories[0].name} (${categoryId}):`)

    const { data: categoryEvents, error: eventsError } = await (supabase.from('events') as any)
      .select('id, name')
      .eq('category_id', categoryId)
      .limit(5)

    if (eventsError) {
      markFailure('Error querying events by category_id.', eventsError)
    }

    console.log(`   Events in this category: ${categoryEvents?.length || 0}`)
    categoryEvents?.forEach((e: any) => console.log(`   - ${e.name}`))

    // Check bookings for these events
    if (categoryEvents && categoryEvents.length > 0) {
      const eventIds = categoryEvents.map((e: any) => e.id)
      const { data: bookings, error: bookingsError } = await (supabase.from('bookings') as any)
        .select('id, event_id, customer_id')
        .in('event_id', eventIds)
        .limit(10)

      if (bookingsError) {
        markFailure('Error querying bookings for category events.', bookingsError)
      }

      console.log(`   Bookings for these events: ${bookings?.length || 0}`)
    }
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Events-with-categories check completed with failures.')
  } else {
    console.log('\n✅ Events-with-categories check complete!')
  }
}

void main().catch((error) => {
  markFailure('check-events-with-categories failed.', error)
})

