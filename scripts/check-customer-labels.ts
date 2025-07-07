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

async function checkCustomerLabels() {
  console.log('=== Checking Customer Labels Status ===\n')

  try {
    // Test if tables exist
    const { data: labels, error: labelsError } = await supabase
      .from('customer_labels')
      .select('*')
    
    if (labelsError) {
      if (labelsError.code === '42P01') {
        console.log('❌ Customer labels table does not exist')
        console.log('\nTo create the customer labels system:')
        console.log('1. Go to Supabase Dashboard > SQL Editor')
        console.log('2. Run the migration at: supabase/migrations/20250706160000_add_customer_labels.sql')
        console.log('3. Then run this script again to verify')
      } else {
        console.error('Error checking labels:', labelsError)
      }
      return
    }
    
    console.log('✅ Customer labels table exists')
    
    if (labels && labels.length > 0) {
      console.log(`\nFound ${labels.length} labels:`)
      labels.forEach(l => {
        console.log(`  • ${l.name} (${l.color})`)
        if (l.description) {
          console.log(`    ${l.description}`)
        }
      })
    } else {
      console.log('\n⚠️  No labels found in the database')
      console.log('The table exists but has no default labels.')
    }
    
    // Check assignments table
    const { error: assignError } = await supabase
      .from('customer_label_assignments')
      .select('id')
      .limit(1)
    
    if (assignError) {
      console.log('\n❌ Customer label assignments table does not exist')
    } else {
      console.log('\n✅ Customer label assignments table exists')
      
      // Count assignments
      const { count } = await supabase
        .from('customer_label_assignments')
        .select('*', { count: 'exact', head: true })
      
      console.log(`   ${count || 0} label assignments found`)
    }
    
  } catch (error) {
    console.error('Error:', error)
  }
}

checkCustomerLabels().catch(console.error)