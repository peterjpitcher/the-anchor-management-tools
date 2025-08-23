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

async function checkData() {
  console.log('=== Checking Customer Suggestions Data ===\n')

  // 1. Check if events have categories
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, title, event_category_id')
    .not('event_category_id', 'is', null)
    .limit(5)

  console.log('1. Events with categories:')
  if (eventsError) {
    console.error('Error:', eventsError)
  } else {
    console.log(`Found ${events?.length || 0} events with categories`)
    events?.forEach(e => console.log(`  - ${e.title} (category: ${e.event_category_id})`))
  }

  // 2. Check event categories
  const { data: categories, error: catError } = await supabase
    .from('event_categories')
    .select('id, name')
    .limit(5)

  console.log('\n2. Event categories:')
  if (catError) {
    console.error('Error:', catError)
  } else {
    console.log(`Found ${categories?.length || 0} categories`)
    categories?.forEach(c => console.log(`  - ${c.name} (${c.id})`))
  }

  // 3. Check customer_category_stats table
  const { data: stats, error: statsError } = await supabase
    .from('customer_category_stats')
    .select('*')
    .limit(5)

  console.log('\n3. Customer category stats:')
  if (statsError) {
    console.error('Error:', statsError)
  } else {
    console.log(`Found ${stats?.length || 0} stats records`)
    if (stats && stats.length > 0) {
      console.log('Sample record:', JSON.stringify(stats[0], null, 2))
    }
  }

  // 4. Test the RPC function directly
  if (categories && categories.length > 0) {
    const categoryId = categories[0].id
    console.log(`\n4. Testing get_category_regulars RPC for category ${categoryId}:`)
    
    const { data: regulars, error: regularsError } = await supabase
      .rpc('get_category_regulars', { 
        p_category_id: categoryId,
        p_days_back: 90
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

  // 5. Check bookings table
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, event_id, customer_id')
    .limit(10)

  console.log('\n5. Bookings data:')
  if (bookingsError) {
    console.error('Error:', bookingsError)
  } else {
    console.log(`Found ${bookings?.length || 0} bookings`)
  }

  process.exit(0)
}

checkData().catch(console.error)