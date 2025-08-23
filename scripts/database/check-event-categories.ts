import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('Missing required environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRole)

async function checkEventCategories() {
  console.log('\n🏷️  Checking Event Categories...\n')
  
  try {
    // Get all event categories
    const { data: categories, error } = await supabase
      .from('event_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    
    if (error) {
      console.error('❌ Error fetching categories:', error.message)
      return
    }
    
    console.log(`Found ${categories?.length || 0} event categories:\n`)
    
    categories?.forEach((category, index) => {
      console.log(`${index + 1}. ${category.name}`)
      console.log(`   ID: ${category.id}`)
      console.log(`   Active: ${category.is_active}`)
      console.log(`   Color: ${category.color}`)
      console.log(`   Icon: ${category.icon}`)
      if (category.description) {
        console.log(`   Description: ${category.description}`)
      }
      if (category.default_performer_name) {
        console.log(`   Default Performer: ${category.default_performer_name}`)
      }
      console.log('')
    })
    
    // Check for events using these categories
    console.log('\n📊 Events per Category:\n')
    
    for (const category of categories || []) {
      const { count } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('category_id', category.id)
      
      console.log(`${category.name}: ${count || 0} events`)
    }
    
    // Search for drag-related events without categories
    console.log('\n🔍 Searching for drag-related events without categories...\n')
    
    const { data: dragEvents, error: dragError } = await supabase
      .from('events')
      .select('id, title, category_id')
      .or('title.ilike.%drag%,title.ilike.%cabaret%,title.ilike.%gameshow%,title.ilike.%house party%')
      .is('category_id', null)
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (dragEvents && dragEvents.length > 0) {
      console.log(`Found ${dragEvents.length} uncategorized events that might be drag/gameshow events:`)
      dragEvents.forEach(event => {
        console.log(`- ${event.title}`)
      })
    } else {
      console.log('No uncategorized drag/gameshow events found.')
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

checkEventCategories()