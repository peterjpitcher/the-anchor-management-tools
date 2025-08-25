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

async function checkCustomersTable() {
  console.log('=== Checking Customers Table Structure ===\n')

  // Get a sample customer to see its structure
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .limit(1)

  if (error) {
    console.error('Error fetching customers:', error)
    return
  }

  if (customers && customers.length > 0) {
    console.log('Sample customer columns:')
    console.log(Object.keys(customers[0]))
    console.log('\nSample customer data (partial):')
    const sample = customers[0]
    console.log({
      id: sample.id,
      first_name: sample.first_name,
      last_name: sample.last_name,
      mobile_number: sample.mobile_number,
      sms_opt_in: sample.sms_opt_in
    })
    console.log(`\nType of first_name: ${typeof sample.first_name}`)
    console.log(`Type of last_name: ${typeof sample.last_name}`)
  }

  process.exit(0)
}

checkCustomersTable().catch(console.error)