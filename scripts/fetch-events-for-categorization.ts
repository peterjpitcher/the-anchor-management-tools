import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function fetchEventsAndCategories() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch Categories
    const { data: categories, error: catError } = await supabase
        .from('event_categories')
        .select('id, name, slug, description')
        .order('sort_order', { ascending: true })

    if (catError) {
        console.error('Error fetching categories:', catError)
        process.exit(1)
    }

    // Fetch Events (future events + recent past to be safe, let's say from today onwards)
    const today = new Date().toISOString().split('T')[0]

    const { data: events, error: eventError } = await supabase
        .from('events')
        .select('id, name, short_description, long_description, category_id, date, event_status')
        .gte('date', today)
        .neq('event_status', 'cancelled')
        .order('date', { ascending: true })

    if (eventError) {
        console.error('Error fetching events:', eventError)
        process.exit(1)
    }

    console.log(JSON.stringify({ categories, events }, null, 2))
}

fetchEventsAndCategories().catch(console.error)
