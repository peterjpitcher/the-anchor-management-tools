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

async function checkCustomerPreferences() {
  console.log('=== Checking Customer Event Preferences ===\n')

  // Get customers who have category stats
  const { data: customersWithStats } = await supabase
    .from('customer_category_stats')
    .select(`
      customer:customers!inner(
        id,
        first_name,
        last_name
      )
    `)
    .limit(3)
  
  const customers = customersWithStats?.map(s => (s as any).customer) || []

  if (customers && customers.length > 0) {
    for (const customer of customers) {
      console.log(`\nCustomer: ${customer.first_name} ${customer.last_name}`)
      
      // Get their category stats
      const { data: stats, error } = await supabase
        .from('customer_category_stats')
        .select(`
          times_attended,
          last_attended_date,
          event_categories!inner(
            id,
            name
          )
        `)
        .eq('customer_id', customer.id)
        .order('times_attended', { ascending: false })

      if (error) {
        console.error('Error:', error)
      } else if (stats && stats.length > 0) {
        console.log('Event preferences:')
        stats.forEach(s => {
          console.log(`  - ${(s as any).event_categories.name}: attended ${s.times_attended} times (last: ${s.last_attended_date})`)
        })
      } else {
        console.log('  No event preferences found')
      }
    }
  }

  process.exit(0)
}

checkCustomerPreferences().catch(console.error)