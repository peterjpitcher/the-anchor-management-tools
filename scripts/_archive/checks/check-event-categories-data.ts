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

async function checkEventCategoriesData() {
  console.log('=== Checking Event Categories Data ===\n')

  try {
    // 1. Check events with categories
    const { data: eventsWithCategories, error: eventsError } = await supabase
      .from('events')
      .select('id, name, category_id, event_categories(name)')
      .not('category_id', 'is', null)
      .limit(10)
    
    if (eventsError) {
      console.error('Error checking events:', eventsError)
      return
    }
    
    console.log(`✅ Found ${eventsWithCategories?.length || 0} events with categories:`)
    eventsWithCategories?.forEach((event: any) => {
      console.log(`  - ${event.name} → ${event.event_categories?.name || 'Unknown category'}`)
    })
    
    // 2. Check customer_category_stats
    const { count: statsCount } = await supabase
      .from('customer_category_stats')
      .select('*', { count: 'exact', head: true })
    
    console.log(`\n✅ Customer category stats: ${statsCount || 0} records`)
    
    // 3. Check a specific category's stats
    if (eventsWithCategories && eventsWithCategories.length > 0) {
      const testCategoryId = eventsWithCategories[0].category_id
      const { data: categoryStats, error: statsError } = await supabase
        .from('customer_category_stats')
        .select(`
          customer_id,
          times_attended,
          last_attended_date,
          customers!inner(
            first_name,
            last_name,
            sms_opt_in
          )
        `)
        .eq('category_id', testCategoryId)
        .eq('customers.sms_opt_in', true)
        .limit(5)
      
      if (statsError) {
        console.error('\nError fetching category stats:', statsError)
      } else {
        console.log(`\nSample stats for category "${eventsWithCategories[0].event_categories?.name}":`)
        categoryStats?.forEach((stat: any) => {
          console.log(`  - ${stat.customers.first_name} ${stat.customers.last_name}: ${stat.times_attended} times`)
        })
      }
    }
    
    // 4. Check recent bookings to see if they should be creating stats
    const { data: recentBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        customer_id,
        event_id,
        status,
        events!inner(
          name,
          category_id
        )
      `)
      .eq('status', 'confirmed')
      .not('events.category_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5)
    
    if (bookingsError) {
      console.error('\nError checking bookings:', bookingsError)
    } else {
      console.log(`\n✅ Recent bookings with categories:`)
      recentBookings?.forEach((booking: any) => {
        console.log(`  - Customer ${booking.customer_id} → ${booking.events.name}`)
      })
    }
    
  } catch (error) {
    console.error('Error:', error)
  }
}

checkEventCategoriesData().catch(console.error)