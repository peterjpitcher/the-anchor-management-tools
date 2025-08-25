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

async function populateStats() {
  console.log('=== Populating Customer Category Stats ===\n')

  // First, clear existing stats to start fresh
  console.log('1. Clearing existing stats...')
  const { error: deleteError } = await supabase
    .from('customer_category_stats')
    .delete()
    .neq('customer_id', '00000000-0000-0000-0000-000000000000') // Delete all

  if (deleteError) {
    console.error('Error clearing stats:', deleteError)
    return
  }

  // Get all bookings with their event categories
  console.log('2. Fetching bookings with event categories...')
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_id,
      created_at,
      event:events!inner(
        id,
        name,
        date,
        category_id
      )
    `)
    .not('events.category_id', 'is', null)
    .order('created_at', { ascending: true })

  if (bookingsError) {
    console.error('Error fetching bookings:', bookingsError)
    return
  }

  console.log(`Found ${bookings?.length || 0} bookings with categories`)

  // Group bookings by customer and category
  const statsMap = new Map<string, any>()

  bookings?.forEach(booking => {
    const key = `${booking.customer_id}_${booking.event.category_id}`
    
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        customer_id: booking.customer_id,
        category_id: booking.event.category_id,
        times_attended: 0,
        first_attended_date: booking.event.date,
        last_attended_date: booking.event.date,
        events: []
      })
    }

    const stat = statsMap.get(key)
    stat.times_attended++
    stat.events.push(booking.event.name)
    
    // Update dates
    if (booking.event.date < stat.first_attended_date) {
      stat.first_attended_date = booking.event.date
    }
    if (booking.event.date > stat.last_attended_date) {
      stat.last_attended_date = booking.event.date
    }
  })

  // Insert the aggregated stats
  console.log(`\n3. Inserting ${statsMap.size} customer category stats...`)
  
  const statsToInsert = Array.from(statsMap.values()).map(stat => ({
    customer_id: stat.customer_id,
    category_id: stat.category_id,
    times_attended: stat.times_attended,
    first_attended_date: stat.first_attended_date,
    last_attended_date: stat.last_attended_date
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('customer_category_stats')
    .insert(statsToInsert)
    .select()

  if (insertError) {
    console.error('Error inserting stats:', insertError)
    return
  }

  console.log(`Successfully inserted ${inserted?.length || 0} stats records`)

  // Test the RPC functions
  console.log('\n4. Testing RPC functions...')
  
  // Get a category with stats
  const { data: categoriesWithStats } = await supabase
    .from('event_categories')
    .select('id, name')
    .limit(1)

  if (categoriesWithStats && categoriesWithStats.length > 0) {
    const categoryId = categoriesWithStats[0].id
    console.log(`\nTesting get_category_regulars for ${categoriesWithStats[0].name}:`)
    
    const { data: regulars, error: regularsError } = await supabase
      .rpc('get_category_regulars', { 
        p_category_id: categoryId,
        p_days_back: 365
      })

    if (regularsError) {
      console.error('Error:', regularsError)
    } else {
      console.log(`Found ${regulars?.length || 0} regular customers`)
      regulars?.slice(0, 3).forEach(r => 
        console.log(`  - ${r.first_name} ${r.last_name} (attended ${r.times_attended} times)`)
      )
    }
  }

  process.exit(0)
}

populateStats().catch(console.error)