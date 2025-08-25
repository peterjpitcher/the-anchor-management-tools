import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing environment variables. Please check .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkEventsWithCategories() {
  console.log('=== Checking Events with Categories ===\n')

  // Check all category fields in events table
  const { data: allEvents, error: allError } = await supabase
    .from('events')
    .select('id, name, category_id, event_category_id')
    .limit(10)

  console.log('1. All events (checking category fields):')
  if (allError) {
    console.error('Error:', allError)
  } else {
    console.log(`Found ${allEvents?.length || 0} events`)
    allEvents?.forEach(e => {
      console.log(`  - ${e.name}`)
      console.log(`    category_id: ${e.category_id}`)
      console.log(`    event_category_id: ${e.event_category_id || 'undefined field'}`)
    })
  }

  // Check events with non-null category_id
  const { data: eventsWithCat, error: catError } = await supabase
    .from('events')
    .select('id, name, category_id')
    .not('category_id', 'is', null)
    .limit(5)

  console.log('\n2. Events with category_id not null:')
  if (catError) {
    console.error('Error:', catError)
  } else {
    console.log(`Found ${eventsWithCat?.length || 0} events with categories`)
    eventsWithCat?.forEach(e => console.log(`  - ${e.name} (category: ${e.category_id})`))
  }

  // Test the RPC function with a known category
  const { data: categories } = await supabase
    .from('event_categories')
    .select('id, name')
    .limit(1)

  if (categories && categories.length > 0) {
    const categoryId = categories[0].id
    console.log(`\n3. Testing get_category_regulars for ${categories[0].name} (${categoryId}):`)
    
    // First, check if there are any bookings for events in this category
    const { data: categoryEvents, error: eventsError } = await supabase
      .from('events')
      .select('id, name')
      .eq('category_id', categoryId)
      .limit(5)

    console.log(`   Events in this category: ${categoryEvents?.length || 0}`)
    categoryEvents?.forEach(e => console.log(`   - ${e.name}`))

    // Check bookings for these events
    if (categoryEvents && categoryEvents.length > 0) {
      const eventIds = categoryEvents.map(e => e.id)
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, event_id, customer_id')
        .in('event_id', eventIds)
        .limit(10)

      console.log(`   Bookings for these events: ${bookings?.length || 0}`)
    }
  }

  process.exit(0)
}

checkEventsWithCategories().catch(console.error)