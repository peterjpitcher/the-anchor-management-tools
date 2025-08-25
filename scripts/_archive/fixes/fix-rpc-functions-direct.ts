import * as dotenv from 'dotenv'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing environment variables. Please check .env.local')
  process.exit(1)
}

async function executeSql(sql: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({ query: sql })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`SQL execution failed: ${error}`)
  }

  return response.json()
}

async function fixRpcFunctions() {
  console.log('=== Fixing RPC Functions via Direct SQL ===\n')

  const supabase = createClient(supabaseUrl, supabaseKey)

  // First, let's test the current function to see the exact error
  console.log('1. Testing current get_category_regulars function...')
  const { data: categories } = await supabase
    .from('event_categories')
    .select('id, name')
    .limit(1)

  if (categories && categories.length > 0) {
    const categoryId = categories[0].id
    console.log(`   Testing with category: ${categories[0].name}`)
    
    const { data: regulars, error: testError } = await supabase
      .rpc('get_category_regulars', { 
        p_category_id: categoryId,
        p_days_back: 365
      })

    if (testError) {
      console.error('   Current error:', testError)
      
      // Now let's manually query the data to see what works
      console.log('\n2. Testing manual query...')
      const { data: manualData, error: manualError } = await supabase
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
        .eq('category_id', categoryId)
        .eq('customers.sms_opt_in', true)
        .order('times_attended', { ascending: false })
        .limit(10)

      if (manualError) {
        console.error('   Manual query error:', manualError)
      } else {
        console.log(`   ✓ Manual query found ${manualData?.length || 0} customers`)
        manualData?.slice(0, 3).forEach(d => {
          const c = (d as any).customers
          console.log(`     - ${c.first_name} ${c.last_name} (attended ${d.times_attended} times)`)
        })
      }
    } else {
      console.log(`   ✓ Function already works! Found ${regulars?.length || 0} customers`)
    }
  }

  process.exit(0)
}

fixRpcFunctions().catch(console.error)