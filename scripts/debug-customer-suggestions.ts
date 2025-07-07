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

async function debugCustomerSuggestions() {
  console.log('=== Debugging Customer Suggestions ===\n')

  try {
    // 1. Get a test category
    const { data: categories } = await supabase
      .from('event_categories')
      .select('id, name')
      .limit(3)
    
    if (!categories || categories.length === 0) {
      console.log('❌ No event categories found')
      return
    }
    
    console.log('✅ Event categories:')
    categories.forEach(cat => console.log(`  - ${cat.name} (${cat.id})`))
    
    const testCategoryId = categories[0].id
    
    // 2. Test the direct query for regulars
    console.log(`\n=== Testing regulars query for ${categories[0].name} ===`)
    
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 90)
    
    const { data: statsData, error } = await supabase
      .from('customer_category_stats')
      .select(`
        customer_id,
        times_attended,
        last_attended_date,
        customers!inner(
          id,
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `)
      .eq('category_id', testCategoryId)
      .eq('customers.sms_opt_in', true)
      .gte('last_attended_date', cutoffDate.toISOString().split('T')[0])
      .order('times_attended', { ascending: false })
      .order('last_attended_date', { ascending: false })
      .limit(5)
    
    if (error) {
      console.error('❌ Error with direct query:', error)
    } else {
      console.log(`✅ Found ${statsData?.length || 0} regulars with sms_opt_in=true`)
      statsData?.forEach((stat: any) => {
        console.log(`  - ${stat.customers.first_name} ${stat.customers.last_name}: ${stat.times_attended} times`)
      })
    }
    
    // 3. Check without sms_opt_in filter
    const { data: allStats } = await supabase
      .from('customer_category_stats')
      .select(`
        customer_id,
        times_attended,
        customers!inner(
          first_name,
          last_name,
          sms_opt_in
        )
      `)
      .eq('category_id', testCategoryId)
      .limit(5)
    
    console.log(`\n✅ Total customers in category (no sms filter): ${allStats?.length || 0}`)
    allStats?.forEach((stat: any) => {
      console.log(`  - ${stat.customers.first_name} ${stat.customers.last_name}: sms_opt_in=${stat.customers.sms_opt_in}`)
    })
    
    // 4. Test user_has_permission function
    console.log(`\n=== Testing user_has_permission function ===`)
    
    // Get a test user
    const { data: users } = await supabase
      .from('user_roles')
      .select('user_id, roles(name)')
      .limit(1)
    
    if (users && users.length > 0) {
      const testUserId = users[0].user_id
      console.log(`Testing with user: ${testUserId} (role: ${(users[0] as any).roles?.name})`)
      
      try {
        const { data: hasPermission, error: permError } = await supabase.rpc('user_has_permission', {
          p_user_id: testUserId,
          p_module_name: 'customers',
          p_action: 'view'
        })
        
        if (permError) {
          console.error('❌ Error calling user_has_permission:', permError)
        } else {
          console.log(`✅ user_has_permission result: ${hasPermission}`)
        }
      } catch (e) {
        console.error('❌ Exception calling user_has_permission:', e)
      }
    }
    
  } catch (error) {
    console.error('Error:', error)
  }
}

debugCustomerSuggestions().catch(console.error)