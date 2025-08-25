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

async function checkEventsTable() {
  console.log('=== Checking Events Table Structure ===\n')

  // Get a sample event to see its structure
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .limit(1)

  if (error) {
    console.error('Error fetching events:', error)
    return
  }

  if (events && events.length > 0) {
    console.log('Sample event columns:')
    console.log(Object.keys(events[0]))
    console.log('\nSample event data:')
    console.log(JSON.stringify(events[0], null, 2))
  }

  process.exit(0)
}

checkEventsTable().catch(console.error)