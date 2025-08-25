#!/usr/bin/env tsx

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../src/lib/supabase/server'

async function debugCategorySuggestions() {
  const supabase = await createAdminClient()
  
  console.log('=== Debugging Category Suggestions ===\n')

  // 1. Check if customer_category_stats table has any data
  console.log('1. Checking customer_category_stats table:')
  const { count: statsCount, error: statsError } = await supabase
    .from('customer_category_stats')
    .select('*', { count: 'exact', head: true })
  
  if (statsError) {
    console.error('Error checking stats:', statsError)
  } else {
    console.log(`Total records in customer_category_stats: ${statsCount}`)
  }

  // 2. Check a few sample records
  const { data: sampleStats, error: sampleError } = await supabase
    .from('customer_category_stats')
    .select('*')
    .limit(5)
  
  if (sampleError) {
    console.error('Error fetching sample stats:', sampleError)
  } else {
    console.log('\nSample records:')
    console.table(sampleStats)
  }

  // 3. Check if there are any events with categories
  console.log('\n2. Checking events with categories:')
  const { data: eventsWithCategories, error: eventsError } = await supabase
    .from('events')
    .select('id, name, category_id')
    .not('category_id', 'is', null)
    .limit(10)
  
  if (eventsError) {
    console.error('Error checking events:', eventsError)
  } else {
    console.log(`Found ${eventsWithCategories?.length || 0} events with categories`)
    if (eventsWithCategories && eventsWithCategories.length > 0) {
      console.table(eventsWithCategories)
    }
  }

  // 4. Check recent bookings for events with categories
  console.log('\n3. Checking recent bookings for events with categories:')
  const { data: recentBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_id,
      event_id,
      created_at,
      events!inner(
        id,
        name,
        category_id
      )
    `)
    .not('events.category_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10)
  
  if (bookingsError) {
    console.error('Error checking bookings:', bookingsError)
  } else {
    console.log(`Found ${recentBookings?.length || 0} recent bookings for events with categories`)
    if (recentBookings && recentBookings.length > 0) {
      console.table(recentBookings.map(b => ({
        booking_id: b.id,
        customer_id: b.customer_id,
        event_name: b.events.name,
        category_id: b.events.category_id,
        created_at: b.created_at
      })))
    }
  }

  // 5. Test the get_category_regulars function directly
  if (eventsWithCategories && eventsWithCategories.length > 0 && eventsWithCategories[0].category_id) {
    console.log('\n4. Testing get_category_regulars function:')
    const categoryId = eventsWithCategories[0].category_id
    console.log(`Testing with category_id: ${categoryId}`)
    
    const { data: regulars, error: regularsError } = await supabase
      .rpc('get_category_regulars', {
        p_category_id: categoryId,
        p_days_back: 90
      })
    
    if (regularsError) {
      console.error('Error calling get_category_regulars:', regularsError)
    } else {
      console.log(`Found ${regulars?.length || 0} regulars`)
      if (regulars && regulars.length > 0) {
        console.table(regulars.slice(0, 5))
      }
    }
  }

  // 6. Check if the trigger exists
  console.log('\n5. Checking if update_customer_category_stats_trigger exists:')
  const { data: triggers, error: triggerError } = await supabase
    .rpc('pg_trigger_exists', {
      p_trigger_name: 'update_customer_category_stats_trigger',
      p_table_name: 'bookings'
    })
    .single()
  
  if (triggerError) {
    // Try a direct query if the function doesn't exist
    const { data: triggerCheck, error: directError } = await supabase
      .from('pg_trigger')
      .select('tgname')
      .eq('tgname', 'update_customer_category_stats_trigger')
      .single()
    
    if (directError) {
      console.log('Could not check trigger existence')
    } else {
      console.log('Trigger exists:', !!triggerCheck)
    }
  } else {
    console.log('Trigger exists:', triggers)
  }
}

// Add a helper function to check if trigger exists
async function checkTriggerExists(supabase: any) {
  const query = `
    SELECT EXISTS (
      SELECT 1 
      FROM pg_trigger 
      WHERE tgname = 'update_customer_category_stats_trigger'
    ) as exists;
  `
  
  const { data, error } = await supabase.rpc('execute_sql', { query })
  if (error) {
    console.error('Error checking trigger:', error)
    return false
  }
  return data?.[0]?.exists || false
}

debugCategorySuggestions().catch(console.error)